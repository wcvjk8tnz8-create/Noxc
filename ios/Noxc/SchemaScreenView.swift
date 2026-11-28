import SwiftUI

private struct Pending {
    let action: J
    let row: J?
    let extra: J
    let label: String
}

/// 全站功能通用渲染器 —— 「所有网站功能都能在 App 里控制」的 iOS 端核心。
/// 不认识任何具体业务，只按服务端 schema 的四种构件渲染：
///   load / forms / actions / rowActions。
/// 路径全走 endpoints 契约，新增站点功能只改服务端生成脚本，不用发版。
struct SchemaScreenView: View {
    @EnvironmentObject var store: AppStore
    let group: Int
    let screen: Int

    @State private var values: [String: String] = [:]
    @State private var flags: [String: Bool] = [:]
    @State private var choices: [String: String] = [:]
    @State private var rows: [Any] = []
    @State private var rawData: J = [:]
    @State private var loading = false
    @State private var loaded = false
    @State private var result: APIResult?
    @State private var resultLabel = ""
    @State private var pending: Pending?
    @State private var showConfirm = false
    @State private var showPrompt = false
    @State private var promptValues: [String: String] = [:]

    private var spec: J { store.screen(group, screen) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard

                if let r = result {
                    ResultCard(result: r, label: resultLabel)
                }

                formsSection
                actionsSection
                dataSection
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
        .navigationTitle(jLabel(spec))
        .id("\(group)-\(screen)")
        .task { await loadData() }
        .refreshable { await loadData() }
        .alert(L10n.confirmTitle, isPresented: $showConfirm) {
            Button(L10n.ok, role: .destructive) {
                if let p = pending {
                    Task { @MainActor in await self.run(p) }
                }
            }
            Button(L10n.cancel, role: .cancel) { }
        } message: {
            Text(L10n.confirmBody)
        }
        .sheet(isPresented: $showPrompt) {
            if let p = pending {
                PromptSheet(action: p.action, values: $promptValues) { extra in
                    let q = Pending(action: p.action, row: p.row, extra: extra, label: p.label)
                    Task { @MainActor in await self.run(q) }
                }
            }
        }
    }

    // MARK: - 头部

    private var headerCard: some View {
        Card {
            Text(jLabel(spec))
                .font(BrandFont.display(19))
                .foregroundStyle(C.text)
            let g: J = (group >= 0 && group < store.groups.count) ? store.groups[group] : [:]
            let admin = jB(spec, "admin") || jB(g, "admin")
            Text((admin ? L10n.adminOnly + "  ·  " : "")
                 + "\(jAJ(spec, "forms").count) \(L10n.save)  ·  "
                 + "\(jAJ(spec, "actions").count) \(L10n.run)")
                .font(BrandFont.body(11))
                .foregroundStyle(C.dim)
                .padding(.top, 4)
            if !jS(spec, "native").isEmpty {
                Text(L10n.t("此页也有精修原生入口（首页 / 域名 / 我的）。",
                            "This page also has a polished native entry (Home / Domains / Profile)."))
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                    .padding(.top, 4)
            }
        }
        .modifier(Stagger(index: 0))
    }

    // MARK: - 动态表单

    @ViewBuilder private var formsSection: some View {
        let forms = jAJ(spec, "forms")
        ForEach(0..<forms.count, id: \.self) { fi in
            let f = forms[fi]
            Card {
                SectionTitle(text: jLabel(f))
                let fields = jAJ(f, "fields")
                ForEach(0..<fields.count, id: \.self) { i in
                    let k = jS(fields[i], "k")
                    FieldRow(fd: fields[i],
                             text: textBinding(k),
                             flag: flagBinding(k),
                             choice: choiceBinding(k))
                }
                PillButton(title: L10n.save, prominent: true) {
                    Task { @MainActor in await self.submitForm(f) }
                }
                .padding(.top, 10)
            }
            .modifier(Stagger(index: fi + 1))
        }
    }

    private func textBinding(_ k: String) -> Binding<String> {
        Binding(get: { self.values[k] ?? "" }, set: { self.values[k] = $0 })
    }

    private func flagBinding(_ k: String) -> Binding<Bool> {
        Binding(get: { self.flags[k] ?? false }, set: { self.flags[k] = $0 })
    }

