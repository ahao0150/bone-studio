import os
import json
import math
import pymupdf
from PIL import Image

BASE_DIR = r"C:\Users\Administrator\.gemini\antigravity\scratch\pelican-bicycle"
SVG_DIR = os.path.join(BASE_DIR, "svg")
PNG_DIR = os.path.join(BASE_DIR, "png")
os.makedirs(SVG_DIR, exist_ok=True)
os.makedirs(PNG_DIR, exist_ok=True)

CANVAS_W = 800
CANVAS_H = 700
ORIGIN_X = 400.0
ORIGIN_Y = 700.0  # matches layers_add origin (canvasWidth/2, canvasHeight)

def solve_2bone_ik(hx, hy, tx, ty, L1, L2, bend_right=True):
    dx = tx - hx
    dy = ty - hy
    d = math.hypot(dx, dy)
    d_clamped = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, d))
    base_angle = math.atan2(dy, dx)
    cos_a = (L1 * L1 + d_clamped * d_clamped - L2 * L2) / (2.0 * L1 * d_clamped)
    cos_a = max(-1.0, min(1.0, cos_a))
    a = math.acos(cos_a)
    theta1 = base_angle - a if bend_right else base_angle + a
    kx = hx + L1 * math.cos(theta1)
    ky = hy + L1 * math.sin(theta1)
    theta2 = math.atan2(ty - ky, tx - kx)
    return (kx, ky), theta1, theta2

# --- Key Joint Positions on 800x700 Canvas (Frame 0 / Setup Pose) ---
REAR_HUB = (245.0, 520.0)
FRONT_HUB = (555.0, 520.0)
CRANK_CENTER = (385.0, 520.0)
SADDLE_TOP = (330.0, 365.0)
HEAD_TUBE_TOP = (500.0, 365.0)
HANDLEBAR_GRIP_R = (472.0, 332.0)
HANDLEBAR_GRIP_L = (480.0, 324.0)
BASKET_FISH_PIVOT = (544.0, 345.0)

# Pedals at Frame 0: crank angle = 30 deg clockwise from +x
CRANK_R = 42.0
THETA0 = math.radians(30.0)
PEDAL_R = (
    CRANK_CENTER[0] + CRANK_R * math.cos(THETA0),
    CRANK_CENTER[1] + CRANK_R * math.sin(THETA0),
)
PEDAL_L = (
    CRANK_CENTER[0] - CRANK_R * math.cos(THETA0),
    CRANK_CENTER[1] - CRANK_R * math.sin(THETA0),
)

HIP_JOINT = (330.0, 365.0)
TAIL_JOINT = (288.0, 362.0)
THIGH_HIP = (336.0, 372.0)
L_THIGH = 102.0
L_SHIN = 100.0
ANKLE_OFFSET_Y = -6.0

FOOT_R_JOINT = (PEDAL_R[0], PEDAL_R[1] + ANKLE_OFFSET_Y)
FOOT_L_JOINT = (PEDAL_L[0], PEDAL_L[1] + ANKLE_OFFSET_Y)
KNEE_R, THIGH_R_RAD0, SHIN_R_RAD0 = solve_2bone_ik(
    THIGH_HIP[0], THIGH_HIP[1], FOOT_R_JOINT[0], FOOT_R_JOINT[1], L_THIGH, L_SHIN, bend_right=True
)
KNEE_L, THIGH_L_RAD0, SHIN_L_RAD0 = solve_2bone_ik(
    THIGH_HIP[0], THIGH_HIP[1], FOOT_L_JOINT[0], FOOT_L_JOINT[1], L_THIGH, L_SHIN, bend_right=True
)

TORSO_JOINT = (330.0, 365.0)
NECK_JOINT = (376.0, 265.0)
SCARF_JOINT = (368.0, 268.0)
HEAD_JOINT = (392.0, 185.0)
POUCH_JOINT = (412.0, 192.0)

