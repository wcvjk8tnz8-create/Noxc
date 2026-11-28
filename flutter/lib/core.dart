import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Noxc Flutter · 分层（对齐 PiliPlus/PiliNara 的工程化做法）
//
//   pages/  →  core.dart (状态/网络/存储/主题收口)  →  Worker API
//
//  · 路由、注入、存储、结果类型全部收口到单点，业务页面不直接碰 HTTP
//  · 平台差异只留在 PlatformX（Pad 断点 / iOS 安全区 / 桌面宽度）
//  · 数据来自服务端 schema + endpoints 契约，新增站内功能不用发版
//  · 离线用 assets/ 里的同源代码快照，不是另一套硬编码
// ─────────────────────────────────────────────────────────────────────────────

typedef J = Map<String, dynamic>;

// ── JSON 小工具（schema 是异构结构，不用强类型模型，避免一个可选字段整页空白） ──

dynamic jv(J? o, String k) => o?[k];
String jS(J? o, String k, [String d = '']) {
  final v = o?[k];
  if (v == null) return d;
  final s = v is String ? v : v.toString();
  return s.isEmpty ? d : s;
}

int jI(J? o, String k, [int d = 0]) {
  final v = o?[k];
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? d;
  return d;
}

bool jB(J? o, String k, [bool d = false]) {
  final v = o?[k];
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) return v == '1' || v.toLowerCase() == 'true';
  return d;
}

J jO(J? o, String k) {
  final v = o?[k];
  return v is Map ? J.from(v as Map) : <String, dynamic>{};
}

J? jOpt(J? o, String k) {
  final v = o?[k];
  return v is Map ? J.from(v as Map) : null;
}

List<dynamic> jA(J? o, String k) {
  final v = o?[k];
  return v is List ? v : <dynamic>[];
}

List<J> jAJ(J? o, String k) =>
    jA(o, k).whereType<Map>().map((e) => J.from(e)).toList(growable: false);

List<String> jSA(J? o, String k) =>
    jA(o, k).map((e) => e.toString()).toList(growable: false);

bool get zh => PlatformX.localeZh;

/// schema 里每个条目自带 l(中)/le(英)，统一在这里取。
String jL(J? o) {
  if (o == null) return '';
  final a = jS(o, 'l');
  final b = jS(o, 'le');
  return zh ? (a.isEmpty ? b : a) : (b.isEmpty ? a : b);
}

String jPretty(J o) {
  try {
    return const JsonEncoder.withIndent('  ').convert(o);
  } catch (_) {
    return o.toString();
  }
}

String rowTitle(J row) {
  for (final k in const [
    'fqdn', 'domain', 'email', 'subject', 'title', 'name',
    'ip', 'code', 'label', 'key', 'action', 'root_domain'
  ]) {
    final v = jS(row, k);
    if (v.isNotEmpty) return v;
  }
  final id = jI(row, 'id');
  return id == 0 ? '结果' : '#$id';
}

String rowSummary(J row) {
  final keys = row.keys.toList()..sort();
  final parts = <String>[];
  for (final k in keys) {
    if (parts.length >= 6) break;
    if (k == 'l' || k == 'le') continue;
    final v = row[k];
    if (v == null || v is Map || v is List) continue;
    final s = v.toString();
    if (s.isEmpty || s.length > 90) continue;
    parts.add('$k=$s');
  }
  return parts.join('  ·  ');
}

// ── 平台差异（只此一处） ──

class PlatformX {
  static bool localeZh = true;
  static bool get isIOS => !kIsWeb && Platform.isIOS;
  static bool get isAndroid => !kIsWeb && Platform.isAndroid;
  static bool pad(double w) => w >= 760;       // iPad 竖屏 / 大屏手机横屏
  static bool wide(double w) => w >= 1100;     // iPad Pro 横屏 / 桌面
  static double contentMax(double w) => wide(w) ? 980 : (pad(w) ? 760 : double.infinity);
}

