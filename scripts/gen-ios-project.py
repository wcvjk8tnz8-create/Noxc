#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 Noxc iOS 原生工程（Universal：iPhone + iPad）。

这份脚本是 iOS 工程的**唯一真源**，重跑即可重建：
  ios/Noxc.xcodeproj/project.pbxproj      Xcode 工程（不依赖 xcodegen，CI 零额外工具）
  ios/Noxc.xcodeproj/xcshareddata/xcschemes/Noxc.xcscheme
  ios/Noxc/Info.plist                    Universal / 分屏 / 多场景 / 中英文 / 字体
  ios/Noxc/Generated/Endpoints.swift     148 条契约，逐条从 src/routes/app.ts 提取
  ios/Noxc/Generated/schema.json         全站功能描述，从 src/lib/appSchema.ts 提取（离线兜底）
  ios/Noxc/Assets.xcassets               AppIcon / 主题色 / 13 张插画（Android WebP 转 PNG）
  ios/Noxc/Fonts/                       两套 OFL 中文字体 + 许可证
  ios/ExportOptions.plist                有证书时的签名导出配置

iOS 端与 Android 端共用同一份服务端 schema 与 endpoints 契约，
新增网站功能只改服务端生成脚本，两端都不用发版。
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import shutil
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
IOS = ROOT / 'ios'
APP = IOS / 'Noxc'
GEN = APP / 'Generated'
ASSETS = APP / 'Assets.xcassets'
PROJ = IOS / 'Noxc.xcodeproj'

DEFAULT_SITE = 'https://nic.299282.xyz/'
BUNDLE_ID = 'xyz.noxc.app'


def uid(key: str) -> str:
    """确定性 24 位 hex UUID —— 重跑不产生 diff。"""
    return hashlib.sha1(('noxc-ios:' + key).encode()).hexdigest()[:24].upper()


