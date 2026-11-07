# -*- coding: utf-8 -*-
"""
Generates an exquisite, illustration-grade multi-layered 2D Samurai Warrior (`samurai-2d`)
in SVG and rasterizes each modular part to high-precision transparent PNGs.

Key Art & Rigging Architecture:
1. True Cel-Shaded / Stylized Illustration SVG:
   - Rich multi-stop linear & radial gradients, metallic katana sheen, crimson-and-gold lacquered
     samurai armor (`do` cuirass, `sode` pauldrons, `kusazuri` hip tassets, `kote` gauntlets, `suneate` greaves),
     deep indigo pleated `hakama`, flowing crimson `haori` battle scarf, and glowing cyan/gold Sword Aura (`剑气`).
2. Flawless Upper-Body & Joint Topology:
   - Independent `neck` slot (`zIndex` between `torso_armor` and `head_samurai`) so the head rotates cleanly
     without ever losing the neck or colliding with the collar.
   - `torso_armor` has a smooth, closed 3/4 side-chest silhouette (zero sleeveless black armhole) and
     integrated `kusazuri` armored skirt plates (`zIndex: 18`) drawn ABOVE `thigh_l` (`zIndex: 14`) so hip cuts
     are 100% hidden across all stances.
   - Concentric circular joint caps centered on every bone pivot `(x, y)` so 160-degree sword swings
     never produce shoulder or elbow steps.
3. Multi-Stage Sword Aura (`剑气`) + Sliceable Bamboo Target (`试斩竹靶`):
   - `slash_arc_fx`: Wide crescent sword-cleave arc around the samurai during the strike.
   - `slash_wave_fx`: Flying crescent sword-aura energy wave (`剑气波`) that launches forward and slices
     the bamboo target at x=700!
"""

import json
import xml.etree.ElementTree as ET
from pathlib import Path
import numpy as np
import pymupdf
from PIL import Image

BASE_DIR = Path(r"C:\Users\Administrator\.gemini\antigravity\scratch\samurai-2d")
SVG_DIR = BASE_DIR / "svg"
PNG_DIR = BASE_DIR / "png"
CANVAS_W = 880
CANVAS_H = 560

# ============================================================================
# Exact Bone Pivot Coordinates in (880 x 560) Rig Canvas Space
# ============================================================================
J = {
    "root": (245.0, 462.0),
    "hip": (245.0, 310.0),
    "torso": (245.0, 292.0),
    "neck": (248.0, 212.0),
    "head": (250.0, 198.0),
    "hair_ponytail": (226.0, 174.0),
    "headband_tail": (224.0, 182.0),
    # Haori battle cloak / scarf 3-bone chain (weighted mesh)
    "cape_root": (232.0, 218.0),
    "cape_mid": (176.0, 258.0),
    "cape_tip": (112.0, 308.0),
    # Scabbard (saya) on left hip
    "saya": (235.0, 306.0),
    # Far Arm (Left Arm - off-hand / scabbard or two-handed grip)
    "arm_upper_l": (256.0, 226.0),
    "arm_lower_l": (264.0, 274.0),
    "hand_l": (278.0, 314.0),
    # Near Arm (Right Arm - main katana-wielding arm)
    "arm_upper_r": (236.0, 228.0),
    "arm_lower_r": (232.0, 280.0),
    "hand_r": (246.0, 322.0),
    "katana": (246.0, 322.0),
    # Far Leg (Right Leg)
    "thigh_r": (255.0, 314.0),
    "shin_r": (263.0, 382.0),
    "foot_r": (267.0, 448.0),
    # Near Leg (Left Leg)
    "thigh_l": (236.0, 316.0),
    "shin_l": (232.0, 384.0),
    "foot_l": (228.0, 450.0),
    # Sword Aura VFX bones
    "slash_arc": (255.0, 275.0),
    "slash_wave": (335.0, 275.0),
    # Bamboo Tatami Target (at x=700)
    "target_stand": (700.0, 462.0),
    "target_base": (700.0, 340.0),
    "target_top": (700.0, 265.0),
}

GRAD_FALLBACKS = {
    "url(#crimsonArmor)": "#991b1b",
    "url(#crimsonBright)": "#dc2626",
    "url(#obsidianArmor)": "#1e293b",
    "url(#indigoHakama)": "#0f172a",
    "url(#goldTrim)": "#eab308",
    "url(#skinGrad)": "#fde4cf",
    "url(#neckGrad)": "#f3c3a2",
    "url(#hairGrad)": "#1e293b",
    "url(#capeGrad)": "#991b1b",
    "url(#bladeSteel)": "#e2e8f0",
    "url(#bladeEdgeGlow)": "#7dd3fc",
    "url(#swordAuraOuter)": "#0ea5e9",
    "url(#swordAuraCore)": "#e0f2fe",
    "url(#crimsonAuraAccent)": "#fb7185",
    "url(#bambooGrad)": "#65a30d",
    "url(#woodStand)": "#78350f",
}

