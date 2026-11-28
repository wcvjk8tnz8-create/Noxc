import 'package:flutter/material.dart';

import 'core.dart';
import 'widgets.dart';

// 用户之前明确反馈过「DNS 记录说接口不存在」——所以这一页不是只读列表，
// 列表 / 增 / 改 / 删全部走 bootstrap 下发的真实契约，路径不硬编码。

class DomainsPage extends StatelessWidget {
  const DomainsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    if (!s.loggedIn) {
      return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 110), children: [
        NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SectionTitle(zh ? '请先登录' : 'Please sign in'),
          Text(zh ? '登录后可以管理域名与 DNS 记录。' : 'Sign in to manage domains and DNS records.',
              style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          const SizedBox(height: 12),
          PillButton(zh ? '登录 / 注册' : 'Sign in / Sign up', prominent: true,
              onTap: () => Navigator.pushNamed(context, '/account')),
        ])),
      ]);
    }
    return RefreshIndicator(
      onRefresh: () => s.refresh(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle(zh ? '我的域名' : 'My domains'),
            Text('${zh ? '已用额度' : 'Used'}: ${s.domains.length}   ·   '
                '${zh ? '配额' : 'Quota'}: ${jS(s.site, 'defaultQuota', '-')}',
                style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            const SizedBox(height: 12),
            PillButton(zh ? '申请子域名' : 'Apply for a subdomain', prominent: true,
                icon: Icons.add_rounded,
                onTap: () => showModalBottomSheet(
                      context: context,
                      isScrollControlled: true,
                      backgroundColor: Colors.transparent,
                      builder: (_) => const ApplySheet(),
                    )),
          ]))),
          const SizedBox(height: 14),
          if (s.domains.isEmpty)
            const Stagger(index: 1, child: EmptyState())
          else
            ...List.generate(s.domains.length, (i) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Stagger(index: i + 1, child: _domainCard(context, s.domains[i])),
                )),
        ],
      ),
    );
  }

  Widget _domainCard(BuildContext context, J row) {
    final cs = Theme.of(context).colorScheme;
    final s = AppScope.of(context);
    return NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(jS(row, 'fqdn'), style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 4),
      Text('${jS(row, 'status')}  ·  ${jS(row, 'root_domain')}  ·  ${jS(row, 'record_count')} DNS',
          style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
      const SizedBox(height: 12),
      PillButton(zh ? 'DNS 记录' : 'DNS records', icon: Icons.dns_rounded, onTap: () {
        showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => RecordsSheet(domain: row),
        );
      }),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: PillButton(zh ? '续期' : 'Renew', onTap: () async {
          final r = await s.call('renew', vars: <String, dynamic>{'id': jS(row, 'id')});
          _toast(context, r);
        })),
        const SizedBox(width: 10),
        Expanded(child: PillButton(zh ? '释放' : 'Release', danger: true, onTap: () async {
          final r = await s.call('subdomainDelete', method: 'DELETE',
              vars: <String, dynamic>{'id': jS(row, 'id')});
          _toast(context, r);
        })),
      ]),
    ]));
  }

  void _toast(BuildContext context, Reply r) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(r.ok ? (zh ? '已完成' : 'Done') : r.display),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ));
  }
}

// ── 申请子域名（含原生滑块验证） ──

class ApplySheet extends StatefulWidget {
  const ApplySheet({super.key});

  @override
  State<ApplySheet> createState() => _ApplySheetState();
}

class _ApplySheetState extends State<ApplySheet> {
  final _label = TextEditingController();
  final _note = TextEditingController();
  String _root = '';
  String _token = '';
  J _challenge = <String, dynamic>{};
  bool _busy = false;
  String _msg = '';

  AppState get s => AppScope.of(context);

