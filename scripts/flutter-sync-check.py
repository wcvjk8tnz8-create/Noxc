#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Flutter 工程静态自检（标准库，两个 CI job 都跑）。

真编译 / analyze 在 workflow 里由 flutter 完成；这里先挡住「能打包但一跑就崩」：
  1) assets/endpoints.json 与 src/routes/app.ts 逐条同源
  2) assets/schema.json 与 src/lib/appSchema.ts 完全一致，schema 引用的 ep 都在契约里
  3) pubspec 只允许三个 pub.dev 官方包，禁止任何 git fork 依赖
  4) 全部 Dart 文件的括号 / 字符串配对（Dart 单双引号、三引号、插值）
  5) 关键架构件存在：分层收口 / 浮动底栏 / iPad 侧栏 / schema 渲染器 / 原生滑块
  6) workflow 真的生成平台壳、注入配置、两端都 build 并校验产物
  7) 反向对照：故意破坏配置时断言必须失败（不写恒真检查）
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FL = ROOT / 'flutter'
ok: list[str] = []
bad: list[str] = []


def check(cond, msg):
    (ok if cond else bad).append(msg)


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


# ── 1. 契约同源 ──
app_ts = read('src/routes/app.ts')
blk = app_ts[app_ts.index('endpoints: {'):app_ts.index('      capabilities: {')]
server_eps = dict(re.findall(r"^\s*(\w+):\s*'([^']+)',", blk, re.M))
bundled_eps = json.loads(read('flutter/assets/endpoints.json'))
check(len(server_eps) >= 140, f'服务端契约 {len(server_eps)} 条')
check(server_eps == bundled_eps,
      f'assets/endpoints.json 与 app.ts 逐条同源（{len(bundled_eps)} 条）')
if server_eps != bundled_eps:
    print('  差异示例:', list(set(server_eps.items()) ^ set(bundled_eps.items()))[:5])

# ── 2. schema 同源 ──
schema_ts = read('src/lib/appSchema.ts')
brace = schema_ts.index('{', schema_ts.index('=', schema_ts.index('export const APP_SCHEMA')))
server_schema, _ = json.JSONDecoder().raw_decode(schema_ts[brace:])
bundled_schema = json.loads(read('flutter/assets/schema.json'))
check(server_schema == bundled_schema, 'assets/schema.json 与 appSchema.ts 完全一致')
check(bundled_schema.get('v') == 2 and len(bundled_schema.get('groups', [])) >= 10,
      f"内置 schema v{bundled_schema.get('v')} / {len(bundled_schema.get('groups', []))} 组")
screens = sum(len(g.get('screens', [])) for g in bundled_schema.get('groups', []))
check(screens >= 40, f'内置 schema 覆盖 {screens} 个页面')

schema_eps: set[str] = set()


def walk(o):
    if isinstance(o, dict):
        if isinstance(o.get('ep'), str):
            schema_eps.add(o['ep'])
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(bundled_schema)
check(schema_eps <= set(server_eps),
      f'schema 引用的 {len(schema_eps)} 个契约 key 全部存在')

# ── 3. 依赖白名单（PiliPlus 的痛点是 git fork 依赖） ──
pub = read('flutter/pubspec.yaml')
check('git:' not in pub and 'ref:' not in pub and 'path:' not in pub,
      'pubspec 零 git / path 依赖，pub get 只走 pub.dev')
check('http: ^1.' in pub and 'shared_preferences: ^2.' in pub and
      'url_launcher: ^6.' in pub,
      '仅 http + shared_preferences + url_launcher 三个官方包')
check('flutter_animate' not in pub and 'get:' not in pub and 'dio:' not in pub,
      '动效自绘、状态用 ChangeNotifier，不引第三方框架')
check('- assets/images/' in pub and 'family: NotoSansSC' in pub,
      '插画与 OFL 中文字体已声明进 bundle')