SHOULDER_R = (362.0, 282.0)
SHOULDER_L = (374.0, 276.0)
L_WING_UPPER = 66.0
L_WING_FORE = 68.0
ELBOW_R, WING_R_RAD0, FOREWING_R_RAD0 = solve_2bone_ik(
    SHOULDER_R[0], SHOULDER_R[1], HANDLEBAR_GRIP_R[0], HANDLEBAR_GRIP_R[1], L_WING_UPPER, L_WING_FORE, bend_right=False
)
ELBOW_L, WING_L_RAD0, FOREWING_L_RAD0 = solve_2bone_ik(
    SHOULDER_L[0], SHOULDER_L[1], HANDLEBAR_GRIP_L[0], HANDLEBAR_GRIP_L[1], L_WING_UPPER, L_WING_FORE, bend_right=False
)

def wheel_svg_content(cx, cy, r=92):
    spokes = []
    for i in range(12):
        ang = math.radians(i * 30)
        x1 = cx + 12 * math.cos(ang)
        y1 = cy + 12 * math.sin(ang)
        x2 = cx + (r - 14) * math.cos(ang)
        y2 = cy + (r - 14) * math.sin(ang)
        spokes.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#B8C4D0" stroke-width="2.5" stroke-linecap="round"/>')
    ref1_x = cx + (r - 28) * math.cos(math.radians(45))
    ref1_y = cy + (r - 28) * math.sin(math.radians(45))
    ref2_x = cx + (r - 28) * math.cos(math.radians(225))
    ref2_y = cy + (r - 28) * math.sin(math.radians(225))
    return f"""
    <g>
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#22272E" stroke-width="13"/>
      <circle cx="{cx}" cy="{cy}" r="{r - 7.5}" fill="none" stroke="#F4E8C1" stroke-width="4.5"/>
      <circle cx="{cx}" cy="{cy}" r="{r - 12}" fill="none" stroke="#8FA1B3" stroke-width="4"/>
      {''.join(spokes)}
      <circle cx="{ref1_x:.2f}" cy="{ref1_y:.2f}" r="6.5" fill="#FF9F1C" stroke="#FFF" stroke-width="1.5"/>
      <circle cx="{ref2_x:.2f}" cy="{ref2_y:.2f}" r="6.5" fill="#2EC4B6" stroke="#FFF" stroke-width="1.5"/>
      <circle cx="{cx}" cy="{cy}" r="14" fill="#4A5568" stroke="#1A202C" stroke-width="3"/>
      <circle cx="{cx}" cy="{cy}" r="6" fill="#E2E8F0"/>
    </g>
    """

def limb_capsule_svg(x1, y1, x2, y2, w1, w2, fill, stroke="#2B2D42", sw=3.5):
    dx, dy = x2 - x1, y2 - y1
    ang = math.degrees(math.atan2(dy, dx))
    length = math.hypot(dx, dy)
    return f"""
    <g transform="translate({x1:.2f},{y1:.2f}) rotate({ang:.2f})">
      <path d="M 0,{-w1:.2f} C {length*0.4:.2f},{-w1*1.05:.2f} {length*0.7:.2f},{-w2:.2f} {length:.2f},{-w2:.2f}
               A {w2:.2f},{w2:.2f} 0 0 1 {length:.2f},{w2:.2f}
               C {length*0.7:.2f},{w2:.2f} {length*0.4:.2f},{w1*1.05:.2f} 0,{w1:.2f}
               A {w1:.2f},{w1:.2f} 0 0 1 0,{-w1:.2f} Z"
            fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>
    </g>
    """