    private func choiceBinding(_ k: String) -> Binding<String> {
        Binding(get: { self.choices[k] ?? "" }, set: { self.choices[k] = $0 })
    }

    private var mergedValues: [String: String] {
        var d = values
        for (k, v) in flags { d[k] = v ? "1" : "0" }
        for (k, v) in choices where !v.isEmpty { d[k] = v }
        return d
    }

    @MainActor
    private func submitForm(_ f: J) async {
        let body = buildBody(jAJ(f, "fields"), mergedValues)
        let ep = jS(f, "ep")
        let m = jS(f, "m", "POST")
        if ep.isEmpty { return }
        let r: APIResult
        if m == "GET" {
            r = await store.call(ep: ep, method: "GET", query: body, refreshAfter: false)
        } else {
            r = await store.call(ep: ep, method: m, body: body, refreshAfter: false)
        }
        result = r
        resultLabel = jLabel(f)
    }

    // MARK: - 独立动作

    @ViewBuilder private var actionsSection: some View {
        let acts = jAJ(spec, "actions")
        if !acts.isEmpty {
            Card {
                SectionTitle(text: L10n.run)
                ForEach(0..<acts.count, id: \.self) { i in
                    PillButton(title: jLabel(acts[i]), danger: jB(acts[i], "danger")) {
                        self.begin(acts[i], row: nil)
                    }
                    .padding(.top, 8)
                }
            }
        }
    }

    private func begin(_ action: J, row: J?) {
        let p = Pending(action: action, row: row, extra: [:], label: jLabel(action))
        let fields = jAJ(action, "fields")
        if !fields.isEmpty {
            pending = p
            promptValues = [:]
            showPrompt = true
        } else if jB(action, "confirm") {
            pending = p
            showConfirm = true
        } else {
            Task { @MainActor in await self.run(p) }
        }
    }

    @MainActor
    private func run(_ p: Pending) async {
        let r = await store.execute(action: p.action, row: p.row, extra: p.extra)
        result = r
        resultLabel = p.label
        if r.ok && jB(p.action, "load") { await loadData() }
    }

    // MARK: - 数据列表

    @ViewBuilder private var dataSection: some View {
        let load = jO(spec, "load")
        if !jS(load, "ep").isEmpty && jS(spec, "native").isEmpty {
            Card {
                SectionTitle(text: L10n.result)
                if loading {
                    SkeletonView(lines: 3)
                } else if rows.isEmpty {
                    EmptyStateView()
                    let pretty = jPretty(rawData)
                    if pretty.count > 2 {
                        Text(String(pretty.prefix(1600)))
                            .font(BrandFont.body(10))
                            .foregroundStyle(C.dim)
                    }
                } else {
                    ForEach(0..<min(rows.count, 60), id: \.self) { i in
                        if let row = rows[i] as? J {
                            rowCard(row)
                        } else {
                            Text(jStrOf(rows[i]))
                                .font(BrandFont.body(11))
                                .foregroundStyle(C.dim)
                        }
                    }
                    if rows.count > 60 {
                        Text("… \(rows.count - 60) more")
                            .font(BrandFont.body(10))
                            .foregroundStyle(C.dim)
                    }
                }
            }
        } else if jAJ(spec, "forms").isEmpty && jAJ(spec, "actions").isEmpty {
            EmptyStateView()
        }
    }

    private func rowCard(_ row: J) -> some View {
        Card {
            Text(jRowTitle(row))
                .font(BrandFont.display(14))
                .foregroundStyle(C.text)
            Text(jRowSummary(row))
                .font(BrandFont.body(10))
                .foregroundStyle(C.dim)
                .padding(.top, 3)
            let ras = jAJ(spec, "rowActions")
            ForEach(0..<ras.count, id: \.self) { k in
                PillButton(title: jLabel(ras[k]), danger: jB(ras[k], "danger")) {
                    self.begin(ras[k], row: row)
                }
                .padding(.top, 6)
            }
        }
    }

