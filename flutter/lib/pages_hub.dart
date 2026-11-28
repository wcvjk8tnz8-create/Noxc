import 'package:flutter/material.dart';

import 'core.dart';
import 'widgets.dart';

// 「所有网站的功能都能在 App 里控制」的 Flutter 实现。
// 不认识任何具体业务，只按服务端 schema 的四种构件渲染：
// load（数据）/ forms（动态表单）/ actions（独立动作）/ rowActions（行内动作）。
// 与 Android / iOS 原生端用的是同一份 schema 与 148 条契约。

class HubPage extends StatefulWidget {
  const HubPage({super.key});

  @override
  State<HubPage> createState() => _HubPageState();
}

class _HubPageState extends State<HubPage> {
  String _q = '';
  int _selected = -1;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      final pad = PlatformX.pad(w);
      final wide = PlatformX.wide(w);
      // 手机 2 列 / iPad 竖屏 3 列 / iPad 横屏左栏 2 列（右栏显示分组详情）
      final cols = wide ? 2 : (pad ? 3 : 2);
      final items = <int>[];
      for (var i = 0; i < s.groups.length; i++) {
        if (_hit(s.groups[i])) items.add(i);
      }

      final left = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
        children: [
          HeroArt(height: pad ? 156 : 128),
          const SizedBox(height: 14),
          NxCard(child: Row(children: [
            _stat(zh ? '功能分组' : 'Groups', s.groups.length),
            _stat(zh ? '页面' : 'Screens', _screens(s)),
            _stat(zh ? '接口动作' : 'Actions', jI(s.site, 'featureEndpoints')),
          ])),
          const SizedBox(height: 14),
          TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: InputDecoration(
              hintText: zh ? '搜索功能' : 'Search features',
              prefixIcon: const Icon(Icons.search_rounded, size: 19),
            ),
          ),
          const SizedBox(height: 14),
          _grid(context, s, cols, items, wide),
          const SizedBox(height: 12),
          Text(
            zh ? '功能清单来自站点下发的 schema，新增功能无需更新 App。'
               : 'Feature list comes from the server-side schema; no app update needed.',
            style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant),
          ),
          if (s.offline)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(zh ? '离线可用：功能清单来自内置快照' : 'Offline: bundled schema snapshot',
                  style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
            ),
        ],
      );

      if (!wide) {
        return RefreshIndicator(onRefresh: () => s.load(fresh: true), child: left);
      }
      // iPad 横屏：左网格 + 右分组详情（PiliPlus Pad 的双栏形态）
      return Row(children: [
        SizedBox(
          width: w * .48,
          child: RefreshIndicator(onRefresh: () => s.load(fresh: true), child: left),
        ),
        VerticalDivider(width: 1, color: cs.outlineVariant),
        Expanded(
          child: _selected >= 0 && _selected < s.groups.length
              ? GroupPage(
                  key: ValueKey(_selected),
                  group: _selected,
                  onScreen: (i) => Navigator.pushNamed(context, '/screen',
                      arguments: <String, dynamic>{'g': _selected, 's': i}),
                )
              : _heroDetail(context, s),
        ),
      ]);
    });
  }

  Widget _heroDetail(BuildContext context, AppState s) {
    final cs = Theme.of(context).colorScheme;
    return ListView(padding: const EdgeInsets.all(20), children: [
      const HeroArt(height: 190),
      const SizedBox(height: 16),
      NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionTitle(zh ? '站点数据' : 'Site stats'),
        Row(children: [
          _stat(zh ? '功能分组' : 'Groups', s.groups.length),
          _stat(zh ? '页面' : 'Screens', _screens(s)),
          _stat(zh ? '接口动作' : 'Actions', jI(s.site, 'featureEndpoints')),
        ]),
      ])),
      const SizedBox(height: 14),
      NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(zh ? '从左侧选择一个功能分组' : 'Pick a feature group on the left',
            style: const TextStyle(fontSize: 13)),
        const SizedBox(height: 6),
        Text(zh ? '为 iPhone 与 iPad 原生适配' : 'Adaptive for iPhone and iPad',
            style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
      ])),
    ]);
  }

  Widget _grid(BuildContext context, AppState s, int cols, List<int> items, bool wide) {
    if (s.groups.isEmpty) return const Skeleton(lines: 4);
    if (items.isEmpty) return EmptyState(text: zh ? '没有匹配的功能' : 'No matching feature');
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: cols,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: cols >= 3 ? .92 : 1.0,
      ),
      itemCount: items.length,
      itemBuilder: (_, k) {
        final i = items[k];
        return Stagger(
          index: k,
          child: BentoCard(
            group: s.groups[i],
            index: i,
            screens: jAJ(s.groups[i], 'screens').length,
            onTap: () {
              if (wide) {
                setState(() => _selected = i);
              } else {
                Navigator.pushNamed(context, '/group', arguments: <String, dynamic>{'g': i});
              }
            },
          ),
        );
      },
    );
  }

  int _screens(AppState s) => s.groups.fold(0, (n, g) => n + jAJ(g, 'screens').length);

  bool _hit(J g) {
    final q = _q.trim().toLowerCase();
    if (q.isEmpty) return true;
    if (jL(g).toLowerCase().contains(q)) return true;
    for (final sc in jAJ(g, 'screens')) {
      if (jL(sc).toLowerCase().contains(q)) return true;
    }
    return false;
  }

  Widget _stat(String title, int value) => Expanded(
        child: Column(children: [
          CountUp(value, size: 21),
          const SizedBox(height: 3),
          Text(title, style: const TextStyle(fontSize: 10)),
        ]),
      );
}

