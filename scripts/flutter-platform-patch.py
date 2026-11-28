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
    if 'android.permission.INTERNET' not in t:
        t = t.replace(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <uses-permission android:name="android.permission.INTERNET"/>',
            1)
        main.write_text(t, encoding='utf-8')
        print('  ✔ AndroidManifest 补 INTERNET 权限')
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
    if man.exists() and 'android.permission.INTERNET' not in man.read_text(encoding='utf-8'):
        print('  ✗ Android 缺 INTERNET 权限')
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
