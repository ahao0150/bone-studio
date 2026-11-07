# -*- coding: utf-8 -*-
"""
Procedural SVG -> PNG part generator for 'archer-2d' (2D Elven Archer / 精灵游侠弓箭手).
Inspired by ai_studio_code.html:
- Emerald & Gold Elven Ranger aesthetic (pointed elf ears, golden hair braid, glowing emerald feather,
  recurve golden-wood bow with dynamic flexing upper/lower limbs, taut bowstring, glowing magic arrows,
  and a right-side Archery Target).
- Uses crisp solid hex fills (no <linearGradient> or <filter> that MuPDF renders black).
- Every anatomical limb and equipment part is an independent slot ready for skin swapping.
"""

import json
import math
from pathlib import Path
import pymupdf
from PIL import Image

OUT_DIR = Path(r"C:\Users\Administrator\.gemini\antigravity\scratch\archer-2d")
SVG_DIR = OUT_DIR / "svg"
PNG_DIR = OUT_DIR / "png"
SVG_DIR.mkdir(parents=True, exist_ok=True)
PNG_DIR.mkdir(parents=True, exist_ok=True)

CANVAS_W = 880
CANVAS_H = 560
GROUND_Y = 460.0
SCALE = 1.5  # 1.5x scale of ai_studio_code.html rig for high-res PNG textures

# Base character root on canvas: (240, 460), hip at (240, 310)
CX = 240.0
CY = 460.0
HIP_X = 240.0
HIP_Y = 310.0  # 460 - 100 * 1.5

# Target base on canvas: (740, 460)
TX = 740.0
TY = 460.0

JOINTS = {
    "root":            (440.0, 560.0),  # Canvas bottom-center (layers_add origin)
    "shadow":          (240.0, 460.0),
    "target_stand":    (740.0, 460.0),
    "target_pivot":    (740.0, 332.0),  # 460 - 85 * 1.5

    "hip":             (240.0, 310.0),
    "torso":           (240.0, 310.0),
    "head":            (241.5, 214.0),  # (0+1*1.5, 310 - 64*1.5)
    "hair_braid":      (226.0, 206.0),
    "hood_feather":    (231.0, 187.0),
    "quiver":          (219.0, 238.0),
    "cape_root":       (231.0, 217.0),
    "cape_mid":        (172.0, 262.0),
    "cape_tip":        (105.0, 332.0),

    # Far leg (thighR in HTML: ox=5*1.5=7.5, oy=0; calfR: oy=46*1.5=69; footR: oy=46*1.5=69)
    "thigh_r":         (247.5, 310.0),
    "shin_r":          (247.5, 379.0),
    "foot_r":          (247.5, 448.0),

    # Near leg (thighL in HTML: ox=-4*1.5=-6, oy=2*1.5=3; calfL: oy=69; footL: oy=69)
    "thigh_l":         (234.0, 313.0),
    "shin_l":          (234.0, 382.0),
    "foot_l":          (234.0, 451.0),

    # Far bow arm (armL in HTML: ox=6*1.5=9, oy=-54*1.5=-81 -> (249, 229); forearmL: oy=48; handL: oy=48)
    # In HTML setup (0 deg), arm hangs straight down: (249, 229) -> (249, 277) -> (249, 325)
    "arm_upper_l":     (249.0, 229.0),
    "arm_lower_l":     (249.0, 277.0),
    "hand_l":          (249.0, 325.0),
    "bow_tip_top":     (237.0, 223.0),  # (-8*1.5, -68*1.5) from hand_l
    "bow_tip_bot":     (237.0, 427.0),  # (-8*1.5, +68*1.5) from hand_l
    "bow_nock":        (237.0, 325.0),

    # Near draw arm (armR in HTML: ox=-6*1.5=-9, oy=-52*1.5=-78 -> (231, 232); forearmR: oy=51; handR: oy=48)
    "arm_upper_r":     (231.0, 232.0),
    "arm_lower_r":     (231.0, 283.0),
    "hand_r":          (231.0, 331.0),
}


