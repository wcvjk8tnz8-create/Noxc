import Foundation

struct APIResult {
    let ok: Bool
    let code: Int
    let data: J
    let message: String

    static func failure(_ text: String) -> APIResult {
        APIResult(ok: false, code: 0, data: [:], message: text)
    }

    var display: String {
        if ok { return jPretty(data) }
        return message.isEmpty ? "HTTP \(code)" : message
    }
}

/// 与 Android 的 Api.java 同一口径：
///  - 冷启动只打 /api/app/v1/bootstrap
///  - 所有按钮走 bootstrap 下发的 endpoints 契约，客户端零硬编码
///  - 会话是 Cookie: sh_session=<token>，登录 / 注册自动从 Set-Cookie 或 body.token 保存
///  - 没网时用 Generated/Endpoints.swift 的静态契约兜底
final class AppAPI {

    private static let siteKey = "noxc.site"
    private static let epsKey = "noxc.endpoints"
    private static let sessionKey = "noxc.session"
    private static let fallbackSite = "https://nic.299282.xyz/"

    static func currentSite() -> String {
        let d = UserDefaults.standard
        if let v = d.string(forKey: siteKey), !v.isEmpty { return normalize(v) }
        if let v = Bundle.main.object(forInfoDictionaryKey: "NoxcSiteURL") as? String,
           !v.isEmpty { return normalize(v) }
        return fallbackSite
    }

    private static func normalize(_ raw: String) -> String {
        var v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !(v.hasPrefix("https://") || v.hasPrefix("http://")) { v = "https://" + v }
        if !v.hasSuffix("/") { v += "/" }
        return v
    }

    var siteBase: String { AppAPI.currentSite() }

    func setSite(_ raw: String) {
        UserDefaults.standard.set(AppAPI.normalize(raw), forKey: AppAPI.siteKey)
    }

    var session: String { UserDefaults.standard.string(forKey: AppAPI.sessionKey) ?? "" }
    func saveSession(_ v: String) {
        if !v.isEmpty { UserDefaults.standard.set(v, forKey: AppAPI.sessionKey) }
    }
    func clearSession() { UserDefaults.standard.removeObject(forKey: AppAPI.sessionKey) }

    func persistEndpoints(_ eps: J) {
        var out: [String: String] = [:]
        for (k, v) in eps {
            if let s = v as? String { out[k] = s }
        }
        if !out.isEmpty { UserDefaults.standard.set(out, forKey: AppAPI.epsKey) }
    }

    func endpoint(_ key: String) -> String {
        let live = UserDefaults.standard.dictionary(forKey: AppAPI.epsKey) as? [String: String] ?? [:]
        return live[key] ?? Endpoints.defaults[key] ?? ""
    }

    /// 取出契约路径里所有 {placeholder} 名字，供渲染器从行数据补值。
    static func placeholders(_ path: String) -> [String] {
        var out: [String] = []
        var rest = path
        while let r = rest.range(of: "\\{(\\w+)\\}", options: .regularExpression) {
            let token = String(rest[r])
            let name = String(token.dropFirst().dropLast())
            if !out.contains(name) { out.append(name) }
            rest = String(rest[r.upperBound...])
        }
        return out
    }

    // MARK: - 请求

    func bootstrap(fresh: Bool = false) async -> APIResult {
        let p = "/api/app/v1/bootstrap" + (fresh ? "?_=\(Int(Date().timeIntervalSince1970 * 1000))" : "")
        return await request("GET", p)
    }

    func schema() async -> APIResult {
        await request("GET", endpoint("schema").isEmpty ? "/api/app/v1/schema" : endpoint("schema"))
    }

    /// 统一执行器：ep 是契约 key，vars 替换 {id}/{rid}/{domain}/{email}/{kind}，
    /// GET 时 body 转 query。残留的可选占位符被清掉，绝不把字面 {status} 打给服务端。
    func call(ep: String, method: String = "POST", body: J = [:],
              vars: [String: String] = [:], query: J = [:]) async -> APIResult {
        var path = endpoint(ep)
        if path.isEmpty { return .failure("接口配置缺失：\(ep)") }
        for (k, v) in vars {
            let safe = v.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? v
            path = path.replacingOccurrences(of: "{\(k)}", with: safe)
        }
        path = path.replacingOccurrences(of: "\\{\\w+\\}", with: "", options: .regularExpression)
        return await request(method, path, method == "GET" ? nil : body, query: query)
    }

    func request(_ method: String, _ path: String, _ body: J? = nil,
                 query: J = [:]) async -> APIResult {
        let full = siteBase + (path.hasPrefix("/") ? String(path.dropFirst()) : path)
        guard var comps = URLComponents(string: full) else { return .failure("站点地址无效") }
        if !query.isEmpty {
            var items = comps.queryItems ?? []
            for (k, v) in query {
                let s = jStrOf(v)
                if !s.isEmpty { items.append(URLQueryItem(name: k, value: s)) }
            }
            comps.queryItems = items
        }
        guard let url = comps.url else { return .failure("站点地址无效") }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("NoxcApp/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        req.setValue(L10n.zh ? "zh-CN,zh;q=0.9" : "en-US,en;q=0.9",
                     forHTTPHeaderField: "Accept-Language")
        if !session.isEmpty { req.setValue("sh_session=\(session)", forHTTPHeaderField: "Cookie") }
        if let body = body, method != "GET" {
            req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            let http = response as? HTTPURLResponse
            let code = http?.statusCode ?? 0
            if let http = http { absorbCookies(http, url: url) }
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? J ?? [:]
            if let t = obj["token"] as? String { saveSession(t) }
            let envelopeOK = obj["success"] as? Bool
            let good = envelopeOK ?? (code >= 200 && code < 300)
            var msg = obj["message"] as? String ?? obj["error"] as? String ?? ""
            if !good && msg.isEmpty { msg = "HTTP \(code)" }
            if !good && obj.isEmpty { msg = "无法解析站点响应（HTTP \(code)）" }
            return APIResult(ok: good, code: code, data: obj, message: msg)
        } catch {
            return .failure("无法连接站点：\(error.localizedDescription)")
        }
    }

    private func absorbCookies(_ http: HTTPURLResponse, url: URL) {
        var fields: [String: String] = [:]
        for (k, v) in http.allHeaderFields { fields["\(k)"] = "\(v)" }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: url) {
            if cookie.name == "sh_session" { saveSession(cookie.value) }
        }
        // 有些代理会把多个 Set-Cookie 拼成一个字符串
        if let raw = fields["Set-Cookie"],
           let r = raw.range(of: "sh_session=([^;,\\s]+)", options: .regularExpression) {
            let pair = String(raw[r]).replacingOccurrences(of: "sh_session=", with: "")
            saveSession(pair)
        }
    }
}
