import SwiftUI

struct PointsView: View {
    @EnvironmentObject var store: AppStore
    @State private var showAccount = false
    @State private var code = ""
    @State private var rewards: [J] = []
    @State private var result: APIResult?
    @State private var resultLabel = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !store.loggedIn {
                    SignInPrompt { self.showAccount = true }
                } else {
                    Card {
                        SectionTitle(text: L10n.balance)
                        CountUp(value: jI(store.points, "points"))
                        Text(jB(store.points, "checked")
                             ? L10n.t("今日已签到", "Checked in today")
                             : L10n.t("今日还未签到", "Not checked in yet"))
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                        PillButton(title: L10n.checkin, prominent: true) {
                            Task { @MainActor in
                                let r = await store.call(ep: "checkin")
                                self.result = r
                                self.resultLabel = L10n.checkin
                            }
                        }
                        .padding(.top, 10)
                    }
                    .modifier(Stagger(index: 0))

                    Card {
                        SectionTitle(text: L10n.rewards)
                        TextField(L10n.redeemCode, text: $code)
                            .textInputAutocapitalization(.never)
                            .padding(10)
                            .background(C.input)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        PillButton(title: L10n.redeem) {
                            Task { @MainActor in
                                let r = await store.call(ep: "redeem", body: ["code": code])
                                self.result = r
                                self.resultLabel = L10n.redeem
                            }
                        }
                        .padding(.top, 10)
                    }
                    .modifier(Stagger(index: 1))

                    if !rewards.isEmpty {
                        Card {
                            SectionTitle(text: L10n.rewards)
                            ForEach(0..<min(rewards.count, 20), id: \.self) { i in
                                Text(jRowTitle(rewards[i]))
                                    .font(BrandFont.body(12))
                                    .foregroundStyle(C.text)
                                Text(jRowSummary(rewards[i]))
                                    .font(BrandFont.body(10))
                                    .foregroundStyle(C.dim)
                                    .padding(.bottom, 6)
                            }
                        }
                        .modifier(Stagger(index: 2))
                    }

                    if let r = result { ResultCard(result: r, label: resultLabel) }

                    let logs = jAJ(store.points, "logs")
                    if !logs.isEmpty {
                        Card {
                            SectionTitle(text: L10n.t("积分明细", "Point history"))
                            ForEach(0..<min(logs.count, 12), id: \.self) { i in
                                Text(jRowSummary(logs[i]))
                                    .font(BrandFont.body(10))
                                    .foregroundStyle(C.dim)
                                    .padding(.bottom, 5)
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
        .refreshable {
            await store.refresh()
            await loadRewards()
        }
        .sheet(isPresented: $showAccount) { AccountView() }
        .task { await loadRewards() }
    }

    @MainActor
    private func loadRewards() async {
        let r = await store.api.call(ep: "rewards", method: "GET")
        if r.ok { rewards = jAJ(r.data, "items") }
    }
}