def magic_arrow_svg(cx, cy, feather_main="#10B981", feather_hi="#6EE7B7", shaft="#FDE047"):
    """Horizontal magic arrow with nock at (cx - 97.5, cy) and tip at (cx + 27, cy), matching HTML #arrow-template * 1.5."""
    x_nock = cx - 97.5
    x_shaft_end = cx + 12.0
    x_tip = cx + 27.0
    return f"""
    <g>
      <!-- Outer glow aura around fletching & tip -->
      <path d="M {x_nock:.1f},{cy:.1f} L {x_nock-18:.1f},{cy-12:.1f} L {x_nock+10:.1f},{cy-12:.1f} L {x_nock+20:.1f},{cy:.1f} L {x_nock+10:.1f},{cy+12:.1f} L {x_nock-18:.1f},{cy+12:.1f} Z"
            fill="{feather_hi}" fill-opacity="0.32"/>
      <!-- Emerald glowing fletching -->
      <path d="M {x_nock:.1f},{cy:.1f} L {x_nock-15:.1f},{cy-9:.1f} L {x_nock+7.5:.1f},{cy-9:.1f} L {x_nock+16.5:.1f},{cy:.1f} L {x_nock+7.5:.1f},{cy+9:.1f} L {x_nock-15:.1f},{cy+9:.1f} Z"
            fill="{feather_main}" stroke="#022C22" stroke-width="2.0" stroke-linejoin="round"/>
      <!-- Golden arrow shaft -->
      <rect x="{x_nock:.1f}" y="{cy-2.2:.1f}" width="{x_shaft_end - x_nock:.1f}" height="4.4" rx="2.0"
            fill="{shaft}" stroke="#713F12" stroke-width="1.6"/>
      <!-- Diamond armor-piercing glowing arrowhead -->
      <polygon points="{x_tip+4:.1f},{cy:.1f} {cx+3:.1f},{cy-10:.1f} {cx+8:.1f},{cy:.1f} {cx+3:.1f},{cy+10:.1f}"
               fill="{feather_hi}" fill-opacity="0.35"/>
      <polygon points="{x_tip:.1f},{cy:.1f} {cx+6:.1f},{cy-7.5:.1f} {cx+10.5:.1f},{cy:.1f} {cx+6:.1f},{cy+7.5:.1f}"
               fill="{feather_hi}" stroke="#064E3B" stroke-width="2.0" stroke-linejoin="round"/>
    </g>
    """


