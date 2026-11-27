#!/usr/bin/env python3
"""安卓资源引用交叉校验：本地没有 android.jar，先自己抓一遍 aapt 会报的错。

扫描所有 XML 的 @string/@color/@drawable/@mipmap/@xml 与 Java 的 R.* 引用，
逐项确认有定义；android.R.* 是平台资源，排除后不参与校验。
由 scripts/android-apk-regression.ts 真跑调用，CI 的 assembleDebug 再真编译。
"""
import glob
import os
import re
import sys

MAIN = 'android/app/src/main'
RES = MAIN + '/res'


def names(pattern, files):
    out = set()
    for f in files:
        out.update(re.findall(pattern, open(f, encoding='utf-8').read()))
    return out


def xml_all():
    return ''.join(open(f, encoding='utf-8').read()
                   for f in glob.glob(MAIN + '/**/*.xml', recursive=True))


def java_all():
    s = ''.join(open(f, encoding='utf-8').read()
                for f in glob.glob(MAIN + '/java/**/*.java', recursive=True))
    # 平台资源不算本项目资源
    return re.sub(r'android\.R\.', 'ANDROID_R_', s)


def main():
    strings = names(r'<string name="([^"]+)"',
                    glob.glob(RES + '/values*/strings.xml'))
    colors = names(r'<color name="([^"]+)"',
                   glob.glob(RES + '/values*/colors.xml'))
    drawables = {os.path.splitext(os.path.basename(f))[0]
                 for f in glob.glob(RES + '/drawable*/*')}
    mipmaps = {os.path.splitext(os.path.basename(f))[0]
               for f in glob.glob(RES + '/mipmap-*/*')}
    layouts = {os.path.splitext(os.path.basename(f))[0]
               for f in glob.glob(RES + '/layout/*.xml')}
    xml_files = {os.path.splitext(os.path.basename(f))[0]
                 for f in glob.glob(RES + '/xml/*.xml')}
    # id 可能定义在布局，也可能定义在 menu（BottomNavigationView / Toolbar 溢出菜单）
    ids = names(r'@\+id/([A-Za-z0-9_]+)',
                glob.glob(RES + '/layout/*.xml') + glob.glob(RES + '/menu/*.xml'))

    x, j = xml_all(), java_all()
    checks = [
        ('@string', r'@string/([A-Za-z0-9_]+)', x, strings),
        ('@color', r'@color/([A-Za-z0-9_]+)', x, colors),
        ('@drawable', r'@drawable/([A-Za-z0-9_]+)', x, drawables),
        ('@mipmap', r'@mipmap/([A-Za-z0-9_]+)', x, mipmaps),
        ('@xml', r'@xml/([A-Za-z0-9_]+)', x, xml_files),
        ('R.string', r'R\.string\.([A-Za-z0-9_]+)', j, strings),
        ('R.color', r'R\.color\.([A-Za-z0-9_]+)', j, colors),
        ('R.id', r'R\.id\.([A-Za-z0-9_]+)', j, ids),
        ('R.layout', r'R\.layout\.([A-Za-z0-9_]+)', j, layouts),
        ('R.drawable', r'R\.drawable\.([A-Za-z0-9_]+)', j, drawables),
    ]
    errs = []
    for kind, pat, src, defined in checks:
        for ref in set(re.findall(pat, src)):
            if ref not in defined:
                errs.append('%s: %s' % (kind, ref))
    if errs:
        print('✗ 未定义资源引用:')
        for e in sorted(errs):
            print('  ' + e)
        return 1
    print('✓ 资源引用齐全：%d strings / %d colors / %d drawables / %d ids / %d layouts'
          % (len(strings), len(colors), len(drawables), len(ids), len(layouts)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
