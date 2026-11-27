#!/usr/bin/env python3
"""生成 Noxc Android 启动图标：深色圆角底 + 几何 N + 一点品牌粉。

产物：
  mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png   传统图标（API 24/25）
  mipmap-xxxhdpi/ic_launcher_foreground.png                  自适应图标前景（API 26+）
只依赖 Pillow；脚本入库，PNG 产物入库，CI 不重复生成。
"""
from PIL import Image, ImageDraw
import pathlib

RES = pathlib.Path(__file__).resolve().parent.parent / 'android/app/src/main/res'
BG = (0x15, 0x15, 0x19, 255)
PINK = (0xE5, 0x8A, 0xB0, 255)
WHITE = (0xF7, 0xF7, 0xF8, 255)
S = 4  # 超采样抗锯齿


def glyph(dr, w, h, color, scale=1.0):
    """居中几何 N（左竖 + 斜 + 右竖）+ 右上一点粉。scale<1 留给自适应安全区。"""
    cx, cy = w / 2, h / 2
    def X(v):
        return cx + (v - 0.5) * w * scale
    def Y(v):
        return cy + (v - 0.5) * h * scale
    def box(x1, y1, x2, y2):
        return [(X(x1), Y(y1)), (X(x2), Y(y1)), (X(x2), Y(y2)), (X(x1), Y(y2))]
    dr.polygon(box(0.27, 0.24, 0.355, 0.76), fill=color)
    dr.polygon(box(0.645, 0.24, 0.73, 0.76), fill=color)
    dr.polygon([(X(0.355), Y(0.24)), (X(0.44), Y(0.24)),
                (X(0.73), Y(0.76)), (X(0.645), Y(0.76))], fill=color)
    r = 0.035 * min(w, h) * scale
    dr.ellipse([X(0.80)-r, Y(0.225)-r, X(0.80)+r, Y(0.225)+r], fill=PINK)


def rounded(size, radius_ratio=0.22):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    r = size * radius_ratio
    dr.rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=BG)
    return img


def main():
    for name, px in [('mipmap-mdpi', 48), ('mipmap-hdpi', 72),
                     ('mipmap-xhdpi', 96), ('mipmap-xxhdpi', 144),
                     ('mipmap-xxxhdpi', 192)]:
        big = px * S
        img = rounded(big)
        glyph(ImageDraw.Draw(img), big, big, WHITE)
        out = img.resize((px, px), Image.LANCZOS)
        path = RES / name / 'ic_launcher.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        out.save(path, 'PNG')
        print('✓', path.relative_to(RES), px, 'x', px)

    # 自适应前景：432x432 透明底，内容缩到中间 66% 安全区
    fg = Image.new('RGBA', (432*S, 432*S), (0, 0, 0, 0))
    glyph(ImageDraw.Draw(fg), 432*S, 432*S, WHITE, scale=0.62)
    fg = fg.resize((432, 432), Image.LANCZOS)
    path = RES / 'mipmap-xxxhdpi' / 'ic_launcher_foreground.png'
    fg.save(path, 'PNG')
    print('✓', path.relative_to(RES), '432 x 432')


if __name__ == '__main__':
    main()
