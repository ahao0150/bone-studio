"""
Generate layered SVG -> PNG parts for the cartoon chick "坤哥 / 鸡哥" basketball character.
Canvas 800x700, character faces right (3/4 view). All parts are designed in ONE canvas
coordinate system; joints in J are shared with build_kunge_mcp.mjs via layers_manifest.json.
"""
import json
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
SVG_DIR = BASE_DIR / "svg"
PNG_DIR = BASE_DIR / "png"
CANVAS_W, CANVAS_H = 800, 700

OL = "#151515"      # outline
YEL = "#f7d46a"     # chick yellow
YEL_HI = "#fde396"
YEL_SH = "#e6b94a"
ORG = "#f29a38"     # beak / legs
ORG_SH = "#d9781f"
RED = "#e8392c"
JK = "#262626"      # jacket black
JK_HI = "#3a3a3a"
HAIR = "#c9c9cc"
HAIR_HI = "#efeff2"
HAIR_SH = "#9a9aa0"
BALL = "#e2782e"
BALL_HI = "#f29a52"
BALL_SH = "#c2601c"

# ---------------------------------------------------------------- joints (canvas px)
J = {
    "root": [400, 640],
    "shadow": [400, 640],
    "hip": [400, 488],
    "torso": [400, 488],
    "neck": [404, 398],
    "head": [404, 370],
    "head_tip": [404, 250],
    "eyes": [472, 262],
    "hair": [404, 150],
    "arm_b_up": [360, 408],
    "arm_b_lo": [348, 456],
    "hand_b": [336, 500],
    "arm_f_up": [446, 408],
    "arm_f_lo": [450, 458],
    "hand_f": [466, 504],
    "thigh_b": [382, 496],
    "shin_b": [378, 560],
    "foot_b": [376, 626],
    "toe_b": [408, 632],
    "thigh_f": [420, 496],
    "shin_f": [424, 560],
    "foot_f": [426, 626],
    "toe_f": [458, 632],
    "ball": [306, 464],
    "ball_shadow": [306, 640],
    "trail": [306, 464],
    "hit_fx": [520, 400],
}


def stick(p0, p1, w, fill, ol_w=6):
    """Capsule limb: dark outline stroke underneath + colored stroke on top (round caps
    => concentric joint arcs at both ends)."""
    x0, y0 = p0
    x1, y1 = p1
    return (
        f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" stroke="{OL}" stroke-width="{w + ol_w * 2}" stroke-linecap="round"/>'
        f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" stroke="{fill}" stroke-width="{w}" stroke-linecap="round"/>'
    )


def chick_foot(ankle, dirx=1):
    ax, ay = ankle
    toes = [(ax + 34 * dirx, ay + 8), (ax + 26 * dirx, ay + 14), (ax - 14 * dirx, ay + 10)]
    s = ""
    for tx, ty in toes:
        s += f'<line x1="{ax}" y1="{ay}" x2="{tx}" y2="{ty}" stroke="{OL}" stroke-width="20" stroke-linecap="round"/>'
    for tx, ty in toes:
        s += f'<line x1="{ax}" y1="{ay}" x2="{tx}" y2="{ty}" stroke="{ORG}" stroke-width="9" stroke-linecap="round"/>'
    s += f'<circle cx="{ax}" cy="{ay}" r="7" fill="{ORG}"/>'
    return s


def leg_part(p0, p1, knee_cap=True):
    s = stick(p0, p1, 15, ORG, 5)
    s += f'<line x1="{p0[0]+3}" y1="{p0[1]}" x2="{p1[0]+3}" y2="{p1[1]}" stroke="{ORG_SH}" stroke-width="4" stroke-linecap="round"/>'
    return s


def arm_upper(p0, p1):
    s = stick(p0, p1, 30, JK, 6)
    s += f'<line x1="{p0[0]+5}" y1="{p0[1]+2}" x2="{p1[0]+5}" y2="{p1[1]}" stroke="{JK_HI}" stroke-width="8" stroke-linecap="round"/>'
    return s


