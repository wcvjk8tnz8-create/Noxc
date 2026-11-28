import SwiftUI

struct DomainsView: View {
    @EnvironmentObject var store: AppStore
    @State private var showAccount = false
    @State private var showApply = false
    @State private var result: APIResult?
    @State private var resultLabel = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !store.loggedIn {
                    SignInPrompt { self.showAccount = true }
                } else {
                    Card {
                        SectionTitle(text: L10n.domains)
                        Text("\(L10n.used): \(store.domains.count)  ·  \(jS(store.site, "defaultQuota", "-"))")
                            .font(BrandFont.body(12))
                            .foregroundStyle(C.dim)
                        PillButton(title: L10n.apply, prominent: true) { self.showApply = true }
                            .padding(.top, 10)
                    }
                    .modifier(Stagger(index: 0))

                    if store.domains.isEmpty {
                        EmptyStateView()
                    } else {
                        ForEach(0..<store.domains.count, id: \.self) { i in
                            domainCard(store.domains[i])
                                .modifier(Stagger(index: i + 1))
                        }
                    }

                    if let r = result {
                        ResultCard(result: r, label: resultLabel)
                    }
                }
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
        .refreshable { await store.refresh() }
        .sheet(isPresented: $showAccount) { AccountView() }
        .sheet(isPresented: $showApply) { ApplySheet() }
    }

    private func domainCard(_ row: J) -> some View {
        Card {
            Text(jS(row, "fqdn"))
                .font(BrandFont.display(16))
                .foregroundStyle(C.text)
            Text("\(jS(row, "status"))  ·  \(jS(row, "root_domain"))  ·  \(jS(row, "record_count")) DNS")
                .font(BrandFont.body(11))
                .foregroundStyle(C.dim)
                .padding(.top, 3)

            HStack(spacing: 10) {
                PillButton(title: L10n.renew) {
                    Task { @MainActor in
                        let r = await store.call(ep: "renew", vars: ["id": jS(row, "id")])
                        self.result = r
                        self.resultLabel = L10n.renew
                    }
                }
                PillButton(title: L10n.release, danger: true) {
                    Task { @MainActor in
                        let r = await store.call(ep: "subdomainDelete", method: "DELETE",
                                                 vars: ["id": jS(row, "id")])
                        self.result = r
                        self.resultLabel = L10n.release
                    }
                }
            }
            .padding(.top, 10)
        }
    }
}

/// 申请子域名：先按需完成原生滑块验证，再带 captchaToken 提交。
struct ApplySheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var label = ""
    @State private var root = ""
    @State private var note = ""
    @State private var captchaToken = ""
    @State private var challenge: J = [:]
    @State private var showCaptcha = false
    @State private var message = ""
    @State private var busy = false

    private var roots: [String] {
        let list = jSArr(store.site, "rootDomains")
        if !list.isEmpty { return list }
        let one = jS(store.site, "rootDomain")
        return one.isEmpty ? [] : [one]
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L10n.label, text: $label)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                    Picker(L10n.root, selection: $root) {
                        ForEach(roots, id: \.self) { Text($0).tag($0) }
                    }
                    TextField(L10n.t("备注（可选）", "Note (optional)"), text: $note)
                }
                Section {
                    Button(busy ? L10n.loading : L10n.apply) {
                        Task { @MainActor in await self.submit() }
                    }
                    .disabled(busy || label.isEmpty || root.isEmpty)
                }
                if !message.isEmpty {
                    Section {
                        Text(message)
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle(L10n.apply)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.done) { dismiss() }
                }
            }
            .onAppear {
                if self.root.isEmpty { self.root = self.roots.first ?? "" }
            }
            .task { await self.prepare() }
            .sheet(isPresented: $showCaptcha) {
                CaptchaSheet(initial: challenge) { token in
                    self.captchaToken = token
                }
            }
        }
    }

    @MainActor
    private func prepare() async {
        let r = await store.api.call(ep: "captcha", method: "GET")
        if r.ok && jB(r.data, "enabled") {
            challenge = r.data
            showCaptcha = true
        }
    }

    @MainActor
    private func submit() async {
        busy = true
        var body: J = ["label": label, "root": root, "note": note]
        if !captchaToken.isEmpty { body["captchaToken"] = captchaToken }
        let r = await store.call(ep: "apply", body: body, refreshAfter: false)
        busy = false
        if r.ok {
            await store.refresh()
            dismiss()
        } else {
            message = r.display
            if jB(r.data, "captchaRequired") {
                captchaToken = ""
                await prepare()
            }
        }
    }
}