PARTS = [
    # 0. ground_shadow
    {
        "name": "ground_shadow",
        "bone": "shadow",
        "zIndex": 0,
        "svg": """
        <g>
          <ellipse cx="240" cy="460" rx="64" ry="12" fill="#02080A" fill-opacity="0.55"/>
          <ellipse cx="240" cy="460" rx="42" ry="7.5" fill="#02080A" fill-opacity="0.40"/>
        </g>
        """,
    },
    # 1. target_stand (wooden tripod base at x=740, y=460)
    {
        "name": "target_stand",
        "bone": "target_stand",
        "zIndex": 1,
        "svg": """
        <g>
          <ellipse cx="740" cy="460" rx="76" ry="13" fill="#02080A" fill-opacity="0.55"/>
          <line x1="698" y1="460" x2="728" y2="332" stroke="#451A03" stroke-width="12" stroke-linecap="round"/>
          <line x1="782" y1="460" x2="752" y2="332" stroke="#451A03" stroke-width="12" stroke-linecap="round"/>
          <circle cx="740" cy="332" r="9" fill="#78350F" stroke="#290F02" stroke-width="2.5"/>
        </g>
        """,
    },
    # 2. target_board (rocking straw target & bullseye rings on target_pivot (740, 332))
    {
        "name": "target_board",
        "bone": "target_pivot",
        "zIndex": 2,
        "svg": """
        <g>
          <!-- Support post (from y=228 to y=445) -->
          <rect x="731" y="228" width="18" height="216" rx="4" fill="#78350F" stroke="#451A03" stroke-width="3"/>
          <!-- Straw target cylinder side thickness -->
          <ellipse cx="746" cy="242" rx="33" ry="93" fill="#D97706" stroke="#78350F" stroke-width="4.5"/>
          <!-- Bullseye concentric rings -->
          <ellipse cx="734" cy="242" rx="30" ry="90" fill="#F8FAFC" stroke="#475569" stroke-width="3"/>
          <ellipse cx="731" cy="242" rx="22.5" ry="67.5" fill="#0284C7"/>
          <ellipse cx="728" cy="242" rx="15" ry="45" fill="#EF4444"/>
          <ellipse cx="725" cy="242" rx="7.5" ry="22.5" fill="#FACC15"/>
        </g>
        """,
    },
    # 3. cape_back (elven cloak, weighted mesh slot)
    {
        "name": "cape_back",
        "bone": "cape_root",
        "zIndex": 3,
        "svg": """
        <g>
          <path d="M 231,217 Q 157,242 97,332 Q 172,343 225,287 Z"
                fill="#03543F" stroke="#065F46" stroke-width="2.6" stroke-linejoin="round"/>
          <path d="M 227,223 Q 168,248 118,322 Q 166,328 214,284 Z"
                fill="#047857"/>
          <path d="M 105,326 Q 162,334 218,286"
                fill="none" stroke="#34D399" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        """,
    },
    # 4. thigh_r (far leg thigh, ball-joint top centered at (247.5, 310) & knee ball-joint at (247.5, 379))
    {
        "name": "thigh_r",
        "bone": "thigh_r",
        "zIndex": 4,
        "svg": """
        <g>
          <path d="M 235.5,314 A 12,5 0 0 1 259.5,314 L 256.5,376 A 9,5 0 0 1 238.5,376 Z"
                fill="#1C1917" stroke="#0C0A09" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M 249.0,313 C 256.5,332 256.0,358 253.5,376 L 256.5,376 C 258.5,356 259.0,332 257.0,313 Z"
                fill="#292524"/>
          <circle cx="247.5" cy="375" r="6.5" fill="#065F46" stroke="#FBBF24" stroke-width="1.6"/>
        </g>
        """,
    },
    # 5. shin_r (far leg calf boot, rounded knee socket at (247.5, 379) to ankle ball at (247.5, 448))
    {
        "name": "shin_r",
        "bone": "shin_r",
        "zIndex": 5,
        "svg": """
        <g>
          <path d="M 238.5,383 A 9,5 0 0 1 256.5,383 L 253.5,444 A 6.5,4 0 0 1 240.0,444 Z"
                fill="#451A03" stroke="#290F02" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M 250.0,383 L 255.5,383 L 252.5,444 L 248.0,444 Z" fill="#78350F"/>
          <line x1="239" y1="402" x2="255" y2="407" stroke="#B45309" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="240" y1="422" x2="254" y2="427" stroke="#B45309" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        """,
    },
    # 6. foot_r (far foot pointing right, rounded ankle socket at (247.5, 448))
    {
        "name": "foot_r",
        "bone": "foot_r",
        "zIndex": 6,
        "svg": """
        <g>
          <path d="M 238.5,444.0 A 7.5,6 0 0 1 253.5,445.0 L 273.0,452.0 C 279.0,455.0 277.5,460.0 268.5,460.0 L 235.5,460.0 L 236.5,448.0 Z"
                fill="#290F02" stroke="#1C0A00" stroke-width="2.0" stroke-linejoin="round"/>
          <path d="M 260.0,450.0 L 273.0,453.0 C 276.0,455.5 274.5,459.0 268.0,459.0 L 258.0,459.0 Z"
                fill="#78350F"/>
        </g>
        """,
    },
    # 7. arm_upper_l (far bow upper arm, rounded ball-joints at shoulder (249, 229) and elbow (249, 277))
    {
        "name": "arm_upper_l",
        "bone": "arm_upper_l",
        "zIndex": 7,
        "svg": """
        <g>
          <rect x="241.5" y="224" width="15" height="58" rx="7.5"
                fill="#064E3B" stroke="#047857" stroke-width="2.2"/>
          <circle cx="249.0" cy="231.5" r="7.2" fill="#78350F" stroke="#FBBF24" stroke-width="1.6"/>
          <rect x="250.5" y="242" width="4.5" height="30" rx="2" fill="#059669"/>
        </g>
        """,
    },
    # 8. arm_lower_l (far bow forearm, rounded elbow cap at (249, 277) to wrist (249, 325))
    {
        "name": "arm_lower_l",
        "bone": "arm_lower_l",
        "zIndex": 8,
        "svg": """
        <g>
          <path d="M 241.5,277 A 7.5,7.5 0 0 1 256.5,277 L 255.0,325 A 6,6 0 0 1 243.0,325 Z"
                fill="#065F46" stroke="#047857" stroke-width="2.0" stroke-linejoin="round"/>
          <path d="M 243.5,283 L 255.5,283 L 254.5,319 L 244.0,319 Z"
                fill="#78350F" stroke="#D97706" stroke-width="1.8" stroke-linejoin="round"/>
          <line x1="244.0" y1="295" x2="255.0" y2="297" stroke="#FBBF24" stroke-width="2.0"/>
          <line x1="244.0" y1="307" x2="254.5" y2="309" stroke="#FBBF24" stroke-width="2.0"/>
        </g>
        """,
    },
    # 9. bow_string_upper (from bow_tip_top (237, 223) to bow_nock (237, 325))
    {
        "name": "bow_string_upper",
        "bone": "string_upper",
        "zIndex": 9,
        "svg": """
        <line x1="237" y1="223" x2="237" y2="325" stroke="#E2E8F0" stroke-width="2.8" stroke-linecap="round"/>
        """,
    },
    # 10. bow_string_lower (from bow_tip_bot (237, 427) to bow_nock (237, 325))
    {
        "name": "bow_string_lower",
        "bone": "string_lower",
        "zIndex": 10,
        "svg": """
        <line x1="237" y1="427" x2="237" y2="325" stroke="#E2E8F0" stroke-width="2.8" stroke-linecap="round"/>
        """,
    },
    # 11. bow_limb_upper (from hand_l (249, 325) up to bow_tip_top (237, 223))
    {
        "name": "bow_limb_upper",
        "bone": "bow_limb_u",
        "zIndex": 11,
        "svg": """
        <g>
          <path d="M 255,325 Q 270,277 237,223" fill="none" stroke="#CA8A04" stroke-width="9.5" stroke-linecap="round"/>
          <path d="M 255,325 Q 270,277 237,223" fill="none" stroke="#FEF08A" stroke-width="4.0" stroke-linecap="round"/>
          <circle cx="237" cy="223" r="4.5" fill="#FEF08A" stroke="#713F12" stroke-width="2.0"/>
        </g>
        """,
    },
    # 12. bow_limb_lower (from hand_l (249, 325) down to bow_tip_bot (237, 427))
    {
        "name": "bow_limb_lower",
        "bone": "bow_limb_d",
        "zIndex": 12,
        "svg": """
        <g>
          <path d="M 255,325 Q 270,373 237,427" fill="none" stroke="#CA8A04" stroke-width="9.5" stroke-linecap="round"/>
          <path d="M 255,325 Q 270,373 237,427" fill="none" stroke="#FEF08A" stroke-width="4.0" stroke-linecap="round"/>
          <circle cx="237" cy="427" r="4.5" fill="#FEF08A" stroke="#713F12" stroke-width="2.0"/>
        </g>
        """,
    },
    # 13. hand_l_bow_grip (emerald-gold bow handle riser + right-facing gripping fingers at (249, 325))
    {
        "name": "hand_l_bow_grip",
        "bone": "hand_l",
        "zIndex": 13,
        "svg": """
        <g>
          <!-- Sculpted bow riser handle -->
          <path d="M 246.5,309.0 C 254.0,309.0 258.5,316.0 258.5,325.0 C 258.5,334.0 254.0,341.0 246.5,341.0 L 244.0,336.0 L 247.0,325.0 L 244.0,314.0 Z"
                fill="#065F46" stroke="#FBBF24" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Right-facing gloved hand & fingers gripping the riser -->
          <rect x="244.5" y="317.5" width="9.5" height="15.0" rx="4.0" fill="#78350F" stroke="#451A03" stroke-width="1.6"/>
          <rect x="250.5" y="318.5" width="8.0" height="3.8" rx="1.8" fill="#FDE68A" stroke="#CA8A04" stroke-width="1.2"/>
          <rect x="251.0" y="322.8" width="8.2" height="3.8" rx="1.8" fill="#FDE68A" stroke="#CA8A04" stroke-width="1.2"/>
          <rect x="250.5" y="327.1" width="7.8" height="3.8" rx="1.8" fill="#FDE68A" stroke="#CA8A04" stroke-width="1.2"/>
        </g>
        """,
    },
    # 14. quiver_back (on torso at (219, 238) rotated -22 deg)
    {
        "name": "quiver_back",
        "bone": "quiver",
        "zIndex": 14,
        "svg": """
        <g transform="translate(219, 238) rotate(-22)">
          <!-- Spare emerald arrow feathers in quiver -->
          <path d="M -6,-42 L -12,-54 L 0,-51 Z M 3,-45 L 0,-58.5 L 9,-52.5 Z M 10.5,-39 L 9,-52.5 L 18,-46.5 Z"
                fill="#34D399" stroke="#064E3B" stroke-width="1.5"/>
          <line x1="-3" y1="-42" x2="-3" y2="0" stroke="#FDE047" stroke-width="3"/>
          <line x1="4.5" y1="-45" x2="4.5" y2="0" stroke="#FDE047" stroke-width="3"/>
          <!-- Leather quiver body -->
          <path d="M -12,-27 L 15,-27 L 10.5,36 L -7.5,36 Z"
                fill="#78350F" stroke="#B45309" stroke-width="3" stroke-linejoin="round"/>
          <line x1="-10.5" y1="-12" x2="13.5" y2="-12" stroke="#FBBF24" stroke-width="3"/>
        </g>
        """,
    },
    # 15. torso_armor (zIndex 18 -> ABOVE thigh_l (15) so the tunic skirt & hip tasset cover the hip joint 100%!)
    {
        "name": "torso_armor",
        "bone": "torso",
        "zIndex": 18,
        "svg": """
        <g>
          <!-- Ranger armored tunic skirt with front slit covering down to y=329 (overlaps thigh_l top!) -->
          <path d="M 216,286 L 263,286 Q 268,308 270,329 L 252,329 L 247,312 L 242,329 L 214,329 Q 215,308 216,286 Z"
                fill="#064E3B" stroke="#FBBF24" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- 3/4 Right-Profile Chest Cuirass -->
          <path d="M 216,288 L 262,288 C 266,272 272,256 270,238 C 269,228 263,220 256,218 L 224,218 C 216,222 214,238 216,258 Z"
                fill="#059669" stroke="#10B981" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Side-back panel on left half -->
          <path d="M 216,288 L 244,288 L 246,220 L 222,220 C 215,228 214,255 216,288 Z"
                fill="#047857"/>
          <!-- Circular emerald-and-gold shoulder joint rosette centered at (231, 232) (NO black hole!) -->
          <circle cx="231" cy="232" r="11.5" fill="#065F46" stroke="#FBBF24" stroke-width="2.0"/>
          <!-- 3/4 Right-facing V-collar & front center line at x=255 -->
          <path d="M 242,218 L 255,236 L 263,218" fill="#065F46" stroke="#FBBF24" stroke-width="2.2" stroke-linejoin="round"/>
          <line x1="255" y1="236" x2="255" y2="288" stroke="#FBBF24" stroke-width="2.4"/>
          <path d="M 246,240 C 263,240 267,260 255,268" fill="none" stroke="#6EE7B7" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="220" y1="223" x2="262" y2="286" stroke="#78350F" stroke-width="6.5" stroke-linecap="round"/>
          <circle cx="252" cy="256" r="5.5" fill="#FBBF24" stroke="#78350F" stroke-width="1.8"/>
          <!-- Waist belt with buckle shifted to right-front (x=254) -->
          <rect x="216" y="284" width="48" height="9" rx="3"
                fill="#78350F" stroke="#FBBF24" stroke-width="1.8"/>
          <rect x="249" y="282.5" width="11" height="12" rx="2"
                fill="none" stroke="#FDE047" stroke-width="2.5"/>
        </g>
        """,
    },
    # 16. hair_braid (golden flowing elven hair behind head)
    {
        "name": "hair_braid",
        "bone": "hair_braid",
        "zIndex": 19,
        "svg": """
        <path d="M 223.5,205 Q 199.5,221.5 184.5,247 Q 211.5,244 229.5,220 Z"
              fill="#FACC15" stroke="#CA8A04" stroke-width="2.0" stroke-linejoin="round"/>
        """,
    },
    # 17. head_elf (neck, elven face, emerald eye, pointed elf ear, ranger hood)
    {
        "name": "head_elf",
        "bone": "head",
        "zIndex": 20,
        "svg": """
        <g>
          <!-- Neck -->
          <rect x="234" y="205" width="15" height="15" rx="3" fill="#FDE68A"/>
          <!-- Elven face -->
          <path d="M 226.5,205 C 226.5,181 264,181 264,205 C 264,217 256.5,223 244.5,223 L 229.5,223 Z"
                fill="#FEF3C7" stroke="#D97706" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Sharp emerald eye -->
          <path d="M 249,208 L 261,209.5 L 258,215.5 L 249,214 Z" fill="#10B981"/>
          <circle cx="256.5" cy="211" r="2.2" fill="#022C22"/>
          <!-- Iconic long pointed elven ear -->
          <path d="M 235.5,209.5 L 205.5,199 L 229.5,218.5 Z"
                fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Elven ranger hood -->
          <path d="M 214.5,208 C 214.5,172 268.5,172 274.5,199 C 259.5,190 232.5,193 220.5,211 Z"
                fill="#047857" stroke="#34D399" stroke-width="2.2" stroke-linejoin="round"/>
        </g>
        """,
    },
    # 18. hood_feather (glowing emerald hawk feather on hood)
    {
        "name": "hood_feather",
        "bone": "hood_feather",
        "zIndex": 21,
        "svg": """
        <g>
          <path d="M 232.5,187 Q 204,163 178.5,175 Q 205.5,190 226.5,193 Z"
                fill="#6EE7B7" fill-opacity="0.35"/>
          <path d="M 232.5,187 Q 204,163 178.5,175 Q 205.5,190 226.5,193 Z"
                fill="#34D399" stroke="#065F46" stroke-width="1.8" stroke-linejoin="round"/>
        </g>
        """,
    },
    # 19. thigh_l (near leg thigh, zIndex 15 -> UNDER torso_armor's skirt! Rounded hip ball-head at (234, 313) & knee ball at (234, 382))
    {
        "name": "thigh_l",
        "bone": "thigh_l",
        "zIndex": 15,
        "svg": """
        <g>
          <path d="M 220,315 A 13.5,6 0 0 1 247.0,315 L 244.5,378 A 10.5,6 0 0 1 223.5,378 Z"
                fill="#292524" stroke="#44403C" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Right-facing front thigh contour highlight -->
          <path d="M 236,313 C 245,333 245,358 242,378 L 245.5,378 C 247.5,358 247.5,333 245.5,313 Z"
                fill="#44403C"/>
        </g>
        """,
    },
    # 20. shin_l (near leg calf with emerald knee guard centered at knee pivot (234, 382) & gold-strapped boot)
    {
        "name": "shin_l",
        "bone": "shin_l",
        "zIndex": 16,
        "svg": """
        <g>
          <path d="M 223.5,384 A 10.5,9 0 0 1 244.5,384 L 241.5,449 A 7.5,6 0 0 1 226.5,449 Z"
                fill="#78350F" stroke="#92400E" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M 237.5,388 L 243.5,388 L 240.5,449 L 235.5,449 Z" fill="#B45309"/>
          <line x1="224" y1="406" x2="243" y2="412" stroke="#FBBF24" stroke-width="3" stroke-linecap="round"/>
          <line x1="225.5" y1="424" x2="241.5" y2="430" stroke="#FBBF24" stroke-width="3" stroke-linecap="round"/>
          <!-- Rounded knee guard centered over the knee pivot (234, 382) -->
          <path d="M 225.0,378 C 225.0,372 246.5,372 246.5,381 L 243.5,393 L 226.5,390 Z"
                fill="#059669" stroke="#FBBF24" stroke-width="1.8" stroke-linejoin="round"/>
        </g>
        """,
    },
    # 21. foot_l (near foot pointing right, rounded ankle cap at (234, 451))
    {
        "name": "foot_l",
        "bone": "foot_l",
        "zIndex": 17,
        "svg": """
        <g>
          <path d="M 223.5,447.5 A 9,6 0 0 1 241.5,448.0 L 262.5,454.5 C 270,457.5 268.5,463 258,463 L 220.5,463 L 221.5,451.0 Z"
                fill="#451A03" stroke="#92400E" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M 248.0,451.0 L 262.5,454.5 C 267.5,457.0 266.0,461.5 258.0,461.5 L 246.0,461.5 Z"
                fill="#78350F" stroke="#FBBF24" stroke-width="1.4"/>
        </g>
        """,
    },
    # 22. arrow_nocked (arrow nocked on the bow, child of bow_nock)
    {
        "name": "arrow_nocked",
        "bone": "bow_nock",
        "zIndex": 22,
        "svg": magic_arrow_svg(249.0, 325.0),
    },
    # 23. arrow_main (projectile arrow 1, centered at (249, 325))
    {
        "name": "arrow_main",
        "bone": "arrow_main",
        "zIndex": 23,
        "svg": magic_arrow_svg(249.0, 325.0),
    },
    # 24. arrow_spread_up (projectile arrow 2 for multishot)
    {
        "name": "arrow_spread_up",
        "bone": "arrow_up",
        "zIndex": 24,
        "svg": magic_arrow_svg(249.0, 325.0),
    },
    # 25. arrow_spread_down (projectile arrow 3 for multishot)
    {
        "name": "arrow_spread_down",
        "bone": "arrow_down",
        "zIndex": 25,
        "svg": magic_arrow_svg(249.0, 325.0),
    },
    # 26. arm_upper_r (near draw upper arm: compact concentric ball-joint shoulder cap centered at (231, 232)
    #     with r=11.5px so when rotated -95 deg to aim forward, there is ZERO overhanging ledge in the armpit!)
    {
        "name": "arm_upper_r",
        "bone": "arm_upper_r",
        "zIndex": 26,
        "svg": """
        <g>
          <!-- Upper arm sleeve with rounded ball-joint ends at (231, 232) and (231, 283) -->
          <rect x="222.0" y="222" width="18" height="68" rx="9.0"
                fill="#047857" stroke="#10B981" stroke-width="2.2"/>
          <rect x="232.5" y="240" width="5.0" height="42" rx="2.5" fill="#10B981"/>
          <!-- Compact concentric shoulder pauldron cap centered right on (231, 232) (r=13.0px) -->
          <circle cx="231" cy="232" r="13.0"
                  fill="#78350F" stroke="#FBBF24" stroke-width="2.0"/>
          <path d="M 219.5,235 Q 231,242 242.5,235" fill="none" stroke="#FBBF24" stroke-width="2.0" stroke-linecap="round"/>
          <circle cx="231" cy="229" r="3.2" fill="#FBBF24"/>
        </g>
        """,
    },
    # 27. arm_lower_r (near draw forearm: rounded elbow ball-joint at (231, 283) + right-facing bracer + side-profile drawing hand)
    {
        "name": "arm_lower_r",
        "bone": "arm_lower_r",
        "zIndex": 27,
        "svg": """
        <g>
          <path d="M 223.5,283 A 7.5,7.5 0 0 1 238.5,283 L 237,328 A 6,6 0 0 1 225,328 Z"
                fill="#78350F" stroke="#B45309" stroke-width="2.2" stroke-linejoin="round"/>
          <rect x="223.5" y="286" width="15.2" height="28" rx="4"
                fill="#065F46" stroke="#FBBF24" stroke-width="1.8"/>
          <line x1="224.0" y1="296" x2="238.2" y2="298" stroke="#FBBF24" stroke-width="2.0"/>
          <line x1="224.0" y1="306" x2="238.0" y2="308" stroke="#FBBF24" stroke-width="2.0"/>
          <path d="M 225.0,324.0 L 236.5,324.0 C 239.5,327.0 239.5,335.0 235.5,338.0 L 226.5,338.0 C 223.5,335.0 223.5,328.0 225.0,324.0 Z"
                fill="#FDE68A" stroke="#CA8A04" stroke-width="2.0" stroke-linejoin="round"/>
          <line x1="231.0" y1="328.0" x2="237.5" y2="330.0" stroke="#CA8A04" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="230.5" y1="332.5" x2="237.0" y2="334.0" stroke="#CA8A04" stroke-width="1.6" stroke-linecap="round"/>
        </g>
        """,
    },
]