// ── 分组页 ──

class GroupPage extends StatelessWidget {
  final int group;
  final void Function(int screen)? onScreen;
  const GroupPage({super.key, required this.group, this.onScreen});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    final g = (group >= 0 && group < s.groups.length) ? s.groups[group] : <String, dynamic>{};
    final screens = s.screensOf(group);
    final admin = jB(g, 'admin');
    return Scaffold(
      appBar: AppBar(title: Text(jL(g))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          Stagger(index: 0, child: NxCard(child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(jL(g), style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('${screens.length} ${zh ? '页面' : 'screens'}${admin ? '  ·  ${zh ? '仅管理员' : 'Admin only'}' : ''}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            ])),
            Icon(admin ? Icons.admin_panel_settings_outlined : Icons.auto_awesome_rounded,
                size: 28, color: cs.primary),
          ]))),
          const SizedBox(height: 14),
          if (screens.isEmpty)
            const EmptyState()
          else
            ...List.generate(screens.length, (i) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Stagger(index: i + 1, child: _tile(context, screens[i], i, admin)),
                )),
        ],
      ),
    );
  }

  Widget _tile(BuildContext context, J sc, int i, bool admin) {
    final cs = Theme.of(context).colorScheme;
    final dim = admin && !AppScope.of(context).isAdmin;
    return Opacity(
      opacity: dim ? .6 : 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          if (onScreen != null) {
            onScreen!(i);
          } else {
            Navigator.pushNamed(context, '/screen',
                arguments: <String, dynamic>{'g': group, 's': i});
          }
        },
        child: NxCard(child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(jL(sc), style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${jAJ(sc, 'forms').length} ${zh ? '表单' : 'forms'}  ·  '
                '${jAJ(sc, 'actions').length} ${zh ? '动作' : 'actions'}',
                style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
          ])),
          Icon(Icons.chevron_right_rounded, color: cs.primary),
        ])),
      ),
    );
  }
}

// ── schema 通用渲染器 ──

class SchemaPage extends StatefulWidget {
  final int group;
  final int screen;
  const SchemaPage({super.key, required this.group, required this.screen});

  @override
  State<SchemaPage> createState() => _SchemaPageState();
}

class _SchemaPageState extends State<SchemaPage> {
  final Map<int, J> _values = <int, J>{};
  List<dynamic> _rows = <dynamic>[];
  J _raw = <String, dynamic>{};
  bool _loading = false;
  Reply? _result;
  String _label = '';

  AppState get s => AppScope.of(context);
  J get spec => s.screenOf(widget.group, widget.screen);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  J _vals(int i) => _values.putIfAbsent(i, () => <String, dynamic>{});

  Future<void> _load() async {
    final load = jOpt(spec, 'load');
    if (load == null || jS(load, 'ep').isEmpty) return;
    final path = s.api.endpoint(jS(load, 'ep'));
    // 带 {id} 之类占位符的页面没有行上下文，交给精修原生页，别打空路径
    if (Api.placeholders(path).isNotEmpty) return;
    setState(() => _loading = true);
    final r = await s.api.call(jS(load, 'ep'), method: 'GET');
    if (!mounted) return;
    var rows = jA(r.data, jS(load, 'items'));
    if (rows.isEmpty) rows = jA(r.data, 'items');
    setState(() {
      _raw = r.data;
      _rows = rows;
      _loading = false;
    });
  }

  Future<void> _run(J action, {J? row, J extra = const {}, String? lbl}) async {
    final r = await s.execute(action, row: row, extra: extra);
    if (!mounted) return;
    setState(() {
      _result = r;
      _label = lbl ?? jL(action);
    });
    if (r.ok && jB(action, 'load')) await _load();
    if (r.ok) await s.refresh();
  }

  void _begin(J action, {J? row}) {
    final fields = jAJ(action, 'fields');
    if (fields.isNotEmpty) {
      _prompt(action, row: row);
    } else if (jB(action, 'confirm')) {
      _confirm(action, row: row);
    } else {
      _run(action, row: row);
    }
  }

