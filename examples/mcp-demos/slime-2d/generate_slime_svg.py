"""
generate_slime_svg.py
Generates an exquisite, multi-layered 2D Translucent Crystal Slime ('slime-2d' · 星露晶核史莱姆王)
using multi-plane SVG vector art + NumPy/Pillow Subsurface Scattering (SSS) jelly shading
and pure alpha-channel optical bloom.

Parts generated (16 modular layers):
  0. ground_shadow      (bone: shadow,        zIndex: 0)  - Soft elliptical ground shadow
  1. slime_back_rim     (bone: body_mid,      zIndex: 1)  - Deep translucent back gel rim &caustics
  2. bubbles_back       (bone: bubbles_back,  zIndex: 2)  - Deep suspended air bubbles & magic motes
  3. crystal_core_glow  (bone: core,          zIndex: 3)  - Radiant starlight aura behind the magic core
  4. crystal_core       (bone: core,          zIndex: 4)  - Faceted rose-gold & astral-cyan magic core + rune ring
  5. slime_body         (bone: body_base,     zIndex: 5)  - Main translucent aqua-emerald jelly body (weighted 6x6 mesh!)
  6. slime_belly_caustic(bone: body_base,     zIndex: 6)  - Inner bottom refraction & luminous floor caustic glow
  7. bubbles_front      (bone: bubbles_front, zIndex: 7)  - Foreground glossy floating gel bubbles
  8. blush_cheeks       (bone: face,          zIndex: 8)  - Cute rosy translucent slime cheeks
  9. eyes_normal        (bone: eyes,          zIndex: 9)  - Big glossy anime slime eyes with starlight catchlights
 10. eyes_blink         (bone: eyes,          zIndex: 10) - Happy curved closed-eye arcs (for blinking & hopping)
 11. eyes_hurt          (bone: eyes,          zIndex: 11) - Squeezed '> <' wince eyes with tiny tear droplets (for hit)
 12. eyes_dizzy         (bone: eyes,          zIndex: 12) - Knocked-out 'X X' / swirl eyes (for die)
 13. mouth_smile        (bone: mouth,         zIndex: 13) - Cute cat-like 'w' slime smile
 14. mouth_wail         (bone: mouth,         zIndex: 14) - Open wavy shock/wail mouth (for hit / die / big jump)
 15. slime_specular     (bone: body_top,      zIndex: 15) - Crisp curved glass-dome specular rim highlights
 16. crest_antenna      (bone: crest_drop,    zIndex: 16) - Wobbling jelly droplet antenna + miniature golden slime crown
 17. splash_droplets_fx (bone: fx_splash,     zIndex: 17) - Dynamic flying gel droplets & impact splash ring (for run/hit/die)
"""

import json
import os
from pathlib import Path
import pymupdf
from PIL import Image, ImageFilter
import numpy as np

BASE_DIR = Path(r"C:\Users\Administrator\.gemini\antigravity\scratch\slime-2d")
SVG_DIR = BASE_DIR / "svg"
PNG_DIR = BASE_DIR / "png"

CANVAS_W = 800
CANVAS_H = 520

# Exact anatomical & soft-body joint pivots in the 800x520 canvas
J = {
    "root":          (400.0, 412.0),
    "shadow":        (400.0, 412.0),
    "body_base":     (400.0, 406.0),  # Bottom contact pivot: scaling Y squashes toward the ground y=406!
    "body_mid":      (400.0, 336.0),  # Center of mass of the jelly dome
    "body_top":      (400.0, 264.0),  # Upper dome apex
    "cheek_l":       (318.0, 356.0),  # Left lateral jelly bulge bone
    "cheek_r":       (482.0, 356.0),  # Right lateral jelly bulge bone
    "core":          (400.0, 334.0),  # Floating inner magic crystal core
    "bubbles_back":  (352.0, 342.0),  # Back internal bubbles
    "bubbles_front": (448.0, 318.0),  # Front internal bubbles
    "face":          (400.0, 342.0),  # Facial group pivot
    "eyes":          (400.0, 334.0),  # Eye line pivot
    "mouth":         (400.0, 358.0),  # Mouth pivot
    "crest_drop":    (400.0, 248.0),  # Top jelly antenna & mini crown pivot
    "fx_splash":     (400.0, 340.0),  # Flying slime droplets VFX pivot
}

