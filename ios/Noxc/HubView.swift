import SwiftUI

struct HubItem: Identifiable {
    let id: Int
    let group: J
    let count: Int
}

/// 全部功能总入口：Bento 网格随屏宽自适应（iPhone 2 列 / iPad 3–4 列），
/// 搜索即时过滤分组与页面，统计数字滚动，卡片错落入场。
struct HubView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.horizontalSizeClass) private var hSize
    let onGroup: (Int) -> Void

    @State private var query = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HeroArt(height: hSize == .regular ? 160 : 132)
                    .modifier(Stagger(index: 0))

                Card {
                    HStack(alignment: .top) {
                        stat(L10n.featureGroups, store.groups.count)
                        stat(L10n.screens, totalScreens)
                        stat(L10n.endpoints, jI(store.site, "featureEndpoints"))
                    }
                }
                .modifier(Stagger(index: 1))

                TextField(L10n.search, text: $query)
                    .font(BrandFont.body(13))
                    .padding(12)
                    .background(C.input)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14)
                        .stroke(C.hair, lineWidth: 1))

                if store.groups.isEmpty {
                    SkeletonView(lines: 4)
                } else if items.isEmpty {
                    EmptyStateView(text: L10n.noMatch)
                } else {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(items) { item in
                            Button { onGroup(item.id) } label: {
                                BentoCard(group: item.group, index: item.id,
                                          screenCount: item.count)
                            }
                            .buttonStyle(PressButtonStyle())
                            .modifier(Stagger(index: item.id))
                        }
                    }
                }

                if store.schemaOffline {
                    Text(L10n.offline)
                        .font(BrandFont.body(10))
                        .foregroundStyle(C.dim)
                }
                Text(L10n.t("功能清单来自站点下发的 schema，新增功能无需更新 App。",
                            "The feature list comes from a server-side schema; new features need no app update."))
                    .font(BrandFont.body(10))
                    .foregroundStyle(C.dim)
                    .padding(.top, 4)
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
    }

    private var columns: [GridItem] {
        let min: CGFloat = hSize == .regular ? 240 : 158
        return [GridItem(.adaptive(minimum: min), spacing: 14)]
    }

    private var totalScreens: Int {
        store.groups.reduce(0) { $0 + jAJ($1, "screens").count }
    }

    private var items: [HubItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        var out: [HubItem] = []
        for (i, g) in store.groups.enumerated() {
            let screens = jAJ(g, "screens")
            var hit = q.isEmpty || jLabel(g).lowercased().contains(q)
            if !hit {
                for s in screens {
                    if jLabel(s).lowercased().contains(q) { hit = true; break }
                }
            }
            if hit { out.append(HubItem(id: i, group: g, count: screens.count)) }
        }
        return out
    }

    private func stat(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 3) {
            CountUp(value: value)
            Text(title).font(BrandFont.body(10)).foregroundStyle(C.dim)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 分组二级页：列出该组下全部站点页面，点进去由 SchemaScreenView 动态渲染。
struct GroupView: View {
    @EnvironmentObject var store: AppStore
    let group: Int
    let onScreen: (Int) -> Void

    private var screens: [J] { store.groupScreens(group) }
    @State private var glow = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(jLabel(jGroup(store.groups, group)))
                                .font(BrandFont.display(20))
                                .foregroundStyle(C.text)
                            Text("\(screens.count) \(L10n.screens)")
                                .font(BrandFont.body(11))
                                .foregroundStyle(C.dim)
                        }
                        Spacer()
                        Image(systemName: jB(jGroup(store.groups, group), "admin")
                              ? "checkmark.shield" : "sparkles")
                            .font(.system(size: 28))
                            .foregroundStyle(C.pink)
                            .scaleEffect(glow ? 1.08 : 1)
                            .onAppear {
                                guard !store.reduceMotion else { return }
                                withAnimation(.easeInOut(duration: 2.2)
                                    .repeatForever(autoreverses: true)) {
                                    self.glow = true
                                }
                            }
                    }
                }
                .modifier(Stagger(index: 0))

                ForEach(0..<screens.count, id: \.self) { i in
                    let s = screens[i]
                    Button { onScreen(i) } label: {
                        Card {
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(jLabel(s))
                                        .font(BrandFont.display(15))
                                        .foregroundStyle(C.text)
                                    let admin = jB(s, "admin") || jB(jGroup(store.groups, group), "admin")
                                    Text((admin ? L10n.adminOnly + "  ·  " : "")
                                         + "\(jAJ(s, "forms").count) \(L10n.save)"
                                         + "  ·  \(jAJ(s, "actions").count) \(L10n.run)")
                                        .font(BrandFont.body(10))
                                        .foregroundStyle(C.dim)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(C.pink)
                            }
                        }
                        .opacity(adminDim(s) ? 0.6 : 1)
                    }
                    .buttonStyle(PressButtonStyle())
                    .modifier(Stagger(index: i + 1))
                }

                if screens.isEmpty { EmptyStateView() }
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
    }

    private func adminDim(_ s: J) -> Bool {
        (jB(s, "admin") || jB(jGroup(store.groups, group), "admin")) && !store.isAdmin
    }
}

/// 安全取组：索引越界时返回空字典，jLabel / jB 都能安全处理。
private func jGroup(_ groups: [J], _ i: Int) -> J {
    (i >= 0 && i < groups.count) ? groups[i] : [:]
}
