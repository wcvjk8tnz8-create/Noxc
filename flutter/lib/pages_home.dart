import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core.dart';
import 'widgets.dart';

class HomePage extends StatelessWidget {
  final VoidCallback onOpenHub;
  const HomePage({super.key, required this.onOpenHub});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    return RefreshIndicator(
      onRefresh: () => s.refresh(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
        children: [
          Text(zh ? '从名字开始，点亮你的域名' : 'Your dynamo starts with a name',
              style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 26, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(jS(s.site, 'siteName', 'Noxc'), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          const SizedBox(height: 16),
          Stagger(index: 0, child: _hubCard(context, s)),
          const SizedBox(height: 14),
          if (jS(s.site, 'announcement').isNotEmpty)
            Stagger(
              index: 1,
              child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SectionTitle(zh ? '站点公告' : 'Announcement'),
                Text(jS(s.site, 'announcement'), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
              ])),
            ),
          const SizedBox(height: 14),
          Stagger(index: 2, child: _statsCard(context, s)),
          const SizedBox(height: 14),
          Stagger(index: 3, child: _quickCard(context, s)),
          if (s.loading) ...[const SizedBox(height: 14), const Stagger(index: 4, child: Skeleton(lines: 2))],
          if (s.error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: NxCard(child: Text(s.error, style: TextStyle(fontSize: 12, color: cs.error))),
            ),
          const SizedBox(height: 14),
          Text(zh ? '为 Android / iOS / iPad 用一套 Dart 代码构建' : 'One Dart codebase for Android / iOS / iPad',
              style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
        ],
      ),
    );
  }

  Widget _hubCard(BuildContext context, AppState s) {
    return InkWell(
      borderRadius: BorderRadius.circular(22),
      onTap: onOpenHub,
      child: NxCard(
        padding: EdgeInsets.zero,
        radius: 22,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const HeroArt(height: 128),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text(zh ? '全部功能' : 'All features',
                    style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 19, fontWeight: FontWeight.w700)),
                const Spacer(),
                Icon(Icons.arrow_outward, size: 18, color: Theme.of(context).colorScheme.primary),
              ]),
              const SizedBox(height: 4),
              Text(zh ? '网站上的一切，都在这里原生完成' : 'Everything on the site, natively',
                  style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              const SizedBox(height: 14),
              Row(children: [
                _mini(zh ? '功能分组' : 'Groups', jI(s.site, 'featureGroups')),
                _mini(zh ? '页面' : 'Screens', jI(s.site, 'featureScreens')),
                _mini(zh ? '接口动作' : 'Actions', jI(s.site, 'featureEndpoints')),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _mini(String title, int value) => Expanded(
        child: Column(children: [
          CountUp(value, size: 21),
          const SizedBox(height: 3),
          Text(title, style: const TextStyle(fontSize: 10)),
        ]),
      );

  Widget _statsCard(BuildContext context, AppState s) {
    final st = jO(s.site, 'publicStats');
    return NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionTitle(zh ? '站点数据' : 'Site stats'),
      Row(children: [
        _mini(zh ? '已开通域名' : 'Domains', jI(st, 'domains')),
        _mini(zh ? '注册用户' : 'Users', jI(st, 'users')),
      ]),
      if (jS(st, 'hottest').isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text('${zh ? '最热后缀' : 'Hottest'}  ${jS(st, 'hottest')}  HOT',
              style: const TextStyle(fontSize: 11)),
        ),
    ]));
  }

  Widget _quickCard(BuildContext context, AppState s) {
    return NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionTitle(zh ? '快捷操作' : 'Quick actions'),
      if (!s.loggedIn)
        Text(zh ? '登录后可以签到、领积分、管理域名' : 'Sign in to check in and manage domains',
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant))
      else
        _CheckinButton(),
      const SizedBox(height: 10),
      PillButton(zh ? '进入全部功能' : 'Open all features', onTap: onOpenHub, icon: Icons.apps_rounded),
    ]));
  }
}

class _CheckinButton extends StatefulWidget {
  @override
  State<_CheckinButton> createState() => _CheckinButtonState();
}

class _CheckinButtonState extends State<_CheckinButton> {
  bool busy = false;
  String msg = '';

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      PillButton(busy ? (zh ? '处理中…' : 'Working…') : (zh ? '每日签到' : 'Daily check-in'),
          prominent: true,
          icon: Icons.event_available_rounded,
          onTap: busy
              ? null
              : () async {
                  setState(() => busy = true);
                  final r = await AppScope.of(context).call('checkin');
                  if (!mounted) return;
                  setState(() {
                    busy = false;
                    msg = r.ok ? (zh ? '签到成功' : 'Checked in') : r.display;
                  });
                }),
      if (msg.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(msg, style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
        ),
    ]);
  }
}

// ── 积分 ──

class PointsPage extends StatefulWidget {
  const PointsPage({super.key});

