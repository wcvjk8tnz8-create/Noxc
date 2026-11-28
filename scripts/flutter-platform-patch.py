#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CI 里 `flutter create` 生成 android/ / ios/ 平台壳之后调用。

平台壳不入库（由 Flutter SDK 按版本生成，避免手写 pbxproj / Gradle），
但模板缺几样东西，这里按 PiliPlus 那类跨平台工程的惯例补上：

Android
  · INTERNET 权限（Flutter release manifest 默认没有，App 会连不上站点）
  · applicationId 统一为 xyz.noxc.app
iOS
  · CFBundleDisplayName / 中英双语
  · iPad 四向 + UIRequiresFullScreen=false（Split View / Slide Over）
  · NSAllowsArbitraryLoads（支持在设置里改自建 http 站点）
  · TARGETED_DEVICE_FAMILY = 1,2、部署目标 ≥ iOS 13
  · Android <queries> / iOS CFBundleURLTypes：浏览器授权登录回跳
"""
import pathlib
import plistlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FL = ROOT / 'flutter'


def patch_android():
    main = FL / 'android/app/src/main/AndroidManifest.xml'
    if not main.exists():
        print('  (无 AndroidManifest，跳过)')
        return
    t = main.read_text(encoding='utf-8')
    changed = False
    if 'android.permission.INTERNET' not in t:
        t = t.replace(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <uses-permission android:name="android.permission.INTERNET"/>',
            1)
        changed = True
        print('  ✔ AndroidManifest 补 INTERNET 权限')
    # Android 11+ 包可见性：url_launcher 打开 https 需要声明 queries
    if '<queries>' not in t:
        queries = '''    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW"/>
            <data android:scheme="https"/>
        </intent>
    </queries>
'''
        t = t.replace('</manifest>', queries + '</manifest>', 1)
        changed = True
        print('  ✔ AndroidManifest 补 <queries>（Android 11+ 打开浏览器）')
    # 授权页的「一键返回 App」用 noxc://auth?code=，注册 scheme 才能切回 App
    if 'android:scheme="noxc"' not in t:
        filt = '''            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="noxc" android:host="auth"/>
            </intent-filter>
'''
        idx = t.find('</activity>')
        if idx < 0:
            raise SystemExit('  ✗ AndroidManifest 没有 </activity>，无法注入 noxc:// 回跳')
        t = t[:idx] + filt + t[idx:]
        changed = True
        print('  ✔ AndroidManifest 补 noxc://auth 回跳 intent-filter')
    if changed:
        main.write_text(t, encoding='utf-8')
    for gradle in sorted((FL / 'android/app').glob('build.gradle*')):
        g = gradle.read_text(encoding='utf-8')
        g2 = re.sub(r'applicationId\s*=\s*"[^"]+"', 'applicationId = "xyz.noxc.app"', g)
        if g2 != g:
            gradle.write_text(g2, encoding='utf-8')
            print(f'  ✔ {gradle.name} applicationId → xyz.noxc.app')


def patch_ios():
    info = FL / 'ios/Runner/Info.plist'
    if not info.exists():
        print('  (无 Info.plist，跳过)')
        return
    with info.open('rb') as f:
        p = plistlib.load(f)
    p['CFBundleDisplayName'] = 'Noxc'
    p['CFBundleLocalizations'] = ['en', 'zh-Hans']
    p['UISupportedInterfaceOrientations~ipad'] = [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
    ]
    p['UIRequiresFullScreen'] = False
    p['NSAppTransportSecurity'] = {'NSAllowsArbitraryLoads': True}
    # 浏览器授权页的「一键返回 App」：noxc://auth?code=XXXX
    p['CFBundleURLTypes'] = [
        {'CFBundleURLName': 'xyz.noxc.app', 'CFBundleURLSchemes': ['noxc']}
    ]
    p['ITSAppUsesNonExemptEncryption'] = False
    with info.open('wb') as f:
        plistlib.dump(p, f)
    print('  ✔ Info.plist：iPad 四向 / 分屏 / ATS / 中英双语 / 显示名')

    pbx = FL / 'ios/Runner.xcodeproj/project.pbxproj'
    if pbx.exists():
        t = pbx.read_text(encoding='utf-8')
        t2 = re.sub(r'TARGETED_DEVICE_FAMILY\s*=\s*"[^"]+"',
                    'TARGETED_DEVICE_FAMILY = "1,2"', t)
        # Flutter 模板偶有 12.0，Material 3 / http 需要更高部署目标
        t2 = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET\s*=\s*[0-9.]+;',
                    'IPHONEOS_DEPLOYMENT_TARGET = 13.0;', t2)
        t2 = re.sub(r'PRODUCT_BUNDLE_IDENTIFIER\s*=\s*[\w.]+;',
                    'PRODUCT_BUNDLE_IDENTIFIER = xyz.noxc.app;', t2)
        if t2 != t:
            pbx.write_text(t2, encoding='utf-8')
            print('  ✔ pbxproj：Universal 1,2 / iOS 13 / Bundle ID')


def verify():
    ok = True
    man = FL / 'android/app/src/main/AndroidManifest.xml'
    if man.exists():
        mt = man.read_text(encoding='utf-8')
        for must, desc in (
            ('android.permission.INTERNET', 'INTERNET 权限'),
            ('<queries>', 'queries（浏览器可见性）'),
            ('android:scheme="noxc"', 'noxc:// 回跳'),
        ):
            if must not in mt:
                print('  ✗ Android 缺 ' + desc)
                ok = False
    info = FL / 'ios/Runner/Info.plist'
    if info.exists():
        with info.open('rb') as f:
            p = plistlib.load(f)
        if len(p.get('UISupportedInterfaceOrientations~ipad', [])) != 4:
            print('  ✗ iPad 方向不是四个')
            ok = False
        if p.get('UIRequiresFullScreen') is not False:
            print('  ✗ UIRequiresFullScreen 未关')
            ok = False
        schemes = [s for t2 in p.get('CFBundleURLTypes', [])
                   for s in t2.get('CFBundleURLSchemes', [])]
        if 'noxc' not in schemes:
            print('  ✗ iOS 未注册 noxc:// 回跳 scheme')
            ok = False
    pbx = FL / 'ios/Runner.xcodeproj/project.pbxproj'
    if pbx.exists() and 'TARGETED_DEVICE_FAMILY = "1,2"' not in pbx.read_text(encoding='utf-8'):
        print('  ✗ 工程不是 Universal')
        ok = False
    print('✔ Flutter 平台壳校验：' + ('通过' if ok else '失败'))
    return ok


if __name__ == '__main__':
    patch_android()
    patch_ios()
    sys.exit(0 if verify() else 1)
