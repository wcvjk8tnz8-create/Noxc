import SwiftUI

/// 登录 / 注册 / 找回密码三合一原生表单，与 Android 的账号流程同一套接口。
/// 会话 Cookie 由 AppAPI 自动吸收，登录成功即刷新 bootstrap。
struct AccountView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var mode = 0            // 0 登录 / 1 注册 / 2 找回
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var agree = true
    @State private var busy = false
    @State private var message = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L10n.account, selection: $mode) {
                        Text(L10n.login).tag(0)
                        Text(L10n.register).tag(1)
                        Text(L10n.forgot).tag(2)
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    TextField(L10n.email, text: $email)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .keyboardType(.emailAddress)
                    SecureField(mode == 2 ? L10n.newPassword : L10n.password, text: $password)
                        .textInputAutocapitalization(.never)
                }

                if mode == 1 {
                    Section {
                        Toggle(L10n.t("同意服务条款", "I agree to the Terms"), isOn: $agree)
                    }
                }

                if mode != 0 {
                    Section {
                        TextField(L10n.code, text: $code)
                            .keyboardType(.numberPad)
                        Button(L10n.sendCode) {
                            Task { @MainActor in await self.sendCode() }
                        }
                        .disabled(busy || email.isEmpty)
                    }
                }

                Section {
                    Button(busy ? L10n.loading : actionTitle) {
                        Task { @MainActor in await self.submit() }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                }

                if !message.isEmpty {
                    Section {
                        Text(message)
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                            .textSelection(.enabled)
                    }
                }

                Section {
                    Text(L10n.t("第三方登录需在浏览器里授权，再用一次性码回到 App。",
                                "Third-party sign-in is authorized in the browser, then handed back with a one-time code."))
                        .font(BrandFont.body(10))
                        .foregroundStyle(C.dim)
                }
            }
            .navigationTitle(L10n.account)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.done) { dismiss() }
                }
            }
        }
    }

    private var actionTitle: String {
        mode == 0 ? L10n.login : (mode == 1 ? L10n.register : L10n.forgot)
    }

    @MainActor
    private func sendCode() async {
        busy = true
        let body: J = ["email": email, "scene": mode == 1 ? "register" : "reset"]
        let r = await store.call(ep: "verifySend", body: body, refreshAfter: false)
        message = r.ok ? L10n.t("验证码已发送", "Code sent") : r.display
        busy = false
    }

    @MainActor
    private func submit() async {
        busy = true
        var r: APIResult
        switch mode {
        case 1:
            r = await store.call(ep: "register", body: [
                "email": email, "password": password, "agreeTerms": agree, "code": code,
            ], refreshAfter: false)
        case 2:
            r = await store.call(ep: "reset", body: [
                "email": email, "code": code, "password": password,
            ], refreshAfter: false)
        default:
            r = await store.call(ep: "login", body: [
                "email": email, "password": password, "remember": true,
            ], refreshAfter: false)
        }
        if r.ok {
            await store.refresh()
            message = L10n.success
            if mode != 2 { dismiss() }
        } else {
            message = r.display
        }
        busy = false
    }
}

/// 未登录时各原生页共用的引导卡。
struct SignInPrompt: View {
    let show: () -> Void

    var body: some View {
        Card {
            SectionTitle(text: L10n.notLoggedIn)
            Text(L10n.t("登录后可以管理域名、签到领积分、查看通知与工单。",
                        "Sign in to manage domains, check in, and view notifications."))
                .font(BrandFont.body(12))
                .foregroundStyle(C.dim)
            PillButton(title: L10n.signIn, prominent: true) { show() }
                .padding(.top, 10)
        }
    }
}
