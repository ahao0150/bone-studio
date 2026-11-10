#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拼两张参考图：
1) ref_clean.png —— 无关节圆盘描边的完整 setup 姿态（800x600）
2) sheet_ref.png —— 1536x1024：左侧完整角色 + 右侧 5x5 部件图版（无圆盘版本）
输出 sheet_layout.json 供逐格提取用。
"""
import json, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.environ.get('RESKIN_OUT', HERE))
os.makedirs(OUT, exist_ok=True)
FOX = os.path.abspath(os.environ.get('RESKIN_WORKDIR', os.path.join(HERE, '..', 'fox-workspace')))
# workdir 需包含 layers_manifest_clean.json 与 png_clean/（见 gen_parts.py --clean）
W, H = 800, 600
SW, SH = 1536, 1024
BG = (236, 236, 236)

manifest = json.load(open(os.path.join(FOX, 'layers_manifest_clean.json'), encoding='utf-8'))
manifest.sort(key=lambda e: e['zIndex'])

# ---- 1. 完整 setup（无圆盘）----
ref = Image.new('RGBA', (W, H), BG + (255,))
for e in manifest:
    im = Image.open(os.path.join(FOX, 'png_clean', e['name'] + '.png')).convert('RGBA')
    ref.alpha_composite(im, (e['left'], e['top']))
ref.convert('RGB').save(os.path.join(OUT, 'ref_clean.png'))

# ---- 2. 图版 ----
sheet = Image.new('RGBA', (SW, SH), BG + (255,))
d = ImageDraw.Draw(sheet)

# 左：完整角色
px0, py0, px1, py1 = 16, 16, 560, 1008
s = min((px1 - px0) / W, (py1 - py0) / H)
rw, rh = int(W * s), int(H * s)
rx, ry = px0 + (px1 - px0 - rw) // 2, py0 + (py1 - py0 - rh) // 2
small = ref.convert('RGB').resize((rw, rh), Image.LANCZOS)
sheet.paste(small, (rx, ry))
d.rectangle([rx - 2, ry - 2, rx + rw + 2, ry + rh + 2], outline=(208, 208, 208), width=2)

# 右：5x5 网格
gx0, gy0, gx1, gy1 = 576, 16, 1520, 1008
cols, rows = 5, 5
cw, ch = (gx1 - gx0) / cols, (gy1 - gy0) / rows
layout = []
for i, e in enumerate(manifest):
    c, r = i % cols, i // cols
    cx0, cy0 = gx0 + c * cw, gy0 + r * ch
    cx1, cy1 = cx0 + cw, cy0 + ch
    d.rectangle([cx0 + 2, cy0 + 2, cx1 - 2, cy1 - 2], outline=(214, 214, 214), width=2)
    im = Image.open(os.path.join(FOX, 'png_clean', e['name'] + '.png')).convert('RGBA')
    sc = min((cw - 30) / im.width, (ch - 30) / im.height, 1.6)
    tw, th = max(1, int(im.width * sc)), max(1, int(im.height * sc))
    im2 = im.resize((tw, th), Image.LANCZOS)
    ox = int(cx0 + (cw - tw) / 2)
    oy = int(cy0 + (ch - th) / 2)
    sheet.alpha_composite(im2, (ox, oy))
    layout.append({
        'name': e['name'], 'cell': [round(cx0), round(cy0), round(cx1), round(cy1)],
        'scale': round(sc, 4), 'part': [ox, oy, tw, th],
        'orig': [e['width'], e['height']], 'bone': e['bone'], 'zIndex': e['zIndex'],
    })

sheet.convert('RGB').save(os.path.join(OUT, 'sheet_ref.png'))
json.dump({'size': [SW, SH], 'cells': layout}, open(os.path.join(OUT, 'sheet_layout.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ref_clean.png + sheet_ref.png written;', len(layout), 'cells')