def thigh_drumstick_svg(x1, y1, x2, y2, drum_fill, leg_fill, leg_stroke, drum_stroke="#334155"):
    dx, dy = x2 - x1, y2 - y1
    ang = math.degrees(math.atan2(dy, dx))
    L = math.hypot(dx, dy)
    return f"""
    <g transform="translate({x1:.2f},{y1:.2f}) rotate({ang:.2f})">
      <!-- Lower orange leg stem out to knee -->
      <path d="M {L*0.48:.2f},-8.5 L {L:.2f},-7.5 A 7.5,7.5 0 0 1 {L:.2f},7.5 L {L*0.48:.2f},8.5 Z"
            fill="{leg_fill}" stroke="{leg_stroke}" stroke-width="3.2" stroke-linejoin="round"/>
      <!-- Fluffy feathered drumstick overlapping upper half -->
      <path d="M 0,-21 C {L*0.28:.2f},-22 {L*0.52:.2f},-17 {L*0.64:.2f},-12
               Q {L*0.70:.2f},-6 {L*0.64:.2f},0
               Q {L*0.70:.2f},6 {L*0.64:.2f},12
               C {L*0.52:.2f},17 {L*0.28:.2f},22 0,21
               A 21,21 0 0 1 0,-21 Z"
            fill="{drum_fill}" stroke="{drum_stroke}" stroke-width="3.6" stroke-linejoin="round"/>
    </g>
    """

