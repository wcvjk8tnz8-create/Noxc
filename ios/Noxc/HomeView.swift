import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: AppStore
    let openHub: () -> Void

    @State private var toast = ""
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L10n.tagline)
                    .font(BrandFont.display(28))
                    .foregroundStyle(C.text)
                Text(jS(store.site, "siteName", "Noxc"))
                    .font(BrandFont.body(12))
                    .foregroundStyle(C.dim)

                hubCard
                    .modifier(Stagger(index: 0))

                let ann = jS(store.site, "announcement")
                if !ann.isEmpty {
                    Card {
                        SectionTitle(text: L10n.announcement)
                        Text(ann).font(BrandFont.body(12)).foregroundStyle(C.dim)
                    }
                    .modifier(Stagger(index: 1))
                }

                statsCard
                    .modifier(Stagger(index: 2))

                quickCard
                    .modifier(Stagger(index: 3))

                if store.loading { SkeletonView(lines: 3) }

                if !store.error.isEmpty {
                    Card {
                        Text(store.error)
                            .font(BrandFont.body(12))
                            .foregroundStyle(C.danger)
                    }
                }

                if !toast.isEmpty {
                    Card {
                        Text(toast)
                            .font(BrandFont.body(11))
                            .foregroundStyle(C.dim)
                            .textSelection(.enabled)
                    }
                }

                Text(L10n.builtFor)
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                    .padding(.top, 8)
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
        .refreshable { await store.refresh() }
    }

    // MARK: - 功能中心 Bento 大卡

    private var hubCard: some View {
        Button(action: openHub) {
            VStack(alignment: .leading, spacing: 0) {
                Image("art_hero")
                    .resizable()
                    .scaledToFill()
                    .frame(height: 124)
                    .clipped()
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.allFeatures)
                        .font(BrandFont.display(20))
                        .foregroundStyle(C.text)
                    Text(L10n.hubSub)
                        .font(BrandFont.body(11))
                        .foregroundStyle(C.dim)
                    HStack(alignment: .top) {
                        miniStat(L10n.featureGroups, jI(store.site, "featureGroups"))
                        miniStat(L10n.screens, jI(store.site, "featureScreens"))
                        miniStat(L10n.endpoints, jI(store.site, "featureEndpoints"))
                    }
                    Text("\(L10n.enter)  →")
                        .font(BrandFont.body(12, weight: .medium))
                        .foregroundStyle(C.pink)
                }
                .padding(14)
            }
            .background(C.card)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(C.hair, lineWidth: 1))
        }
        .buttonStyle(PressButtonStyle())
    }

    private func miniStat(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 3) {
            CountUp(value: value)
            Text(title).font(BrandFont.body(10)).foregroundStyle(C.dim)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - 站点数据

    private var statsCard: some View {
        Card {
            SectionTitle(text: L10n.siteStats)
            let st = jO(store.site, "publicStats")
            HStack(alignment: .top) {
                miniStat(L10n.domains, jI(st, "domains"))
                miniStat(L10n.profile, jI(st, "users"))
            }
            let hot = jS(st, "hottest")
            if !hot.isEmpty {
                Text("\(hot)  🔥")
                    .font(BrandFont.body(11))
                    .foregroundStyle(C.dim)
                    .padding(.top, 6)
            }
        }
    }

    // MARK: - 快捷操作

    private var quickCard: some View {
        Card {
            SectionTitle(text: L10n.points)
            if store.loggedIn {
                PillButton(title: busy ? L10n.loading : L10n.checkin, prominent: true) {
                    Task { @MainActor in
                        self.busy = true
                        let r = await store.call(ep: "checkin")
                        self.toast = r.ok ? L10n.success : r.display
                        self.busy = false
                    }
                }
            } else {
                Text(L10n.notLoggedIn)
                    .font(BrandFont.body(12))
                    .foregroundStyle(C.dim)
            }
            PillButton(title: L10n.allFeatures) { openHub() }
                .padding(.top, 8)
        }
    }
}
