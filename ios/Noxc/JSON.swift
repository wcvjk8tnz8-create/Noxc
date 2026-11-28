import Foundation

/// schema / 接口返回值统一当作 [String: Any] 处理。
/// 不用 Codable：服务端 schema 里 opt/const/vars 是异构结构，手写的
/// 强类型模型反而容易因为一个可选字段解析失败整页空白。
typealias J = [String: Any]

func jO(_ o: J?, _ k: String) -> J { (o?[k] as? J) ?? [:] }
func jOOpt(_ o: J?, _ k: String) -> J? { o?[k] as? J }
func jA(_ o: J?, _ k: String) -> [Any] { (o?[k] as? [Any]) ?? [] }
func jAJ(_ o: J?, _ k: String) -> [J] { jA(o, k).compactMap { $0 as? J } }

func jSArr(_ o: J?, _ k: String) -> [String] {
    jA(o, k).compactMap { $0 as? String }
}

func jStrOf(_ v: Any?) -> String {
    guard let v = v else { return "" }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    if let b = v as? Bool { return b ? "true" : "false" }
    return ""
}

func jS(_ o: J?, _ k: String, _ d: String = "") -> String {
    guard let v = o?[k] else { return d }
    let s = jStrOf(v)
    return s.isEmpty ? d : s
}

func jI(_ o: J?, _ k: String, _ d: Int = 0) -> Int {
    guard let v = o?[k] else { return d }
    if let n = v as? NSNumber { return n.intValue }
    if let s = v as? String { return Int(s) ?? d }
    return d
}

func jB(_ o: J?, _ k: String, _ d: Bool = false) -> Bool {
    guard let v = o?[k] else { return d }
    if let b = v as? Bool { return b }
    if let n = v as? NSNumber { return n.boolValue }
    if let s = v as? String { return s == "1" || s.lowercased() == "true" }
    return d
}

/// schema 里每个条目都带 l(中) / le(英)。
func jLabel(_ o: J?) -> String {
    guard let o = o else { return "" }
    let zh = jS(o, "l")
    let en = jS(o, "le")
    return L10n.zh ? (zh.isEmpty ? en : zh) : (en.isEmpty ? zh : en)
}

func jPretty(_ o: J) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
          let s = String(data: d, encoding: .utf8) else { return "" }
    return s
}

/// 数据行摘要：取前若干个标量字段拼一行，避免嵌套对象直接打印成 <null>。
func jRowTitle(_ row: J) -> String {
    for k in ["fqdn", "domain", "email", "subject", "title", "name",
              "ip", "code", "label", "key", "action", "root_domain"] {
        let v = jS(row, k)
        if !v.isEmpty { return v }
    }
    let id = jI(row, "id")
    return id == 0 ? L10n.result : "#\(id)"
}

func jRowSummary(_ row: J) -> String {
    var parts: [String] = []
    for k in row.keys.sorted() {
        if parts.count >= 6 { break }
        let v = jStrOf(row[k])
        if v.isEmpty || v.count > 90 { continue }
        if k == "l" || k == "le" { continue }
        parts.append("\(k)=\(v)")
    }
    return parts.joined(separator: "  ·  ")
}