LAYERS = [
    # 0. ground_shadow
    {
        "name": "ground_shadow",
        "bone": "shadow",
        "zIndex": 0,
        "svg": """
        <g>
          <ellipse cx="400" cy="410" rx="114" ry="18" fill="#060913" fill-opacity="0.45"/>
          <ellipse cx="400" cy="410" rx="84" ry="12" fill="#020617" fill-opacity="0.65"/>
        </g>
        """,
    },
    # 1. slime_back_rim (Inner back wall of the translucent jelly dome, visible behind the core)
    {
        "name": "slime_back_rim",
        "bone": "body_mid",
        "zIndex": 1,
        "svg": """
        <g>
          <!-- Deep ocean-sapphire back gel silhouette -->
          <path d="M 400,250
                   C 462,250 508,295 514,352
                   C 518,390 494,408 400,408
                   C 306,408 282,390 286,352
                   C 292,295 338,250 400,250 Z"
                fill="#0369a1" fill-opacity="0.78" stroke="#082f49" stroke-width="3.0"/>
          <!-- Inner refraction dome glow -->
          <path d="M 400,264
                   C 452,264 492,302 496,352
                   C 499,384 476,398 400,398
                   C 324,398 301,384 304,352
                   C 308,302 348,264 400,264 Z"
                fill="#0ea5e9" fill-opacity="0.65"/>
        </g>
        """,
    },
    # 2. bubbles_back (Suspended deep gel bubbles & glowing motes)
    {
        "name": "bubbles_back",
        "bone": "bubbles_back",
        "zIndex": 2,
        "svg": """
        <g>
          <circle cx="332" cy="348" r="10" fill="#7dd3fc" fill-opacity="0.55" stroke="#e0f2fe" stroke-width="1.5"/>
          <circle cx="329" cy="345" r="3.2" fill="#ffffff" fill-opacity="0.85"/>
          <circle cx="348" cy="312" r="6.5" fill="#7dd3fc" fill-opacity="0.50" stroke="#bae6fd" stroke-width="1.2"/>
          <circle cx="346" cy="310" r="2.0" fill="#ffffff" fill-opacity="0.80"/>
          <circle cx="318" cy="376" r="5.0" fill="#38bdf8" fill-opacity="0.60"/>
          <circle cx="366" cy="378" r="4.0" fill="#bae6fd" fill-opacity="0.65"/>
          <!-- Tiny four-point starlight mote -->
          <path d="M 355,288 L 357,294 L 363,296 L 357,298 L 355,304 L 353,298 L 347,296 L 353,294 Z"
                fill="#fef08a" fill-opacity="0.85"/>
        </g>
        """,
    },
    # 3. crystal_core_glow (Radiant magic halo behind the floating crystal core)
    {
        "name": "crystal_core_glow",
        "bone": "core",
        "zIndex": 3,
        "svg": """
        <g>
          <circle cx="400" cy="334" r="44" fill="#2dd4bf" fill-opacity="0.38"/>
          <circle cx="400" cy="334" r="30" fill="#fef08a" fill-opacity="0.55"/>
          <!-- Orbiting magic rune ring -->
          <ellipse cx="400" cy="334" rx="38" ry="13" transform="rotate(-16 400 334)"
                   fill="none" stroke="#fef08a" stroke-width="2.2" stroke-dasharray="8 5"/>
          <ellipse cx="400" cy="334" rx="38" ry="13" transform="rotate(24 400 334)"
                   fill="none" stroke="#f472b6" stroke-width="1.8" stroke-dasharray="6 6"/>
        </g>
        """,
    },
    # 4. crystal_core (Faceted rose-pink & golden-amber enchanted crystal core suspended inside the slime)
    {
        "name": "crystal_core",
        "bone": "core",
        "zIndex": 4,
        "svg": """
        <g>
          <!-- Outer octahedron crystal silhouette -->
          <polygon points="400,298 424,326 416,356 400,368 384,356 376,326"
                   fill="#f43f5e" stroke="#881337" stroke-width="2.2" stroke-linejoin="round"/>
          <!-- Left lit crystal facet -->
          <polygon points="400,298 400,334 376,326" fill="#fda4af"/>
          <!-- Right bright crystal facet -->
          <polygon points="400,298 424,326 400,334" fill="#fb7185"/>
          <!-- Lower-left mid facet -->
          <polygon points="376,326 400,334 384,356" fill="#e11d48"/>
          <!-- Lower-right shadow facet -->
          <polygon points="424,326 416,356 400,334" fill="#be123c"/>
          <!-- Bottom tip facet -->
          <polygon points="384,356 400,334 416,356 400,368" fill="#9f1239"/>
          <!-- Central diamond starlight core -->
          <polygon points="400,312 411,332 400,350 389,332" fill="#fef08a"/>
          <polygon points="400,318 406,332 400,344 394,332" fill="#ffffff"/>
          <!-- Floating mini crystal shards -->
          <polygon points="366,318 372,323 367,330 362,324" fill="#fde047" stroke="#854d0e" stroke-width="1.2"/>
          <polygon points="433,336 439,341 434,348 429,342" fill="#fde047" stroke="#854d0e" stroke-width="1.2"/>
        </g>
        """,
    },
    # 5. slime_body (Main translucent aqua-emerald jelly body - bound to 6x6 weighted soft-body mesh!)
    {
        "name": "slime_body",
        "bone": "body_base",
        "zIndex": 5,
        "svg": """
        <g>
          <!-- Outer plump water-droplet jelly silhouette with soft flat-bottom contact curve -->
          <path d="M 400,244
                   C 468,244 518,292 524,354
                   C 528,394 502,410 400,410
                   C 298,410 272,394 276,354
                   C 282,292 332,244 400,244 Z"
                fill="#06b6d4" fill-opacity="0.72" stroke="#083344" stroke-width="3.8" stroke-linejoin="round"/>
          <!-- Mid-layer turquoise-mint subsurface scattering dome -->
          <path d="M 400,254
                   C 460,254 506,296 510,352
                   C 513,386 488,401 400,401
                   C 312,401 287,386 290,352
                   C 294,296 340,254 400,254 Z"
                fill="#2dd4bf" fill-opacity="0.52"/>
          <!-- Upper luminous aquamarine crown glow -->
          <path d="M 400,256
                   C 448,256 486,286 492,326
                   C 464,308 336,308 308,326
                   C 314,286 352,256 400,256 Z"
                fill="#99f6e4" fill-opacity="0.48"/>
          <!-- Bottom crescent shadow & thick gel rim -->
          <path d="M 278,362
                   C 286,396 322,408 400,408
                   C 478,408 514,396 522,362
                   C 508,390 468,398 400,398
                   C 332,398 292,390 278,362 Z"
                fill="#0369a1" fill-opacity="0.68"/>
        </g>
        """,
    },
    # 6. slime_belly_caustic (Internal bottom floor reflection & luminous caustic ring)
    {
        "name": "slime_belly_caustic",
        "bone": "body_base",
        "zIndex": 6,
        "svg": """
        <g>
          <ellipse cx="400" cy="390" rx="78" ry="12" fill="#5eead4" fill-opacity="0.42"/>
          <ellipse cx="400" cy="392" rx="52" ry="7" fill="#ccfbf1" fill-opacity="0.58"/>
        </g>
        """,
    },
    # 7. bubbles_front (Foreground glossy floating bubbles & sparkles)
    {
        "name": "bubbles_front",
        "bone": "bubbles_front",
        "zIndex": 7,
        "svg": """
        <g>
          <circle cx="464" cy="322" r="11.5" fill="#bae6fd" fill-opacity="0.62" stroke="#ffffff" stroke-width="1.8"/>
          <circle cx="460" cy="318" r="3.8" fill="#ffffff" fill-opacity="0.95"/>
          <circle cx="446" cy="292" r="7.0" fill="#bae6fd" fill-opacity="0.58" stroke="#ffffff" stroke-width="1.4"/>
          <circle cx="444" cy="290" r="2.4" fill="#ffffff" fill-opacity="0.90"/>
          <circle cx="478" cy="356" r="6.0" fill="#7dd3fc" fill-opacity="0.65" stroke="#e0f2fe" stroke-width="1.2"/>
          <circle cx="432" cy="374" r="4.5" fill="#e0f2fe" fill-opacity="0.75"/>
          <!-- Sparkle star -->
          <path d="M 454,344 L 456,350 L 462,352 L 456,354 L 454,360 L 452,354 L 446,352 L 452,350 Z"
                fill="#ffffff" fill-opacity="0.92"/>
        </g>
        """,
    },
    # 8. blush_cheeks (Cute translucent coral-pink cheek blushes)
    {
        "name": "blush_cheeks",
        "bone": "face",
        "zIndex": 8,
        "svg": """
        <g>
          <ellipse cx="344" cy="348" rx="16" ry="8.5" transform="rotate(-6 344 348)" fill="#fb7185" fill-opacity="0.62"/>
          <line x1="338" y1="346" x2="341" y2="351" stroke="#ffe4e6" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="346" y1="345" x2="349" y2="350" stroke="#ffe4e6" stroke-width="1.8" stroke-linecap="round"/>

          <ellipse cx="456" cy="348" rx="16" ry="8.5" transform="rotate(6 456 348)" fill="#fb7185" fill-opacity="0.62"/>
          <line x1="451" y1="345" x2="454" y2="350" stroke="#ffe4e6" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="459" y1="346" x2="462" y2="351" stroke="#ffe4e6" stroke-width="1.8" stroke-linecap="round"/>
        </g>
        """,
    },
    # 9. eyes_normal (Default glossy anime eyes with golden-amber lower iris & twin starlight catchlights)
    {
        "name": "eyes_normal",
        "bone": "eyes",
        "zIndex": 9,
        "svg": """
        <g>
          <!-- Left Eye -->
          <ellipse cx="364" cy="332" rx="13.5" ry="16.5" fill="#0f172a" stroke="#082f49" stroke-width="2.2"/>
          <ellipse cx="364" cy="335" rx="10.5" ry="12.0" fill="#1e3a8a"/>
          <path d="M 354,336 C 356,346 372,346 374,336 C 370,340 358,340 354,336 Z" fill="#38bdf8"/>
          <circle cx="359" cy="325" r="5.2" fill="#ffffff"/>
          <circle cx="369" cy="339" r="2.6" fill="#ffffff"/>
          <circle cx="364" cy="333" r="1.8" fill="#fef08a"/>

          <!-- Right Eye -->
          <ellipse cx="436" cy="332" rx="13.5" ry="16.5" fill="#0f172a" stroke="#082f49" stroke-width="2.2"/>
          <ellipse cx="436" cy="335" rx="10.5" ry="12.0" fill="#1e3a8a"/>
          <path d="M 426,336 C 428,346 444,346 446,336 C 442,340 430,340 426,336 Z" fill="#38bdf8"/>
          <circle cx="431" cy="325" r="5.2" fill="#ffffff"/>
          <circle cx="441" cy="339" r="2.6" fill="#ffffff"/>
          <circle cx="436" cy="333" r="1.8" fill="#fef08a"/>
        </g>
        """,
    },
    # 10. eyes_blink (Happy curved closed-eye arcs for blinking & joyful hops)
    {
        "name": "eyes_blink",
        "bone": "eyes",
        "zIndex": 10,
        "svg": """
        <g>
          <path d="M 350,334 Q 364,320 378,334" fill="none" stroke="#0f172a" stroke-width="4.2" stroke-linecap="round"/>
          <path d="M 352,332 Q 364,322 376,332" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round"/>

          <path d="M 422,334 Q 436,320 450,334" fill="none" stroke="#0f172a" stroke-width="4.2" stroke-linecap="round"/>
          <path d="M 424,332 Q 436,322 448,332" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round"/>
        </g>
        """,
    },
    # 11. eyes_hurt (Squeezed '> <' wince eyes with tiny tear droplets at corners for `hit`)
    {
        "name": "eyes_hurt",
        "bone": "eyes",
        "zIndex": 11,
        "svg": """
        <g>
          <!-- Left '>' eye -->
          <path d="M 350,322 L 376,333 L 350,344" fill="none" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Tear droplet on left corner -->
          <path d="M 346,342 C 340,346 340,353 345,354 C 350,354 350,347 346,342 Z" fill="#7dd3fc" stroke="#0284c7" stroke-width="1.4"/>

          <!-- Right '<' eye -->
          <path d="M 450,322 L 424,333 L 450,344" fill="none" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Tear droplet on right corner -->
          <path d="M 454,342 C 460,346 460,353 455,354 C 450,354 450,347 454,342 Z" fill="#7dd3fc" stroke="#0284c7" stroke-width="1.4"/>
        </g>
        """,
    },
    # 12. eyes_dizzy (Knocked-out 'X X' eyes for `die`)
    {
        "name": "eyes_dizzy",
        "bone": "eyes",
        "zIndex": 12,
        "svg": """
        <g>
          <!-- Left 'X' eye -->
          <line x1="352" y1="321" x2="376" y2="345" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="376" y1="321" x2="352" y2="345" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round"/>
          <!-- Right 'X' eye -->
          <line x1="424" y1="321" x2="448" y2="345" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="448" y1="321" x2="424" y2="345" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round"/>
        </g>
        """,
    },
    # 13. mouth_smile (Cute 'w' slime mouth for idle & hop)
    {
        "name": "mouth_smile",
        "bone": "mouth",
        "zIndex": 13,
        "svg": """
        <g>
          <path d="M 384,354 Q 392,363 400,355 Q 408,363 416,354"
                fill="none" stroke="#0f172a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        """,
    },
    # 14. mouth_wail (Open shocked / wailing mouth for hit, die & high-speed run)
    {
        "name": "mouth_wail",
        "bone": "mouth",
        "zIndex": 14,
        "svg": """
        <g>
          <path d="M 385,350 Q 400,342 415,350 Q 420,368 400,368 Q 380,368 385,350 Z"
                fill="#be123c" stroke="#0f172a" stroke-width="3.0" stroke-linejoin="round"/>
          <!-- Cute pink tongue inside mouth -->
          <path d="M 390,362 Q 400,354 410,362 Q 406,367 400,367 Q 394,367 390,362 Z" fill="#fda4af"/>
        </g>
        """,
    },
    # 15. slime_specular (Glossy curved glass-dome specular highlights on the upper surface)
    {
        "name": "slime_specular",
        "bone": "body_top",
        "zIndex": 15,
        "svg": """
        <g>
          <!-- Large left-top curved glass window highlight -->
          <path d="M 312,306
                   C 324,276 356,258 388,256
                   C 394,256 396,265 388,267
                   C 360,271 334,286 322,312
                   C 318,318 309,314 312,306 Z"
                fill="#ffffff" fill-opacity="0.88"/>
          <!-- Secondary oval specular dot -->
          <ellipse cx="306" cy="326" rx="5.5" ry="9.0" transform="rotate(18 306 326)" fill="#ffffff" fill-opacity="0.82"/>
          <!-- Right rim counter-highlight -->
          <path d="M 468,274
                   C 488,290 502,314 506,340
                   C 507,346 500,348 498,342
                   C 493,318 480,296 463,281
                   C 459,277 464,271 468,274 Z"
                fill="#e0f2fe" fill-opacity="0.72"/>
        </g>
        """,
    },
    # 16. crest_antenna (Wobbling jelly droplet antenna + miniature royal golden slime crown)
    {
        "name": "crest_antenna",
        "bone": "crest_drop",
        "zIndex": 16,
        "svg": """
        <g>
          <!-- Translucent jelly stalk & droplet bulb rising from the dome apex -->
          <path d="M 390,250
                   C 392,232 384,212 396,198
                   C 404,188 418,192 418,204
                   C 418,216 406,222 408,250 Z"
                fill="#2dd4bf" fill-opacity="0.88" stroke="#083344" stroke-width="3.0" stroke-linejoin="round"/>
          <circle cx="404" cy="202" r="4.0" fill="#ffffff" fill-opacity="0.90"/>

          <!-- Miniature Royal Golden Crown tilted jauntily around the jelly antenna base -->
          <g transform="rotate(8 404 240)">
            <path d="M 374,244 L 368,216 L 388,228 L 404,208 L 420,228 L 440,216 L 434,244 Z"
                  fill="#facc15" stroke="#451a03" stroke-width="2.6" stroke-linejoin="round"/>
            <!-- Crown inner shadow & gold base band -->
            <path d="M 374,238 L 434,238 L 432,246 C 414,250 394,250 376,246 Z"
                  fill="#eab308" stroke="#451a03" stroke-width="2.2"/>
            <!-- Center ruby & side sapphire jewels -->
            <polygon points="404,224 410,231 404,238 398,231" fill="#f43f5e" stroke="#881337" stroke-width="1.2"/>
            <circle cx="384" cy="233" r="3.2" fill="#38bdf8" stroke="#0c4a6e" stroke-width="1.0"/>
            <circle cx="424" cy="233" r="3.2" fill="#38bdf8" stroke="#0c4a6e" stroke-width="1.0"/>
            <!-- Pearl tips on crown spikes -->
            <circle cx="368" cy="215" r="3.5" fill="#fef08a" stroke="#451a03" stroke-width="1.4"/>
            <circle cx="404" cy="207" r="4.2" fill="#ffffff" stroke="#451a03" stroke-width="1.4"/>
            <circle cx="440" cy="215" r="3.5" fill="#fef08a" stroke="#451a03" stroke-width="1.4"/>
          </g>
        </g>
        """,
    },
    # 17. splash_droplets_fx (Dynamic flying jelly droplets & impact burst ring for hop_run, hit & die)
    {
        "name": "splash_droplets_fx",
        "bone": "fx_splash",
        "zIndex": 17,
        "svg": """
        <g>
          <!-- Left-top flying droplet -->
          <path d="M 258,282 C 236,268 222,276 228,292 C 234,304 250,296 258,282 Z"
                fill="#2dd4bf" stroke="#083344" stroke-width="2.2"/>
          <circle cx="234" cy="282" r="2.8" fill="#ffffff"/>

          <!-- Left-mid flying droplet -->
          <path d="M 242,344 C 216,340 208,352 218,364 C 228,372 238,358 242,344 Z"
                fill="#38bdf8" stroke="#083344" stroke-width="2.2"/>
          <circle cx="222" cy="352" r="2.4" fill="#ffffff"/>

          <!-- Right-top flying droplet -->
          <path d="M 542,278 C 564,264 578,272 572,288 C 566,300 550,292 542,278 Z"
                fill="#2dd4bf" stroke="#083344" stroke-width="2.2"/>
          <circle cx="566" cy="278" r="2.8" fill="#ffffff"/>

          <!-- Right-mid flying droplet -->
          <path d="M 558,342 C 584,338 592,350 582,362 C 572,370 562,356 558,342 Z"
                fill="#38bdf8" stroke="#083344" stroke-width="2.2"/>
          <circle cx="578" cy="350" r="2.4" fill="#ffffff"/>

          <!-- Upper-left & upper-right mini beads -->
          <circle cx="276" cy="242" r="7.5" fill="#5eead4" stroke="#083344" stroke-width="2.0"/>
          <circle cx="274" cy="240" r="2.4" fill="#ffffff"/>
          <circle cx="524" cy="240" r="7.5" fill="#5eead4" stroke="#083344" stroke-width="2.0"/>
          <circle cx="522" cy="238" r="2.4" fill="#ffffff"/>

          <!-- Starburst impact sparkles -->
          <path d="M 255,314 L 259,322 L 267,326 L 259,330 L 255,338 L 251,330 L 243,326 L 251,322 Z" fill="#fef08a"/>
          <path d="M 545,312 L 549,320 L 557,324 L 549,328 L 545,336 L 541,328 L 533,324 L 541,320 Z" fill="#fef08a"/>
        </g>
        """,
    },
]