  @override
  State<PointsPage> createState() => _PointsPageState();
}

class _PointsPageState extends State<PointsPage> {
  final TextEditingController _code = TextEditingController();
  List<J> rewards = <J>[];
  Reply? result;
  String label = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadRewards());
  }

  Future<void> _loadRewards() async {
    final r = await AppScope.of(context).api.call('rewards', method: 'GET');
    if (!mounted) return;
    if (r.ok) setState(() => rewards = jAJ(r.data, 'items'));
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    if (!s.loggedIn) {
      return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 110), children: [
        _signInPrompt(context),
      ]);
    }
    return RefreshIndicator(
      onRefresh: () async {
        await s.refresh();
        await _loadRewards();
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle(zh ? '当前积分' : 'Balance'),
            CountUp(jI(s.points, 'points'), size: 34),
            const SizedBox(height: 6),
            Text(jB(s.points, 'checked') ? (zh ? '今日已签到' : 'Checked in today') : (zh ? '今日还未签到' : 'Not checked in yet'),
                style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            const SizedBox(height: 12),
            PillButton(zh ? '每日签到' : 'Daily check-in', prominent: true, onTap: () async {
              final r = await s.call('checkin');
              setState(() {
                result = r;
                label = zh ? '签到' : 'Check-in';
              });
            }),
          ]))),
          const SizedBox(height: 14),
          Stagger(index: 1, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle(zh ? '兑换码' : 'Redeem code'),
            TextField(controller: _code, decoration: InputDecoration(hintText: 'DC-XXXXXX')),
            const SizedBox(height: 10),
            PillButton(zh ? '兑换' : 'Redeem', onTap: () async {
              final r = await s.call('redeem', body: <String, dynamic>{'code': _code.text.trim()});
              setState(() {
                result = r;
                label = zh ? '兑换' : 'Redeem';
              });
            }),
          ]))),
          if (rewards.isNotEmpty) ...[
            const SizedBox(height: 14),
            Stagger(index: 2, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionTitle(zh ? '奖励中心' : 'Rewards'),
              ...rewards.take(20).map((r) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(jRowTitleCompat(r), style: const TextStyle(fontSize: 12)),
                  )),
            ]))),
          ],
          if (result != null) ...[
            const SizedBox(height: 14),
            ResultCard(result: result!, label: label),
          ],
          const SizedBox(height: 14),
          NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle(zh ? '积分明细' : 'Point history'),
            ...jAJ(s.points, 'logs').take(12).map((r) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(rowSummary(r), style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                )),
          ])),
        ],
      ),
    );
  }

  Widget _signInPrompt(BuildContext context) => NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionTitle(zh ? '请先登录' : 'Please sign in'),
        Text(zh ? '登录后可以签到、领积分、查看通知与工单。' : 'Sign in to check in and view notifications.',
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 12),
        PillButton(zh ? '登录 / 注册' : 'Sign in / Sign up', prominent: true,
            onTap: () => Navigator.pushNamed(context, '/account')),
      ]));
}

String jRowTitleCompat(J r) => rowTitle(r);

// ── 我的 ──

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  late TextEditingController _nick;
  late TextEditingController _bio;
  Reply? result;

  @override
  void initState() {
    super.initState();
    _nick = TextEditingController();
    _bio = TextEditingController();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final u = AppScope.of(context).user;
    if (_nick.text.isEmpty) _nick.text = jS(u, 'nickname');
    if (_bio.text.isEmpty) _bio.text = jS(u, 'bio');
  }

  @override
  void dispose() {
    _nick.dispose();
    _bio.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    return RefreshIndicator(
      onRefresh: () => s.refresh(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          if (!s.loggedIn)
            Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionTitle(zh ? '请先登录' : 'Please sign in'),
              const SizedBox(height: 10),
              PillButton(zh ? '登录 / 注册' : 'Sign in / Sign up', prominent: true,
                  onTap: () => Navigator.pushNamed(context, '/account')),
            ])))
          else ...[
            Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionTitle(jS(s.user, 'email', 'Noxc')),
              Text('${zh ? '角色' : 'Role'}: ${jS(s.user, 'role')}   ·   '
                  '${zh ? '配额' : 'Quota'}: ${jS(s.user, 'quota', '-')}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
              const SizedBox(height: 5),
              Text('${zh ? '积分' : 'Points'}: ${jI(s.points, 'points')}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            ]))),
            const SizedBox(height: 14),
            Stagger(index: 1, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionTitle(zh ? '资料' : 'Profile'),
              TextField(controller: _nick, decoration: InputDecoration(labelText: zh ? '昵称' : 'Nickname')),
              const SizedBox(height: 10),
              TextField(controller: _bio, decoration: InputDecoration(labelText: zh ? '简介' : 'Bio')),
              const SizedBox(height: 12),
              PillButton(zh ? '保存资料' : 'Save profile', prominent: true, onTap: () async {
                final r = await s.call('profile', method: 'PUT',
                    body: <String, dynamic>{'nickname': _nick.text, 'bio': _bio.text});
                setState(() => result = r);
              }),
            ]))),
          ],
          if (result != null) ...[const SizedBox(height: 14), ResultCard(result: result!, label: zh ? '资料' : 'Profile')],
          const SizedBox(height: 14),
          Stagger(index: 2, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            PillButton(zh ? '设置' : 'Settings', icon: Icons.tune_rounded,
                onTap: () => Navigator.pushNamed(context, '/settings')),
            if (s.loggedIn) ...[
              const SizedBox(height: 10),
              PillButton(zh ? '退出登录' : 'Sign out', danger: true, onTap: () async {
                await s.call('logout', refreshAfter: false);
                Store.clearSession();
                await s.refresh();
              }),
            ],
          ]))),
        ],
      ),
    );
  }
}