def arm_lower(p0, p1):
    # sleeve to wrist, white cuff, yellow wing-hand mitten at palm (p1)
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    wx, wy = p0[0] + dx * 0.62, p0[1] + dy * 0.62
    cx2, cy2 = p0[0] + dx * 0.74, p0[1] + dy * 0.74
    s = stick(p0, (wx, wy), 27, JK, 6)
    s += stick((wx, wy), (cx2, cy2), 28, "#f4f4f4", 5)
    s += (
        f'<ellipse cx="{p1[0]}" cy="{p1[1]}" rx="17" ry="15" fill="{YEL}" stroke="{OL}" stroke-width="5"/>'
        f'<path d="M {p1[0]-8},{p1[1]+4} Q {p1[0]},{p1[1]+12} {p1[0]+9},{p1[1]+3}" fill="none" stroke="{YEL_SH}" stroke-width="3" stroke-linecap="round"/>'
    )
    return s


def basketball(cx, cy, r=36):
    return f"""
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="{BALL}"/>
    <path d="M {cx-r*0.95},{cy+r*0.25} A {r} {r} 0 0 0 {cx+r*0.5},{cy+r*0.86} A {r*0.85} {r*0.85} 0 0 1 {cx-r*0.95},{cy+r*0.25} Z" fill="{BALL_SH}" />
    <ellipse cx="{cx+r*0.3}" cy="{cy-r*0.42}" rx="{r*0.38}" ry="{r*0.22}" fill="{BALL_HI}" transform="rotate(-25 {cx+r*0.3} {cy-r*0.42})"/>
    <line x1="{cx-r}" y1="{cy}" x2="{cx+r}" y2="{cy}" stroke="{OL}" stroke-width="4"/>
    <line x1="{cx}" y1="{cy-r}" x2="{cx}" y2="{cy+r}" stroke="{OL}" stroke-width="4"/>
    <path d="M {cx-r*0.62},{cy-r*0.78} Q {cx-r*0.18},{cy} {cx-r*0.62},{cy+r*0.78}" fill="none" stroke="{OL}" stroke-width="4"/>
    <path d="M {cx+r*0.62},{cy-r*0.78} Q {cx+r*0.18},{cy} {cx+r*0.62},{cy+r*0.78}" fill="none" stroke="{OL}" stroke-width="4"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{OL}" stroke-width="5.5"/>
    """


bx, by = J["ball"]