// ── 本地存储收口（shared_preferences 单点，页面不直接碰） ──

class Store {
  static SharedPreferences? _p;

  static Future<void> init() async {
    _p ??= await SharedPreferences.getInstance();
  }

  static String get site => _p?.getString('site') ?? 'https://nic.299282.xyz/';
  static set site(String v) => _p?.setString('site', v);
  static String get session => _p?.getString('session') ?? '';
  static set session(String v) => _p?.setString('session', v);
  static void clearSession() => _p?.remove('session');
  static String get endpointsCache => _p?.getString('endpoints') ?? '';
  static set endpointsCache(String v) => _p?.setString('endpoints', v);
  static int get themeIndex => _p?.getInt('theme') ?? 0;
  static set themeIndex(int v) => _p?.setInt('theme', v);
  static int get themeMode => _p?.getInt('mode') ?? 0; // 0 系统 / 1 亮 / 2 暗
  static set themeMode(int v) => _p?.setInt('mode', v);
  static bool get reduceMotion => _p?.getBool('reduce') ?? false;
  static set reduceMotion(bool v) => _p?.setBool('reduce', v);
}

String normalizeSite(String raw) {
  var v = raw.trim();
  if (!v.startsWith('https://') && !v.startsWith('http://')) v = 'https://$v';
  if (!v.endsWith('/')) v = '$v/';
  return v;
}

// ── 主题：Material 3 + 动态主题色（PiliPlus 的招牌） ──

class AppTheme with ChangeNotifier {
  static const seeds = <Color>[
    Color(0xFFE58AB0), // 品牌粉（默认，沿用站点现行配色）
    Color(0xFF7C6CF6),
    Color(0xFF4CA8E0),
    Color(0xFF48B883),
    Color(0xFFEBA34A),
    Color(0xFFE36C6C),
  ];

  int _seed = Store.themeIndex;
  int _mode = Store.themeMode;
  bool _reduce = Store.reduceMotion;

  int get seed => _seed;
  int get mode => _mode;
  bool get reduceMotion => _reduce;
  Color get color => seeds[_seed.clamp(0, seeds.length - 1).toInt()];
  ThemeMode get materialMode => switch (_mode) { 1 => ThemeMode.light, 2 => ThemeMode.dark, _ => ThemeMode.system };

  void setSeed(int v) {
    _seed = v.clamp(0, seeds.length - 1).toInt();
    Store.themeIndex = _seed;
    notifyListeners();
  }

  void setMode(int v) {
    _mode = v.clamp(0, 2).toInt();
    Store.themeMode = _mode;
    notifyListeners();
  }

  void setReduce(bool v) {
    _reduce = v;
    Store.reduceMotion = v;
    notifyListeners();
  }

  ThemeData light() => _base(Brightness.light);
  ThemeData dark() => _base(Brightness.dark);

  ThemeData _base(Brightness b) {
    final scheme = ColorScheme.fromSeed(seedColor: color, brightness: b);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'NotoSansSC',
      scaffoldBackgroundColor: b == Brightness.dark
          ? const Color(0xFF121318)
          : const Color(0xFFF7F7F9),
      splashFactory: InkRipple.splashFactory,
      // 不写 const：部分 Flutter 版本的 PageTransitionsBuilder 子类没有 const
      // 构造，const map 会直接编译失败；这里两个平台都走稳定的淡入上移。
      pageTransitionsTheme: PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: FadeUpwardsPageTransitionsBuilder(),
        },
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 46),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: 'NotoSansSC', fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: b == Brightness.dark ? const Color(0xFF171820) : const Color(0xFFF0F0F4),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: color, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      ),
      chipTheme: const ChipThemeData(
        shape: StadiumBorder(),
        labelStyle: TextStyle(fontFamily: 'NotoSansSC', fontSize: 12),
      ),
    );
  }
}

