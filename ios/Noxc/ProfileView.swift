import SwiftUI
import UIKit

struct ProfileView: View {
    @EnvironmentObject var store: AppStore
    @State private var showAccount = false
    @State private var showSettings = false
    @State private var nickname = ""
    @State private var bio = ""
    @State private var result: APIResult?
    @State private var resultLabel = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !store.loggedIn {
                    SignInPrompt { self.showAccount = true }
                } else {
                    Card {
                        SectionTitle(text: jS(store.user, "email", "Noxc"))
                        Text("\(L10n.t("角色", "Role")): \(jS(store.user, "role"))  ·  "
                             + "\(L10n.t("配额", "Quota")): \(jS(store.user, "quota", "-"))")
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                        Text("\(L10n.balance): \(jI(store.points, "points"))")
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                            .padding(.top, 4)
                    }
                    .modifier(Stagger(index: 0))

                    Card {
                        SectionTitle(text: L10n.editProfile)
                        TextField(L10n.nickname, text: $nickname)
                            .padding(10).background(C.input)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        TextField(L10n.bio, text: $bio)
                            .padding(10).background(C.input)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .padding(.top, 8)
                        PillButton(title: L10n.save, prominent: true) {
                            Task { @MainActor in
                                let r = await store.call(ep: "profile", method: "PUT",
                                                         body: ["nickname": nickname, "bio": bio])
                                self.result = r
                                self.resultLabel = L10n.editProfile
                            }
                        }
                        .padding(.top, 10)
                    }
                    .modifier(Stagger(index: 1))

                    if let r = result { ResultCard(result: r, label: resultLabel) }

                    Card {
                        PillButton(title: L10n.settings) { self.showSettings = true }
                        PillButton(title: L10n.signOut, danger: true) {
                            Task { @MainActor in
                                let r = await store.call(ep: "logout", refreshAfter: false)
                                store.api.clearSession()
                                await store.refresh()
                                self.result = r
                                self.resultLabel = L10n.signOut
                            }
                        }
                        .padding(.top, 8)
                    }
                    .modifier(Stagger(index: 2))
                }

                Card {
                    PillButton(title: L10n.settings) { self.showSettings = true }
                }
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
        .refreshable { await store.refresh() }
        .sheet(isPresented: $showAccount) { AccountView() }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .onAppear {
            self.nickname = jS(store.user, "nickname")
            self.bio = jS(store.user, "bio")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var siteText = ""
    @State private var saved = ""

    var body: some View {
        Form {
            Section(L10n.siteURL) {
                TextField("https://", text: $siteText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.URL)
                Button(L10n.save) {
                    store.setSite(siteText)
                    saved = L10n.t("已保存，正在重新连接", "Saved, reconnecting")
                }
                Text(L10n.t("站点地址可在 App 内更换，接口地图会自动刷新。",
                            "Change the site here; the endpoint map refreshes automatically."))
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                if !saved.isEmpty {
                    Text(saved).font(BrandFont.body(10)).foregroundStyle(C.green)
                }
                Text(store.siteURL)
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
            }

            Section(L10n.appearance) {
                Toggle(L10n.reduceMotion, isOn: Binding(
                    get: { store.reduceMotion },
                    set: { store.setReduce($0) }
                ))
                Text(L10n.t("开启后骨架屏、错落入场与数字滚动会退化为瞬时切换。",
                            "When on, shimmer, stagger and counters become instant."))
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                Text(L10n.builtFor)
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
            }

            Section(L10n.about) {
                Text("Noxc · " + L10n.t("iPhone / iPad 原生版", "native for iPhone / iPad"))
                    .font(BrandFont.body(12))
                Text(L10n.t("功能清单来自站点下发的 schema，与 Android 端同源。",
                            "Feature list comes from the same server-side schema as Android."))
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                Button(L10n.openSite) {
                    if let url = URL(string: store.siteURL) { UIApplication.shared.open(url) }
                }
            }
        }
        .onAppear { self.siteText = store.siteURL }
    }
}
