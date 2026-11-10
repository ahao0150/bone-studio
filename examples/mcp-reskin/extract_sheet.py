#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从部件图版输出中逐格提取换皮贴图：
  1) 按 layout 裁格子 → 抠浅灰底 → 取最大连通域（画出来的那个部件）
  2) 与原始部件 alpha 做矩配准（等比缩放+中心对齐），再 ±3px 平移微调 IoU
  3) 颜色采样回原尺寸画布，alpha 沿用原部件（几何不变）
用法: python3 extract_sheet.py <painted_sheet.png> <out_dir>
"""
import json, os, sys
import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FOX = os.path.abspath(os.environ.get('RESKIN_WORKDIR', os.path.join(HERE, '..', 'fox-workspace')))
LAYOUT = os.path.abspath(os.environ.get('RESKIN_LAYOUT', os.path.join(HERE, 'sheet_layout.json')))
layout = json.load(open(LAYOUT, encoding='utf-8'))
SW, SH = layout['size']
LIMB_BONES = {'thigh_n', 'shin_n', 'paw_n', 'thigh_f', 'shin_f', 'paw_f',
              'arm_n', 'forearm_n', 'pawF_n', 'arm_f', 'forearm_f', 'pawF_f'}

def key_bg(img, thr=20):
    h, w = img.shape[:2]
    p = 6
    corners = np.concatenate([img[:p, :p].reshape(-1, 3), img[:p, -p:].reshape(-1, 3),
                              img[-p:, :p].reshape(-1, 3), img[-p:, -p:].reshape(-1, 3)])
    bgc = np.median(corners, axis=0)
    dist = np.sqrt(((img.astype(np.float32) - bgc) ** 2).sum(2))
    near = (dist < thr).astype(np.uint8)
    ff = near.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if ff[sy, sx]:
            cv2.floodFill(ff, mask, (sx, sy), 2)
    subject = (ff != 2).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(subject, 8)
    if n > 1:
        idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        subject = (lab == idx).astype(np.uint8)
    subject = cv2.morphologyEx(subject, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return subject

def bleed(img, mask, iters=5):
    out = img.astype(np.float32).copy()
    m = mask.astype(bool)
    for _ in range(iters):
        grown = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        ring = grown & ~m
        if not ring.any():
            break
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            sm = np.roll(np.roll(m, dy, 0), dx, 1)
            sc = np.roll(np.roll(out, dy, 0), dx, 1)
            take = ring & sm
            out[take] = sc[take]
        m = grown
    return np.clip(out, 0, 255).astype(np.uint8)

def align_mask(src_m, dst_m):
    """求把 src 掩码对齐到 dst 掩码的 2x3 变换（等比缩放+平移，IoU 微调）。"""
    ys, xs = np.where(src_m > 0); ys2, xs2 = np.where(dst_m > 0)
    sbw, sbh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    dbw, dbh = xs2.max() - xs2.min() + 1, ys2.max() - ys2.min() + 1
    s = min(dbw / sbw, dbh / sbh)
    ms, md = cv2.moments(src_m, True), cv2.moments(dst_m, True)
    cs = (ms['m10'] / ms['m00'], ms['m01'] / ms['m00'])
    cd = (md['m10'] / md['m00'], md['m01'] / md['m00'])
    best = (s, cd[0] - s * cs[0], cd[1] - s * cs[1])
    def score(p):
        W = np.array([[p[0], 0, p[1]], [0, p[0], p[2]]], np.float32)
        ws = cv2.warpAffine(src_m, W, (dst_m.shape[1], dst_m.shape[0]), flags=cv2.INTER_NEAREST)
        inter = np.logical_and(ws, dst_m).sum()
        union = np.logical_or(ws, dst_m).sum()
        return inter / max(union, 1)
    b = score(best)
    for step in (3, 2, 1):
        improved = True
        while improved:
            improved = False
            for dx, dy in ((step, 0), (-step, 0), (0, step), (0, -step), (step, step), (-step, -step), (step, -step), (-step, step)):
                q = (best[0], best[1] + dx, best[2] + dy)
                v = score(q)
                if v > b + 1e-5:
                    best, b = q, v
                    improved = True
    return best, b

def main():
    painted_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    img = np.array(Image.open(painted_path).convert('RGB').resize((SW, SH), Image.LANCZOS))
    report = []
    for cell in layout['cells']:
        name = cell['name']
        x0, y0, x1, y1 = cell['cell']
        pad = 8
        crop = img[y0 + pad:y1 - pad, x0 + pad:x1 - pad]
        sub = key_bg(crop)
        area = int(sub.sum())
        alpha_src = np.array(Image.open(os.path.join(FOX, 'png', name + '.png')).convert('RGBA'))[..., 3]
        h, w = alpha_src.shape
        near_ok = area > 30
        if near_ok:
            subd = cv2.dilate(sub, np.ones((3, 3), np.uint8))  # 掩码略胀，盖住抗锯齿
            core = cv2.erode(subd, np.ones((3, 3), np.uint8), iterations=1)  # 去掉边缘亮边
            if core.sum() < 30:
                core = subd
            filled = bleed(crop, core, iters=18)  # 深度外扩，避免 alpha 边缘采样到底色
            # 填充区（alpha 关节圆超出画出肢体的角落）向部件整体中值色混合，避免发白
            painted = cv2.dilate(sub, np.ones((3, 3), np.uint8)) > 0
            med = np.median(crop[core > 0], axis=0)
            outside = ~painted
            filled[outside] = (0.35 * filled[outside] + 0.65 * med).astype(np.uint8)
            (s, tx, ty), iou = align_mask(subd, (alpha_src > 8).astype(np.uint8))
            s *= 1.02  # 2% 余量，让内容完全覆盖 alpha 的圆头
            ms, md = cv2.moments(subd, True), cv2.moments(alpha_src > 8, True)
            cs = (ms['m10'] / ms['m00'], ms['m01'] / ms['m00'])
            cd = (md['m10'] / md['m00'], md['m01'] / md['m00'])
            tx, ty = cd[0] - s * cs[0], cd[1] - s * cs[1]
            Wm = np.array([[s, 0, tx], [0, s, ty]], np.float32)
            warped = cv2.warpAffine(filled, Wm, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            # 边缘亮色钳制：painterly 图版给肢体末端画了浅色"毛袜"，贴到 alpha 的
            # 关节圆上会形成白圈。对距 alpha 边缘 <5px 的环带，若比"核心区颜色"
            # 明显更亮（>+22），改用核心色，纹理暗部与合理浅色保留。
            A = (alpha_src > 8).astype(np.uint8)
            coreA = cv2.erode(A, np.ones((3, 3), np.uint8), iterations=8)
            if coreA.sum() >= 20:
                nearest = bleed(warped, coreA, iters=14)
                edge_zone = A.astype(bool) & ~cv2.erode(A, np.ones((3, 3), np.uint8), iterations=5).astype(bool)
                lum_w = warped.astype(np.float32).mean(axis=2)
                lum_n = nearest.astype(np.float32).mean(axis=2)
                replace = edge_zone & (lum_w > lum_n + 22)
                warped = np.where(replace[..., None], nearest, warped)
            # 四肢部件：3px 边缘环带向整体中值色混合，压掉肢端浅色毛边造成的白痕
            if cell['bone'] in LIMB_BONES:
                med_w = np.median(warped[coreA > 0], axis=0) if coreA.sum() >= 20 else np.array([200, 110, 40], np.float32)
                edge3 = A.astype(bool) & ~cv2.erode(A, np.ones((3, 3), np.uint8), iterations=3).astype(bool)
                wf = warped.astype(np.float32)
                wf[edge3] = 0.45 * wf[edge3] + 0.55 * med_w
                warped = np.clip(wf, 0, 255).astype(np.uint8)
            rgba = np.dstack([warped, alpha_src]).astype(np.uint8)
        else:
            rgba = np.dstack([np.zeros((h, w, 3), np.uint8), alpha_src]).astype(np.uint8)
            iou = 0.0
        Image.fromarray(rgba, 'RGBA').save(os.path.join(out_dir, name + '.png'))
        report.append((name, area, round(float(iou), 3), near_ok))
    print(f"{sum(1 for r in report if r[3])}/{len(report)} parts extracted")
    for r in report:
        flag = 'OK ' if r[3] else 'MISS'
        print(f'  {flag} {r[0]:11s} area={r[1]:5d} iou={r[2]:.3f}')

if __name__ == '__main__':
    main()