/// 全局主题单例：页面里直接 `appTheme.setSeed(...)`，不用再套一层 Provider。
/// 构造时 Store 可能还没 init，AppTheme 的 getter 都带默认值，安全。
final AppTheme appTheme = AppTheme();

// ── 统一结果类型（PiliPlus 的 LoadingState 思路） ──

class Reply {
  final bool ok;
  final int code;
  final J data;
  final String message;

  const Reply(this.ok, this.code, this.data, this.message);
  factory Reply.fail(String m) => Reply(false, 0, <String, dynamic>{}, m);

  String get display => ok ? jPretty(data) : (message.isEmpty ? 'HTTP $code' : message);
}

// ── 网络层：bootstrap / schema / 148 条契约（唯一出口） ──

class Api {
  final http.Client _client = http.Client();
  final Map<String, String> _eps = <String, String>{};

  String get base => normalizeSite(Store.site);
  String get session => Store.session;

  Future<void> loadBundled() async {
    if (_eps.isNotEmpty) return;
    final cached = Store.endpointsCache;
    if (cached.isNotEmpty) {
      try {
        final m = jsonDecode(cached);
        if (m is Map) _eps.addAll(m.map((k, v) => MapEntry(k.toString(), v.toString())));
      } catch (_) {}
    }
    if (_eps.isEmpty) {
      try {
        final raw = await rootBundle.loadString('assets/endpoints.json');
        final m = jsonDecode(raw);
        if (m is Map) _eps.addAll(m.map((k, v) => MapEntry(k.toString(), v.toString())));
      } catch (_) {}
    }
  }

  void applyEndpoints(J map) {
    _eps.clear();
    _eps.addAll(map.map((k, v) => MapEntry(k.toString(), v.toString())));
    Store.endpointsCache = jsonEncode(_eps);
  }

  String endpoint(String key) => _eps[key] ?? '';

  /// 浏览器授权页：用户在浏览器（含第三方 OAuth）登录站点后点「授权给 App」，
  /// 拿到 12 位一次性码回 App 粘贴，走 appTokenExchange 换 sh_session。
  Uri authorizeUri() {
    final path = endpoint('appAuthorize').isEmpty ? '/app-authorize' : endpoint('appAuthorize');
    return Uri.parse(base + (path.startsWith('/') ? path.substring(1) : path));
  }

  static List<String> placeholders(String path) {
    final out = <String>[];
    for (final m in RegExp(r'\{(\w+)\}').allMatches(path)) {
      final n = m.group(1)!;
      if (!out.contains(n)) out.add(n);
    }
    return out;
  }

  Uri _uri(String path, J query) {
    final full = base + (path.startsWith('/') ? path.substring(1) : path);
    final u = Uri.parse(full);
    if (query.isEmpty) return u;
    final q = <String, String>{};
    u.queryParameters.forEach((k, v) => q[k] = v);
    query.forEach((k, v) {
      final s = v?.toString() ?? '';
      if (s.isNotEmpty) q[k] = s;
    });
    return u.replace(queryParameters: q);
  }

