import SwiftUI

@main
struct NoxcApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        // WindowGroup + Info.plist 的 UIApplicationSupportsMultipleScenes
        // 让 iPad 可以开第二个窗口、台前调度与 Split View。
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.load() }
        }
    }
}

/// iPhone 用标签栏，iPad 用三栏 NavigationSplitView；
/// 同一套页面组件，按 horizontalSizeClass 自动切换，不做两套 UI。
struct NavItem: Identifiable {
    let id: String
    let title: String
    let icon: String
}

enum Route: Hashable {
    case group(Int)
    case screen(Int, Int)
}

struct RootView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var tab = 0
    @State private var hubPath: [Route] = []
    @State private var selection = "home"
    @State private var pickedGroup = -1
    @State private var pickedScreen = -1

    var body: some View {
        Group {
            if hSize == .regular { iPadRoot } else { iPhoneRoot }
        }
        .preferredColorScheme(.dark)
        .tint(C.pink)
        .background(C.bg.ignoresSafeArea())
    }

    // MARK: - iPhone

    private var iPhoneRoot: some View {
        TabView(selection: $tab) {
            NavigationStack {
                HomeView(openHub: { self.tab = 3 })
                    .navigationTitle(L10n.home)
            }
            .tabItem { Label(L10n.home, systemImage: "house.fill") }
            .tag(0)

            NavigationStack {
                DomainsView()
                    .navigationTitle(L10n.domains)
            }
            .tabItem { Label(L10n.domains, systemImage: "globe") }
            .tag(1)

            NavigationStack {
                PointsView()
                    .navigationTitle(L10n.points)
            }
            .tabItem { Label(L10n.points, systemImage: "star.fill") }
            .tag(2)

            NavigationStack(path: $hubPath) {
                HubView(onGroup: { i in self.hubPath.append(Route.group(i)) })
                    .navigationTitle(L10n.allFeatures)
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .group(let g):
                            GroupView(group: g) { s in
                                self.hubPath.append(Route.screen(g, s))
                            }
                        case .screen(let g, let s):
                            SchemaScreenView(group: g, screen: s)
                        }
                    }
            }
            .tabItem { Label(L10n.allFeatures, systemImage: "square.grid.2x2") }
            .tag(3)

            NavigationStack {
                ProfileView()
                    .navigationTitle(L10n.profile)
            }
            .tabItem { Label(L10n.profile, systemImage: "person.crop.circle") }
            .tag(4)
        }
    }

    // MARK: - iPad

    private var iPadRoot: some View {
        NavigationSplitView {
            sidebar
        } content: {
            contentPane
                .navigationTitle(currentTitle)
        } detail: {
            detailPane
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var navItems: [NavItem] {
        [
            NavItem(id: "home", title: L10n.home, icon: "house.fill"),
            NavItem(id: "domains", title: L10n.domains, icon: "globe"),
            NavItem(id: "points", title: L10n.points, icon: "star.fill"),
            NavItem(id: "hub", title: L10n.allFeatures, icon: "square.grid.2x2"),
            NavItem(id: "profile", title: L10n.profile, icon: "person.crop.circle"),
            NavItem(id: "settings", title: L10n.settings, icon: "gearshape"),
        ]
    }

    private var sidebar: some View {
        List {
            Section(L10n.noxc) {
                ForEach(navItems) { item in
                    Button { self.select(item.id) } label: {
                        Label(item.title, systemImage: item.icon)
                            .foregroundStyle(selection == item.id ? C.pink : C.text)
                    }
                }
            }
            Section(L10n.featureGroups) {
                ForEach(0..<store.groups.count, id: \.self) { i in
                    Button { self.select("g\(i)") } label: {
                        Label(jLabel(store.groups[i]), systemImage: iconFor(i))
                            .foregroundStyle(selection == "g\(i)" ? C.pink : C.text)
                    }
                }
            }
            if store.schemaOffline {
                Section {
                    Text(L10n.offline)
                        .font(BrandFont.body(11))
                        .foregroundStyle(C.dim)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Noxc")
    }

    @ViewBuilder private var contentPane: some View {
        switch selection {
        case "home":
            HomeView(openHub: { self.selection = "hub" })
        case "domains":
            DomainsView()
        case "points":
            PointsView()
        case "hub":
            HubView(onGroup: { i in self.select("g\(i)") })
        case "profile":
            ProfileView()
        case "settings":
            SettingsView()
        default:
            if selection.hasPrefix("g"), let i = Int(String(selection.dropFirst())) {
                GroupView(group: i) { s in
                    self.pickedGroup = i
                    self.pickedScreen = s
                }
            } else {
                HeroDetailView()
            }
        }
    }

    @ViewBuilder private var detailPane: some View {
        if pickedScreen >= 0 && pickedGroup >= 0 {
            SchemaScreenView(group: pickedGroup, screen: pickedScreen)
        } else {
            HeroDetailView()
        }
    }

    private func select(_ id: String) {
        selection = id
        pickedScreen = -1
        if id.hasPrefix("g"), let i = Int(String(id.dropFirst())) {
            pickedGroup = i
        }
    }

    private var currentTitle: String {
        if let item = navItems.first(where: { $0.id == selection }) { return item.title }
        if selection.hasPrefix("g"), let i = Int(String(selection.dropFirst())),
           i < store.groups.count { return jLabel(store.groups[i]) }
        return "Noxc"
    }

    private func iconFor(_ i: Int) -> String {
        guard i < store.groups.count else { return "square.grid.2x2" }
        switch jS(store.groups[i], "icon") {
        case "home": return "house"
        case "domain": return "globe"
        case "dns": return "network"
        case "star", "gift": return "star"
        case "person": return "person.crop.circle"
        case "forum": return "bubble.left.and.bubble.right"
        case "public": return "globe.americas"
        case "shield": return "checkmark.shield"
        case "tune": return "slider.horizontal.3"
        case "cloud": return "cloud"
        case "search": return "magnifyingglass"
        default: return "square.grid.2x2"
        }
    }
}

/// iPad 详情栏未选具体功能时的品牌占位，不出现空白面板。
struct HeroDetailView: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeroArt(height: 200)
                Card {
                    SectionTitle(text: L10n.siteStats)
                    HStack(alignment: .top) {
                        statColumn(L10n.featureGroups, jI(store.site, "featureGroups"))
                        statColumn(L10n.screens, jI(store.site, "featureScreens"))
                        statColumn(L10n.endpoints, jI(store.site, "featureEndpoints"))
                    }
                }
                Card {
                    Text(L10n.nativeDetail)
                        .font(BrandFont.body(13))
                        .foregroundStyle(C.text)
                    Text(L10n.builtFor)
                        .font(BrandFont.body(11))
                        .foregroundStyle(C.dim)
                        .padding(.top, 6)
                }
            }
            .padding()
        }
        .background(C.bg.ignoresSafeArea())
    }

    private func statColumn(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 4) {
            CountUp(value: value)
            Text(title)
                .font(BrandFont.body(10))
                .foregroundStyle(C.dim)
        }
        .frame(maxWidth: .infinity)
    }
}