// ── 设置：动态主题色 / 亮暗 / 减少动画 / 换站点（PiliPlus 那种高度可定制） ──

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late TextEditingController _site;
  String saved = '';

  @override
  void initState() {
    super.initState();
    _site = TextEditingController(text: Store.site);
  }

  @override
  void dispose() {
    _site.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(zh ? '设置' : 'Settings')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SectionTitle(zh ? '主题色' : 'Accent color'),
          AnimatedBuilder(
            animation: appTheme,
            builder: (_, __) => Wrap(
              spacing: 12,
              runSpacing: 12,
              children: List.generate(AppTheme.seeds.length, (i) {
                final c = AppTheme.seeds[i];
                final active = appTheme.seed == i;
                return GestureDetector(
                  onTap: () => appTheme.setSeed(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 260),
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: c,
                      shape: BoxShape.circle,
                      border: Border.all(color: active ? cs.onSurface : Colors.transparent, width: 3),
                      boxShadow: active ? [BoxShadow(color: c.withOpacity(.5), blurRadius: 12)] : null,
                    ),
                    child: active ? const Icon(Icons.check_rounded, color: Colors.white, size: 20) : null,
                  ),
                );
              }),
            ),
          ),
        ])),
        const SizedBox(height: 14),
        NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SectionTitle(zh ? '外观' : 'Appearance'),
          AnimatedBuilder(
            animation: appTheme,
            builder: (_, __) => SegmentedButton<int>(
              segments: [
                ButtonSegment(value: 0, label: Text(zh ? '系统' : 'System'), icon: const Icon(Icons.brightness_auto, size: 16)),
                ButtonSegment(value: 1, label: Text(zh ? '亮色' : 'Light'), icon: const Icon(Icons.light_mode, size: 16)),
                ButtonSegment(value: 2, label: Text(zh ? '暗色' : 'Dark'), icon: const Icon(Icons.dark_mode, size: 16)),
              ],
              selected: <int>{appTheme.mode},
              onSelectionChanged: (v) => appTheme.setMode(v.first),
            ),
          ),
          const SizedBox(height: 8),
          AnimatedBuilder(
            animation: appTheme,
            builder: (_, __) => SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(zh ? '减少动画' : 'Reduce animations', style: const TextStyle(fontSize: 13)),
              subtitle: Text(zh ? '骨架屏、错落入场与数字滚动会退化为瞬时切换' : 'Shimmer, stagger and counters become instant',
                  style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
              value: appTheme.reduceMotion,
              onChanged: (v) => appTheme.setReduce(v),
            ),
          ),
        ])),
        const SizedBox(height: 14),
        NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SectionTitle(zh ? '站点地址' : 'Site URL'),
          TextField(controller: _site, keyboardType: TextInputType.url, decoration: const InputDecoration(hintText: 'https://')),
          const SizedBox(height: 10),
          PillButton(zh ? '保存并重新连接' : 'Save & reconnect', prominent: true, onTap: () async {
            await AppScope.of(context).setSite(_site.text);
            setState(() => saved = zh ? '已保存，接口地图已刷新' : 'Saved, endpoints refreshed');
          }),
          if (saved.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(saved, style: TextStyle(fontSize: 11, color: cs.primary))),
          const SizedBox(height: 8),
          GestureDetector(
            onTap: () => Clipboard.setData(ClipboardData(text: Store.site)),
            child: Text(Store.site, style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
          ),
        ])),
        const SizedBox(height: 14),
        NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SectionTitle(zh ? '关于' : 'About'),
          Text('Noxc · ${zh ? 'Flutter 版（Android / iOS / iPad）' : 'Flutter build (Android / iOS / iPad)'}',
              style: const TextStyle(fontSize: 12)),
          const SizedBox(height: 6),
          Text(zh
              ? '功能清单来自站点下发的 schema，与接口契约同源；新增站内功能无需更新 App。'
              : 'Feature list comes from the server-side schema; new features need no app update.',
              style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
        ])),
      ]),
    );
  }
}