parts = [
    {
        "name": "wing_l",
        "bone": "wing_l",
        "svg": limb_capsule_svg(SHOULDER_L[0], SHOULDER_L[1], ELBOW_L[0], ELBOW_L[1], 21, 15, "#CBD5E1", "#334155", 3.5)
    },
    {
        "name": "forewing_l",
        "bone": "forewing_l",
        "svg": limb_capsule_svg(ELBOW_L[0], ELBOW_L[1], HANDLEBAR_GRIP_L[0], HANDLEBAR_GRIP_L[1], 14, 10, "#CBD5E1", "#334155", 3.5)
    },
    {
        "name": "thigh_l",
        "bone": "thigh_l",
        "svg": thigh_drumstick_svg(THIGH_HIP[0], THIGH_HIP[1], KNEE_L[0], KNEE_L[1], "#CBD5E1", "#E07A2E", "#5C2D0C")
    },
    {
        "name": "shin_l",
        "bone": "shin_l",
        "svg": limb_capsule_svg(KNEE_L[0], KNEE_L[1], FOOT_L_JOINT[0], FOOT_L_JOINT[1], 7.5, 6.5, "#E07A2E", "#5C2D0C", 3.2)
    },
    {
        "name": "foot_l",
        "bone": "foot_l",
        "svg": f"""
        <g transform="translate({FOOT_L_JOINT[0]:.2f},{FOOT_L_JOINT[1]:.2f})">
          <path d="M -8,-4 C 5,-6 24,-2 30,5 C 24,10 12,11 -12,9 C -16,7 -14,-2 -8,-4 Z"
                fill="#E07A2E" stroke="#5C2D0C" stroke-width="3" stroke-linejoin="round"/>
          <path d="M 8,0 L 26,4 M 6,4 L 22,8" stroke="#5C2D0C" stroke-width="2" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "pedal_l",
        "bone": "pedal_l",
        "svg": f"""
        <g transform="translate({PEDAL_L[0]:.2f},{PEDAL_L[1]:.2f})">
          <rect x="-20" y="-6" width="40" height="12" rx="4" fill="#334155" stroke="#0F172A" stroke-width="2.5"/>
          <rect x="-12" y="-3" width="24" height="6" rx="2" fill="#F59E0B"/>
          <circle cx="0" cy="0" r="4" fill="#94A3B8"/>
        </g>
        """
    },
    {
        "name": "wheel_back",
        "bone": "wheel_back",
        "svg": wheel_svg_content(REAR_HUB[0], REAR_HUB[1], 92)
    },
    {
        "name": "wheel_front",
        "bone": "wheel_front",
        "svg": wheel_svg_content(FRONT_HUB[0], FRONT_HUB[1], 92)
    },
    {
        "name": "basket_fish",
        "bone": "basket_fish",
        "svg": f"""
        <g transform="translate({BASKET_FISH_PIVOT[0]:.2f},{BASKET_FISH_PIVOT[1]:.2f}) rotate(-22)">
          <path d="M 0,15 C -14,0 -12,-20 2,-28 C 14,-20 16,0 4,15 Z" fill="#38BDF8" stroke="#0369A1" stroke-width="3"/>
          <path d="M 2,-28 L -10,-40 L 0,-35 L 12,-40 Z" fill="#0284C7" stroke="#0369A1" stroke-width="2.5" stroke-linejoin="round"/>
          <circle cx="0" cy="-12" r="3" fill="#FFF"/>
          <circle cx="1" cy="-12" r="1.5" fill="#0F172A"/>
          <path d="M -5,-2 Q 2,2 8,-2" fill="none" stroke="#BAE6FD" stroke-width="2" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "bike_frame",
        "bone": "bike_frame",
        "svg": f"""
        <g>
          <!-- Rear fender / mudguard -->
          <path d="M 148,505 A 98,98 0 0 1 332,475" fill="none" stroke="#E63946" stroke-width="9" stroke-linecap="round"/>
          <path d="M 148,505 A 98,98 0 0 1 332,475" fill="none" stroke="#FFF" stroke-width="2" stroke-linecap="round"/>
          <!-- Front fender / mudguard -->
          <path d="M 472,468 A 98,98 0 0 1 638,472" fill="none" stroke="#E63946" stroke-width="9" stroke-linecap="round"/>
          <!-- Drive chain between rear hub (245,520) and crank (385,520) -->
          <path d="M 245,508 L 385,496 L 385,544 L 245,532 A 12,12 0 0 1 245,508 Z"
                fill="none" stroke="#475569" stroke-width="4" stroke-dasharray="6,4"/>
          <!-- Chainstay & Seatstay -->
          <line x1="245" y1="520" x2="385" y2="520" stroke="#E63946" stroke-width="9" stroke-linecap="round"/>
          <line x1="245" y1="520" x2="342" y2="395" stroke="#E63946" stroke-width="8" stroke-linecap="round"/>
          <!-- Seat tube -->
          <line x1="385" y1="520" x2="335" y2="380" stroke="#CBD5E1" stroke-width="8" stroke-linecap="round"/>
          <line x1="385" y1="520" x2="342" y2="395" stroke="#E63946" stroke-width="11" stroke-linecap="round"/>
          <!-- Down tube & Curved cruiser top tube -->
          <path d="M 385,520 C 430,475 470,425 498,382" fill="none" stroke="#E63946" stroke-width="11" stroke-linecap="round"/>
          <path d="M 342,395 C 395,395 445,382 496,370" fill="none" stroke="#E63946" stroke-width="10" stroke-linecap="round"/>
          <!-- Front fork & Head tube -->
          <line x1="494" y1="362" x2="504" y2="395" stroke="#E63946" stroke-width="13" stroke-linecap="round"/>
          <path d="M 500,388 Q 528,455 555,520" fill="none" stroke="#E63946" stroke-width="10" stroke-linecap="round"/>
          <circle cx="245" cy="520" r="8" fill="#E2E8F0" stroke="#1E293B" stroke-width="2.5"/>
          <circle cx="555" cy="520" r="8" fill="#E2E8F0" stroke="#1E293B" stroke-width="2.5"/>
          <!-- Vintage leather saddle -->
          <path d="M 295,368 C 295,352 325,354 365,362 C 372,364 370,374 356,376 C 335,378 300,380 295,368 Z"
                fill="#7C2D12" stroke="#271206" stroke-width="3.5" stroke-linejoin="round"/>
          <circle cx="310" cy="370" r="2.5" fill="#FBBF24"/>
          <circle cx="322" cy="371" r="2.5" fill="#FBBF24"/>
        </g>
        """
    },
    {
        "name": "handlebar",
        "bone": "handlebar",
        "svg": f"""
        <g>
          <!-- Mounting straps connecting front basket to stem -->
          <line x1="496" y1="342" x2="514" y2="345" stroke="#64748B" stroke-width="5" stroke-linecap="round"/>
          <line x1="499" y1="365" x2="516" y2="372" stroke="#64748B" stroke-width="5" stroke-linecap="round"/>
          <!-- Chrome stem from head tube (500,365) up to (495,325) -->
          <path d="M 500,365 L 495,325 L 472,332" fill="none" stroke="#CBD5E1" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 500,365 L 495,325 L 472,332" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Brass bicycle bell -->
          <circle cx="488" cy="318" r="8" fill="#FBBF24" stroke="#78350F" stroke-width="2.5"/>
          <!-- Red handlebar grip -->
          <rect x="458" y="325" width="24" height="12" rx="6" transform="rotate(-12 470 331)" fill="#DC2626" stroke="#450A0A" stroke-width="2.5"/>
          <!-- Front wicker basket -->
          <path d="M 512,338 L 568,338 L 558,388 L 516,388 Z" fill="#D97706" stroke="#78350F" stroke-width="3.5" stroke-linejoin="round"/>
          <line x1="514" y1="354" x2="564" y2="354" stroke="#78350F" stroke-width="2.5"/>
          <line x1="515" y1="370" x2="561" y2="370" stroke="#78350F" stroke-width="2.5"/>
          <line x1="532" y1="338" x2="528" y2="388" stroke="#78350F" stroke-width="2.5"/>
          <line x1="548" y1="338" x2="544" y2="388" stroke="#78350F" stroke-width="2.5"/>
          <rect x="509" y="333" width="62" height="8" rx="4" fill="#F59E0B" stroke="#78350F" stroke-width="2.5"/>
        </g>
        """
    },
    {
        "name": "crank_gear",
        "bone": "crank_gear",
        "svg": f"""
        <g>
          <line x1="{CRANK_CENTER[0]}" y1="{CRANK_CENTER[1]}" x2="{PEDAL_L[0]:.2f}" y2="{PEDAL_L[1]:.2f}"
                stroke="#64748B" stroke-width="7" stroke-linecap="round"/>
          <circle cx="{CRANK_CENTER[0]}" cy="{CRANK_CENTER[1]}" r="26" fill="#E2E8F0" stroke="#334155" stroke-width="4" stroke-dasharray="5,3"/>
          <circle cx="{CRANK_CENTER[0]}" cy="{CRANK_CENTER[1]}" r="18" fill="none" stroke="#64748B" stroke-width="3"/>
          <line x1="{CRANK_CENTER[0]-18}" y1="{CRANK_CENTER[1]}" x2="{CRANK_CENTER[0]+18}" y2="{CRANK_CENTER[1]}" stroke="#475569" stroke-width="4"/>
          <line x1="{CRANK_CENTER[0]}" y1="{CRANK_CENTER[1]-18}" x2="{CRANK_CENTER[0]}" y2="{CRANK_CENTER[1]+18}" stroke="#475569" stroke-width="4"/>
          <line x1="{CRANK_CENTER[0]}" y1="{CRANK_CENTER[1]}" x2="{PEDAL_R[0]:.2f}" y2="{PEDAL_R[1]:.2f}"
                stroke="#94A3B8" stroke-width="8" stroke-linecap="round"/>
          <line x1="{CRANK_CENTER[0]}" y1="{CRANK_CENTER[1]}" x2="{PEDAL_R[0]:.2f}" y2="{PEDAL_R[1]:.2f}"
                stroke="#CBD5E1" stroke-width="4" stroke-linecap="round"/>
          <circle cx="{CRANK_CENTER[0]}" cy="{CRANK_CENTER[1]}" r="7" fill="#334155" stroke="#F8FAFC" stroke-width="2"/>
        </g>
        """
    },
    {
        "name": "tail",
        "bone": "tail",
        "svg": f"""
        <g transform="translate({TAIL_JOINT[0]:.2f},{TAIL_JOINT[1]:.2f})">
          <path d="M 8,4 C -15,12 -38,6 -52,-8 C -36,-12 -22,-8 -4,-4
                   C -24,-14 -40,-20 -46,-28 C -26,-26 -8,-18 10,-6 Z"
                fill="#F8FAFC" stroke="#334155" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M -42,-10 C -30,-8 -16,-4 -2,0" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "torso",
        "bone": "torso",
        "svg": f"""
        <g>
          <path d="M 290,348 C 282,308 312,258 358,252 C 392,248 412,276 408,314
                   C 404,352 372,380 332,378 C 304,376 294,366 290,348 Z"
                fill="#FFFFFF" stroke="#334155" stroke-width="4" stroke-linejoin="round"/>
          <path d="M 358,262 C 388,262 402,286 398,316 C 394,344 370,368 338,368
                   C 365,352 378,325 376,294 C 374,276 368,268 358,262 Z"
                fill="#FEF3C7"/>
          <path d="M 332,262 C 350,252 378,252 394,268 L 386,298 C 366,288 344,288 326,294 Z"
                fill="#1D4ED8" stroke="#1E3A8A" stroke-width="3" stroke-linejoin="round"/>
          <line x1="330" y1="278" x2="389" y2="282" stroke="#FDE047" stroke-width="3" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "thigh_r",
        "bone": "thigh_r",
        "svg": thigh_drumstick_svg(THIGH_HIP[0], THIGH_HIP[1], KNEE_R[0], KNEE_R[1], "#FFFFFF", "#F97316", "#7C2D12")
    },
    {
        "name": "shin_r",
        "bone": "shin_r",
        "svg": limb_capsule_svg(KNEE_R[0], KNEE_R[1], FOOT_R_JOINT[0], FOOT_R_JOINT[1], 8, 7, "#F97316", "#7C2D12", 3.2)
    },
    {
        "name": "pedal_r",
        "bone": "pedal_r",
        "svg": f"""
        <g transform="translate({PEDAL_R[0]:.2f},{PEDAL_R[1]:.2f})">
          <rect x="-21" y="-6" width="42" height="12" rx="4" fill="#1E293B" stroke="#0F172A" stroke-width="2.5"/>
          <rect x="-13" y="-3" width="26" height="6" rx="2" fill="#FBBF24"/>
          <circle cx="0" cy="0" r="4" fill="#CBD5E1"/>
        </g>
        """
    },
    {
        "name": "foot_r",
        "bone": "foot_r",
        "svg": f"""
        <g transform="translate({FOOT_R_JOINT[0]:.2f},{FOOT_R_JOINT[1]:.2f})">
          <path d="M -8,-4 C 6,-6 26,-2 33,5 C 26,11 12,12 -12,9 C -16,7 -14,-2 -8,-4 Z"
                fill="#F97316" stroke="#7C2D12" stroke-width="3.2" stroke-linejoin="round"/>
          <path d="M 8,0 L 28,4 M 6,4 L 24,8" stroke="#7C2D12" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "neck",
        "bone": "neck",
        "svg": f"""
        <g>
          <path d="M 362,268 C 356,238 366,205 378,182 L 404,186 C 396,212 390,240 392,268 Z"
                fill="#FFFFFF" stroke="#334155" stroke-width="3.8" stroke-linejoin="round"/>
          <path d="M 384,188 C 380,214 378,240 380,264" fill="none" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "scarf",
        "bone": "scarf",
        "svg": f"""
        <g>
          <path d="M 358,258 C 332,254 298,258 272,272 C 288,284 322,282 356,274 Z"
                fill="#EF4444" stroke="#7F1D1D" stroke-width="3.2" stroke-linejoin="round"/>
          <path d="M 352,265 C 330,266 308,274 288,288 C 308,290 334,284 358,274 Z"
                fill="#DC2626" stroke="#7F1D1D" stroke-width="3" stroke-linejoin="round"/>
          <rect x="352" y="255" width="34" height="18" rx="8" fill="#EF4444" stroke="#7F1D1D" stroke-width="3.2"/>
          <line x1="362" y1="256" x2="362" y2="272" stroke="#FDE047" stroke-width="3.5"/>
          <line x1="374" y1="256" x2="374" y2="272" stroke="#FDE047" stroke-width="3.5"/>
        </g>
        """
    },
    {
        "name": "beak_pouch",
        "bone": "beak_pouch",
        "svg": f"""
        <g>
          <path d="M 410,192 C 416,232 455,250 495,238 C 516,231 526,210 528,194
                   C 492,198 448,196 410,192 Z"
                fill="#FB923C" stroke="#7C2D12" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M 424,204 C 446,230 482,236 512,214" fill="none" stroke="#FDBA74" stroke-width="4" stroke-linecap="round"/>
          <path d="M 432,198 C 455,218 485,222 516,204" fill="none" stroke="#EA580C" stroke-width="2.2" stroke-linecap="round"/>
        </g>
        """
    },
    {
        "name": "head",
        "bone": "head",
        "svg": f"""
        <g>
          <path d="M 372,172 L 358,164 L 368,156 L 360,148 L 376,148" fill="#FFFFFF" stroke="#334155" stroke-width="3" stroke-linejoin="round"/>
          <ellipse cx="392" cy="172" rx="24" ry="22" fill="#FFFFFF" stroke="#334155" stroke-width="3.8"/>
          <path d="M 408,162 C 448,162 496,168 526,178 C 534,182 535,194 528,198
                   C 523,198 520,193 516,192 C 482,194 442,194 408,192 Z"
                fill="#FBBF24" stroke="#78350F" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M 412,167 C 450,167 492,172 522,181" fill="none" stroke="#FEF08A" stroke-width="3" stroke-linecap="round"/>
          <circle cx="527" cy="188" r="4" fill="#EF4444"/>
          <circle cx="398" cy="168" r="8.5" fill="#FEF9C3" stroke="#1E293B" stroke-width="2.5"/>
          <circle cx="400" cy="168" r="5" fill="#0F172A"/>
          <circle cx="402" cy="166" r="2" fill="#FFFFFF"/>
          <ellipse cx="392" cy="180" rx="5.5" ry="3.5" fill="#FDA4AF" opacity="0.8"/>
          <path d="M 372,152 C 370,134 398,128 414,142 L 410,155 Z" fill="#1D4ED8" stroke="#1E3A8A" stroke-width="3" stroke-linejoin="round"/>
          <path d="M 370,152 L 424,152 C 422,146 412,145 370,152 Z" fill="#0F172A" stroke="#0F172A" stroke-width="2"/>
          <circle cx="392" cy="133" r="4" fill="#FDE047" stroke="#1E3A8A" stroke-width="2"/>
        </g>
        """
    },
    {
        "name": "wing_r",
        "bone": "wing_r",
        "svg": (
            limb_capsule_svg(SHOULDER_R[0], SHOULDER_R[1], ELBOW_R[0], ELBOW_R[1], 24, 17, "#FFFFFF", "#334155", 3.8)
            + f'<path d="M {SHOULDER_R[0]-6:.1f},{SHOULDER_R[1]+2:.1f} Q {(SHOULDER_R[0]+ELBOW_R[0])*0.45:.1f},{ELBOW_R[1]+10:.1f} {ELBOW_R[0]-4:.1f},{ELBOW_R[1]+4:.1f}" fill="none" stroke="#CBD5E1" stroke-width="3.5" stroke-linecap="round"/>'
        )
    },
    {
        "name": "forewing_r",
        "bone": "forewing_r",
        "svg": (
            limb_capsule_svg(ELBOW_R[0], ELBOW_R[1], HANDLEBAR_GRIP_R[0], HANDLEBAR_GRIP_R[1], 16, 12, "#FFFFFF", "#334155", 3.8)
            + f'<circle cx="{HANDLEBAR_GRIP_R[0]:.1f}" cy="{HANDLEBAR_GRIP_R[1]:.1f}" r="11" fill="#FFFFFF" stroke="#334155" stroke-width="3.5"/>'
        )
    },
]