LAYERS = [
    # ------------------------------------------------------------ ground shadows
    {"name": "shadow", "bone": "shadow", "zIndex": 0,
     "svg": f'<ellipse cx="400" cy="641" rx="104" ry="14" fill="#000000" fill-opacity="0.22"/>'},
    {"name": "ball_shadow", "bone": "ball_shadow", "zIndex": 1,
     "svg": f'<ellipse cx="{bx}" cy="641" rx="32" ry="8" fill="#000000" fill-opacity="0.22"/>'},
    # ------------------------------------------------------------ ball behind back
    {"name": "ball_back", "bone": "ball", "zIndex": 2, "svg": basketball(bx, by)},
    # ------------------------------------------------------------ far arm (behind body)
    {"name": "arm_b_up", "bone": "arm_b_up", "zIndex": 3, "svg": arm_upper(J["arm_b_up"], J["arm_b_lo"])},
    {"name": "arm_b_lo", "bone": "arm_b_lo", "zIndex": 4, "svg": arm_lower(J["arm_b_lo"], J["hand_b"])},
    # ------------------------------------------------------------ far leg
    {"name": "thigh_b", "bone": "thigh_b", "zIndex": 5, "svg": leg_part(J["thigh_b"], J["shin_b"])},
    {"name": "shin_b", "bone": "shin_b", "zIndex": 6, "svg": leg_part(J["shin_b"], J["foot_b"])},
    {"name": "foot_b", "bone": "foot_b", "zIndex": 7, "svg": chick_foot(J["foot_b"])},
    # ------------------------------------------------------------ near leg
    {"name": "thigh_f", "bone": "thigh_f", "zIndex": 8, "svg": leg_part(J["thigh_f"], J["shin_f"])},
    {"name": "shin_f", "bone": "shin_f", "zIndex": 9, "svg": leg_part(J["shin_f"], J["foot_f"])},
    {"name": "foot_f", "bone": "foot_f", "zIndex": 10, "svg": chick_foot(J["foot_f"])},
    # ------------------------------------------------------------ neck (under torso & head)
    {"name": "neck", "bone": "neck", "zIndex": 11,
     "svg": f'<rect x="384" y="352" width="40" height="58" rx="14" fill="{YEL}" stroke="{OL}" stroke-width="5"/>'},
    # ------------------------------------------------------------ torso: black jacket + shorts
    {"name": "torso", "bone": "torso", "zIndex": 12, "svg": f"""
     <path d="M 338,396 C 360,384 452,384 470,396 C 484,432 488,480 486,516 L 490,540
              C 460,548 430,546 404,540 L 400,528 L 396,540 C 370,546 344,548 318,540 L 322,516
              C 320,478 324,432 338,396 Z" fill="{JK}" stroke="{OL}" stroke-width="6" stroke-linejoin="round"/>
     <path d="M 440,394 C 462,398 474,440 476,500 L 470,506 C 466,452 458,414 440,394 Z" fill="{JK_HI}"/>
     <path d="M 326,508 C 380,516 430,516 482,508" fill="none" stroke="#f2f2f2" stroke-width="7" stroke-linecap="round"/>
     <path d="M 424,396 L 426,506" fill="none" stroke="#f2f2f2" stroke-width="5" stroke-linecap="round"/>
     <circle cx="425" cy="420" r="4" fill="#f2f2f2"/>
     <path d="M 400,520 L 400,536" stroke="#000" stroke-width="4"/>
     """},
    # ------------------------------------------------------------ head (face + beak + cheeks)
    {"name": "head", "bone": "head", "zIndex": 13, "svg": f"""
     <ellipse cx="408" cy="262" rx="136" ry="116" fill="{YEL}"/>
     <path d="M 284,300 C 300,350 360,378 420,378 C 360,370 310,340 296,290 Z" fill="{YEL_SH}"/>
     <ellipse cx="440" cy="214" rx="86" ry="46" fill="{YEL_HI}" fill-opacity="0.9"/>
     <ellipse cx="408" cy="262" rx="136" ry="116" fill="none" stroke="{OL}" stroke-width="7"/>
     <circle cx="322" cy="318" r="32" fill="{RED}"/>
     <circle cx="526" cy="314" r="22" fill="{RED}"/>
     <ellipse cx="466" cy="344" rx="26" ry="14" fill="{ORG_SH}" stroke="{OL}" stroke-width="5"/>
     <ellipse cx="470" cy="322" rx="36" ry="19" fill="{ORG}" stroke="{OL}" stroke-width="5"/>
     <path d="M 450,316 Q 470,310 490,316" fill="none" stroke="#ffc27a" stroke-width="4" stroke-linecap="round"/>
     """},
    # ------------------------------------------------------------ eyes (blinkable via eyes bone scaleY)
    {"name": "eyes", "bone": "eyes", "zIndex": 14, "svg": f"""
     <circle cx="436" cy="264" r="38" fill="#ffffff" stroke="{OL}" stroke-width="6"/>
     <circle cx="508" cy="262" r="32" fill="#ffffff" stroke="{OL}" stroke-width="6"/>
     <circle cx="452" cy="256" r="13" fill="{OL}"/>
     <circle cx="522" cy="252" r="12" fill="{OL}"/>
     <circle cx="456" cy="251" r="4" fill="#ffffff"/>
     <circle cx="526" cy="247" r="3.5" fill="#ffffff"/>
     <path d="M 478,240 Q 510,226 542,240" fill="none" stroke="{OL}" stroke-width="8" stroke-linecap="round"/>
     """},
    # ------------------------------------------------------------ hit eyes  > <
    {"name": "eyes_hit", "bone": "eyes", "zIndex": 15, "svg": f"""
     <path d="M 414,242 L 452,264 L 414,286" fill="none" stroke="{OL}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 530,242 L 494,264 L 530,286" fill="none" stroke="{OL}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 552,214 C 546,228 548,238 556,240 C 564,238 566,228 552,214 Z" fill="#7cc8ff" stroke="{OL}" stroke-width="3"/>
     """},
    # ------------------------------------------------------------ silver middle-part hair
    {"name": "hair", "bone": "hair", "zIndex": 16, "svg": f"""
     <path d="M 452,142 C 420,116 352,118 312,146 C 266,180 252,250 264,322
              L 284,296 L 292,330 L 308,270 L 326,302 L 342,240 L 362,268 L 380,214 L 398,246 L 414,196
              C 428,176 440,160 452,150 Z" fill="{HAIR}" stroke="{OL}" stroke-width="7" stroke-linejoin="round"/>
     <path d="M 452,142 C 500,124 552,152 566,214 C 574,252 568,290 556,318
              L 548,270 L 542,226 L 530,232 L 518,198 L 502,206 L 484,178
              C 470,170 462,158 452,150 Z" fill="{HAIR}" stroke="{OL}" stroke-width="7" stroke-linejoin="round"/>
     <path d="M 300,180 C 290,214 284,250 286,286" fill="none" stroke="{HAIR_SH}" stroke-width="9" stroke-linecap="round"/>
     <path d="M 340,166 C 328,196 320,222 318,250" fill="none" stroke="{HAIR_HI}" stroke-width="8" stroke-linecap="round"/>
     <path d="M 380,150 C 372,172 366,190 362,214" fill="none" stroke="{HAIR_SH}" stroke-width="8" stroke-linecap="round"/>
     <path d="M 414,144 C 408,160 402,176 398,196" fill="none" stroke="{HAIR_HI}" stroke-width="7" stroke-linecap="round"/>
     <path d="M 496,148 C 510,170 516,190 518,214" fill="none" stroke="{HAIR_HI}" stroke-width="8" stroke-linecap="round"/>
     <path d="M 538,170 C 550,200 556,226 556,250" fill="none" stroke="{HAIR_SH}" stroke-width="8" stroke-linecap="round"/>
     <path d="M 330,150 C 360,134 400,130 430,136" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-dasharray="18 12"/>
     <path d="M 478,140 C 506,140 530,152 546,172" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-dasharray="16 12"/>
     <path d="M 452,146 L 452,152" stroke="{OL}" stroke-width="7" stroke-linecap="round"/>
     """},
    # ------------------------------------------------------------ turtleneck collar (over chin)
    {"name": "collar", "bone": "torso", "zIndex": 17, "svg": f"""
     <path d="M 320,374 C 360,352 452,350 496,370 C 504,386 500,402 490,410
              C 444,398 372,400 328,412 C 316,402 314,386 320,374 Z" fill="{JK}" stroke="{OL}" stroke-width="6" stroke-linejoin="round"/>
     <path d="M 332,402 C 376,392 440,390 482,400" fill="none" stroke="#f2f2f2" stroke-width="5" stroke-linecap="round"/>
     <path d="M 344,372 C 380,362 440,360 478,372" fill="none" stroke="{JK_HI}" stroke-width="5" stroke-linecap="round"/>
     """},
    # ------------------------------------------------------------ near arm (in front)
    {"name": "arm_f_up", "bone": "arm_f_up", "zIndex": 18, "svg": arm_upper(J["arm_f_up"], J["arm_f_lo"])},
    {"name": "arm_f_lo", "bone": "arm_f_lo", "zIndex": 19, "svg": arm_lower(J["arm_f_lo"], J["hand_f"])},
    # ------------------------------------------------------------ speed trail + front ball
    {"name": "ball_trail", "bone": "trail", "zIndex": 20, "svg": f"""
     <path d="M {bx-30},{by-24} L {bx-150},{by-14} L {bx-30},{by-12} Z" fill="#ffffff" fill-opacity="0.75"/>
     <path d="M {bx-34},{by-4} L {bx-190},{by+2} L {bx-34},{by+8} Z" fill="#ffd27a" fill-opacity="0.85"/>
     <path d="M {bx-30},{by+16} L {bx-130},{by+20} L {bx-30},{by+26} Z" fill="#ffffff" fill-opacity="0.7"/>
     """},
    {"name": "ball_front", "bone": "ball", "zIndex": 21, "svg": basketball(bx, by)},
    # ------------------------------------------------------------ hit impact star
    {"name": "hit_fx", "bone": "hit_fx", "zIndex": 22, "svg": """
     <polygon points="520,348 532,382 566,368 546,398 580,414 542,416 552,452 524,428 502,458 502,420 464,424 492,400 466,374 502,384"
              fill="#fff3a0" stroke="#ff8a1a" stroke-width="6" stroke-linejoin="round"/>
     <polygon points="520,374 527,392 546,388 534,402 548,414 528,412 524,430 514,414 498,424 506,406 490,396 510,394"
              fill="#ffffff"/>
     """},
]


