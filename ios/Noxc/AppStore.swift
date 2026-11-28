import Foundation
import SwiftUI

/// App 全局状态。所有网络结果回到主线程后再写 @Published，
/// 页面只渲染，不自己发 URLSession。
final class AppStore: ObservableObject {
    @Published var boot: J = [:]
    @Published var site: J = [:]
    @Published var user: J = [:]
    @Published var domains: [J] = []
    @Published var points: J = [:]
    @Published var isAdmin = false
    @Published var groups: [J] = []
    @Published var schemaVersion = 0
    @Published var schemaOffline = false
    @Published var loading = true
    @Published var error = ""
    @Published var reduceMotion = Motion.reduce
    @Published var siteURL = AppAPI.currentSite()

    let api = AppAPI()

    var loggedIn: Bool { !user.isEmpty }

    // MARK: - 冷启动

    @MainActor
    func load(fresh: Bool = false) async {
        loading = true
        let r = await api.bootstrap(fresh: fresh)
        if r.ok {
            applyBoot(r.data)
            error = ""
        } else {
            error = r.display
        }
        await loadSchema()
        loading = false
    }

    /// 下拉刷新 / 写操作之后只重取登录态数据，不重复解析 schema。
    @MainActor
    func refresh() async {
        let r = await api.bootstrap(fresh: true)
        if r.ok { applyBoot(r.data); error = "" }
    }

    @MainActor
    private func applyBoot(_ data: J) {
        boot = data
        site = jO(data, "site")
        user = jOOpt(data, "user") ?? [:]
        isAdmin = jB(site, "isAdmin") || jS(user, "role") == "admin"
        domains = jAJ(jOOpt(data, "domains"), "items")
        points = jOOpt(data, "points") ?? [:]
        api.persistEndpoints(jO(data, "endpoints"))
    }

    // MARK: - 全站功能描述

    @MainActor
    func loadSchema() async {
        let r = await api.schema()
        if r.ok, !jA(r.data, "groups").isEmpty {
            groups = jAJ(r.data, "groups")
            schemaVersion = jI(r.data, "v")
            schemaOffline = false
            return
        }
        let bundled = AppStore.bundledSchema()
        groups = jAJ(bundled, "groups")
        schemaVersion = jI(bundled, "v")
        schemaOffline = !groups.isEmpty
    }

    static func bundledSchema() -> J {
        guard let url = Bundle.main.url(forResource: "schema", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? J else { return [:] }
        return obj
    }

    func groupScreens(_ i: Int) -> [J] {
        guard i >= 0, i < groups.count else { return [] }
        return jAJ(groups[i], "screens")
    }

    func screen(_ g: Int, _ s: Int) -> J {
        let arr = groupScreens(g)
        guard s >= 0, s < arr.count else { return [:] }
        return arr[s]
    }

    // MARK: - 动作

    /// 原生页与 schema 渲染器共用：执行一个契约动作，成功后刷新登录态数据。
    @MainActor
    func call(ep: String, method: String = "POST", body: J = [:],
              vars: [String: String] = [:], query: J = [:],
              refreshAfter: Bool = true) async -> APIResult {
        let r = await api.call(ep: ep, method: method, body: body, vars: vars, query: query)
        if r.ok && refreshAfter { await refresh() }
        return r
    }

    /// 把 schema 动作（含 const / vars / 行数据）翻译成一次请求。
    @MainActor
    func execute(action: J, row: J? = nil, extra: J = [:]) async -> APIResult {
        let ep = jS(action, "ep")
        let method = jS(action, "m", "POST")
        if ep.isEmpty { return .failure("接口配置缺失") }
        var body = extra
        let consts = jO(action, "const")
        for (k, v) in consts { body[k] = v }

        var vars: [String: String] = [:]
        for k in jSArr(action, "vars") { vars[k] = valueFor(k, body: body, row: row) }
        // 路径里出现的占位符，即使 vars 没列出来也尝试从行数据补
        let path = api.endpoint(ep)
        for ph in AppAPI.placeholders(path) where vars[ph] == nil {
            vars[ph] = valueFor(ph, body: body, row: row)
        }
        let q = method == "GET" ? body : [:]
        let payload = method == "GET" ? [:] : body
        return await call(ep: ep, method: method, body: payload,
                          vars: vars, query: q, refreshAfter: false)
    }

    private func valueFor(_ k: String, body: J, row: J?) -> String {
        if let v = body[k], !jStrOf(v).isEmpty { return jStrOf(v) }
        if let row = row {
            let v = jStrOf(row[k])
            if !v.isEmpty && v != "0" { return v }
            if k == "domain" {
                let fqdn = jS(row, "fqdn")
                if !fqdn.isEmpty { return fqdn }
                let d = jS(row, "domain")
                if !d.isEmpty { return d }
                let root = jS(row, "root_domain")
                if !root.isEmpty { return root }
            }
            if k == "rid" || k == "id" {
                let id = jS(row, "id")
                if !id.isEmpty { return id }
            }
            if k == "email" {
                let e = jS(row, "email")
                if !e.isEmpty { return e }
            }
        }
        return ""
    }

    // MARK: - 偏好

    func setReduce(_ on: Bool) {
        Motion.setReduce(on)
        reduceMotion = on
    }

    func setSite(_ raw: String) {
        api.setSite(raw)
        siteURL = api.siteBase
        api.clearSession()
        Task { await load(fresh: true) }
    }
}