manifest_layers = []
full_svg_parts = []
PAD = 8

for idx, p in enumerate(parts):
    # First render on full canvas to detect exact pixel bounding box
    probe_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" viewBox="0 0 {CANVAS_W} {CANVAS_H}">\n{p["svg"]}\n</svg>\n'
    doc = pymupdf.open(stream=probe_svg.encode("utf-8"), filetype="svg")
    pix = doc[0].get_pixmap(alpha=True)
    im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    doc.close()
    bbox = im.getbbox()
    if not bbox:
        raise RuntimeError(f"Empty part: {p['name']}")
    x0, y0, x1, y1 = bbox
    lx = max(0, x0 - PAD)
    ly = max(0, y0 - PAD)
    lw = min(CANVAS_W, x1 + PAD) - lx
    lh = min(CANVAS_H, y1 + PAD) - ly

    svg_text = f'<svg xmlns="http://www.w3.org/2000/svg" width="{lw}" height="{lh}" viewBox="{lx} {ly} {lw} {lh}">\n{p["svg"]}\n</svg>\n'
    svg_path = os.path.join(SVG_DIR, f"{p['name']}.svg")
    png_path = os.path.join(PNG_DIR, f"{p['name']}.png")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_text)
    doc2 = pymupdf.open(stream=svg_text.encode("utf-8"), filetype="svg")
    pix2 = doc2[0].get_pixmap(alpha=True)
    pix2.save(png_path)
    doc2.close()

    full_svg_parts.append(p["svg"])
    manifest_layers.append({
        "name": p["name"],
        "bone": p["bone"],
        "svg": svg_path.replace("\\", "/"),
        "file": png_path.replace("\\", "/"),
        "left": lx,
        "top": ly,
        "width": pix2.width,
        "height": pix2.height,
        "zIndex": idx,
    })