LAYERS = [
    # 0. ground_shadow
    {
        "name": "ground_shadow",
        "bone": "root",
        "zIndex": 0,
        "svg": """
        <g>
          <ellipse cx="246" cy="462" rx="58" ry="12" fill="#090d16" fill-opacity="0.55"/>
          <ellipse cx="246" cy="462" rx="40" ry="7" fill="#020617" fill-opacity="0.65"/>
        </g>
        """,
    },
    # 1. target_stand_base (wooden stand + lower half of the tatami-maki bamboo target at x=700)
    {
        "name": "target_stand_base",
        "bone": "target_base",
        "zIndex": 1,
        "svg": """
        <g>
          <!-- Ground shadow under target -->
          <ellipse cx="700" cy="462" rx="52" ry="11" fill="#090d16" fill-opacity="0.55"/>
          <!-- Tripod wooden legs -->
          <path d="M 695,355 L 664,460 L 676,460 L 702,365 Z" fill="url(#woodStand)" stroke="#1c0a00" stroke-width="2"/>
          <path d="M 705,355 L 736,460 L 724,460 L 698,365 Z" fill="url(#woodStand)" stroke="#1c0a00" stroke-width="2"/>
          <rect x="693" y="340" width="14" height="118" rx="3" fill="url(#woodStand)" stroke="#1c0a00" stroke-width="2"/>
          <!-- Horizontal cross-beam -->
          <rect x="672" y="366" width="56" height="12" rx="3" fill="url(#woodStand)" stroke="#1c0a00" stroke-width="2"/>
          <rect x="691" y="364" width="18" height="16" rx="2" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.5"/>
          <!-- Lower half of woven tatami/bamboo cylinder (from y=268 down to y=356, diagonal cut at y=268!) -->
          <path d="M 678,274 L 722,260 L 722,354 C 722,360 678,360 678,354 Z"
                fill="url(#bambooGrad)" stroke="#1a2e05" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Bamboo vertical ribs & straw rope bindings -->
          <line x1="689" y1="271" x2="689" y2="356" stroke="#365314" stroke-width="1.6"/>
          <line x1="700" y1="267" x2="700" y2="357" stroke="#365314" stroke-width="1.6"/>
          <line x1="711" y1="264" x2="711" y2="356" stroke="#365314" stroke-width="1.6"/>
          <path d="M 677,305 Q 700,311 723,305" fill="none" stroke="#eab308" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M 677,338 Q 700,344 723,338" fill="none" stroke="#eab308" stroke-width="4.5" stroke-linecap="round"/>
          <!-- Diagonal cut cross-section highlight -->
          <path d="M 678,274 L 722,260 Q 702,272 678,274 Z" fill="#ecfccb" stroke="#65a30d" stroke-width="1.2"/>
        </g>
        """,
    },
    # 2. target_top_half (upper half of the bamboo target from y=178 to y=274, kicks off when sliced by sword aura!)
    {
        "name": "target_top_half",
        "bone": "target_top",
        "zIndex": 2,
        "svg": """
        <g>
          <path d="M 678,184 C 678,176 722,176 722,184 L 722,260 L 678,274 Z"
                fill="url(#bambooGrad)" stroke="#1a2e05" stroke-width="2.2" stroke-linejoin="round"/>
          <ellipse cx="700" cy="184" rx="22" ry="6" fill="#d9f99d" stroke="#365314" stroke-width="2"/>
          <ellipse cx="700" cy="184" rx="13" ry="3.5" fill="#fef08a" stroke="#65a30d" stroke-width="1.2"/>
          <line x1="689" y1="189" x2="689" y2="270" stroke="#365314" stroke-width="1.6"/>
          <line x1="700" y1="190" x2="700" y2="266" stroke="#365314" stroke-width="1.6"/>
          <line x1="711" y1="189" x2="711" y2="263" stroke="#365314" stroke-width="1.6"/>
          <path d="M 677,208 Q 700,214 723,208" fill="none" stroke="#eab308" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M 677,242 Q 700,248 723,242" fill="none" stroke="#eab308" stroke-width="4.5" stroke-linecap="round"/>
        </g>
        """,
    },
    # 3. haori_cape (flowing crimson samurai battle cloak / scarf, weighted mesh slot)
    {
        "name": "haori_cape",
        "bone": "cape_root",
        "zIndex": 3,
        "svg": """
        <g>
          <!-- Outer crimson battle cloak with tattered heroic hem & gold trim -->
          <path d="M 236,212 Q 168,232 92,306 L 114,316 L 104,332 Q 174,328 232,276 Z"
                fill="url(#capeGrad)" stroke="#450a0a" stroke-width="2.4" stroke-linejoin="round"/>
          <!-- Inner dynamic fold highlight -->
          <path d="M 228,220 Q 170,244 112,304 Q 158,308 220,268 Z"
                fill="#ef4444" fill-opacity="0.45"/>
          <!-- Deep shadow fold -->
          <path d="M 230,234 Q 175,266 122,322 L 145,323 Q 188,285 228,256 Z"
                fill="#450a0a" fill-opacity="0.55"/>
          <!-- Golden cloud/wave border pattern along bottom edge -->
          <path d="M 106,330 Q 172,324 229,274"
                fill="none" stroke="url(#goldTrim)" stroke-width="3.2" stroke-linecap="round"/>
        </g>
        """,
    },
    # 4. arm_upper_l (far upper arm, concentric ball-joint at (256, 226) to elbow (264, 274))
    {
        "name": "arm_upper_l",
        "bone": "arm_upper_l",
        "zIndex": 4,
        "svg": """
        <g>
          <path d="M 245,226 A 11,11 0 0 1 267,226 L 273,274 A 9,9 0 0 1 255,274 Z"
                fill="url(#indigoHakama)" stroke="#090d16" stroke-width="2.2"/>
          <!-- Far shoulder guard (sode) -->
          <circle cx="256" cy="226" r="11.5" fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="2"/>
          <path d="M 246,229 Q 256,235 266,229" fill="none" stroke="url(#goldTrim)" stroke-width="1.8"/>
        </g>
        """,
    },
    # 5. arm_lower_l (far forearm kote gauntlet + hand, elbow (264, 274) to hand (278, 314))
    {
        "name": "arm_lower_l",
        "bone": "arm_lower_l",
        "zIndex": 5,
        "svg": """
        <g>
          <path d="M 255,274 A 9,9 0 0 1 273,274 L 284,312 A 7,7 0 0 1 270,315 Z"
                fill="url(#obsidianArmor)" stroke="#090d16" stroke-width="2"/>
          <!-- Crimson & gold kote forearm plate -->
          <path d="M 258,280 L 273,278 L 282,308 L 269,310 Z"
                fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="1.8"/>
          <line x1="260" y1="290" x2="276" y2="288" stroke="url(#goldTrim)" stroke-width="1.8"/>
          <line x1="264" y1="300" x2="279" y2="298" stroke="url(#goldTrim)" stroke-width="1.8"/>
          <!-- Far hand gripping -->
          <circle cx="278" cy="314" r="6.5" fill="url(#skinGrad)" stroke="#7c2d12" stroke-width="1.6"/>
        </g>
        """,
    },
    # 6. thigh_r (far leg hakama thigh, hip (255, 314) to knee (263, 382))
    {
        "name": "thigh_r",
        "bone": "thigh_r",
        "zIndex": 6,
        "svg": """
        <g>
          <!-- Wide pleated samurai hakama thigh tapering to knee -->
          <path d="M 240,314 A 15,10 0 0 1 270,314 L 276,376 C 276,384 250,384 250,376 Z"
                fill="url(#indigoHakama)" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Hakama vertical pleat lines -->
          <line x1="254" y1="320" x2="261" y2="375" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="262" y1="320" x2="269" y2="374" stroke="#475569" stroke-width="1.6" stroke-linecap="round"/>
        </g>
        """,
    },
    # 7. shin_r (far leg armored greave suneate, knee (263, 382) to ankle (267, 448))
    {
        "name": "shin_r",
        "bone": "shin_r",
        "zIndex": 7,
        "svg": """
        <g>
          <path d="M 253,382 A 10,8 0 0 1 273,382 L 274,446 A 7,6 0 0 1 260,446 Z"
                fill="url(#obsidianArmor)" stroke="#020617" stroke-width="2.2"/>
          <!-- Gold-trimmed crimson suneate shin plate -->
          <path d="M 262,384 L 273,384 L 273,444 L 264,444 Z"
                fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="1.6"/>
          <!-- Knee guard (kikko) -->
          <path d="M 254,378 C 254,370 276,370 276,380 L 274,390 L 256,388 Z"
                fill="url(#obsidianArmor)" stroke="url(#goldTrim)" stroke-width="1.8"/>
          <line x1="254" y1="404" x2="273" y2="407" stroke="url(#goldTrim)" stroke-width="2"/>
          <line x1="256" y1="424" x2="273" y2="427" stroke="url(#goldTrim)" stroke-width="2"/>
        </g>
        """,
    },
    # 8. foot_r (far samurai waraji sandal & tabi sock, ankle (267, 448))
    {
        "name": "foot_r",
        "bone": "foot_r",
        "zIndex": 8,
        "svg": """
        <g>
          <path d="M 258,444 A 8,6 0 0 1 274,445 L 294,453 C 300,455 299,461 290,461 L 256,461 L 257,448 Z"
                fill="#1e293b" stroke="#020617" stroke-width="2" stroke-linejoin="round"/>
          <!-- White tabi toe & crimson strap -->
          <path d="M 278,448 L 294,453 C 298,455 297,459 290,459 L 276,459 Z" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.5"/>
          <path d="M 268,447 L 280,458" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="256" y1="460" x2="296" y2="460" stroke="#a16207" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        """,
    },
    # 9. thigh_l (near leg hakama thigh, hip (236, 316) to knee (232, 384))
    #    zIndex 9 -> sits UNDER torso_armor (zIndex 13) so the kusazuri armored skirt covers the hip 100%!
    {
        "name": "thigh_l",
        "bone": "thigh_l",
        "zIndex": 9,
        "svg": """
        <g>
          <!-- Wide sculptural hakama trousers with crisp cel-shaded folds -->
          <path d="M 219,316 A 17,11 0 0 1 253,316 L 248,378 C 248,387 216,387 216,378 Z"
                fill="url(#indigoHakama)" stroke="#020617" stroke-width="2.4" stroke-linejoin="round"/>
          <!-- Lit front thigh plane -->
          <path d="M 234,316 L 251,316 L 246,378 L 231,378 Z"
                fill="#334155" fill-opacity="0.45"/>
          <!-- Crisp hakama pleats -->
          <line x1="228" y1="322" x2="225" y2="378" stroke="#020617" stroke-width="2.0" stroke-linecap="round"/>
          <line x1="238" y1="320" x2="236" y2="378" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/>
        </g>
        """,
    },
    # 10. shin_l (near leg armored greave suneate + golden dragon knee guard, knee (232, 384) to ankle (228, 450))
    {
        "name": "shin_l",
        "bone": "shin_l",
        "zIndex": 10,
        "svg": """
        <g>
          <path d="M 220,384 A 12,9 0 0 1 244,384 L 238,448 A 9,6 0 0 1 220,448 Z"
                fill="url(#obsidianArmor)" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Front crimson & gold lacquered shin plate -->
          <path d="M 229,386 L 243,386 L 237,447 L 226,447 Z"
                fill="url(#crimsonBright)" stroke="url(#goldTrim)" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Sculpted golden knee guard (suneate poleyn) centered right over knee pivot (232, 384) -->
          <path d="M 218,380 C 218,369 246,369 246,381 L 242,394 L 221,391 Z"
                fill="url(#obsidianArmor)" stroke="url(#goldTrim)" stroke-width="2.2" stroke-linejoin="round"/>
          <circle cx="234" cy="381" r="4.2" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.2"/>
          <!-- Gold horizontal armor bindings -->
          <path d="M 220,406 Q 232,410 241,406" fill="none" stroke="url(#goldTrim)" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M 220,426 Q 231,430 239,426" fill="none" stroke="url(#goldTrim)" stroke-width="2.6" stroke-linecap="round"/>
        </g>
        """,
    },
    # 11. foot_l (near samurai armored sandal & tabi sock, ankle (228, 450))
    {
        "name": "foot_l",
        "bone": "foot_l",
        "zIndex": 11,
        "svg": """
        <g>
          <path d="M 218,446 A 9,6 0 0 1 237,447 L 259,455 C 266,458 265,464 255,464 L 216,464 L 217,450 Z"
                fill="#0f172a" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- White tabi front & crimson sandal thongs -->
          <path d="M 240,450 L 259,455 C 263,457 262,462 254,462 L 238,462 Z"
                fill="#f8fafc" stroke="#1e293b" stroke-width="1.6"/>
          <!-- Gold-plated foot guard (kogake) -->
          <path d="M 222,448 L 242,450 L 238,458 L 220,456 Z"
                fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="1.6"/>
          <line x1="216" y1="463" x2="262" y2="463" stroke="#eab308" stroke-width="2.6" stroke-linecap="round"/>
        </g>
        """,
    },
    # 12. neck (INDEPENDENT sculpted neck slot! Tucked between torso collar (zIndex 13) and head jawline (zIndex 16)!)
    {
        "name": "neck",
        "bone": "neck",
        "zIndex": 12,
        "svg": """
        <g>
          <!-- Cylindrical shaded neck extending from y=192 down to y=228 -->
          <path d="M 240,192 L 256,192 L 258,228 L 236,228 Z"
                fill="#f3c3a2" stroke="#5c2814" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Lit front-right throat plane -->
          <path d="M 247,192 L 256,192 L 257,226 L 246,226 Z" fill="#fde4cf"/>
          <!-- Sub-mental cast shadow under the chin -->
          <path d="M 240,194 Q 249,205 256,197 L 256,205 Q 248,211 239,203 Z"
                fill="#c27856" fill-opacity="0.65"/>
        </g>
        """,
    },
    # 13. torso_armor (Samurai Do cuirass + inner kimono collar + Kusazuri armored hip skirt at zIndex 13 > thigh_l 9!)
    {
        "name": "torso_armor",
        "bone": "torso",
        "zIndex": 13,
        "svg": """
        <g>
          <!-- 1. Kusazuri (layered crimson-and-gold lacquered tasset skirt plates covering y=286..336 over the thighs!) -->
          <!-- Far-right front tasset plate -->
          <path d="M 246,288 L 270,288 L 277,332 L 250,332 Z"
                fill="url(#obsidianArmor)" stroke="url(#goldTrim)" stroke-width="2.0" stroke-linejoin="round"/>
          <line x1="248" y1="302" x2="272" y2="302" stroke="#dc2626" stroke-width="2.4"/>
          <line x1="249" y1="316" x2="275" y2="316" stroke="url(#goldTrim)" stroke-width="2.2"/>
          <!-- Near-left side-front tasset plate (directly covers thigh_l hip joint (236, 316)!) -->
          <path d="M 218,288 L 252,288 L 246,335 L 212,332 Z"
                fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="2.2" stroke-linejoin="round"/>
          <line x1="216" y1="301" x2="250" y2="301" stroke="url(#goldTrim)" stroke-width="2.2"/>
          <line x1="215" y1="313" x2="248" y2="313" stroke="#090d16" stroke-width="2.4"/>
          <line x1="214" y1="324" x2="247" y2="324" stroke="url(#goldTrim)" stroke-width="2.2"/>

          <!-- 2. Main Do Cuirass (3/4 right-facing tapered samurai chest armor, smooth closed side—NO black armhole!) -->
          <path d="M 222,288 L 266,288 C 271,268 275,248 272,226 C 270,218 263,214 256,214 L 228,214 C 220,218 218,236 220,258 Z"
                fill="url(#obsidianArmor)" stroke="#090d16" stroke-width="2.4" stroke-linejoin="round"/>
          <!-- Crimson lacquered chest plate (sendan-no-ita / mune-ita) on right-front chest -->
          <path d="M 234,224 L 270,224 C 273,244 270,266 265,286 L 236,286 C 232,266 231,244 234,224 Z"
                fill="url(#crimsonBright)" stroke="url(#goldTrim)" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Horizontal lamellar armor lacing lines -->
          <path d="M 234,240 Q 254,244 271,239" fill="none" stroke="url(#goldTrim)" stroke-width="2.0"/>
          <path d="M 234,256 Q 254,260 270,255" fill="none" stroke="#090d16" stroke-width="2.4"/>
          <path d="M 235,271 Q 253,275 267,270" fill="none" stroke="url(#goldTrim)" stroke-width="2.0"/>
          <!-- Layered white & crimson kimono V-collar (eri) wrapping the base of the neck at y=212..234 -->
          <path d="M 232,212 L 256,232 L 264,212 L 258,212 L 254,224 L 238,212 Z"
                fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M 227,214 L 255,236 L 267,214"
                fill="none" stroke="url(#goldTrim)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Golden demon/crest medallion on chest -->
          <circle cx="256" cy="248" r="5.5" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.6"/>
          <!-- Obi silk waist sash & golden buckle -->
          <rect x="219" y="282" width="50" height="10" rx="3" fill="url(#indigoHakama)" stroke="url(#goldTrim)" stroke-width="2.0"/>
          <rect x="252" y="280" width="12" height="14" rx="2.5" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.8"/>
        </g>
        """,
    },
    # 14. saya_sheath (katana scabbard worn through the obi on the left hip at (235, 306))
    {
        "name": "saya_sheath",
        "bone": "saya",
        "zIndex": 14,
        "svg": """
        <g>
          <!-- Curved black-and-crimson lacquered scabbard extending back from hip (235, 306) to (135, 355) -->
          <path d="M 252,298 Q 192,318 132,352 L 136,360 Q 196,327 255,306 Z"
                fill="url(#obsidianArmor)" stroke="#020617" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Gold kojiri (scabbard tip) & crimson sageo cord wrap -->
          <path d="M 132,352 L 146,345 L 150,353 L 136,360 Z" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.4"/>
          <path d="M 218,310 L 238,303 L 241,311 L 221,318 Z" fill="url(#crimsonBright)" stroke="url(#goldTrim)" stroke-width="1.5"/>
        </g>
        """,
    },
    # 15. hair_ponytail (lush multi-strand samurai high ponytail at (226, 174))
    {
        "name": "hair_ponytail",
        "bone": "hair_ponytail",
        "zIndex": 15,
        "svg": """
        <g>
          <!-- Flowing crimson headband tails (hachimaki) with dynamic wave -->
          <path d="M 226,182 C 195,184 168,196 138,214 C 168,208 196,198 224,190 Z"
                fill="#ef4444" stroke="#450a0a" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M 224,186 C 196,196 172,212 150,230 C 178,220 202,206 224,193 Z"
                fill="#b91c1c" stroke="#450a0a" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- Upper spiky ponytail plume -->
          <path d="M 228,170 C 202,146 162,150 132,176 C 160,170 184,172 214,178 Z"
                fill="#0f172a" stroke="#020617" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Main wild samurai high ponytail mass -->
          <path d="M 228,173 C 196,156 152,168 126,198 C 156,192 186,188 218,186 Z"
                fill="#1e293b" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Lower layered hair strand -->
          <path d="M 226,177 C 194,170 160,186 142,212 C 172,204 198,196 224,186 Z"
                fill="#0f172a" stroke="#020617" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Crisp anime hair sheen highlights -->
          <path d="M 216,166 Q 180,160 152,174 Q 182,168 214,173 Z" fill="#475569"/>
          <path d="M 212,175 Q 178,174 150,190 Q 180,184 210,181 Z" fill="#334155"/>
          <!-- Gold hair tie cuff (motoyui) -->
          <rect x="220" y="166" width="9" height="15" rx="3" transform="rotate(-18 224 173)"
                fill="#eab308" stroke="#451a03" stroke-width="1.6"/>
          <line x1="222" y1="170" x2="228" y2="168" stroke="#fef08a" stroke-width="1.4"/>
        </g>
        """,
    },
    # 16. head_samurai (sculpted 3/4 anime-stylized samurai head, sharp eyes, headband, NO neck glued on!)
    {
        "name": "head_samurai",
        "bone": "head",
        "zIndex": 16,
        "svg": """
        <g>
          <!-- Back cranium hair mass -->
          <path d="M 222,188 C 216,160 240,146 266,154 C 276,158 280,170 276,180 L 232,196 Z"
                fill="#1e293b" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Sculpted 3/4 right-facing anime samurai face & crisp jawline -->
          <path d="M 235,172 C 235,158 270,158 273,176 L 276,188 C 277,191 274,193 273,196 L 270,204 C 268,208 260,208 252,205 L 238,195 Z"
                fill="#fde4cf" stroke="#5c2814" stroke-width="1.9" stroke-linejoin="round"/>
          <!-- Soft anime cel-shadow along left temple, ear-side cheek & under lower lip -->
          <path d="M 235,172 L 248,172 C 245,184 247,196 258,204 L 252,205 L 238,195 Z"
                fill="#f3c3a2"/>
          <!-- Nose bridge highlight & nostril accent -->
          <path d="M 271,180 L 275,189 L 271,191" fill="none" stroke="#fff7ed" stroke-width="1.6" stroke-linecap="round"/>
          <!-- Focused samurai eye (crisp dark upper lash, crimson-gold iris, bright catchlight) -->
          <path d="M 255,178 L 271,175" stroke="#020617" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M 256,182 L 269,181 L 267,186.5 L 257,186.5 Z" fill="#ffffff" stroke="#020617" stroke-width="1.4"/>
          <circle cx="264" cy="183.8" r="2.4" fill="#b91c1c"/>
          <circle cx="264" cy="183.8" r="1.2" fill="#020617"/>
          <circle cx="265" cy="183.0" r="0.9" fill="#ffffff"/>
          <!-- Calm, resolute mouth line -->
          <path d="M 263,198 Q 267,197.5 271,198.5" fill="none" stroke="#5c2814" stroke-width="1.6" stroke-linecap="round"/>
          <!-- Sculpted ear with inner helix detail -->
          <path d="M 240,181 C 232,179 231,192 240,194" fill="#fde4cf" stroke="#5c2814" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M 237,184 C 234,185 234,190 238,191" fill="none" stroke="#c27856" stroke-width="1.3" stroke-linecap="round"/>
          <!-- Crimson & gold samurai headband (hachimaki) with metallic fore-crest (harikake) -->
          <path d="M 223,177 Q 251,167 276,174 L 275,166 Q 249,159 222,169 Z"
                fill="#dc2626" stroke="#450a0a" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M 225,172 Q 251,163 274,169" fill="none" stroke="#f87171" stroke-width="1.4"/>
          <!-- Golden crescent forehead crest (maedate) -->
          <path d="M 267,164 L 282,153 L 275,169 L 281,173 L 268,172 Z"
                fill="#eab308" stroke="#451a03" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M 269,165 L 279,157 L 274,168 Z" fill="#fef08a"/>
          <!-- Layered anime front hair bangs framing the temple & cheek -->
          <path d="M 254,154 C 241,165 239,182 244,196 C 246,183 251,169 260,160 Z"
                fill="#0f172a" stroke="#020617" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M 248,158 C 236,166 232,178 234,188 C 237,178 242,168 252,160 Z"
                fill="#1e293b" stroke="#020617" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M 263,154 C 272,160 279,169 283,178 C 274,171 268,167 259,162 Z"
                fill="#1e293b" stroke="#020617" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- Hair crown highlight -->
          <path d="M 234,160 Q 250,152 265,157" fill="none" stroke="#475569" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        """,
    },
    # 17. katana_sword (The Samurai's Katana: tsuba guard, tsuka hilt, and gleaming curved steel blade!)
    {
        "name": "katana_sword",
        "bone": "katana",
        "zIndex": 17,
        "svg": """
        <g>
          <!-- Tsuka (diamond-wrapped katana handle from (216, 336) through grip (246, 322) to tsuba (262, 314)) -->
          <path d="M 212,335 L 260,312 L 264,320 L 216,343 Z"
                fill="#0f172a" stroke="#020617" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Crimson tsuka-ito diamond cord markings -->
          <line x1="222" y1="331" x2="226" y2="338" stroke="#ef4444" stroke-width="2.4"/>
          <line x1="232" y1="326" x2="236" y2="333" stroke="#ef4444" stroke-width="2.4"/>
          <line x1="242" y1="321" x2="246" y2="328" stroke="#ef4444" stroke-width="2.4"/>
          <line x1="252" y1="316" x2="256" y2="323" stroke="#ef4444" stroke-width="2.4"/>
          <!-- Kashira (golden pommel cap) -->
          <circle cx="214" cy="339" r="4.5" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.5"/>
          <!-- Tsuba (ornate golden circular handguard at (262, 315)) -->
          <ellipse cx="262" cy="315" rx="4.5" ry="12.5" transform="rotate(-25 262 315)"
                   fill="url(#goldTrim)" stroke="#451a03" stroke-width="2.0"/>
          <!-- Habaki (golden blade collar) -->
          <path d="M 264,310 L 275,305 L 278,312 L 267,318 Z"
                fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.5"/>
          <!-- Nagasa (curved gleaming steel katana blade extending from (275, 308) to tip (425, 224)) -->
          <path d="M 274,305 Q 350,268 428,218 Q 422,231 412,237 Q 345,279 277,312 Z"
                fill="url(#bladeSteel)" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Hamon (wavy tempered blade edge gleam) -->
          <path d="M 278,309 Q 350,272 424,221"
                fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M 282,306 Q 352,268 426,219"
                fill="none" stroke="#38bdf8" stroke-width="1.2" stroke-linecap="round" stroke-opacity="0.8"/>
        </g>
        """,
    },
    # 18. arm_upper_r (near upper arm + concentric circular Sode shoulder armor centered at (236, 228)!)
    {
        "name": "arm_upper_r",
        "bone": "arm_upper_r",
        "zIndex": 18,
        "svg": """
        <g>
          <!-- Upper arm armored sleeve from shoulder (236, 228) to elbow (232, 280) -->
          <path d="M 224,228 A 12,12 0 0 1 248,228 L 243,280 A 11,11 0 0 1 221,280 Z"
                fill="url(#indigoHakama)" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M 235,232 L 246,232 L 242,278 L 233,278 Z" fill="#334155" fill-opacity="0.5"/>
          <!-- Concentric circular Samurai Sode Shoulder Armor centered right on pivot (236, 228) (r=14.5px) -->
          <!-- Because it is a concentric circle around (236, 228), rotating -130 deg in slash has ZERO step! -->
          <circle cx="236" cy="228" r="14.5"
                  fill="url(#crimsonBright)" stroke="url(#goldTrim)" stroke-width="2.4"/>
          <path d="M 223,225 Q 236,232 249,225" fill="none" stroke="url(#goldTrim)" stroke-width="2.0" stroke-linecap="round"/>
          <path d="M 223,232 Q 236,239 249,232" fill="none" stroke="#090d16" stroke-width="2.2" stroke-linecap="round"/>
          <circle cx="236" cy="222" r="3.5" fill="url(#goldTrim)" stroke="#451a03" stroke-width="1.2"/>
        </g>
        """,
    },
    # 19. arm_lower_r (near forearm kote gauntlet + articulated fingers gripping katana at (246, 322))
    {
        "name": "arm_lower_r",
        "bone": "arm_lower_r",
        "zIndex": 19,
        "svg": """
        <g>
          <!-- Forearm base from elbow (232, 280) to wrist (246, 322) -->
          <path d="M 222,280 A 10,10 0 0 1 242,280 L 253,318 A 8,8 0 0 1 237,322 Z"
                fill="url(#obsidianArmor)" stroke="#020617" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Ornate crimson & gold Kote gauntlet plate -->
          <path d="M 225,284 L 242,281 L 252,314 L 237,318 Z"
                fill="url(#crimsonBright)" stroke="url(#goldTrim)" stroke-width="2.0" stroke-linejoin="round"/>
          <!-- Elbow rondel guard centered on (232, 280) -->
          <circle cx="232" cy="280" r="6.5" fill="url(#obsidianArmor)" stroke="url(#goldTrim)" stroke-width="1.8"/>
          <line x1="227" y1="295" x2="245" y2="292" stroke="url(#goldTrim)" stroke-width="2.0"/>
          <line x1="231" y1="306" x2="249" y2="303" stroke="url(#goldTrim)" stroke-width="2.0"/>
          <!-- Articulated right hand & 4 fingers wrapping around the katana hilt at (246, 322) -->
          <path d="M 239,315 L 253,312 C 257,316 258,325 252,329 L 241,330 C 237,327 237,320 239,315 Z"
                fill="url(#skinGrad)" stroke="#7c2d12" stroke-width="1.8" stroke-linejoin="round"/>
          <!-- Tekko (gold-trimmed crimson back-of-hand armor plate) -->
          <path d="M 239,314 L 250,312 L 252,321 L 241,323 Z"
                fill="url(#crimsonArmor)" stroke="url(#goldTrim)" stroke-width="1.4"/>
          <!-- Articulated fingers curled around tsuka -->
          <rect x="246" y="320" width="8.5" height="3.2" rx="1.5" transform="rotate(-22 250 321)" fill="url(#skinGrad)" stroke="#7c2d12" stroke-width="1.1"/>
          <rect x="244" y="323" width="8.5" height="3.2" rx="1.5" transform="rotate(-22 248 324)" fill="url(#skinGrad)" stroke="#7c2d12" stroke-width="1.1"/>
          <rect x="242" y="326" width="8.0" height="3.2" rx="1.5" transform="rotate(-22 246 327)" fill="url(#skinGrad)" stroke="#7c2d12" stroke-width="1.1"/>
        </g>
        """,
    },
    # 20. slash_arc_fx (Crescent Sword-Cleave Arc VFX around the samurai, hidden in Setup Pose, ignites during `slash`!)
    {
        "name": "slash_arc_fx",
        "bone": "slash_arc",
        "zIndex": 20,
        "svg": """
        <g>
          <!-- Outer soft cyan glow halo -->
          <path d="M 180,108 C 350,98 475,202 465,348 C 456,422 390,472 288,474 C 372,446 418,390 422,325 C 428,222 328,140 180,108 Z"
                fill="#0284c7" fill-opacity="0.38"/>
          <!-- Mid-layer vibrant azure crescent slash arc -->
          <path d="M 192,115 C 348,106 466,206 456,345 C 448,415 385,465 295,468 C 376,440 420,386 424,325 C 430,224 334,144 192,115 Z"
                fill="#38bdf8" fill-opacity="0.82"/>
          <!-- Crimson-gold inner fire ribbon -->
          <path d="M 218,130 C 352,126 446,216 438,338 C 432,395 382,442 315,452 C 378,425 410,378 412,322 C 416,228 335,152 218,130 Z"
                fill="#fb7185" fill-opacity="0.78"/>
          <!-- Razor-sharp white-hot leading edge of the katana cleave -->
          <path d="M 208,120 C 356,112 462,210 452,345 C 446,408 392,455 310,464 C 388,436 432,382 436,322 C 442,218 345,136 208,120 Z"
                fill="#f0f9ff" fill-opacity="0.96"/>
          <!-- Pure white outer razor arc -->
          <path d="M 225,118 C 368,118 464,216 452,348 C 446,404 398,448 326,460"
                fill="none" stroke="#ffffff" stroke-width="4.0" stroke-linecap="round"/>
          <!-- Dynamic speed lines / energy sparks -->
          <path d="M 260,122 Q 395,165 446,285" fill="none" stroke="#fef08a" stroke-width="3.0" stroke-linecap="round"/>
          <path d="M 355,155 L 392,138 L 370,170 Z" fill="#fef08a"/>
          <path d="M 432,245 L 472,238 L 444,264 Z" fill="#ffffff"/>
          <path d="M 418,365 L 454,380 L 412,388 Z" fill="#fef08a"/>
        </g>
        """,
    },
    # 21. slash_wave_fx (Flying Crescent Sword-Aura Projectile Wave `剑气波` that travels to x=700 to slice the bamboo target!)
    {
        "name": "slash_wave_fx",
        "bone": "slash_wave",
        "zIndex": 21,
        "svg": """
        <g>
          <!-- Outer shockwave aura glow -->
          <path d="M 282,128 C 422,160 464,275 402,402 C 370,442 322,462 270,466 C 334,428 368,366 372,295 C 376,220 340,164 282,128 Z"
                fill="#0284c7" fill-opacity="0.45"/>
          <!-- Clean crescent-shaped crimson-gold inner fire wake (no self-intersecting triangles!) -->
          <path d="M 290,148 C 398,180 432,276 382,385 C 358,420 322,440 285,448 C 336,412 362,355 365,292 C 368,226 336,178 290,148 Z"
                fill="#f43f5e" fill-opacity="0.72"/>
          <!-- Sweeping wind/energy tail streaks behind the crescent -->
          <path d="M 315,195 Q 355,205 378,235 Q 345,222 315,195 Z" fill="#38bdf8" fill-opacity="0.75"/>
          <path d="M 310,285 Q 352,288 386,295 Q 348,305 310,285 Z" fill="#fef08a" fill-opacity="0.85"/>
          <path d="M 315,375 Q 352,368 376,345 Q 342,382 315,375 Z" fill="#38bdf8" fill-opacity="0.75"/>
          <!-- Mid-layer electric cyan crescent blade wave -->
          <path d="M 298,136 C 416,168 454,276 396,394 C 368,432 325,452 280,458 C 344,420 378,360 382,294 C 386,222 350,168 298,136 Z"
                fill="#38bdf8" fill-opacity="0.90"/>
          <!-- White-hot crescent blade wave core -->
          <path d="M 310,145 C 414,175 446,278 392,388 C 368,425 332,445 292,452 C 352,414 388,356 392,290 C 396,222 360,172 310,145 Z"
                fill="#f0f9ff" fill-opacity="0.98"/>
          <path d="M 322,155 C 418,192 436,285 390,382"
                fill="none" stroke="#ffffff" stroke-width="5.0" stroke-linecap="round"/>
          <!-- Energy shards -->
          <polygon points="415,235 454,226 422,254" fill="#ffffff"/>
          <polygon points="425,295 468,290 430,314" fill="#fef08a"/>
          <polygon points="402,355 442,364 398,374" fill="#7dd3fc"/>
        </g>
        """,
    },
]