  List<String> get _roots {
    final list = jSA(s.site, 'rootDomains');
    if (list.isNotEmpty) return list;
    final one = jS(s.site, 'rootDomain');
    return one.isEmpty ? <String>[] : <String>[one];
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        setState(() => _root = _roots.isEmpty ? '' : _roots.first);
        _prepare();
      }
    });
  }

  @override
  void dispose() {
    _label.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _prepare() async {
    final r = await s.api.call('captcha', method: 'GET');
    if (!mounted || !r.ok || !jB(r.data, 'enabled')) return;
    setState(() => _challenge = r.data);
    // 领到挑战后弹一次验证；关闭后 token 为空也能提交（站点关掉验证时）
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CaptchaSheet(
        initial: _challenge,
        onToken: (v) {
          if (mounted) setState(() => _token = v);
        },
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final body = <String, dynamic>{
      'label': _label.text.trim(),
      'root': _root,
      'note': _note.text.trim(),
    };
    if (_token.isNotEmpty) body['captchaToken'] = _token;
    final r = await s.call('apply', body: body, refreshAfter: false);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r.ok) {
      await s.refresh();
      if (mounted) Navigator.pop(context);
    } else {
      setState(() => _msg = r.display);
      if (jB(r.data, 'captchaRequired')) {
        _token = '';
        await _prepare();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
      ),
      padding: EdgeInsets.only(
          left: 18, right: 18, top: 18, bottom: MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(zh ? '申请子域名' : 'Apply for a subdomain',
                style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 18, fontWeight: FontWeight.w700)),
            const Spacer(),
            IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded)),
          ]),
          TextField(controller: _label, decoration: InputDecoration(labelText: zh ? '名称' : 'Label')),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(color: softSurface(context), borderRadius: BorderRadius.circular(14)),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: (_root.isEmpty || !_roots.contains(_root)) ? null : _root,
                isExpanded: true,
                hint: Text(zh ? '后缀' : 'Root', style: const TextStyle(fontSize: 12)),
                items: _roots.map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
                onChanged: (v) => setState(() => _root = v ?? ''),
              ),
            ),
          ),
          const SizedBox(height: 10),
          TextField(controller: _note, decoration: InputDecoration(labelText: zh ? '备注（可选）' : 'Note (optional)')),
          const SizedBox(height: 14),
          PillButton(_busy ? (zh ? '提交中…' : 'Submitting…') : (zh ? '提交申请' : 'Submit'),
              prominent: true,
              onTap: (_busy || _label.text.trim().isEmpty || _root.isEmpty) ? null : _submit),
          if (_msg.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 10),
                child: Text(_msg, style: TextStyle(fontSize: 11, color: cs.error))),
        ]),
      ),
    );
  }
}

// ── DNS 记录：列表 / 增 / 改 / 删 ──

class RecordsSheet extends StatefulWidget {
  final J domain;
  const RecordsSheet({super.key, required this.domain});

  @override
  State<RecordsSheet> createState() => _RecordsSheetState();
}

class _RecordsSheetState extends State<RecordsSheet> {
  static const types = <String>['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

  List<J> rows = <J>[];
  bool loading = true;
  Reply? result;
  String label = '';
  String _type = 'A';
  final _host = TextEditingController(text: '@');
  final _value = TextEditingController();
  final _ttl = TextEditingController(text: '300');

  AppState get s => AppScope.of(context);
  String get _id => jS(widget.domain, 'id');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _host.dispose();
    _value.dispose();
    _ttl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final r = await s.api.call('records', method: 'GET', vars: <String, dynamic>{'id': _id});
    if (!mounted) return;
    setState(() {
      rows = jAJ(r.data, 'records');
      loading = false;
      if (!r.ok) result = r;
    });
  }

  Future<void> _run(String ep, String method, J body, J vars, String lbl) async {
    final r = await s.call(ep, method: method, body: body, vars: vars, refreshAfter: false);
    if (!mounted) return;
    setState(() {
      result = r;
      label = lbl;
    });
    if (r.ok) await _load();
  }

