#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BoneStudio 换皮：把 AI 重绘整图投影回 25 个分层部件的纹理。
思路：轮廓 ECC 配准（仿射）把 AI 图对齐到原 800x600 画布；逐部件按 bbox 采样颜色，
alpha 沿用原部件（几何完全不变 → 关节不可能穿帮）。用法：
  python3 project_texture.py <gen.png> <out_parts_dir> [--ref ref_setup.png] [--preview out.png]
"""
import json, os, sys
import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FOX = os.path.abspath(os.environ.get('RESKIN_WORKDIR', os.path.join(HERE, '..', 'fox-workspace')))
# workdir 需包含 layers_manifest.json 与 png/
W, H = 800, 600

def key_white(img, thr=15):
    """按四角底色抠图：与背景色距离小于阈值且与画布边缘连通的区域视为背景。"""
    h, w = img.shape[:2]
    p = 6
    corners = np.concatenate([
        img[:p, :p].reshape(-1, 3), img[:p, -p:].reshape(-1, 3),
        img[-p:, :p].reshape(-1, 3), img[-p:, -p:].reshape(-1, 3)])
    bgc = np.median(corners, axis=0)
    dist = np.sqrt(((img.astype(np.float32) - bgc) ** 2).sum(axis=2))
    near = (dist < thr).astype(np.uint8)
    ff = near.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if ff[sy, sx] == 1:
            cv2.floodFill(ff, mask, (sx, sy), 2)
    bg = (ff == 2).astype(np.uint8)
    subject = 1 - bg
    # 保留最大连通域
    n, lab, stats, _ = cv2.connectedComponentsWithStats(subject, 8)
    if n > 1:
        idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        subject = (lab == idx).astype(np.uint8)
    subject = cv2.morphologyEx(subject, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return subject

def bleed_colors(img, subject, iters=6):
    """把主体颜色向背景扩散若干像素，防止部件边缘采样到白底。"""
    out = img.astype(np.float32).copy()
    m = subject.astype(bool)
    for _ in range(iters):
        grown = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        ring = grown & ~m
        if not ring.any():
            break
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            shifted_m = np.roll(np.roll(m, dy, 0), dx, 1)
            shifted_c = np.roll(np.roll(out, dy, 0), dx, 1)
            take = ring & shifted_m
            out[take] = shifted_c[take]
        m = grown
    return np.clip(out, 0, 255).astype(np.uint8)

def compose(manifest, parts_dir, size=(W, H)):
    canvas = Image.new('RGBA', size, (0, 0, 0, 0))
    for e in sorted(manifest, key=lambda x: x['zIndex']):
        im = Image.open(os.path.join(parts_dir, e['name'] + '.png')).convert('RGBA')
        canvas.alpha_composite(im, (e['left'], e['top']))
    return canvas

def main():
    gen_path, out_dir = sys.argv[1], sys.argv[2]
    ref_path = os.path.join(HERE, 'ref_setup.png')
    preview_path = os.path.join(out_dir, 'preview_skin.png')
    for i, a in enumerate(sys.argv):
        if a == '--ref':
            ref_path = sys.argv[i + 1]
        if a == '--preview':
            preview_path = sys.argv[i + 1]
    manifest = json.load(open(os.path.join(FOX, 'layers_manifest.json'), encoding='utf-8'))
    os.makedirs(out_dir, exist_ok=True)

    # ---- 1. AI 图：缩放到画布、抠主体 ----
    gen = np.array(Image.open(gen_path).convert('RGB').resize((W, H), Image.LANCZOS))
    gen_subj = key_white(gen)

    # ---- 2. 原始画布轮廓（部件 alpha 并集）----
    orig = compose(manifest, os.path.join(FOX, 'png'))
    orig_mask = (np.array(orig.getchannel('A')) > 8).astype(np.uint8)

    # ---- 3. 仿射配准（AI 图 → 原画布）：矩协方差初始化 + 模糊 mask 的 ECC 精修 ----
    g8 = (gen_subj * 255).astype(np.uint8)
    o8 = (orig_mask * 255).astype(np.uint8)
    def moments_affine(src_mask, dst_mask):
        """求把 src 对齐到 dst 的仿射初值（含各向异性缩放）。"""
        def stats(m):
            mm = cv2.moments(m, True)
            cx, cy = mm['m10'] / mm['m00'], mm['m01'] / mm['m00']
            cxx, cyy, cxy = mm['mu20'] / mm['m00'], mm['mu02'] / mm['m00'], mm['mu11'] / mm['m00']
            return (cx, cy), np.array([[cxx, cxy], [cxy, cyy]])
        (gs, cs), (gd, cd) = stats(src_mask), stats(dst_mask)
        def sqrtm(c):
            w, v = np.linalg.eigh(c)
            w = np.clip(w, 1e-6, None)
            return v @ np.diag(np.sqrt(w)) @ v.T
        A = sqrtm(cd) @ np.linalg.inv(sqrtm(cs))
        t = np.array(gd) - A @ np.array(gs)
        return np.hstack([A, t.reshape(2, 1)]).astype(np.float32)

    warp = moments_affine(g8, o8)

    # 参数化（a,b,tx,c,d,ty）坐标下降最大化 IoU
    def to_w(p):
        return np.array([[p[0], p[1], p[2]], [p[3], p[4], p[5]]], np.float32)

    def iou(p, src, dst):
        ws = cv2.warpAffine(src, to_w(p), (dst.shape[1], dst.shape[0]), flags=cv2.INTER_NEAREST)
        inter = np.logical_and(ws > 0, dst > 0).sum()
        union = np.logical_or(ws > 0, dst > 0).sum()
        return inter / max(union, 1)

    def fit(src, dst, p, steps, rounds=80):
        best = iou(p, src, dst)
        for _ in range(rounds):
            improved = False
            for i in range(6):
                for sgn in (1, -1):
                    q = p.copy()
                    q[i] += sgn * steps[i]
                    v = iou(q, src, dst)
                    if v > best + 1e-6:
                        p, best = q, v
                        improved = True
                        break
            if not improved:
                steps = [s * 0.55 for s in steps]
                if max(abs(s) for s in steps) < 1e-3:
                    break
        return p, best

    p0 = [warp[0, 0], warp[0, 1], warp[0, 2], warp[1, 0], warp[1, 1], warp[1, 2]]
    q = 0.4
    small_o = cv2.resize(o8, None, fx=q, fy=q, interpolation=cv2.INTER_NEAREST)
    small_g = cv2.resize(g8, None, fx=q, fy=q, interpolation=cv2.INTER_NEAREST)
    p_small = p0.copy()
    p_small[0] *= 1; p_small[1] *= 1; p_small[2] *= q
    p_small[3] *= 1; p_small[4] *= 1; p_small[5] *= q
    iou0 = iou(p0, g8, o8)
    p_small, _ = fit(small_g, small_o, p_small, [0.05, 0.04, 6, 0.04, 0.05, 6])
    p_ref = p_small.copy()
    p_ref[2] /= q
    p_ref[5] /= q
    p_ref, iou1 = fit(g8, o8, p_ref, [0.02, 0.01, 2.5, 0.01, 0.02, 2.5])
    warp = to_w(p_ref)
    print(f'IoU: init={iou0:.3f} -> fit={iou1:.3f}')
    print('warp =', np.round(warp, 4).tolist())

    # ---- 4. 颜色外扩 + 变形到画布 ----
    gen_filled = bleed_colors(gen, gen_subj)
    warped = cv2.warpAffine(gen_filled, warp, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    # ---- 5. 逐部件采样（颜色=AI 图，alpha=原图）----
    for e in manifest:
        l, t, w, h = e['left'], e['top'], e['width'], e['height']
        crop = warped[t:t + h, l:l + w]
        alpha = np.array(Image.open(os.path.join(FOX, 'png', e['name'] + '.png')).convert('RGBA'))[..., 3]
        assert crop.shape[:2] == alpha.shape, f"{e['name']} {crop.shape} vs {alpha.shape}"
        rgba = np.dstack([crop, alpha]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(out_dir, e['name'] + '.png'))

    # ---- 6. 预览合成 ----
    canvas = compose(manifest, out_dir)
    bgc = Image.new('RGBA', (W, H), (236, 231, 221, 255))
    bgc.alpha_composite(canvas)
    if preview_path:
        bgc.convert('RGB').save(preview_path)
        print('preview ->', preview_path)

if __name__ == '__main__':
    main()