def resolve_svg_colors(svg_text: str) -> str:
    for k, v in GRAD_FALLBACKS.items():
        svg_text = svg_text.replace(k, v)
    return svg_text


def render_svg_to_pil(svg_body: str, layer_name: str = "") -> Image.Image:
    from PIL import ImageFilter

    clean_body = resolve_svg_colors(svg_body)
    full_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" viewBox="0 0 {CANVAS_W} {CANVAS_H}">{clean_body}</svg>'
    doc = pymupdf.open(stream=full_svg.encode("utf-8"), filetype="svg")
    page = doc[0]
    pix = page.get_pixmap(alpha=True, dpi=72)
    im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)

    if layer_name in ("slash_arc_fx", "slash_wave_fx"):
        # Add real multi-scale Sword Aura optical bloom glow (pure alpha blur so RGB never darkens!)
        a_chan = im.split()[3]
        a_wide = a_chan.filter(ImageFilter.GaussianBlur(radius=9.0)).point(lambda p: min(255, int(p * 0.55)))
        a_mid = a_chan.filter(ImageFilter.GaussianBlur(radius=4.0)).point(lambda p: min(255, int(p * 0.85)))

        glow_wide = Image.new("RGBA", im.size, (56, 189, 248, 0))   # Pure sky-cyan outer energy bloom
        glow_wide.putalpha(a_wide)
        glow_mid = Image.new("RGBA", im.size, (186, 230, 253, 0))   # Luminous ice-blue mid bloom
        glow_mid.putalpha(a_mid)

        out = Image.alpha_composite(glow_wide, glow_mid)
        out = Image.alpha_composite(out, im)
        return out
    elif layer_name != "ground_shadow":
        # Add subtle 2D illustration directional lighting gradient across the part's bounding box
        arr = np.array(im, dtype=np.float32)
        bbox = im.getbbox()
        if bbox:
            x0, y0, x1, y1 = bbox
            bw, bh = max(1.0, float(x1 - x0)), max(1.0, float(y1 - y0))
            yy, xx = np.mgrid[0 : im.height, 0 : im.width]
            nx = np.clip((xx - x0) / bw, 0.0, 1.0)
            ny = np.clip((yy - y0) / bh, 0.0, 1.0)
            # Top-right warm key light (1.08x) tapering to bottom-left shadow (0.86x)
            light = 0.88 + 0.14 * nx + 0.08 * (1.0 - ny)
            # Keep dark outlines (<40 brightness) crisp dark
            lum = np.mean(arr[..., :3], axis=-1)
            is_fill = (lum > 35.0).astype(np.float32)
            factor = 1.0 + (light - 1.0) * is_fill
            arr[..., :3] = np.clip(arr[..., :3] * factor[..., None], 0.0, 255.0)
            return Image.fromarray(arr.astype(np.uint8), mode="RGBA")
    return im