  void _edit(J row) {
    final host = TextEditingController(text: jS(row, 'host'));
    final value = TextEditingController(text: jS(row, 'content'));
    final ttl = TextEditingController(text: jS(row, 'ttl', '300'));
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        title: Text('${jS(row, 'type')}  ${jS(row, 'name')}'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: host, decoration: InputDecoration(labelText: zh ? '主机名' : 'Host')),
          const SizedBox(height: 8),
          TextField(controller: value, decoration: InputDecoration(labelText: zh ? '记录值' : 'Value')),
          const SizedBox(height: 8),
          TextField(controller: ttl, keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: 'TTL')),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(zh ? '取消' : 'Cancel')),
          FilledButton(
            onPressed: () {
              Navigator.pop(context);
              _run('recordUpdate', 'PATCH',
                  <String, dynamic>{
                    'host': host.text,
                    'content': value.text,
                    'ttl': int.tryParse(ttl.text) ?? 300,
                  },
                  <String, dynamic>{'rid': jS(row, 'id')},
                  zh ? '更新记录' : 'Update record');
            },
            child: Text(zh ? '保存' : 'Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      height: MediaQuery.of(context).size.height * .84,
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
      ),
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(jS(widget.domain, 'fqdn'),
                  style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 18, fontWeight: FontWeight.w700)),
              Text(zh ? 'DNS 记录 · 增 / 改 / 删' : 'DNS records · create / update / delete',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
            ]),
          ),
          IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded)),
        ]),
        const SizedBox(height: 8),
        Expanded(
          child: ListView(
            padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 18),
            children: [
              if (result != null) ...[ResultCard(result: result!, label: label), const SizedBox(height: 12)],
              _addForm(context),
              const SizedBox(height: 14),
              SectionTitle('${zh ? '现有记录' : 'Records'}  (${rows.length})'),
              if (loading)
                const Skeleton(lines: 3)
              else if (rows.isEmpty)
                const EmptyState()
              else
                ...rows.map((r) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _recordCard(context, r),
                    )),
            ],
          ),
        ),
      ]),
    );
  }

  Widget _addForm(BuildContext context) {
    return NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionTitle(zh ? '添加记录' : 'Add record'),
      Row(children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(color: softSurface(context), borderRadius: BorderRadius.circular(14)),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _type,
                isExpanded: true,
                items: types.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
                onChanged: (v) => setState(() => _type = v ?? 'A'),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(child: TextField(controller: _host, decoration: InputDecoration(labelText: zh ? '主机名' : 'Host'))),
      ]),
      const SizedBox(height: 10),
      TextField(controller: _value, decoration: InputDecoration(labelText: zh ? '记录值' : 'Value')),
      const SizedBox(height: 10),
      TextField(controller: _ttl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'TTL')),
      const SizedBox(height: 12),
      PillButton(zh ? '添加' : 'Add', prominent: true, icon: Icons.add_rounded, onTap: () {
        if (_value.text.trim().isEmpty) return;
        _run('records', 'POST',
            <String, dynamic>{
              'type': _type,
              'host': _host.text.trim().isEmpty ? '@' : _host.text.trim(),
              'content': _value.text.trim(),
              'ttl': int.tryParse(_ttl.text) ?? 300,
            },
            <String, dynamic>{'id': _id},
            zh ? '添加记录' : 'Add record');
      }),
    ]));
  }

  Widget _recordCard(BuildContext context, J r) {
    final cs = Theme.of(context).colorScheme;
    return NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          decoration: BoxDecoration(color: cs.primary.withOpacity(.14), borderRadius: BorderRadius.circular(999)),
          child: Text(jS(r, 'type'), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: cs.primary)),
        ),
        const SizedBox(width: 9),
        Expanded(child: Text(jS(r, 'name'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
      ]),
      const SizedBox(height: 6),
      Text(jS(r, 'content'), style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
      Text('TTL ${jS(r, 'ttl')}', style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: PillButton(zh ? '编辑' : 'Edit', onTap: () => _edit(r))),
        const SizedBox(width: 10),
        Expanded(child: PillButton(zh ? '删除' : 'Delete', danger: true, onTap: () {
          _run('recordDelete', 'DELETE', const <String, dynamic>{},
              <String, dynamic>{'rid': jS(r, 'id')}, zh ? '删除记录' : 'Delete record');
        })),
      ]),
    ]));
  }
}