  Future<Reply> raw(String method, String path, {J? body, J query = const {}}) async {
    try {
      final uri = _uri(path, query);
      final headers = <String, String>{
        'Accept': 'application/json',
        'User-Agent': 'NoxcFlutter/1.0 (${PlatformX.isIOS ? 'iOS' : 'Android'})',
        'Accept-Language': zh ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9',
      };
      if (session.isNotEmpty) headers['Cookie'] = 'sh_session=$session';
      late http.Response res;
      final encoded = (body != null && method != 'GET') ? jsonEncode(body) : null;
      if (encoded != null) headers['Content-Type'] = 'application/json; charset=utf-8';
      switch (method) {
        case 'GET': res = await _client.get(uri, headers: headers); break;
        case 'POST': res = await _client.post(uri, headers: headers, body: encoded); break;
        case 'PUT': res = await _client.put(uri, headers: headers, body: encoded); break;
        case 'PATCH': res = await _client.patch(uri, headers: headers, body: encoded); break;
        case 'DELETE': res = await _client.delete(uri, headers: headers, body: encoded); break;
        default: res = await _client.get(uri, headers: headers);
      }
      _absorb(res);
      J obj = <String, dynamic>{};
      if (res.body.isNotEmpty) {
        try {
          final d = jsonDecode(res.body);
          if (d is Map) obj = J.from(d);
        } catch (_) {}
      }
      final good = obj['success'] is bool
          ? obj['success'] as bool
          : (res.statusCode >= 200 && res.statusCode < 300);
      var msg = (obj['message'] ?? obj['error'] ?? '').toString();
      if (!good && msg.isEmpty) {
        msg = res.body.isEmpty
            ? 'HTTP ${res.statusCode}'
            : res.body.substring(0, res.body.length > 300 ? 300 : res.body.length);
      }
      if (obj['token'] is String && (obj['token'] as String).isNotEmpty) {
        Store.session = obj['token'] as String;
      }
      return Reply(good, res.statusCode, obj, msg);
    } catch (e) {
      return Reply.fail('无法连接站点：$e');
    }
  }

  void _absorb(http.Response res) {
    final raw = res.headers['set-cookie'] ?? '';
    final m = RegExp(r'sh_session=([^;,\s]+)').firstMatch(raw);
    if (m != null) Store.session = m.group(1)!;
  }

  Future<Reply> bootstrap({bool fresh = false}) => raw(
        'GET',
        '/api/app/v1/bootstrap' +
            (fresh ? '?_=${DateTime.now().millisecondsSinceEpoch}' : ''),
      );

  Future<Reply> schema() => raw('GET', endpoint('schema').isEmpty ? '/api/app/v1/schema' : endpoint('schema'));

  /// 所有按钮都走这里：契约占位符替换 + 残留可选占位符清空。
  Future<Reply> call(String ep,
      {String method = 'POST', J body = const {}, J vars = const {}, J query = const {}, bool autoQuery = false}) async {
    var path = endpoint(ep);
    if (path.isEmpty) return Reply.fail('接口配置缺失：$ep');
    vars.forEach((k, v) {
      path = path.replaceAll('{$k}', Uri.encodeComponent(v.toString()));
    });
    path = path.replaceAllMapped(RegExp(r'\{\w+\}'), (_) => '');
    final q = <String, dynamic>{}..addAll(query);
    if (autoQuery || method == 'GET') q.addAll(body);
    return raw(method, path, body: method == 'GET' ? null : body, query: q);
  }
}

// ── 全局状态（ChangeNotifier + InheritedNotifier，零状态管理包） ──

class AppState extends ChangeNotifier {
  final Api api = Api();
  J site = <String, dynamic>{};
  J user = <String, dynamic>{};
  List<J> domains = <J>[];
  J points = <String, dynamic>{};
  List<J> groups = <J>[];
  int schemaVersion = 0;
  bool offline = false;
  bool loading = true;
  String error = '';

  bool get loggedIn => user.isNotEmpty;
  bool get isAdmin => jB(site, 'isAdmin') || jS(user, 'role') == 'admin';

  Future<void> init() async {
    await api.loadBundled();
    await load();
  }

  Future<void> load({bool fresh = false}) async {
    loading = true;
    notifyListeners();
    final r = await api.bootstrap(fresh: fresh);
    if (r.ok) {
      _apply(r.data);
      error = '';
    } else {
      error = r.display;
    }
    await loadSchema();
    loading = false;
    notifyListeners();
  }

  Future<void> refresh() async {
    final r = await api.bootstrap(fresh: true);
    if (r.ok) {
      _apply(r.data);
      error = '';
      notifyListeners();
    }
  }