  void _confirm(J action, {J? row}) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        title: Text(zh ? '确定执行？' : 'Are you sure?'),
        content: Text(zh ? '此操作不可撤销' : 'This action cannot be undone'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(zh ? '取消' : 'Cancel')),
          FilledButton(
              onPressed: () {
                Navigator.pop(context);
                _run(action, row: row);
              },
              child: Text(zh ? '确定' : 'OK')),
        ],
      ),
    );
  }

  void _prompt(J action, {J? row}) {
    final fields = jAJ(action, 'fields');
    final vals = <String, dynamic>{};
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        final cs = Theme.of(context).colorScheme;
        return Container(
          decoration: BoxDecoration(
              color: cs.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(26))),
          padding: EdgeInsets.only(
              left: 18, right: 18, top: 18, bottom: MediaQuery.of(context).viewInsets.bottom + 18),
          child: StatefulBuilder(builder: (ctx, setLocal) {
            return SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(jL(action), style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                ...fields.map((f) => DynField(
                      fd: f,
                      values: vals,
                      onChange: () => setLocal(() {}),
                    )),
                const SizedBox(height: 14),
                PillButton(zh ? '执行' : 'Run', prominent: true, onTap: () {
                  Navigator.pop(context);
                  _run(action, row: row, extra: buildBody(fields, vals));
                }),
              ]),
            );
          }),
        );
      },
    );
  }

  Future<void> _submitForm(int i, J form) async {
    final ep = jS(form, 'ep');
    if (ep.isEmpty) return;
    final body = buildBody(jAJ(form, 'fields'), _vals(i));
    final m = jS(form, 'm', 'POST');
    final r = await s.call(ep, method: m, body: m == 'GET' ? const <String, dynamic>{} : body,
        query: m == 'GET' ? body : const <String, dynamic>{}, refreshAfter: false);
    if (!mounted) return;
    setState(() {
      _result = r;
      _label = jL(form);
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final sp = spec;
    final g = (widget.group >= 0 && widget.group < s.groups.length) ? s.groups[widget.group] : <String, dynamic>{};
    final forms = jAJ(sp, 'forms');
    final actions = jAJ(sp, 'actions');
    final rowActions = jAJ(sp, 'rowActions');
    final load = jOpt(sp, 'load');
    final hasLoad = load != null && jS(load, 'ep').isNotEmpty;
    final loadPath = hasLoad ? s.api.endpoint(jS(load, 'ep')) : '';
    final needsRow = Api.placeholders(loadPath).isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: Text(jL(sp))),
      body: RefreshIndicator(
        onRefresh: () async {
          await s.refresh();
          await _load();
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
          children: [
            Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(jL(sp), style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 5),
              Text('${jL(g)}  ·  ${forms.length} ${zh ? '表单' : 'forms'}  ·  '
                  '${actions.length} ${zh ? '动作' : 'actions'}',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            ]))),
            const SizedBox(height: 14),
            if (_result != null) ...[ResultCard(result: _result!, label: _label), const SizedBox(height: 14)],
            ...List.generate(forms.length, (i) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Stagger(index: i + 1, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SectionTitle(jL(forms[i])),
                    ...jAJ(forms[i], 'fields').map((f) => DynField(
                          fd: f,
                          values: _vals(i),
                          onChange: () => setState(() {}),
                        )),
                    const SizedBox(height: 12),
                    PillButton(zh ? '保存' : 'Save', prominent: true, onTap: () => _submitForm(i, forms[i])),
                  ]))),
                )),
            if (actions.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SectionTitle(zh ? '操作' : 'Actions'),
                  ...actions.map((a) => Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: PillButton(jL(a), danger: jB(a, 'danger'), onTap: () => _begin(a)),
                      )),
                ])),
              ),
            if (hasLoad)
              NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SectionTitle(zh ? '数据' : 'Data'),
                if (needsRow)
                  Text(zh ? '此页需要具体对象，请使用「我的域名 / 全部功能」里的原生入口。'
                          : 'This page needs a specific item; use the native Domains entry.',
                      style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant))
                else if (_loading)
                  const Skeleton(lines: 3)
                else if (_rows.isEmpty)
                  Column(children: [
                    const EmptyState(),
                    if (_raw.isNotEmpty)
                      SelectableText(jPretty(_raw).substring(0, jPretty(_raw).length > 1200 ? 1200 : jPretty(_raw).length),
                          style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                  ])
                else
                  ..._rows.take(60).map((item) {
                    final row = item is Map ? J.from(item) : <String, dynamic>{'text': item.toString()};
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: NxCard(
                        color: softSurface(context),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(rowTitle(row), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          Text(rowSummary(row), style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                          ...rowActions.map((a) => Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: PillButton(jL(a), danger: jB(a, 'danger'), onTap: () => _begin(a, row: row)),
                              )),
                        ]),
                      ),
                    );
                  }),
                if (_rows.length > 60)
                  Text('… ${_rows.length - 60} more', style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
              ]))
            else if (forms.isEmpty && actions.isEmpty)
              const EmptyState(),
          ],
        ),
      ),
    );
  }
}