    @MainActor
    private func loadData() async {
        guard let load = jOOpt(spec, "load"),
              !jS(load, "ep").isEmpty,
              jS(spec, "native").isEmpty else {
            loaded = true
            return
        }
        loading = true
        let r = await store.api.call(ep: jS(load, "ep"), method: "GET")
        rawData = r.data
        let key = jS(load, "items")
        var arr = key.isEmpty ? jA(r.data, "items") : jA(r.data, key)
        if arr.isEmpty { arr = jA(r.data, "items") }
        rows = arr
        loading = false
        loaded = true
    }
}

// MARK: - 表单字段

private struct FieldRow: View {
    let fd: J
    @Binding var text: String
    @Binding var flag: Bool
    @Binding var choice: String

    private var type: String { jS(fd, "t", "text") }
    private var title: String { jLabel(fd) }

    private var options: [(String, String)] {
        jA(fd, "opt").compactMap { item -> (String, String)? in
            guard let a = item as? [Any], a.count >= 2 else { return nil }
            return (jStrOf(a[0]), jStrOf(a[1]))
        }
    }

    private func displayName() -> String {
        if choice.isEmpty { return L10n.select }
        for o in options where o.0 == choice { return o.1 }
        return choice
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch type {
            case "bool":
                Toggle(title, isOn: $flag)
                    .font(BrandFont.body(13))
                    .tint(C.pink)

            case "select":
                Text(title).font(BrandFont.body(11)).foregroundStyle(C.dim)
                Menu {
                    ForEach(0..<options.count, id: \.self) { i in
                        Button(options[i].1) { self.choice = options[i].0 }
                    }
                } label: {
                    HStack {
                        Text(displayName())
                            .font(BrandFont.body(13))
                            .foregroundStyle(C.text)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11))
                            .foregroundStyle(C.dim)
                    }
                    .padding(10)
                    .background(C.input)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

            case "area":
                Text(title).font(BrandFont.body(11)).foregroundStyle(C.dim)
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .font(BrandFont.body(13))
                    .foregroundStyle(C.text)
                    .frame(minHeight: 78)
                    .padding(8)
                    .background(C.input)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

            case "secret":
                SecureField(title, text: $text)
                    .font(BrandFont.body(13))
                    .padding(10)
                    .background(C.input)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

            default:
                TextField(title, text: $text)
                    .font(BrandFont.body(13))
                    .keyboardType(type == "num" ? .numberPad : .default)
                    .padding(10)
                    .background(C.input)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.top, 8)
    }
}

// MARK: - 动作参数弹窗

private struct PromptSheet: View {
    @Environment(\.dismiss) private var dismiss
    let action: J
    @Binding var values: [String: String]
    let onRun: (J) -> Void

    var body: some View {
        NavigationStack {
            Form {
                let fields = jAJ(action, "fields")
                ForEach(0..<fields.count, id: \.self) { i in
                    let k = jS(fields[i], "k")
                    TextField(jLabel(fields[i]), text: Binding(
                        get: { self.values[k] ?? "" },
                        set: { self.values[k] = $0 }
                    ))
                    .keyboardType(jS(fields[i], "t") == "num" ? .numberPad : .default)
                }
                Section {
                    Button(L10n.run) {
                        onRun(PromptSheet.build(jAJ(action, "fields"), values))
                        dismiss()
                    }
                }
            }
            .navigationTitle(jLabel(action))
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.cancel) { dismiss() }
                }
            }
        }
    }

    static func build(_ fields: [J], _ vals: [String: String]) -> J {
        var out: J = [:]
        for fd in fields {
            let k = jS(fd, "k")
            let t = jS(fd, "t", "text")
            let v = vals[k] ?? ""
            if k.isEmpty || v.isEmpty { continue }
            if t == "num" { out[k] = Int(v) ?? 0 } else { out[k] = v }
        }
        return out
    }
}

// MARK: - 表单值收集

private func buildBody(_ fields: [J], _ vals: [String: String]) -> J {
    var out: J = [:]
    for fd in fields {
        let k = jS(fd, "k")
        let t = jS(fd, "t", "text")
        if k.isEmpty { continue }
        let v = vals[k] ?? ""
        if t == "bool" {
            if vals[k] != nil { out[k] = (v == "1" || v == "true") }
        } else if v.isEmpty {
            continue
        } else if t == "num" {
            out[k] = Int(v) ?? 0
        } else {
            out[k] = v
        }
    }
    return out
}