def render_svg_bytes_to_pil(svg_text: str) -> Image.Image:
    doc = pymupdf.open(stream=svg_text.encode("utf-8"), filetype="svg")
    page = doc[0]
    pix = page.get_pixmap(alpha=True, dpi=72)
    return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)


def main():
    manifest = {
        "canvasWidth": CANVAS_W,
        "canvasHeight": CANVAS_H,
        "groundY": GROUND_Y,
        "joints": JOINTS,
        "layers": [],
    }

    existing_boxes = {}
    manifest_path = OUT_DIR / "layers_manifest.json"
    if manifest_path.exists():
        old_m = json.loads(manifest_path.read_text(encoding="utf-8"))
        for l in old_m.get("layers", []):
            existing_boxes[l["name"]] = (l["left"], l["top"], l["width"], l["height"])

    clipped_count = 0
    for item in PARTS:
        name = item["name"]
        full_svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" '
            f'viewBox="0 0 {CANVAS_W} {CANVAS_H}">\n'
            f'{item["svg"]}\n</svg>\n'
        )
        full_im = render_svg_bytes_to_pil(full_svg)
        bbox = full_im.getbbox()
        if not bbox:
            raise RuntimeError(f"Empty part: {name}")

        if name in existing_boxes:
            left, top, w, h = existing_boxes[name]
        else:
            pad = 8
            left = max(0, bbox[0] - pad)
            top = max(0, bbox[1] - pad)
            right = min(CANVAS_W, bbox[2] + pad)
            bottom = min(CANVAS_H, bbox[3] + pad)
            w = right - left
            h = bottom - top

        cropped_svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{left} {top} {w} {h}">\n'
            f'{item["svg"]}\n</svg>\n'
        )
        svg_path = SVG_DIR / f"{name}.svg"
        png_path = PNG_DIR / f"{name}.png"
        svg_path.write_text(cropped_svg, encoding="utf-8")

        part_im = render_svg_bytes_to_pil(cropped_svg)
        part_im.save(png_path)

        alpha = part_im.getchannel("A")
        px = alpha.load()
        edge_max = 0
        for x in range(part_im.width):
            edge_max = max(edge_max, px[x, 0], px[x, part_im.height - 1])
        for y in range(part_im.height):
            edge_max = max(edge_max, px[0, y], px[part_im.width - 1, y])
        if edge_max > 0:
            clipped_count += 1
            print(f"WARNING: {name} edge alpha={edge_max}")

        manifest["layers"].append({
            "name": name,
            "file": str(png_path).replace("\\", "/"),
            "svg": str(svg_path).replace("\\", "/"),
            "bone": item["bone"],
            "zIndex": item["zIndex"],
            "left": left,
            "top": top,
            "width": w,
            "height": h,
        })

    manifest_path = OUT_DIR / "layers_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Generated {len(PARTS)} SVG & PNG parts in {OUT_DIR}. Clipped count: {clipped_count}")


if __name__ == "__main__":
    main()