full_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" viewBox="0 0 {CANVAS_W} {CANVAS_H}">\n' + "\n".join(full_svg_parts) + "\n</svg>\n"
with open(os.path.join(SVG_DIR, "_full_preview.svg"), "w", encoding="utf-8") as f:
    f.write(full_svg)
doc = pymupdf.open(stream=full_svg.encode("utf-8"), filetype="svg")
doc[0].get_pixmap(alpha=True).save(os.path.join(PNG_DIR, "_full_preview.png"))
doc.close()

manifest = {
    "canvasWidth": CANVAS_W,
    "canvasHeight": CANVAS_H,
    "origin": [ORIGIN_X, ORIGIN_Y],
    "joints": {
        "root": (ORIGIN_X, ORIGIN_Y),
        "bike_frame": CRANK_CENTER,
        "wheel_back": REAR_HUB,
        "wheel_front": FRONT_HUB,
        "crank_gear": CRANK_CENTER,
        "pedal_l": PEDAL_L,
        "pedal_r": PEDAL_R,
        "handlebar": HEAD_TUBE_TOP,
        "basket_fish": BASKET_FISH_PIVOT,
        "hip": HIP_JOINT,
        "tail": TAIL_JOINT,
        "thigh_l": THIGH_HIP,
        "shin_l": KNEE_L,
        "foot_l": FOOT_L_JOINT,
        "thigh_r": THIGH_HIP,
        "shin_r": KNEE_R,
        "foot_r": FOOT_R_JOINT,
        "torso": TORSO_JOINT,
        "scarf": SCARF_JOINT,
        "neck": NECK_JOINT,
        "head": HEAD_JOINT,
        "beak_pouch": POUCH_JOINT,
        "wing_l": SHOULDER_L,
        "forewing_l": ELBOW_L,
        "wing_r": SHOULDER_R,
        "forewing_r": ELBOW_R,
        "grip_l": HANDLEBAR_GRIP_L,
        "grip_r": HANDLEBAR_GRIP_R,
    },
    "lengths": {
        "L_THIGH": L_THIGH,
        "L_SHIN": L_SHIN,
        "L_WING_UPPER": L_WING_UPPER,
        "L_WING_FORE": L_WING_FORE,
        "CRANK_R": CRANK_R,
        "THETA0_DEG": 30.0,
        "ANKLE_OFFSET_Y": ANKLE_OFFSET_Y,
    },
    "layers": manifest_layers,
}

with open(os.path.join(BASE_DIR, "layers_manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f"Generated {len(manifest_layers)} auto-padded SVG -> PNG parts successfully!")