  void _apply(J d) {
    site = jO(d, 'site');
    final u = jOpt(d, 'user');
    user = u ?? <String, dynamic>{};
    domains = jAJ(jOpt(d, 'domains'), 'items');
    points = jOpt(d, 'points') ?? <String, dynamic>{};
    api.applyEndpoints(jO(d, 'endpoints'));
  }

  Future<void> loadSchema() async {
    final r = await api.schema();
    if (r.ok && jA(r.data, 'groups').isNotEmpty) {
      groups = jAJ(r.data, 'groups');
      schemaVersion = jI(r.data, 'v');
      offline = false;
      return;
    }
    try {
      final raw = await rootBundle.loadString('assets/schema.json');
      final m = jsonDecode(raw);
      if (m is Map) {
        groups = jAJ(J.from(m), 'groups');
        schemaVersion = jI(J.from(m), 'v');
        offline = groups.isNotEmpty;
      }
    } catch (_) {}
  }

  List<J> screensOf(int g) => (g >= 0 && g < groups.length) ? jAJ(groups[g], 'screens') : <J>[];
  J screenOf(int g, int s) {
    final list = screensOf(g);
    return (s >= 0 && s < list.length) ? list[s] : <String, dynamic>{};
  }

  Future<Reply> call(String ep,
      {String method = 'POST', J body = const {}, J vars = const {}, J query = const {}, bool refreshAfter = true}) async {
    final r = await api.call(ep, method: method, body: body, vars: vars, query: query);
    if (r.ok && refreshAfter) await refresh();
    return r;
  }

  /// 把 schema 动作（const / vars / 行数据）翻译成一次契约请求。
  Future<Reply> execute(J action, {J? row, J extra = const {}}) async {
    final ep = jS(action, 'ep');
    final method = jS(action, 'm', 'POST');
    if (ep.isEmpty) return Reply.fail('接口配置缺失');
    final body = <String, dynamic>{}..addAll(extra);
    jO(action, 'const').forEach((k, v) => body[k] = v);

    final vars = <String, dynamic>{};
    for (final k in jSA(action, 'vars')) {
      vars[k] = _valueFor(k, body, row);
    }
    final path = api.endpoint(ep);
    for (final ph in Api.placeholders(path)) {
      if (!vars.containsKey(ph)) vars[ph] = _valueFor(ph, body, row);
    }
    return call(ep, method: method, body: method == 'GET' ? const {} : body,
        vars: vars, query: method == 'GET' ? body : const {}, refreshAfter: false);
  }

  String _valueFor(String k, J body, J? row) {
    final b = body[k];
    if (b != null && b.toString().isNotEmpty) return b.toString();
    if (row != null) {
      final v = jS(row, k);
      if (v.isNotEmpty && v != '0') return v;
      if (k == 'domain') {
        for (final alt in const ['fqdn', 'domain', 'root_domain']) {
          final a = jS(row, alt);
          if (a.isNotEmpty) return a;
        }
      }
      if (k == 'rid' || k == 'id') {
        final a = jS(row, 'id');
        if (a.isNotEmpty) return a;
      }
      if (k == 'email') {
        final a = jS(row, 'email');
        if (a.isNotEmpty) return a;
      }
    }
    return '';
  }

  Future<void> setSite(String raw) async {
    Store.site = normalizeSite(raw);
    Store.clearSession();
    await load(fresh: true);
  }
}

/// 注入点：业务页面用 `AppScope.of(ctx).state`，不直接构造状态。
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({Key? key, required AppState notifier, required Widget child})
      : super(key: key, notifier: notifier, child: child);

  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

// 路由表在 main.dart 统一注册（Dart 没有前向声明，core 不引用页面类，
// 避免 core ↔ pages 循环 import）。页面里一律用 AppRoutes.go(...)，不自己
// new MaterialPageRoute，和 PiliPlus 的 Routes 收口是同一个意思。
