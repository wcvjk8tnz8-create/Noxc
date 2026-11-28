import 'package:flutter/material.dart';

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
  bool _agree = true;
  bool _busy = false;
  String _msg = '';

  @override
  void dispose() {
    _email.dispose();
    _pass.dispose();
    _code.dispose();
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
                ? '第三方登录需在浏览器里授权，再用一次性码回到 App；其余流程全部在 App 内完成。'
                : 'Third-party sign-in is authorized in the browser, then handed back with a one-time code.',
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