def render_svg_to_pil(svg_body: str) -> Image.Image:
    full_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" '
                f'viewBox="0 0 {CANVAS_W} {CANVAS_H}">{svg_body}</svg>')
    doc = pymupdf.open(stream=full_svg.encode("utf-8"), filetype="svg")
    pix = doc[0].get_pixmap(alpha=True, dpi=72)
    raw = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 4).astype(np.float32)
    alpha = raw[..., 3:4]
    raw[..., :3] = np.where(alpha > 0, np.clip(raw[..., :3] * 255.0 / np.maximum(alpha, 1.0), 0, 255), 0)
    return Image.fromarray(raw.astype(np.uint8), mode="RGBA")


def main():
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    manifest_layers = []
    preview = Image.new("RGBA", (CANVAS_W, CANVAS_H), (210, 236, 240, 255))
    hidden_in_preview = {"ball_front", "ball_trail", "hit_fx", "eyes_hit"}

    for item in sorted(LAYERS, key=lambda x: x["zIndex"]):
        name = item["name"]
        im = render_svg_to_pil(item["svg"])
        bbox = im.getbbox()
        if not bbox:
            raise RuntimeError(f"empty layer {name}")
        pad = 8
        x0, y0 = max(0, bbox[0] - pad), max(0, bbox[1] - pad)
        x1, y1 = min(CANVAS_W, bbox[2] + pad), min(CANVAS_H, bbox[3] + pad)
        w, h = x1 - x0, y1 - y0
        crop = im.crop((x0, y0, x1, y1))
        a = np.array(crop)[..., 3]
        edge = max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max())
        if edge != 0:
            print(f"WARNING: {name} touches crop edge (alpha {edge})")
        crop.save(PNG_DIR / f"{name}.png")
        (SVG_DIR / f"{name}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{x0} {y0} {w} {h}">{item["svg"]}</svg>',
            encoding="utf-8")
        manifest_layers.append({
            "name": name, "bone": item["bone"], "zIndex": item["zIndex"],
            "left": x0, "top": y0, "width": w, "height": h,
            "file": str((PNG_DIR / f"{name}.png").resolve()).replace("\\", "/"),
        })
        if name not in hidden_in_preview:
            preview.alpha_composite(im)

    manifest = {"canvasWidth": CANVAS_W, "canvasHeight": CANVAS_H, "joints": J, "layers": manifest_layers}
    (BASE_DIR / "layers_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    preview.save(BASE_DIR / "setup_preview.png")
    print(f"Generated {len(manifest_layers)} layers")


if __name__ == "__main__":
    main()
