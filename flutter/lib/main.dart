import 'package:flutter/material.dart';

import 'core.dart';
import 'pages_account.dart';
import 'pages_domains.dart';
import 'pages_home.dart';
import 'pages_hub.dart';
import 'widgets.dart';

// Noxc · Flutter（Android / iOS / iPad）
// 一套 Dart 代码全端统一，平台差异只留在 PlatformX / RootPage 的布局分支里。

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Store.init();
  PlatformX.localeZh =
      WidgetsBinding.instance.platformDispatcher.locale.languageCode == 'zh';

  final state = AppState();
  await state.api.loadBundled(); // 离线契约先就绪，界面立刻能画
  runApp(NoxcApp(state: state));
  // 网络放首帧之后，站点不可达也不会拖慢启动；骨架屏先撑住界面。
  WidgetsBinding.instance.addPostFrameCallback((_) => state.load());
}

class NoxcApp extends StatelessWidget {
  final AppState state;
  const NoxcApp({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return AppScope(
      notifier: state,
      child: AnimatedBuilder(
        animation: appTheme,
        builder: (context, _) => MaterialApp(
          title: 'Noxc',
          debugShowCheckedModeBanner: false,
          theme: appTheme.light(),
          darkTheme: appTheme.dark(),
          themeMode: appTheme.materialMode,
          onGenerateRoute: AppRoutes.onGenerate,
          home: const RootPage(),
        ),
      ),
    );
  }
}

/// 路由收口：页面里只写 `Navigator.pushNamed`，不自己 new Route。
class AppRoutes {
  static Route<dynamic> onGenerate(RouteSettings s) {
    final name = s.name ?? '/';
    late Widget page;
    switch (name) {
      case '/hub':
        page = const HubPage();
        break;
      case '/group':
        page = GroupPage(group: (s.arguments as Map?)?['g'] as int? ?? 0);
        break;
      case '/screen':
        final a = (s.arguments as Map?) ?? <String, dynamic>{};
        page = SchemaPage(
            group: a['g'] as int? ?? 0, screen: a['s'] as int? ?? 0);
        break;
      case '/settings':
        page = const SettingsPage();
        break;
      case '/account':
        page = const AccountPage();
        break;
      default:
        page = const RootPage();
    }
    return PageRouteBuilder(
      settings: s,
      pageBuilder: (_, __, ___) => page,
      transitionsBuilder: (_, anim, __, child) => FadeTransition(
        opacity: CurvedAnimation(parent: anim, curve: Curves.easeOutCubic),
        child: SlideTransition(
          position: Tween<Offset>(begin: const Offset(0, .025), end: Offset.zero)
              .animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
          child: child,
        ),
      ),
      transitionDuration: const Duration(milliseconds: 260),
    );
  }
}

class RootPage extends StatefulWidget {
  const RootPage({super.key});

  @override
  State<RootPage> createState() => _RootPageState();
}

class _RootPageState extends State<RootPage> {
  int _tab = 0;

  List<Widget> _pages() => <Widget>[
        HomePage(onOpenHub: () => setState(() => _tab = 3)),
        const DomainsPage(),
        const PointsPage(),
        const HubPage(),
        const ProfilePage(),
      ];

  static const _labels = <(String, String)>[
    ('首页', 'Home'),
    ('域名', 'Domains'),
    ('积分', 'Points'),
    ('功能', 'Features'),
    ('我的', 'Profile'),
  ];

  static const _icons = <(IconData, IconData)>[
    (Icons.home_outlined, Icons.home_rounded),
    (Icons.language_outlined, Icons.language_rounded),
    (Icons.stars_outlined, Icons.stars_rounded),
    (Icons.apps_outlined, Icons.apps_rounded),
    (Icons.person_outline, Icons.person_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      final pad = PlatformX.pad(w);
      final body = IndexedStack(index: _tab, children: _pages());

      if (pad) {
        // iPad：左侧 NavigationRail + 右侧内容；HubPage 内部再做一层双栏。
        return Scaffold(
          body: Row(children: [
            SafeArea(
              child: NavigationRail(
                selectedIndex: _tab,
                onDestinationSelected: (i) => setState(() => _tab = i),
                labelType: NavigationRailLabelType.all,
                minWidth: 76,
                groupAlignment: -.15,
                leading: Padding(
                  padding: const EdgeInsets.fromLTRB(8, 18, 8, 22),
                  child: Column(children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Image.asset('assets/images/art_group_0.png', width: 42, height: 42, fit: BoxFit.cover),
                    ),
                    const SizedBox(height: 8),
                    Text('Noxc', style: TextStyle(fontFamily: 'NotoSerifSC', fontSize: 13, color: cs.primary)),
                  ]),
                ),
                trailing: Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: IconButton(
                    icon: const Icon(Icons.settings_outlined),
                    onPressed: () => Navigator.pushNamed(context, '/settings'),
                  ),
                ),
                destinations: List.generate(_labels.length, (i) => NavigationRailDestination(
                      icon: Icon(_icons[i].$1),
                      selectedIcon: Icon(_icons[i].$2, color: cs.primary),
                      label: Text(zh ? _labels[i].$1 : _labels[i].$2),
                    )),
              ),
            ),
            VerticalDivider(width: 1, color: cs.outlineVariant),
            Expanded(child: body),
          ]),
        );
      }

      // 手机：悬浮胶囊底栏（PiliPlus 形态），内容延伸到栏下
      return Scaffold(
        extendBody: true,
        body: body,
        bottomNavigationBar: FloatNav(
          current: _tab,
          onTap: (i) => setState(() => _tab = i),
          admin: AppScope.of(context).isAdmin,
        ),
      );
    });
  }
}