def render_svg_to_pil(svg_body: str, layer_name: str = "") -> Image.Image:
    full_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" viewBox="0 0 {CANVAS_W} {CANVAS_H}">{svg_body}</svg>'
    doc = pymupdf.open(stream=full_svg.encode("utf-8"), filetype="svg")
    page = doc[0]
    pix = page.get_pixmap(alpha=True, dpi=72)
    # Crucial: PyMuPDF get_pixmap(alpha=True) outputs premultiplied RGB!
    # Unpremultiply RGB so PIL & BoneStudio straight-alpha compositing stays vibrant & never darkens semi-transparent gel!
    raw = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 4).astype(np.float32)
    alpha = raw[..., 3:4]
    raw[..., :3] = np.where(alpha > 0, np.clip(raw[..., :3] * 255.0 / np.maximum(alpha, 1.0), 0.0, 255.0), 0.0)
    im = Image.fromarray(raw.astype(np.uint8), mode="RGBA")

    if layer_name in ("crystal_core_glow", "crystal_core", "splash_droplets_fx"):
        # Pure alpha-channel multi-scale optical bloom (zero dark RGBA halo!)
        a_chan = im.split()[3]
        a_wide = a_chan.filter(ImageFilter.GaussianBlur(radius=10.0)).point(lambda p: min(255, int(p * 0.55)))
        a_mid = a_chan.filter(ImageFilter.GaussianBlur(radius=4.0)).point(lambda p: min(255, int(p * 0.85)))

        wide_rgb = (244, 114, 182, 0) if "core" in layer_name else (45, 212, 191, 0)
        mid_rgb = (254, 240, 138, 0) if "core" in layer_name else (186, 230, 253, 0)

        glow_wide = Image.new("RGBA", im.size, wide_rgb)
        glow_wide.putalpha(a_wide)
        glow_mid = Image.new("RGBA", im.size, mid_rgb)
        glow_mid.putalpha(a_mid)

        out = Image.alpha_composite(glow_wide, glow_mid)
        out = Image.alpha_composite(out, im)
        return out

    elif layer_name == "slime_body":
        # Subsurface Scattering (SSS) radial + vertical translucent jelly shader!
        arr = np.array(im, dtype=np.float32)
        bbox = im.getbbox()
        if bbox:
            x0, y0, x1, y1 = bbox
            cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.50
            rx, ry = max(1.0, (x1 - x0) * 0.5), max(1.0, (y1 - y0) * 0.5)
            yy, xx = np.mgrid[0 : im.height, 0 : im.width]
            dist = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
            # Inner core of the slime is brighter & more translucent so the crystal core shines through!
            sss = np.clip(1.18 - 0.25 * (dist ** 1.4), 0.85, 1.20)
            lum = np.mean(arr[..., :3], axis=-1)
            is_fill = (lum > 45.0).astype(np.float32)
            factor = 1.0 + (sss - 1.0) * is_fill
            arr[..., 0] = np.clip(arr[..., 0] * factor, 0.0, 255.0)
            arr[..., 1] = np.clip(arr[..., 1] * (factor * 1.04), 0.0, 255.0)
            arr[..., 2] = np.clip(arr[..., 2] * (factor * 1.02), 0.0, 255.0)
            # Fresnel translucency: crystal-clear in the center (0.28x alpha) so the rose-gold core shines vividly,
            # and rich aqua-emerald near the outer rim (0.98x alpha)
            fresnel = np.clip(0.28 + 0.70 * np.clip(dist, 0.0, 1.0) ** 1.85, 0.28, 0.98)
            arr[..., 3] = np.where(is_fill > 0.5, np.clip(arr[..., 3] * fresnel, 0.0, 255.0), arr[..., 3])
            return Image.fromarray(arr.astype(np.uint8), mode="RGBA")

    return im