def main():
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    manifest_layers = []
    # Create two previews:
    # 1. Setup Pose preview (without sword aura VFX)
    # 2. Sword Aura preview (with slash_arc_fx and slash_wave_fx visible!)
    setup_preview = Image.new("RGBA", (CANVAS_W, CANVAS_H), (22, 25, 34, 255))
    aura_preview = Image.new("RGBA", (CANVAS_W, CANVAS_H), (22, 25, 34, 255))

    for item in sorted(LAYERS, key=lambda x: x["zIndex"]):
        name = item["name"]
        im_full = render_svg_to_pil(item["svg"], name)
        bbox = im_full.getbbox()
        if not bbox:
            raise RuntimeError(f"Empty SVG layer: {name}")

        pad = 6
        x0 = max(0, bbox[0] - pad)
        y0 = max(0, bbox[1] - pad)
        x1 = min(CANVAS_W, bbox[2] + pad)
        y1 = min(CANVAS_H, bbox[3] + pad)
        w, h = x1 - x0, y1 - y0

        cropped = im_full.crop((x0, y0, x1, y1))
        cropped.save(PNG_DIR / f"{name}.png")

        cropped_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{x0} {y0} {w} {h}">{resolve_svg_colors(item["svg"])}</svg>'
        (SVG_DIR / f"{name}.svg").write_text(cropped_svg, encoding="utf-8")

        manifest_layers.append(
            {
                "name": name,
                "bone": item["bone"],
                "zIndex": item["zIndex"],
                "left": x0,
                "top": y0,
                "width": w,
                "height": h,
                "centerX": round(x0 + w / 2.0, 2),
                "centerY": round(y0 + h / 2.0, 2),
                "file": str((PNG_DIR / f"{name}.png").resolve()),
            }
        )

        if name not in ("slash_arc_fx", "slash_wave_fx"):
            setup_preview.alpha_composite(im_full)
        aura_preview.alpha_composite(im_full)

    manifest = {
        "canvasWidth": CANVAS_W,
        "canvasHeight": CANVAS_H,
        "joints": {k: list(v) for k, v in J.items()},
        "layers": manifest_layers,
    }
    (BASE_DIR / "layers_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    setup_preview.save(BASE_DIR / "samurai_setup_preview.png")
    aura_preview.save(BASE_DIR / "samurai_aura_preview.png")
    print(f"Generated {len(manifest_layers)} SVG & PNG parts in {BASE_DIR}")


if __name__ == "__main__":
    main()
