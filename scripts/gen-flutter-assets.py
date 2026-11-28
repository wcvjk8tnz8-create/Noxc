#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从服务端真源生成 Flutter 工程 assets/（唯一真源，重跑即可刷新）。

  assets/endpoints.json   148 条接口契约 ← src/routes/app.ts
  assets/schema.json      10 组 / 48 页功能描述 ← src/lib/appSchema.ts
  assets/images/*.png     13 张品牌插画 + 4 张滑块图库 ← Android drawable / public/img/captcha
  assets/fonts/*          两套 OFL 中文字体 + 许可证

PiliPlus 那类 Flutter 客户端的痛点是「一堆 git fork 依赖，构建前得拉分支」；
我们反着来：零第三方 dart 包（只用 http + shared_preferences 两个官方包），
所有数据来自服务端下发 + 内置快照，pub get 只走 pub.dev。
"""
import json
import pathlib
import re
import shutil

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
FL = ROOT / 'flutter'
ASSETS = FL / 'assets'


def w(p: pathlib.Path, text: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def endpoints() -> dict:
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


def main():
    eps, sch = endpoints(), schema()
    w(ASSETS / 'endpoints.json', json.dumps(eps, ensure_ascii=False, indent=2) + '\n')
    w(ASSETS / 'schema.json', json.dumps(sch, ensure_ascii=False, separators=(',', ':')))

    img = ASSETS / 'images'
    img.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted((ROOT / 'android/app/src/main/res/drawable-nodpi').glob('art_*.webp')):
        Image.open(f).convert('RGB').save(img / (f.stem + '.png'), 'PNG')
        n += 1
    for f in sorted((ROOT / 'public/img/captcha').glob('*.webp')):
        if f.stem == 'knob':
            continue
        Image.open(f).convert('RGB').save(img / ('captcha_' + f.stem + '.png'), 'PNG')
        n += 1
    if n < 16:
        raise SystemExit(f'插画/验证码图只生成了 {n} 张')

    fonts = ASSETS / 'fonts'
    fonts.mkdir(parents=True, exist_ok=True)
    for name in ('NotoSansSC-Regular.ttf', 'NotoSerifSC-VF.ttf', 'OFL.txt'):
        shutil.copyfile(ROOT / 'android/app/src/main/assets/fonts' / name, fonts / name)

    screens = sum(len(g['screens']) for g in sch['groups'])
    print(f'✔ {len(eps)} 条契约 / {len(sch["groups"])} 组 {screens} 页 / {n} 张图 / 2 套 OFL 字体')


if __name__ == '__main__':
    main()
