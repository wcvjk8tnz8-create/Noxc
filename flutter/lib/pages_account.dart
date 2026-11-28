import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core.dart';
import 'widgets.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({super.key});

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  int _mode = 0; // 0 登录 / 1 注册 / 2 找回
  final _email = TextEditingController();
  final _pass = TextEditingController();
  final _code = TextEditingController();
  final _authCode = TextEditingController();
  bool _agree = true;
  bool _busy = false;
  String _msg = '';

  @override
  void dispose() {
    _email.dispose();
    _pass.dispose();
    _code.dispose();
    _authCode.dispose();
    super.dispose();
  }

  AppState get s => AppScope.of(context);

  Future<void> _sendCode() async {
    setState(() => _busy = true);
    final r = await s.call('verifySend',
        body: <String, dynamic>{
          'email': _email.text.trim(),
          'scene': _mode == 1 ? 'register' : 'reset',
        },
        refreshAfter: false);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _msg = r.ok ? (zh ? '验证码已发送' : 'Code sent') : r.display;
    });
  }

  /// 浏览器授权登录：打开 Worker 直出的 /app-authorize。
  /// 用户在浏览器里用邮箱 / GitHub / NodeLoc 登录 → 点「授权给 App」拿码 →
  /// 回 App 粘贴（授权页的「一键返回 App」在个别浏览器不认 noxc:// 时可能没反应，
  /// 所以粘贴码是主路径）。
  Future<void> _openBrowserAuthorize() async {
    final uri = s.api.authorizeUri();
    try {
      final okDirect = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!okDirect && mounted) {
        setState(() => _msg = zh ? '未能打开浏览器，请手动访问 ${uri.toString()}' : 'Could not open browser');
      }
    } catch (e) {
      if (mounted) setState(() => _msg = '${zh ? '打开浏览器失败' : 'Cannot open browser'}：$e');
    }
  }

  Future<void> _exchangeCode() async {
    final clean = _authCode.text.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (clean.length < 8) {
      setState(() => _msg = zh ? '请填写浏览器里显示的 12 位授权码' : 'Enter the 12-digit code shown in the browser');
      return;
    }
    setState(() => _busy = true);
    final r = await s.call('appTokenExchange',
        body: <String, dynamic>{'code': clean}, refreshAfter: false);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r.ok) {
      await s.refresh();
      if (!mounted) return;
      Navigator.pop(context);
    } else {
      setState(() => _msg = r.display);
    }
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final Map<String, dynamic> body;
    final String ep;
    if (_mode == 1) {
      ep = 'register';
      body = <String, dynamic>{
        'email': _email.text.trim(),
        'password': _pass.text,
        'agreeTerms': _agree,
        'code': _code.text.trim(),
      };
    } else if (_mode == 2) {
      ep = 'reset';
      body = <String, dynamic>{
        'email': _email.text.trim(),
        'code': _code.text.trim(),
        'password': _pass.text,
      };
    } else {
      ep = 'login';
      body = <String, dynamic>{
        'email': _email.text.trim(),
        'password': _pass.text,
        'remember': true,
      };
    }
    final r = await s.call(ep, body: body, refreshAfter: false);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r.ok) {
      await s.refresh();
      if (!mounted) return;
      if (_mode == 2) {
        setState(() {
          _mode = 0;
          _msg = zh ? '密码已重置，请登录' : 'Password reset, please sign in';
        });
      } else {
        Navigator.pop(context);
      }
    } else {
      setState(() => _msg = r.display);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(zh ? '账号' : 'Account')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          // 浏览器授权登录（此前 Flutter 版漏掉，用户指出的就是这个按钮）
          Stagger(index: 0, child: NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(Icons.open_in_new_rounded, size: 19, color: cs.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(zh ? '浏览器授权登录' : 'Sign in via browser',
                    style: const TextStyle(fontFamily: 'NotoSerifSC', fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ]),
            const SizedBox(height: 8),
            Text(
              zh
                  ? '在浏览器里登录 nic.299282.xyz（邮箱 / GitHub / NodeLoc 都行），'
                    '点「授权给 App」拿到一次性码，回这里粘贴即可。'
                  : 'Sign in on the site in your browser (email / GitHub / NodeLoc), '
                    'tap “Authorize App” and paste the one-time code here.',
              style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant, height: 1.5),
            ),
            const SizedBox(height: 12),
            PillButton(zh ? '打开浏览器授权' : 'Open browser to authorize',
                prominent: true,
                icon: Icons.public_rounded,
                onTap: _busy ? null : _openBrowserAuthorize),
            const SizedBox(height: 10),
            TextField(
              controller: _authCode,
              textCapitalization: TextCapitalization.characters,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: zh ? '授权码（XXXX-XXXX-XXXX）' : 'Authorization code',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.content_paste_rounded, size: 17),
                  onPressed: () async {
                    final data = await Clipboard.getData(Clipboard.kTextPlain);
                    if (data?.text != null) setState(() => _authCode.text = data!.text!);
                  },
                ),
              ),
            ),
            const SizedBox(height: 10),
            PillButton(_busy ? (zh ? '兑换中…' : 'Exchanging…') : (zh ? '用授权码登录' : 'Sign in with code'),
                icon: Icons.vpn_key_rounded,
                onTap: (_busy || _authCode.text.isEmpty) ? null : _exchangeCode),
          ]))),
          const SizedBox(height: 16),
          Text(zh ? '或者使用邮箱密码' : 'Or use email & password',
              style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
          const SizedBox(height: 10),
          SegmentedButton<int>(
            segments: [
              ButtonSegment(value: 0, label: Text(zh ? '登录' : 'Sign in')),
              ButtonSegment(value: 1, label: Text(zh ? '注册' : 'Sign up')),
              ButtonSegment(value: 2, label: Text(zh ? '找回' : 'Recover')),
            ],
            selected: <int>{_mode},
            onSelectionChanged: (v) => setState(() => _mode = v.first),
          ),
          const SizedBox(height: 16),
          NxCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(controller: _email, keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: zh ? '邮箱' : 'Email')),
            const SizedBox(height: 10),
            TextField(controller: _pass, obscureText: true,
                decoration: InputDecoration(
                    labelText: _mode == 2 ? (zh ? '新密码' : 'New password') : (zh ? '密码' : 'Password'))),
            if (_mode == 1) ...[
              const SizedBox(height: 6),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(zh ? '同意服务条款' : 'I agree to the Terms', style: const TextStyle(fontSize: 12)),
                value: _agree,
                onChanged: (v) => setState(() => _agree = v),
              ),
            ],
            if (_mode != 0) ...[
              const SizedBox(height: 8),
              TextField(controller: _code, keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: zh ? '验证码' : 'Code')),
              const SizedBox(height: 10),
              PillButton(zh ? '发送验证码' : 'Send code', onTap: _busy || _email.text.isEmpty ? null : _sendCode),
            ],
            const SizedBox(height: 14),
            PillButton(_busy ? (zh ? '处理中…' : 'Working…') : _actionTitle(),
                prominent: true,
                onTap: (_busy || _email.text.isEmpty || _pass.text.isEmpty) ? null : _submit),
          ])),
          if (_msg.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: NxCard(child: SelectableText(_msg, style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant))),
            ),
          const SizedBox(height: 14),
          NxCard(child: Text(
            zh
                ? '授权码 5 分钟有效、单次消费；换到的是站点原有会话，权限与封禁判定一致。'
                  '若授权页「一键返回 App」没反应，直接复制码粘贴即可。'
                : 'The code expires in 5 minutes and is single-use; it redeems the site\'s own session. '
                  'If “Return to App” does nothing, just copy and paste the code.',
            style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant),
          )),
        ],
      ),
    );
  }

  String _actionTitle() => _mode == 0
      ? (zh ? '登录' : 'Sign in')
      : (_mode == 1 ? (zh ? '注册' : 'Sign up') : (zh ? '重置密码' : 'Reset password'));
}