def main():
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    manifest_layers = []
    setup_preview = Image.new("RGBA", (CANVAS_W, CANVAS_H), (18, 24, 38, 255))
    hit_preview = Image.new("RGBA", (CANVAS_W, CANVAS_H), (18, 24, 38, 255))

    default_hidden = {"eyes_blink", "eyes_hurt", "eyes_dizzy", "mouth_wail", "splash_droplets_fx"}
    hit_visible = {"ground_shadow", "slime_back_rim", "bubbles_back", "crystal_core_glow", "crystal_core",
                   "slime_body", "slime_belly_caustic", "bubbles_front", "blush_cheeks",
                   "eyes_hurt", "mouth_wail", "slime_specular", "crest_antenna", "splash_droplets_fx"}

    for item in sorted(LAYERS, key=lambda x: x["zIndex"]):
        name = item["name"]
        im_full = render_svg_to_pil(item["svg"], name)
        bbox = im_full.getbbox()
        if not bbox:
            raise RuntimeError(f"Empty SVG layer: {name}")

        pad = 10
        x0 = max(0, bbox[0] - pad)
        y0 = max(0, bbox[1] - pad)
        x1 = min(CANVAS_W, bbox[2] + pad)
        y1 = min(CANVAS_H, bbox[3] + pad)
        w, h = x1 - x0, y1 - y0

        cropped = im_full.crop((x0, y0, x1, y1))
        cropped.save(PNG_DIR / f"{name}.png")

        cropped_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{x0} {y0} {w} {h}">{item["svg"]}</svg>'
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
                "defaultHidden": name in default_hidden,
                "file": str((PNG_DIR / f"{name}.png").resolve()),
            }
        )

        if name not in default_hidden:
            setup_preview.alpha_composite(im_full)
        if name in hit_visible:
            hit_preview.alpha_composite(im_full)

    manifest = {
        "canvasWidth": CANVAS_W,
        "canvasHeight": CANVAS_H,
        "joints": {k: list(v) for k, v in J.items()},
        "layers": manifest_layers,
    }
    (BASE_DIR / "layers_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    setup_preview.save(BASE_DIR / "slime_setup_preview.png")
    hit_preview.save(BASE_DIR / "slime_hit_preview.png")
    print(f"Generated {len(manifest_layers)} Slime SVG & PNG parts in {BASE_DIR}")


if __name__ == "__main__":
    main()
