#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""iOS 工程静态自检（只用标准库，macOS runner 无需装任何依赖）。

真编译由 .github/workflows/ios-ipa.yml 的 xcodebuild 完成；
这一步先把「能打包但一跑就崩」的问题挡在前面：
  1) Generated/Endpoints.swift 与 src/routes/app.ts 契约逐条同源
  2) Generated/schema.json 与 src/lib/appSchema.ts 同为 v2
  3) pbxproj 里每个引用的 UUID 都有定义，Swift / 资源都进了对应 build phase
  4) Universal 配置（1,2）/ 部署目标 / shared scheme / Info.plist 关键键
  5) Assets 里每张 PNG 真实存在，OFL 字体与许可证齐
  6) 所有 Swift 文件括号 / 字符串配对
"""
import glob
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ok: list[str] = []
bad: list[str] = []


def check(cond, msg):
    (ok if cond else bad).append(msg)


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


# ── 1. endpoints 同源 ──
app_ts = read('src/routes/app.ts')
blk = app_ts[app_ts.index('endpoints: {'):app_ts.index('      capabilities: {')]
server_eps = dict(re.findall(r"^\s*(\w+):\s*'([^']+)',", blk, re.M))
swift_eps = dict(re.findall(r'^\s*"(\w+)":\s*"([^"]+)",',
                            read('ios/Noxc/Generated/Endpoints.swift'), re.M))
check(len(server_eps) >= 140, f'服务端契约 {len(server_eps)} 条')
check(server_eps == swift_eps,
      f'Endpoints.swift 与 app.ts 逐条同源（iOS {len(swift_eps)} 条）')
if server_eps != swift_eps:
    diff = set(server_eps.items()) ^ set(swift_eps.items())
    print('  差异示例:', list(diff)[:5])

# ── 2. schema 同源 ──
schema_ts = read('src/lib/appSchema.ts')
brace = schema_ts.index('{', schema_ts.index('=', schema_ts.index('export const APP_SCHEMA')))
server_schema, _ = json.JSONDecoder().raw_decode(schema_ts[brace:])
bundled = json.loads(read('ios/Noxc/Generated/schema.json'))
check(server_schema == bundled, 'schema.json 与 appSchema.ts 完全一致（离线快照不过期）')
check(bundled.get('v') == 2 and len(bundled.get('groups', [])) >= 10,
      f"内置 schema v{bundled.get('v')} / {len(bundled.get('groups', []))} 组")

# schema 里所有 ep 必须在契约里
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


walk(bundled)
check(schema_eps <= set(server_eps),
      f'schema 引用的 {len(schema_eps)} 个契约 key 全部存在')

# ── 3. pbxproj 完整性 ──
pbx = read('ios/Noxc.xcodeproj/project.pbxproj')
# PBXGroup / PBXProject 有些定义行不带 /* 注释 */，两种写法都算定义
defined = set(re.findall(r'^\t\t([0-9A-F]{24})\s*(?:/\*|=)', pbx, re.M))
referenced = set(re.findall(r'\b([0-9A-F]{24})\b', pbx))
missing = referenced - defined
check(not missing, f'pbxproj 里 {len(referenced)} 个 UUID 引用全部有定义（缺 {len(missing)}）')
if missing:
    print('  缺失示例:', list(missing)[:5])

check('TARGETED_DEVICE_FAMILY = "1,2"' in pbx,
      'Universal：TARGETED_DEVICE_FAMILY = 1,2（iPhone + iPad）')
check('IPHONEOS_DEPLOYMENT_TARGET = 16.0' in pbx, 'iOS 16 部署目标')
check('PRODUCT_BUNDLE_IDENTIFIER = xyz.noxc.app' in pbx, 'Bundle ID 与 Android applicationId 一致')
check('INFOPLIST_FILE = Noxc/Info.plist' in pbx, '使用独立 Info.plist')
check('SWIFT_VERSION = 5.0' in pbx, 'Swift 5')
for section in ['PBXBuildFile', 'PBXFileReference', 'PBXFrameworksBuildPhase',
                'PBXGroup', 'PBXNativeTarget', 'PBXProject',
                'PBXResourcesBuildPhase', 'PBXSourcesBuildPhase',
                'XCBuildConfiguration', 'XCConfigurationList']:
    check(f'/* Begin {section} section */' in pbx and
          f'/* End {section} section */' in pbx, f'pbxproj 段完整：{section}')
pbx_clean = re.sub(r'/\*.*?\*/', '', pbx, flags=re.S)
pbx_clean = re.sub(r'"(?:[^"\\]|\\.)*"', '""', pbx_clean)
check(pbx_clean.count('{') == pbx_clean.count('}')
      and pbx_clean.count('(') == pbx_clean.count(')')
      and pbx_clean.count('[') == pbx_clean.count(']'),
      'pbxproj 括号 / 圆括号 / 方括号全部配对')
root_match = re.search(r'rootObject = ([0-9A-F]{24})', pbx)
check(bool(root_match) and root_match.group(1) in defined,
      'rootObject 指向真实的 PBXProject 对象')

swift_files = sorted((ROOT / 'ios/Noxc').rglob('*.swift'))
rel = [str(p.relative_to(ROOT / 'ios/Noxc')).replace('\\', '/') for p in swift_files]
for f in rel:
    name = f.split('/')[-1]
    check(f'{name} in Sources' in pbx, f'Swift 文件进 Sources：{name}')

for res in ['schema.json', 'Assets.xcassets', 'NotoSansSC-Regular.ttf',
            'NotoSerifSC-VF.ttf', 'OFL.txt']:
    check(f'{res} in Resources' in pbx, f'资源进 Resources：{res}')

scheme = ROOT / 'ios/Noxc.xcodeproj/xcshareddata/xcschemes/Noxc.xcscheme'
check(scheme.exists() and 'Noxc.xcodeproj' in scheme.read_text(encoding='utf-8'),
      'shared scheme 存在且引用本工程')
check('ArchiveAction' in scheme.read_text(encoding='utf-8'), 'scheme 支持 archive')

# ── 4. Info.plist ──
import plistlib
with (ROOT / 'ios/Noxc/Info.plist').open('rb') as f:
    info = plistlib.load(f)
check(info.get('CFBundleDisplayName') == 'Noxc', 'CFBundleDisplayName = Noxc')
check(info.get('UIRequiresFullScreen') is False,
      'UIRequiresFullScreen = false（支持 iPad 分屏 / Slide Over）')
check('UISupportedInterfaceOrientations~ipad' in info, 'iPad 四向支持')
check(len(info.get('UISupportedInterfaceOrientations~ipad', [])) == 4,
      'iPad 方向四个全开')
check(info.get('UIApplicationSceneManifest', {}).get('UIApplicationSupportsMultipleScenes') is True,
      '支持 iPad 多窗口 / 台前调度')
check(len(info.get('UIAppFonts', [])) == 2, '内置两套 OFL 中文字体')
check('en' in info.get('CFBundleLocalizations', []) and
      'zh-Hans' in info.get('CFBundleLocalizations', []), '中英双语文案声明')
check(info.get('UILaunchScreen', {}).get('UIColorName') == 'LaunchBackground',
      '启动屏用资源目录颜色，无 storyboard 依赖')

# ── 5. 资源真实存在 ──
assets = ROOT / 'ios/Noxc/Assets.xcassets'
contents = list(assets.rglob('Contents.json'))
broken = []
for c in contents:
    try:
        d = json.loads(c.read_text(encoding='utf-8'))
    except Exception as e:
        broken.append(f'{c.name}: {e}')
        continue
    for img in d.get('images', []):
        fn = img.get('filename')
        if fn and not (c.parent / fn).exists():
            broken.append(f'{c.parent.name}/{fn}')
check(not broken, f'{len(contents)} 个 asset 目录内容有效，引用 PNG 全部存在')
if broken:
    print('  缺失:', broken[:5])
for name in ('NotoSansSC-Regular.ttf', 'NotoSerifSC-VF.ttf', 'OFL.txt'):
    check((ROOT / 'ios/Noxc/Fonts' / name).exists(), f'内置字体 / 许可证：{name}')

# ── 6. Swift 括号配对 ──
def strip(s):
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
        if c == '"':
            i += 1
            while i < n and s[i] != '"':
                if s[i] == '\\':
                    i += 1
                i += 1
            i += 1
            out.append('""')
            continue
        out.append(c)
        i += 1
    return ''.join(out)


for p in swift_files:
    s = strip(p.read_text(encoding='utf-8'))
    good = all(s.count(a) == s.count(b) for a, b in [('{', '}'), ('(', ')'), ('[', ']')])
    check(good, f'Swift 括号配对：{p.name}')

# ── 7. 反向对照：故意破坏配置，断言必须失败（防止检查写成恒真） ──
def is_universal(text):
    return 'TARGETED_DEVICE_FAMILY = "1,2"' in text


check(is_universal(pbx) and not is_universal(
      'TARGETED_DEVICE_FAMILY = "1"'.join(
          pbx.split('TARGETED_DEVICE_FAMILY = "1,2"'))),
      '反向对照：删掉 iPad 家族时 Universal 断言必须失败')
check(server_schema == bundled and {**bundled, 'v': 99} != bundled,
      '反向对照：schema 版本被改时同源断言必须失败')
check(len(server_eps) == len(swift_eps) and
      {**swift_eps, 'ghost': '/api/ghost'} != server_eps,
      '反向对照：契约多一条假接口时同源断言必须失败')

print(f'✔ iOS 工程静态自检：{len(ok)} 通过，{len(bad)} 失败')
for m in bad:
    print('  ✗ ' + m)
sys.exit(1 if bad else 0)