def w(path: pathlib.Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


# ───────── 1. 从服务端提取真源 ─────────

def endpoints() -> dict[str, str]:
    s = (ROOT / 'src/routes/app.ts').read_text(encoding='utf-8')
    blk = s[s.index('endpoints: {'):s.index('      capabilities: {')]
    eps = dict(re.findall(r"^\s*(\w+):\s*'([^']+)',", blk, re.M))
    if len(eps) < 140:
        raise SystemExit(f'契约提取异常，只拿到 {len(eps)} 条')
    return eps


def schema() -> dict:
    s = (ROOT / 'src/lib/appSchema.ts').read_text(encoding='utf-8')
    at = s.index('export const APP_SCHEMA')
    brace = s.index('{', s.index('=', at))
    obj, _ = json.JSONDecoder().raw_decode(s[brace:])
    if obj.get('v') != 2 or len(obj['groups']) < 10:
        raise SystemExit('schema 提取异常')
    return obj


def write_generated(eps: dict[str, str], sch: dict):
    lines = [
        '// 自动生成，勿手改。来源：src/routes/app.ts 的 endpoints 契约。',
        '// iOS 与 Android 共用同一份接口地图；bootstrap 返回新契约时会覆盖这份兜底。',
        'import Foundation',
        '',
        'enum Endpoints {',
        '    /// App 冷启动没网时用这份静态契约；bootstrap 成功后以服务端下发为准。',
        '    static let defaults: [String: String] = [',
    ]
    for k, v in eps.items():
        esc = v.replace('\\', '\\\\').replace('"', '\\"')
        lines.append(f'        "{k}": "{esc}",')
    lines += ['    ]', '}', '']
    w(GEN / 'Endpoints.swift', '\n'.join(lines))
    w(GEN / 'schema.json', json.dumps(sch, ensure_ascii=False, separators=(',', ':')))
    print(f'✔ Endpoints.swift {len(eps)} 条 / schema.json {len(sch["groups"])} 组')


# ───────── 2. 资源 ─────────

def write_assets():
    # 根
    w(ASSETS / 'Contents.json', json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
    # 图标：复用 Android 品牌几何 N
    BG = (0x15, 0x15, 0x19, 255)
    PINK = (0xE5, 0x8A, 0xB0, 255)
    WHITE = (0xF7, 0xF7, 0xF8, 255)
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    cx = cy = S / 2

    def X(v): return cx + (v - 0.5) * S * 0.78
    def Y(v): return cy + (v - 0.5) * S * 0.78
    d.polygon([(X(.27), Y(.24)), (X(.355), Y(.24)), (X(.355), Y(.76)), (X(.27), Y(.76))], fill=WHITE)
    d.polygon([(X(.645), Y(.24)), (X(.73), Y(.24)), (X(.73), Y(.76)), (X(.645), Y(.76))], fill=WHITE)
    d.polygon([(X(.355), Y(.24)), (X(.44), Y(.24)), (X(.73), Y(.76)), (X(.645), Y(.76))], fill=WHITE)
    r = 0.035 * S * 0.78
    d.ellipse([X(.80) - r, Y(.225) - r, X(.80) + r, Y(.225) + r], fill=PINK)
    icon_dir = ASSETS / 'AppIcon.appiconset'
    icon_dir.mkdir(parents=True, exist_ok=True)
    im.convert('RGB').save(icon_dir / 'AppIcon.png', 'PNG')
    w(icon_dir / 'Contents.json', json.dumps({
        'images': [{'filename': 'AppIcon.png', 'idiom': 'universal',
                    'platform': 'ios', 'size': '1024x1024'}],
        'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')

    # 颜色集
    def colorset(name, rgb):
        p = ASSETS / (name + '.colorset')
        p.mkdir(parents=True, exist_ok=True)
        w(p / 'Contents.json', json.dumps({
            'colors': [{'color': {'color-space': 'srgb', 'components': {
                'a': '1.000', 'r': f'{rgb[0]:.3f}', 'g': f'{rgb[1]:.3f}', 'b': f'{rgb[2]:.3f}'}},
                'idiom': 'universal'}],
            'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')

    colorset('AccentColor', (0.898, 0.541, 0.690))
    colorset('LaunchBackground', (0.071, 0.075, 0.090))

    # 13 张插画：Android WebP → PNG（iOS 资源目录统一 PNG）
    src = ROOT / 'android/app/src/main/res/drawable-nodpi'
    n = 0
    for f in sorted(src.glob('art_*.webp')):
        p = ASSETS / (f.stem + '.imageset')
        p.mkdir(parents=True, exist_ok=True)
        Image.open(f).convert('RGB').save(p / (f.stem + '.png'), 'PNG')
        w(p / 'Contents.json', json.dumps({
            'images': [{'filename': f.stem + '.png', 'idiom': 'universal', 'scale': '1x'}],
            'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
        n += 1
    if n < 12:
        raise SystemExit(f'插画只有 {n} 张')

    # 滑块验证码图库：站点 public/img/captcha/*.webp → PNG 内置
    # iOS 不依赖远程 WebP 解码，原生 SliderCaptchaView 直接读本地资源。
    cap_src = ROOT / 'public/img/captcha'
    cap_n = 0
    for f in sorted(cap_src.glob('*.webp')):
        if f.stem == 'knob':
            continue
        name = 'captcha_' + f.stem
        p = ASSETS / (name + '.imageset')
        p.mkdir(parents=True, exist_ok=True)
        Image.open(f).convert('RGB').save(p / (name + '.png'), 'PNG')
        w(p / 'Contents.json', json.dumps({
            'images': [{'filename': name + '.png', 'idiom': 'universal', 'scale': '1x'}],
            'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
        cap_n += 1

    # 字体 + 许可证
    fonts = ROOT / 'android/app/src/main/assets/fonts'
    (APP / 'Fonts').mkdir(parents=True, exist_ok=True)
    for name in ('NotoSansSC-Regular.ttf', 'NotoSerifSC-VF.ttf', 'OFL.txt'):
        shutil.copyfile(fonts / name, APP / 'Fonts' / name)
    print(f'✔ Assets: AppIcon + 2 颜色集 + {n} 张插画 + 2 套 OFL 字体')


def write_plists():
    info = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Noxc</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Noxc</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>CFBundleLocalizations</key>
    <array>
        <string>en</string>
        <string>zh-Hans</string>
    </array>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UILaunchScreen</key>
    <dict>
        <key>UIColorName</key>
        <string>LaunchBackground</string>
    </dict>
    <!-- Universal：iPhone 竖屏 + 横屏，iPad 四向全开 -->
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <!-- 支持 iPad Split View / Slide Over / 台前调度，不强制全屏 -->
    <key>UIRequiresFullScreen</key>
    <false/>
    <key>UIApplicationSceneManifest</key>
    <dict>
        <key>UIApplicationSupportsMultipleScenes</key>
        <true/>
    </dict>
    <key>UIAppFonts</key>
    <array>
        <string>NotoSansSC-Regular.ttf</string>
        <string>NotoSerifSC-VF.ttf</string>
    </array>
    <key>ITSAppUsesNonExemptEncryption</key>
    <false/>
    <!-- 站点地址可在 App 设置里改，允许自建 http 站点；不走 App Store 分发 -->
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>NoxcSiteURL</key>
    <string>{DEFAULT_SITE}</string>
</dict>
</plist>
'''
    w(APP / 'Info.plist', info)

    export = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>ad-hoc</string>
    <key>teamID</key>
    <string>__TEAM_ID__</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>xyz.noxc.app</key>
        <string>__PROFILE_NAME__</string>
    </dict>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>thinning</key>
    <string>&lt;none&gt;</string>
</dict>
</plist>
'''
    w(IOS / 'ExportOptions.plist', export)


# ───────── 3. Xcode 工程 ─────────

def quote(s: str) -> str:
    return s if re.fullmatch(r'[A-Za-z0-9_./+-]+', s) else '"' + s.replace('"', '\\"') + '"'


def build_pbxproj(swift_files: list[str], resources: list[str]) -> str:
    U = lambda k: uid(k)
    objs: list[str] = []

    def emit(section: str, body: str):
        objs.append(f'/* Begin {section} section */\n{body}\n/* End {section} section */')

    # 文件引用
    refs: dict[str, tuple[str, str]] = {}   # path -> (uuid, filetype)
    for p in swift_files + resources + ['Info.plist']:
        if p.endswith('.swift'):
            ft = 'sourcecode.swift'
        elif p.endswith('.json'):
            ft = 'text.json'
        elif p.endswith('.plist'):
            ft = 'text.plist.xml'
        elif p.endswith('.xcassets'):
            ft = 'folder.assetcatalog'
        elif p.endswith('.ttf'):
            ft = 'file'
        elif p.endswith('.txt'):
            ft = 'text'
        else:
            ft = 'file'
        refs[p] = (U('ref:' + p), ft)

    product_ref = U('product')
    target = U('target')
    project = U('project')
    main_group = U('group:main')
    app_group = U('group:Noxc')
    gen_group = U('group:Generated')
    font_group = U('group:Fonts')
    res_group = U('group:Resources')
    prod_group = U('group:Products')
    sources_phase = U('phase:sources')
    frameworks_phase = U('phase:frameworks')
    resources_phase = U('phase:resources')
    proj_list = U('conflist:project')
    targ_list = U('conflist:target')
    dbg_proj, rel_proj = U('conf:project:Debug'), U('conf:project:Release')
    dbg_targ, rel_targ = U('conf:target:Debug'), U('conf:target:Release')

    # PBXBuildFile
    b = []
    for p in swift_files:
        b.append(f'\t\t{U("build:sources:" + p)} /* {p} in Sources */ = '
                 f'{{isa = PBXBuildFile; fileRef = {refs[p][0]} /* {p.split("/")[-1]} */; }};')
    for p in resources:
        b.append(f'\t\t{U("build:resources:" + p)} /* {p} in Resources */ = '
                 f'{{isa = PBXBuildFile; fileRef = {refs[p][0]} /* {p.split("/")[-1]} */; }};')
    emit('PBXBuildFile', '\n'.join(b))

    # PBXFileReference
    f = []
    for p, (u, ft) in refs.items():
        name = p.split('/')[-1]
        f.append(f'\t\t{u} /* {name} */ = {{isa = PBXFileReference; '
                 f'lastKnownFileType = {ft}; path = {quote(name)}; sourceTree = "<group>"; }};')
    f.append(f'\t\t{product_ref} /* Noxc.app */ = {{isa = PBXFileReference; '
             f'explicitFileType = wrapper.application; includeInIndex = 0; '
             f'path = Noxc.app; sourceTree = BUILT_PRODUCTS_DIR; }};')
    emit('PBXFileReference', '\n'.join(f))

    emit('PBXFrameworksBuildPhase',
         f'\t\t{frameworks_phase} /* Frameworks */ = {{\n'
         f'\t\t\tisa = PBXFrameworksBuildPhase;\n'
         f'\t\t\tbuildActionMask = 2147483647;\n'
         f'\t\t\tfiles = (\n\t\t\t);\n'
         f'\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};')

    # Groups：按目录组织
    def children(paths):
        return '\n'.join(f'\t\t\t\t{refs[p][0]} /* {p.split("/")[-1]} */,' for p in paths)

    swift_top = [p for p in swift_files if not p.startswith('Generated/')]
    gen_swift = [p for p in swift_files if p.startswith('Generated/')]
    # 每个 fileRef 只能挂在一个 group 里：Generated/* 归 Generated 组，
    # Fonts/* 归 Fonts 组，其余（Assets.xcassets）归 Resources 组。
    res_top = [p for p in resources
               if not p.startswith('Fonts/') and not p.startswith('Generated/')]
    font_res = [p for p in resources if p.startswith('Fonts/')]

    groups = f'''\t\t{main_group} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{app_group} /* Noxc */,
\t\t\t\t{prod_group} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{app_group} /* Noxc */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{gen_group} /* Generated */,
\t\t\t\t{font_group} /* Fonts */,
\t\t\t\t{res_group} /* Resources */,
{children(swift_top)}
\t\t\t\t{refs['Info.plist'][0]} /* Info.plist */,
\t\t\t);
\t\t\tpath = Noxc;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{gen_group} /* Generated */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{children(gen_swift + [p for p in resources if p.startswith('Generated/')])}
\t\t\t);
\t\t\tpath = Generated;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{font_group} /* Fonts */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{children(font_res)}
\t\t\t);
\t\t\tpath = Fonts;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{res_group} /* Resources */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
{children(res_top)}
\t\t\t);
\t\t\tname = Resources;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{prod_group} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{product_ref} /* Noxc.app */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};'''
    emit('PBXGroup', groups)

    emit('PBXNativeTarget', f'''\t\t{target} /* Noxc */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {targ_list} /* Build configuration list for PBXNativeTarget "Noxc" */;
\t\t\tbuildPhases = (
\t\t\t\t{sources_phase} /* Sources */,
\t\t\t\t{frameworks_phase} /* Frameworks */,
\t\t\t\t{resources_phase} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = Noxc;
\t\t\tproductName = Noxc;
\t\t\tproductReference = {product_ref} /* Noxc.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};''')

    emit('PBXProject', f'''\t\t{project} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1500;
\t\t\t\tLastUpgradeCheck = 1500;
\t\t\t\tTargetAttributes = {{
\t\t\t\t\t{target} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;
\t\t\t\t\t}};
\t\t\t\t}};
\t\t\t}};
\t\t\tbuildConfigurationList = {proj_list} /* Build configuration list for PBXProject "Noxc" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t\t"zh-Hans",
\t\t\t);
\t\t\tmainGroup = {main_group};
\t\t\tproductRefGroup = {prod_group} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{target} /* Noxc */,
\t\t\t);
\t\t}};''')

    emit('PBXResourcesBuildPhase', f'''\t\t{resources_phase} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
'''.rstrip('\n') + '\n' +
         '\n'.join(f'\t\t\t\t{U("build:resources:" + p)} /* {p.split("/")[-1]} in Resources */,' for p in resources) +
         f'''
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};''')

    emit('PBXSourcesBuildPhase', f'''\t\t{sources_phase} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
'''.rstrip('\n') + '\n' +
         '\n'.join(f'\t\t\t\t{U("build:sources:" + p)} /* {p.split("/")[-1]} in Sources */,' for p in swift_files) +
         f'''
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};''')

    common_project = '''\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCLANG_WARN_DOCUMENTATION_COMMENTS = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu11;
\t\t\t\tGCC_WARN_UNDECLARED_SELECTOR = YES;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tMTL_ENABLE_DEBUG_INFO = NO;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";'''

    common_target = f'''\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = Noxc/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = {BUNDLE_ID};
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";'''

    def conf(u, name, extra, level):
        return (f'\t\t{u} /* {name} */ = {{\n'
                f'\t\t\tisa = XCBuildConfiguration;\n'
                f'\t\t\tbuildSettings = {{\n{extra}\n\t\t\t}};\n'
                f'\t\t\tname = {name};\n\t\t}};')

    emit('XCBuildConfiguration', '\n'.join([
        conf(dbg_proj, 'Debug', common_project + '''
\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;
\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (
\t\t\t\t\t"DEBUG=1",
\t\t\t\t\t"$(inherited)",
\t\t\t\t);
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";''', 'project'),
        conf(rel_proj, 'Release', common_project + '''
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";''', 'project'),
        conf(dbg_targ, 'Debug', common_target + '''
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";''', 'target'),
        conf(rel_targ, 'Release', common_target, 'target'),
    ]))

    emit('XCConfigurationList', f'''\t\t{proj_list} /* Build configuration list for PBXProject "Noxc" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{dbg_proj} /* Debug */,
\t\t\t\t{rel_proj} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
\t\t{targ_list} /* Build configuration list for PBXNativeTarget "Noxc" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{dbg_targ} /* Debug */,
\t\t\t\t{rel_targ} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};''')

    body = '\n\n'.join(objs)
    return ('// !$*UTF8*$!\n'
            '{\n'
            '\tarchiveVersion = 1;\n'
            '\tclasses = {\n\t};\n'
            '\tobjectVersion = 56;\n'
            '\tobjects = {\n\n' + body + '\n\n\t};\n'
            f'\trootObject = {project} /* Project object */;\n'
            '}\n')


def write_scheme():
    U = uid('target')
    s = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1500" version="1.7">
   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
            <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{U}" BuildableName="Noxc.app" BlueprintName="Noxc" ReferencedContainer="container:Noxc.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
      <Testables></Testables>
   </TestAction>
   <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
   </LaunchAction>
   <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES">
   </ProfileAction>
   <AnalyzeAction buildConfiguration="Debug"></AnalyzeAction>
   <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"></ArchiveAction>
</Scheme>
'''
    w(PROJ / 'xcshareddata/xcschemes/Noxc.xcscheme', s)


def main():
    eps = endpoints()
    sch = schema()
    write_generated(eps, sch)
    write_assets()
    write_plists()

    swift = sorted(str(p.relative_to(APP)).replace('\\', '/')
                   for p in APP.rglob('*.swift'))
    resources = (sorted(str(p.relative_to(APP)).replace('\\', '/')
                        for p in APP.rglob('*.json')
                        if 'Assets.xcassets' not in str(p))
                 + ['Assets.xcassets']
                 + sorted('Fonts/' + p.name for p in (APP / 'Fonts').iterdir()))
    # Assets.xcassets 里的 Contents.json 不作为单独资源
    resources = [r for r in resources if not r.startswith('Assets.xcassets/')]
    if not swift:
        raise SystemExit('没有 Swift 源文件，工程会编译失败')

    w(PROJ / 'project.pbxproj', build_pbxproj(swift, resources))
    write_scheme()
    print(f'✔ Xcode 工程：{len(swift)} 个 Swift 文件 / {len(resources)} 项资源')
    print('  Swift:', ', '.join(swift))


if __name__ == '__main__':
    main()