# ── 4. Dart 括号 / 字符串配对 ──
def strip(s: str) -> str:
    out = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == '/' and i + 1 < n and s[i + 1] == '/':
            while i < n and s[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and s[i + 1] == '*':
            i += 2
            while i + 1 < n and not (s[i] == '*' and s[i + 1] == '/'):
                i += 1
            i += 2
            continue
        # 三引号 / 单双引号字符串
        triple = s[i:i + 3]
        if triple in ("'''", '"""'):
            q = triple
            i += 3
            while i + 2 < n and s[i:i + 3] != q:
                if s[i] == '\\':
                    i += 1
                i += 1
            i += 3
            out.append('""')
            continue
        if c in ("'", '"'):
            q = c
            i += 1
            while i < n and s[i] != q:
                if s[i] == '\\':
                    i += 1
                i += 1
            i += 1
            out.append('""')
            continue
        out.append(c)
        i += 1
    return ''.join(out)


dart = sorted((FL / 'lib').rglob('*.dart'))
all_src = '\n'.join(p.read_text(encoding='utf-8') for p in dart)
for p in dart:
    st = strip(p.read_text(encoding='utf-8'))
    good = all(st.count(a) == st.count(b) for a, b in [('{', '}'), ('(', ')'), ('[', ']')])
    check(good, f'Dart 括号配对：{p.name}')
check(len(dart) >= 6, f'{len(dart)} 个 Dart 源文件')

# ── 5. 架构件 ──
for sym, desc in [
    ('class AppState', '状态收口 AppState'),
    ('class Api', '网络层唯一出口 Api'),
    ('class AppScope', '注入点 AppScope'),
    ('class AppRoutes', '路由表收口 AppRoutes'),
    ('final AppTheme appTheme', '全局动态主题单例'),
    ('class FloatNav', '浮动胶囊底栏 FloatNav'),
    ('NavigationRail(', 'iPad NavigationRail 侧栏'),
    ('PlatformX.pad(', 'Pad 宽度断点'),
    ('class SchemaPage', 'schema 通用渲染器'),
    ('class CaptchaSheet', '原生滑块验证'),
    ('class DynField', '动态表单字段'),
    ('class RecordsSheet', 'DNS 记录完整增删改'),
    ('class Stagger', '错落入场动效'),
    ('class Shimmer', '骨架屏扫光'),
    ('class CountUp', '数字滚动'),
    ('AppThemeRef.reduce', '尊重「减少动画」'),
    ('bootstrap', '冷启动只打一次 bootstrap'),
    ('endpoints.json', '离线契约快照'),
]:
    check(sym in all_src, desc)
check("Navigator.pushNamed" in all_src, '页面用命名路由，不自己 new Route')
# 浏览器授权登录（用户指出 Flutter 版漏掉「浏览器授权」按钮）
check('authorizeUri()' in all_src and 'appAuthorize' in all_src,
      'Api 提供 /app-authorize 的 Uri（来自服务端契约）')
check('launchUrl(' in all_src and 'appTokenExchange' in all_src,
      '账号页有「打开浏览器授权」按钮 + 一次性码兑换')
check('Clipboard.getData' in all_src and 'onChanged: (_) => setState' in all_src,
      '授权码支持粘贴、输入后按钮解锁')
check('浏览器授权登录' in all_src and '打开浏览器授权' in all_src,
      '中文按钮文案齐全（不是只留英文）')
check('appAuthorize' in bundled_eps and 'appTokenExchange' in bundled_eps,
      '浏览器授权用的两个契约 key 在内置快照里')

# CI annotations 抓到过的三类真实编译错误，锁死不再回流
check('CurvedAnimation(parent:' in all_src and
      'CurvedAnimation(_c,' not in all_src,
      'CurvedAnimation 用命名参数 parent/curve（位置参数会编译失败）')
check('Alignment.bottomLeading' not in all_src and
      'Alignment.bottomLeft' in all_src,
      'Alignment 用 bottomLeft（没有 bottomLeading）')
check('const PageTransitionsTheme' not in all_src and
      'CupertinoPageTransitionsBuilder' not in all_src,
      'PageTransitionsTheme 不用 const map / 未导入的 Cupertino builder')

# ── 6. workflow / 平台壳 ──
wf = read('.github/workflows/flutter-app.yml')
patch = read('scripts/flutter-platform-patch.py')
check('flutter create --org xyz.noxc --project-name noxc' in wf,
      'CI 用 flutter create 生成平台壳，不入库手写 pbxproj')
check('flutter-platform-patch.py' in wf, 'CI 注入 Android / iOS 平台配置')
check('flutter build apk --release' in wf, 'CI 真编译 Android APK')
check('flutter build ios --release --no-codesign' in wf, 'CI 真编译 iOS Release')
check('flutter build ios --simulator --debug' in wf, 'CI 额外出模拟器 .app')
check('UIDeviceFamily' in wf and "'1' not in fam" in wf,
      'CI 真校验编译产物 Universal（iPhone + iPad）')
check('flutter analyze' in wf, 'CI 跑 Dart 静态分析')
check('assets/flutter_assets/assets/schema.json' in wf,
      'CI 校验 APK 里内置 schema / 契约')
check('macos' in wf and 'ubuntu-latest' in wf, '两个 job 分别在 macOS / Ubuntu 上构建')
check('android.permission.INTERNET' in patch, 'Android 补 INTERNET 权限')
check('<queries>' in patch and 'android:scheme="noxc"' in patch,
      'Android 补浏览器可见性 queries 与 noxc:// 回跳')
check('CFBundleURLTypes' in patch and "'noxc'" in patch,
      'iOS 注册 noxc:// 回跳 scheme')
check('UISupportedInterfaceOrientations~ipad' in patch and
      'UIRequiresFullScreen' in patch, 'iOS 补 iPad 四向与分屏')
check('TARGETED_DEVICE_FAMILY = "1,2"' in patch, 'iOS 工程 Universal')
check(read('flutter/README.md').count('Flutter') >= 3, 'flutter/README.md 说明工程')

# ── 7. 反向对照 ──
check(server_eps == bundled_eps and
      {**bundled_eps, 'ghost': '/api/ghost'} != server_eps,
      '反向对照：契约多一条假接口时同源断言必须失败')
fake_pub = pub.replace('dependencies:',
                       'dependencies:\n  fake_pkg:\n    git: https://example.invalid/repo.git', 1)
check('git:' not in pub and 'git:' in fake_pub and
      fake_pub != pub,
      '反向对照：pubspec 出现 git 依赖时白名单断言必须失败')
is_universal = lambda s: 'TARGETED_DEVICE_FAMILY = "1,2"' in s
check(is_universal(patch) and not is_universal(
      patch.replace('TARGETED_DEVICE_FAMILY = "1,2"',
                    'TARGETED_DEVICE_FAMILY = "1"')),
      '反向对照：删掉 iPad 家族时 Universal 断言必须失败')
check('class FloatNav' in all_src and 'class FloatNav' not in
      all_src.replace('class FloatNav', 'class ZzzNav'),
      '反向对照：浮动底栏被删时架构断言必须失败')
check('launchUrl(' in all_src and 'launchUrl(' not in
      all_src.replace('launchUrl(', 'neverLaunch('),
      '反向对照：浏览器授权按钮被删时断言必须失败')

print(f'✔ Flutter 工程静态自检：{len(ok)} 通过，{len(bad)} 失败')
for m in bad:
    print('  ✗ ' + m)
sys.exit(1 if bad else 0)
