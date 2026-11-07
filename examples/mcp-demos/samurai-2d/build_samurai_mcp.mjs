/**
 * build_samurai_mcp.mjs
 *
 * Complete end-to-end BoneStudio MCP pipeline for 'samurai-2d' (2D Melee Samurai / 绯刃剑豪):
 *   1. Creates 'samurai-2d' (880x560, 24fps)
 *   2. Creates 25 hierarchical bones in the 0-deg SVG reference pose:
 *      - root -> shadow
 *      - root -> hip -> saya (scabbard), thigh_r -> shin_r -> foot_r, thigh_l -> shin_l -> foot_l
 *      - hip -> torso -> neck -> head -> hair_ponytail (independent neck bone prevents collar/jaw clipping!)
 *      - torso -> cape_root -> cape_mid -> cape_tip (3-bone Haori cloak chain)
 *      - torso -> arm_upper_l -> arm_lower_l
 *      - torso -> arm_upper_r -> arm_lower_r -> katana
 *      - root -> slash_arc (crescent cleave trail VFX), slash_wave (flying sword aura projectile VFX)
 *      - root -> target_base -> target_top (sliceable bamboo tatami target at x=700)
 *   3. Imports 22 multi-layered cel-shaded SVG->PNG parts at root via layers_add (with left/top bounds)
 *   4. Rebinds all 22 slots to their target bones with zIndex (zero-drift rebase)
 *   5. Builds a 5x4 weighted mesh for `haori_cape` bound to `['torso', 'cape_root', 'cape_mid', 'cape_tip']`
 *   6. Rotates Setup Pose to IDLE0 (Chudan-no-kamae / 中段构警戒架势)
 *   7. Authors 4 rich 24fps animations:
 *      - `idle`  (32 frames, loop): Chudan-no-kamae breathing, subtle blade poise, flowing Haori & ponytail
 *      - `walk`  (24 frames, loop): Measured tactical advance with full leg/knee/ankle articulation
 *      - `run`   (16 frames, loop): Low-center Iai dash, torso leaned +24 deg forward, katana swept back
 *      - `slash` (30 frames, playTimes=1):
 *          * f=0..6   (Windup / 蓄力上段举刀): Two-handed overhead raise, cape & ponytail whip back
 *          * f=6..8   (Cleave / 绯刃烈斩): Lightning 2-frame downward cleave (+165 deg arc) + `slash_arc_fx` burst!
 *          * f=8..18  (Sword Aura Wave / 剑气破空斩竹): `slash_wave_fx` launches at high velocity from x=395 to x=835,
 *                     slicing `target_top` at f=12 so the upper bamboo bundle slides diagonally off the cut plane!
 *          * f=18..30 (Chiburi & Noto Recovery / 振血收势): Snaps blade and returns smoothly to Chudan stance.
 *   8. Exports DragonBones 5.5 & Spine 4.2 (with runtime validation) and renders PNG/GIF previews.
 */

import fs from 'node:fs';
import path from 'node:path';
import { startMcp } from 'file:///C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/tools/mcp-client.mjs';

const SCRATCH_DIR = 'C:/Users/Administrator/.gemini/antigravity/scratch/samurai-2d';
const PREVIEW_DIR = `${SCRATCH_DIR}/previews`;
const ARTIFACT_DIR = 'C:/Users/Administrator/.gemini/antigravity/brain/64c3fdc2-7eec-43b3-a77d-96c0cb31e6b6';
const EXPORT_SPINE_DIR = `${SCRATCH_DIR}/export_spine`;
const EXPORT_DB_DIR = `${SCRATCH_DIR}/export_db`;
const PROJECTS_DIR = 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects';

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
fs.mkdirSync(EXPORT_SPINE_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DB_DIR, { recursive: true });

// Remove stale lock if present
const lockPath = path.join(PROJECTS_DIR, 'samurai-2d', '.lock.json');
if (fs.existsSync(lockPath)) {
  try { fs.unlinkSync(lockPath); } catch {}
}

const manifest = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'layers_manifest.json'), 'utf8'));
const J = manifest.joints;
const CANVAS_W = manifest.canvasWidth;   // 880
const CANVAS_H = manifest.canvasHeight;  // 560
const OX = CANVAS_W / 2;                 // 440
const OY = CANVAS_H;                     // 560 (layers_add origin convention)

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;

function matFrom(x, y, deg) {
  const r = deg * RAD;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y];
}
function mulMat(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
function invMat(M) {
  const det = M[0] * M[3] - M[1] * M[2];
  const a = M[3] / det;
  const b = -M[1] / det;
  const c = -M[2] / det;
  const d = M[0] / det;
  return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])];
}

// ============================================================================
// Bone Hierarchy Definition (Parent-First, in 0-deg SVG reference pose)
// Note: Bones that receive canvas-space (dx, dy) translations in bone_keys
// (hip, shadow, slash_arc, slash_wave, target_base, target_top) have their
// parents at 0 deg so (dx, dy) is 1:1 with canvas (+x right, +y down) pixels!
// ============================================================================
const BONE_SPECS = [
  { name: 'shadow',        parent: 'root',        from: J.root,          to: [J.root[0] + 45, J.root[1]] },
  { name: 'target_base',   parent: 'root',        from: J.target_base,   to: [J.target_base[0] + 40, J.target_base[1]] },
  { name: 'target_top',    parent: 'target_base', from: J.target_top,    to: [J.target_top[0], J.target_top[1] - 75] },

  { name: 'hip',           parent: 'root',        from: J.hip,           to: [J.hip[0] + 28, J.hip[1]] },
  { name: 'saya',          parent: 'hip',         from: J.saya,          to: [J.saya[0] - 85, J.saya[1] + 24] },

  // Far Leg (thigh_r -> shin_r -> foot_r)
  { name: 'thigh_r',       parent: 'hip',         from: J.thigh_r,       to: J.shin_r },
  { name: 'shin_r',        parent: 'thigh_r',     from: J.shin_r,        to: J.foot_r },
  { name: 'foot_r',        parent: 'shin_r',      from: J.foot_r,        to: [J.foot_r[0] + 28, J.foot_r[1] + 6] },

  // Near Leg (thigh_l -> shin_l -> foot_l)
  { name: 'thigh_l',       parent: 'hip',         from: J.thigh_l,       to: J.shin_l },
  { name: 'shin_l',        parent: 'thigh_l',     from: J.shin_l,        to: J.foot_l },
  { name: 'foot_l',        parent: 'shin_l',      from: J.foot_l,        to: [J.foot_l[0] + 28, J.foot_l[1] + 6] },

  // Torso, Independent Neck, Head & High Ponytail
  { name: 'torso',         parent: 'hip',         from: J.torso,         to: J.neck },
  { name: 'neck',          parent: 'torso',       from: J.neck,          to: J.head },
  { name: 'head',          parent: 'neck',        from: J.head,          to: [J.head[0], J.head[1] - 42] },
  { name: 'hair_ponytail', parent: 'head',        from: J.hair_ponytail, to: [J.hair_ponytail[0] - 68, J.hair_ponytail[1] + 25] },

  // Haori Cloak 3-bone chain
  { name: 'cape_root',     parent: 'torso',       from: J.cape_root,     to: J.cape_mid },
  { name: 'cape_mid',      parent: 'cape_root',   from: J.cape_mid,      to: J.cape_tip },
  { name: 'cape_tip',      parent: 'cape_mid',    from: J.cape_tip,      to: [J.cape_tip[0] - 32, J.cape_tip[1] + 24] },

  // Far Arm (Left)
  { name: 'arm_upper_l',   parent: 'torso',       from: J.arm_upper_l,   to: J.arm_lower_l },
  { name: 'arm_lower_l',   parent: 'arm_upper_l', from: J.arm_lower_l,   to: [J.arm_lower_l[0] + 24, J.arm_lower_l[1] + 40] },

  // Near Arm (Right) & Katana
  { name: 'arm_upper_r',   parent: 'torso',       from: J.arm_upper_r,   to: J.arm_lower_r },
  { name: 'arm_lower_r',   parent: 'arm_upper_r', from: J.arm_lower_r,   to: J.katana },
  { name: 'katana',        parent: 'arm_lower_r', from: J.katana,        to: [J.katana[0] + 145, J.katana[1] - 88] },

  // Sword Aura VFX Bones (parented to root at 0 deg)
  { name: 'slash_arc',     parent: 'root',        from: J.slash_arc,     to: [J.slash_arc[0] + 80, J.slash_arc[1]] },
  { name: 'slash_wave',    parent: 'root',        from: J.slash_wave,    to: [J.slash_wave[0] + 80, J.slash_wave[1]] },
];

const worldMats = { root: matFrom(0, 0, 0) };
const localBind = {};
const boneConfigs = [];

for (const b of BONE_SPECS) {
  const wx = b.from[0] - OX;
  const wy = b.from[1] - OY;
  const tx = b.to[0] - OX;
  const ty = b.to[1] - OY;
  const wDeg = Math.atan2(ty - wy, tx - wx) * DEG;
  const len = Math.round(Math.hypot(tx - wx, ty - wy));
  const W = matFrom(wx, wy, wDeg);
  const P = worldMats[b.parent];
  const localM = mulMat(invMat(P), W);
  const localDeg = Math.atan2(localM[1], localM[0]) * DEG;

  worldMats[b.name] = W;
  localBind[b.name] = {
    x: r2(localM[4]),
    y: r2(localM[5]),
    skX: r2(localDeg),
    skY: r2(localDeg),
  };
  boneConfigs.push({
    name: b.name,
    parent: b.parent,
    length: len,
    transform: { ...localBind[b.name] },
  });
}

// ============================================================================
// Chudan-no-kamae (中段构警戒架势) Setup Pose Deltas
// ============================================================================
const IDLE0 = {
  hipRot: 0,
  torso: 3,
  neck: -1,
  head: -2,
  hair_ponytail: 2,
  saya: -4,
  cape_root: 4,
  cape_mid: 3,
  cape_tip: 2,
  thigh_l: -11,
  shin_l: 13,
  foot_l: -2,
  thigh_r: 13,
  shin_r: 8,
  foot_r: -16,
  arm_upper_r: -24,
  arm_lower_r: -34,
  katana: 44,
  arm_upper_l: -38,
  arm_lower_l: -28,
};

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
function smoothstep(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
function easeOutCubic(t) {
  const u = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - u, 3);
}
function easeInBack(t) {
  const u = Math.max(0, Math.min(1, t));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * u * u * u - c1 * u * u;
}

/**
 * Converts a samurai pose object at frame `f` into BoneStudio bone_keys
 * (all rotations & translations are offsets relative to IDLE0 Setup Pose!).
 */
function buildKeysForFrame(f, p) {
  const {
    hipX = 0,
    hipY = 0,
    hipRot = IDLE0.hipRot,
    torso = IDLE0.torso,
    neck = IDLE0.neck,
    head = IDLE0.head,
    ponytail = IDLE0.hair_ponytail,
    saya = IDLE0.saya,
    capeRoot = IDLE0.cape_root,
    capeMid = IDLE0.cape_mid,
    capeTip = IDLE0.cape_tip,
    thighL = IDLE0.thigh_l,
    shinL = IDLE0.shin_l,
    footL = IDLE0.foot_l,
    thighR = IDLE0.thigh_r,
    shinR = IDLE0.shin_r,
    footR = IDLE0.foot_r,
    armR = IDLE0.arm_upper_r,
    forearmR = IDLE0.arm_lower_r,
    katana = IDLE0.katana,
    armL = IDLE0.arm_upper_l,
    forearmL = IDLE0.arm_lower_l,
    slashArcX = 0,
    slashArcY = 0,
    slashArcRot = 0,
    slashArcScaleX = 0.01,
    slashArcScaleY = 0.01,
    slashWaveX = 0,
    slashWaveY = 0,
    slashWaveRot = 0,
    slashWaveScaleX = 0.01,
    slashWaveScaleY = 0.01,
    targetBaseRot = 0,
    targetTopX = 0,
    targetTopY = 0,
    targetTopRot = 0,
  } = p;

  const keys = [];
  const add = (bone, vals) => {
    const k = { bone, frame: f };
    for (const [key, v] of Object.entries(vals)) {
      if (v !== undefined) k[key] = r2(v);
    }
    keys.push(k);
  };

  // 1. Hip & Ground Shadow
  add('hip', { x: hipX, y: hipY, rotate: hipRot - IDLE0.hipRot });
  const shadowScale = Math.max(0.72, Math.min(1.18, 1.0 + hipY * 0.008));
  add('shadow', { x: hipX, y: 0, scaleX: shadowScale, scaleY: shadowScale });

  // 2. Torso, Independent Neck, Head, Ponytail, Scabbard & Haori Cloak
  add('torso', { rotate: torso - IDLE0.torso });
  add('neck', { rotate: neck - IDLE0.neck });
  add('head', { rotate: head - IDLE0.head });
  add('hair_ponytail', { rotate: ponytail - IDLE0.hair_ponytail });
  add('saya', { rotate: saya - IDLE0.saya });
  add('cape_root', { rotate: capeRoot - IDLE0.cape_root });
  add('cape_mid', { rotate: capeMid - IDLE0.cape_mid });
  add('cape_tip', { rotate: capeTip - IDLE0.cape_tip });

  // 3. Near & Far Legs
  add('thigh_l', { rotate: thighL - IDLE0.thigh_l });
  add('shin_l',  { rotate: shinL  - IDLE0.shin_l });
  add('foot_l',  { rotate: footL  - IDLE0.foot_l });

  add('thigh_r', { rotate: thighR - IDLE0.thigh_r });
  add('shin_r',  { rotate: shinR  - IDLE0.shin_r });
  add('foot_r',  { rotate: footR  - IDLE0.foot_r });

  // 4. Arms & Katana
  add('arm_upper_r', { rotate: armR     - IDLE0.arm_upper_r });
  add('arm_lower_r', { rotate: forearmR - IDLE0.arm_lower_r });
  add('katana',      { rotate: katana   - IDLE0.katana });

  add('arm_upper_l', { rotate: armL     - IDLE0.arm_upper_l });
  add('arm_lower_l', { rotate: forearmL - IDLE0.arm_lower_l });

  // 5. Sword Aura VFX & Sliceable Bamboo Target
  add('slash_arc', {
    x: slashArcX,
    y: slashArcY,
    rotate: slashArcRot,
    scaleX: slashArcScaleX,
    scaleY: slashArcScaleY,
  });
  add('slash_wave', {
    x: slashWaveX,
    y: slashWaveY,
    rotate: slashWaveRot,
    scaleX: slashWaveScaleX,
    scaleY: slashWaveScaleY,
  });
  add('target_base', { rotate: targetBaseRot });
  add('target_top', { x: targetTopX, y: targetTopY, rotate: targetTopRot });

  return keys;
}

// ============================================================================
// 1. IDLE (警戒待机 · 中段构 - 32 frames, loop)
// ============================================================================
function genIdle() {
  const dur = 32;
  const keys = [];
  for (let f = 0; f <= dur; f += 2) {
    const ph = (f / dur) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const sLag = Math.sin(ph - 0.85);
    keys.push(
      ...buildKeysForFrame(f, {
        hipX: 0,
        hipY: 3.2 * s,
        hipRot: 1.0 * s,
        torso: 3 + 1.8 * s,
        neck: -1 - 0.8 * s,
        head: -2 - 1.2 * s,
        ponytail: 2 + 5.5 * sLag,
        saya: -4 + 2.2 * c,
        capeRoot: 4 + 4.5 * sLag,
        capeMid: 3 + 6.5 * Math.sin(ph - 1.3),
        capeTip: 2 + 8.0 * Math.sin(ph - 1.8),
        thighL: -11 - 2.0 * s,
        shinL: 13 + 3.5 * s,
        footL: -2 - 1.5 * s,
        thighR: 13 - 2.0 * s,
        shinR: 8 + 3.5 * s,
        footR: -16 - 1.5 * s,
        armR: -24 + 3.2 * s,
        forearmR: -34 - 2.5 * c,
        katana: 44 + 2.0 * c,
        armL: -38 + 2.8 * s,
        forearmL: -28 - 2.0 * c,
      })
    );
  }
  return keys;
}

// ============================================================================
// 2. WALK (持刀巡步 - 24 frames, loop)
// ============================================================================
function genWalk() {
  const dur = 24;
  const keys = [];
  for (let f = 0; f <= dur; f += 2) {
    const ph = (f / dur) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const s2 = Math.sin(ph * 2);
    const c2 = Math.cos(ph * 2);

    const thighL = -26 * s;
    const shinL = 18 + 22 * Math.max(0, c);
    const footL = -6 * s - 8 * Math.max(0, c);

    const thighR = 26 * s;
    const shinR = 18 + 22 * Math.max(0, -c);
    const footR = 6 * s - 8 * Math.max(0, -c);

    keys.push(
      ...buildKeysForFrame(f, {
        hipX: 3.0 * c,
        hipY: 4.5 * Math.abs(s) - 1.5,
        hipRot: 2.5 * s,
        torso: 8 + 2.2 * c2,
        neck: -3 - 1.0 * c2,
        head: -4 - 1.2 * c2,
        ponytail: 8 + 7.5 * Math.sin(ph * 2 - 0.7),
        saya: -8 + 4.5 * s,
        capeRoot: 10 + 5.5 * Math.sin(ph * 2 - 0.5),
        capeMid: 8 + 7.5 * Math.sin(ph * 2 - 1.1),
        capeTip: 6 + 9.0 * Math.sin(ph * 2 - 1.7),
        thighL,
        shinL,
        footL,
        thighR,
        shinR,
        footR,
        armR: -18 + 10 * s,
        forearmR: -36 - 5 * c,
        katana: 46 + 4 * s,
        armL: -28 - 12 * s,
        forearmL: -26 + 6 * c,
      })
    );
  }
  return keys;
}

// ============================================================================
// 3. RUN (疾风突进 · 居合冲刺 - 16 frames, loop)
// ============================================================================
function genRun() {
  const dur = 16;
  const keys = [];
  for (let f = 0; f <= dur; f += 1) {
    const ph = (f / dur) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const s2 = Math.sin(ph * 2);
    const c2 = Math.cos(ph * 2);

    const thighL = -46 * s - 6;
    const shinL = 26 + 42 * Math.max(0, c);
    const footL = -14 * s - 12 * Math.max(0, c);

    const thighR = 46 * s - 6;
    const shinR = 26 + 42 * Math.max(0, -c);
    const footR = 14 * s - 12 * Math.max(0, -c);

    keys.push(
      ...buildKeysForFrame(f, {
        hipX: 6.0 * c,
        hipY: -9 * Math.abs(c) + 5,
        hipRot: 6.0 + 3.5 * s,
        torso: 20 + 3.2 * c2,
        neck: -9 - 1.5 * c2,
        head: -9 - 1.8 * c2,
        ponytail: 16 + 8 * Math.sin(ph * 2 - 0.6),
        saya: -14 + 6.0 * s,
        capeRoot: 12 + 4.5 * Math.sin(ph * 2 - 0.5),
        capeMid: 9 + 5.5 * Math.sin(ph * 2 - 1.1),
        capeTip: 6 + 6.5 * Math.sin(ph * 2 - 1.7),
        thighL,
        shinL,
        footL,
        thighR,
        shinR,
        footR,
        // Katana held low & ready in front during combat sprint!
        armR: -18 + 10 * s,
        forearmR: -28 + 6 * c,
        katana: 32 + 4 * s,
        // Left hand guards in front
        armL: -34 - 18 * s,
        forearmL: -32 + 8 * c,
      })
    );
  }
  return keys;
}

// ============================================================================
// 4. SLASH (一刀两断 · 烈斩剑气 - 30 frames, playTimes=1)
//   - f=0..6   (Windup / 蓄力上段举刀): Steps back slightly, raises Katana high overhead (-115 deg)
//   - f=6..8   (Cleave / 绯刃烈斩): Explosive forward lunge (+38px) & 150 deg downward cleave!
//              Both hands extend forward in front of torso as `slash_arc_fx` bursts around the blade!
//   - f=8..18  (Sword Aura Wave / 月牙剑气破空): `slash_wave_fx` launches forward at high speed
//              from x=395 to x=835, slicing the bamboo target at f=11..12!
//              At f>=12, `target_top` slides diagonally down-right along the cut plane!
//   - f=18..30 (Chiburi & Return / 振血收势): Smoothly recovers to Chudan stance.
// ============================================================================
function genSlash() {
  const dur = 30;
  const keys = [];
  for (let f = 0; f <= dur; f += 1) {
    let pose = {};

    if (f <= 6) {
      // Phase 1: Overhead Jodan Windup (f=0..6)
      const t = smoothstep(f / 6);
      pose = {
        hipX: lerp(0, -16, t),
        hipY: lerp(0, 6, t),
        hipRot: lerp(0, -8, t),
        torso: lerp(3, -12, t),
        neck: lerp(-1, 5, t),
        head: lerp(-2, 8, t),
        ponytail: lerp(2, -12, t),
        saya: lerp(-4, 8, t),
        capeRoot: lerp(4, -8, t),
        capeMid: lerp(3, -10, t),
        capeTip: lerp(2, -12, t),
        thighL: lerp(-11, -24, t),
        shinL: lerp(13, 28, t),
        footL: lerp(-2, -6, t),
        thighR: lerp(13, 24, t),
        shinR: lerp(8, 16, t),
        footR: lerp(-16, -24, t),
        armR: lerp(-24, -115, t),
        forearmR: lerp(-34, -25, t),
        katana: lerp(44, 35, t),
        armL: lerp(-38, -102, t),
        forearmL: lerp(-28, -25, t),
      };
    } else if (f <= 8) {
      // Phase 2: Lightning 2-frame Downward Cleave (f=6..8)
      const t = (f - 6) / 2;
      pose = {
        hipX: lerp(-16, 38, t),
        hipY: lerp(6, 15, t),
        hipRot: lerp(-8, 10, t),
        torso: lerp(-12, 20, t),
        neck: lerp(5, -8, t),
        head: lerp(8, -10, t),
        ponytail: lerp(-12, 18, t),
        saya: lerp(8, -16, t),
        capeRoot: lerp(-8, 14, t),
        capeMid: lerp(-10, 10, t),
        capeTip: lerp(-12, 8, t),
        thighL: lerp(-24, -46, t),
        shinL: lerp(28, 48, t),
        footL: lerp(-6, -4, t),
        thighR: lerp(24, 38, t),
        shinR: lerp(16, 10, t),
        footR: lerp(-24, -30, t),
        armR: lerp(-115, -32, t),
        forearmR: lerp(-25, -8, t),
        katana: lerp(35, 52, t),
        armL: lerp(-102, -38, t),
        forearmL: lerp(-25, -12, t),
      };
    } else if (f <= 18) {
      // Phase 3: Follow-through Hold & Aura Wave Projection (f=8..18)
      const t = easeOutCubic((f - 8) / 10);
      pose = {
        hipX: lerp(38, 42, t),
        hipY: lerp(15, 12, t),
        hipRot: lerp(10, 8, t),
        torso: lerp(20, 16, t),
        neck: lerp(-8, -6, t),
        head: lerp(-10, -7, t),
        ponytail: lerp(18, 10, t) + 4 * Math.sin(t * Math.PI),
        saya: lerp(-16, -12, t),
        capeRoot: lerp(14, 9, t) + 3 * Math.sin(t * Math.PI),
        capeMid: lerp(10, 7, t) + 4 * Math.sin(t * Math.PI),
        capeTip: lerp(8, 5, t) + 5 * Math.sin(t * Math.PI),
        thighL: lerp(-46, -40, t),
        shinL: lerp(48, 42, t),
        footL: -4,
        thighR: lerp(38, 34, t),
        shinR: lerp(10, 12, t),
        footR: lerp(-30, -26, t),
        armR: lerp(-32, -26, t),
        forearmR: lerp(-8, -4, t),
        katana: lerp(52, 58, t),
        armL: lerp(-38, -32, t),
        forearmL: lerp(-12, -16, t),
      };
    } else {
      // Phase 4: Chiburi & Return to Chudan-no-kamae (f=18..30)
      const t = smoothstep((f - 18) / 12);
      pose = {
        hipX: lerp(42, 0, t),
        hipY: lerp(12, 0, t),
        hipRot: lerp(8, 0, t),
        torso: lerp(16, 3, t),
        neck: lerp(-6, -1, t),
        head: lerp(-7, -2, t),
        ponytail: lerp(10, 2, t),
        saya: lerp(-12, -4, t),
        capeRoot: lerp(9, 4, t),
        capeMid: lerp(7, 3, t),
        capeTip: lerp(5, 2, t),
        thighL: lerp(-40, -11, t),
        shinL: lerp(42, 13, t),
        footL: lerp(-4, -2, t),
        thighR: lerp(34, 13, t),
        shinR: lerp(12, 8, t),
        footR: lerp(-26, -16, t),
        armR: lerp(-26, -24, t),
        forearmR: lerp(-4, -34, t),
        katana: lerp(58, 44, t),
        armL: lerp(-32, -38, t),
        forearmL: lerp(-16, -28, t),
      };
    }

    // ------------------------------------------------------------------------
    // Sword Aura VFX 1: Crescent Cleave Arc (`slash_arc` at J.slash_arc = (340, 250))
    // ------------------------------------------------------------------------
    if (f < 6) {
      pose.slashArcX = 0;
      pose.slashArcY = 0;
      pose.slashArcRot = -45;
      pose.slashArcScaleX = 0.01;
      pose.slashArcScaleY = 0.01;
    } else if (f <= 12) {
      const u = (f - 6) / 6;
      pose.slashArcX = lerp(12, 58, easeOutCubic(u));
      pose.slashArcY = lerp(-8, 12, easeOutCubic(u));
      pose.slashArcRot = lerp(-32, 18, easeOutCubic(u));
      const sc = f === 6 ? 0.72 : lerp(1.06, 1.24, u);
      pose.slashArcScaleX = sc;
      pose.slashArcScaleY = sc;
    } else {
      pose.slashArcX = 58;
      pose.slashArcY = 12;
      pose.slashArcRot = 18;
      pose.slashArcScaleX = 0.01;
      pose.slashArcScaleY = 0.01;
    }

    // ------------------------------------------------------------------------
    // Sword Aura VFX 2: Flying Crescent Wave (`slash_wave` at J.slash_wave = (380, 250))
    // Launches at f=7 from x=390 (dx=+10) and streaks across the bamboo target (x=700, dx=+320)
    // to x=835 (dx=+455) by f=17!
    // ------------------------------------------------------------------------
    if (f < 7) {
      pose.slashWaveX = 0;
      pose.slashWaveY = 0;
      pose.slashWaveRot = -6;
      pose.slashWaveScaleX = 0.01;
      pose.slashWaveScaleY = 0.01;
    } else if (f <= 17) {
      const u = (f - 7) / 10;
      pose.slashWaveX = lerp(10, 455, u);
      pose.slashWaveY = lerp(-4, 6, u);
      pose.slashWaveRot = lerp(-4, 4, u);
      pose.slashWaveScaleX = lerp(0.88, 1.32, u);
      pose.slashWaveScaleY = lerp(0.95, 1.18, u);
    } else {
      pose.slashWaveX = 455;
      pose.slashWaveY = 6;
      pose.slashWaveRot = 4;
      pose.slashWaveScaleX = 0.01;
      pose.slashWaveScaleY = 0.01;
    }

    // ------------------------------------------------------------------------
    // Sliceable Bamboo Target (`target_base` & `target_top` at x=700)
    // Impact occurs at f=11 when `slash_wave` crosses x=700!
    // Upper half slides diagonally down-right along the cut plane and tilts!
    // ------------------------------------------------------------------------
    if (f < 11) {
      pose.targetBaseRot = 0;
      pose.targetTopX = 0;
      pose.targetTopY = 0;
      pose.targetTopRot = 0;
    } else if (f <= 25) {
      const u = easeOutCubic((f - 11) / 14);
      const decay = Math.exp(-3.2 * ((f - 11) / 14));
      pose.targetBaseRot = 5.0 * decay * Math.sin(((f - 11) / 14) * Math.PI * 3);
      pose.targetTopX = lerp(0, 34, u);
      pose.targetTopY = lerp(0, 22, u);
      pose.targetTopRot = lerp(0, 28, u);
    } else {
      const u = smoothstep((f - 25) / 5);
      pose.targetBaseRot = 0;
      pose.targetTopX = lerp(34, 0, u);
      pose.targetTopY = lerp(22, 0, u);
      pose.targetTopRot = lerp(28, 0, u);
    }

    keys.push(...buildKeysForFrame(f, pose));
  }
  return keys;
}

// ============================================================================
// Execute MCP Build Pipeline (with Windows .lock EPERM retry protection)
// ============================================================================
const rawMcp = await startMcp({ BONESTUDIO_PROJECTS: PROJECTS_DIR });
const mcp = {
  async call(name, args) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await rawMcp.call(name, args);
      } catch (e) {
        if (String(e?.message || e).includes('EPERM') && attempt < 5) {
          await new Promise((r) => setTimeout(r, 90 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  },
  close() {
    rawMcp.close();
  },
};

try {
  console.log('1. Registering MCP session...');
  await mcp.call('session_set', {
    name: 'Antigravity·2D近战武士(samurai-2d)',
    task: '制作精美多层赛璐璐矢量近战武士骨骼与待机/行走/奔跑/烈斩剑气4套动作',
  });

  console.log('2. Creating project samurai-2d...');
  await mcp.call('project_new', { name: 'samurai-2d' });

  console.log(`3. Creating ${boneConfigs.length} bones in 0-deg reference pose...`);
  for (const b of boneConfigs) {
    await mcp.call('bone_create', b);
  }

  console.log(`4. Importing ${manifest.layers.length} PNG layers at root...`);
  await mcp.call('layers_add', {
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    layers: manifest.layers.map((l) => ({
      file: l.file,
      name: l.name,
      bone: 'root',
      left: l.left,
      top: l.top,
    })),
  });

  console.log('5. Rebinding slots to target bones with zIndex (zero-drift rebase)...');
  for (const l of manifest.layers) {
    await mcp.call('slot_update', {
      slot: l.name,
      bone: l.bone,
      zIndex: l.zIndex,
    });
  }

  // Hide Sword Aura VFX slots in Setup Pose by default
  for (const fxSlot of ['slash_arc_fx', 'slash_wave_fx']) {
    await mcp.call('slot_update', { slot: fxSlot, attachment: '' });
  }

  console.log('6. Converting haori_cape into a 5x4 weighted mesh...');
  await mcp.call('mesh_create', { slot: 'haori_cape', cols: 5, rows: 4 });
  await mcp.call('weights_auto', {
    slot: 'haori_cape',
    bones: ['torso', 'cape_root', 'cape_mid', 'cape_tip'],
  });

  console.log('7. Rotating Setup Pose to IDLE0 (中段构警戒架势)...');
  for (const [boneName, deltaDeg] of Object.entries(IDLE0)) {
    if (!localBind[boneName]) continue;
    const b = localBind[boneName];
    await mcp.call('bone_update', {
      bone: boneName,
      transform: {
        skX: r2(b.skX + deltaDeg),
        skY: r2(b.skY + deltaDeg),
      },
    });
  }

  async function hideAuraSlots(animName, dur) {
    for (const s of ['slash_arc_fx', 'slash_wave_fx']) {
      await mcp.call('slot_key', { animation: animName, slot: s, frame: 0,   attachment: '', color: { aM: 0 } });
      await mcp.call('slot_key', { animation: animName, slot: s, frame: dur, attachment: '', color: { aM: 0 } });
    }
  }

  console.log('8. Authoring 4 Samurai animations (idle, walk, run, slash)...');
  // (1) idle (32f loop) - update default 'idle' created by project_new
  await mcp.call('animation_update', { animation: 'idle', duration: 32, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'idle', keys: genIdle() });
  await hideAuraSlots('idle', 32);

  // (2) walk (24f loop)
  await mcp.call('animation_create', { name: 'walk', duration: 24, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'walk', keys: genWalk() });
  await hideAuraSlots('walk', 24);
  await mcp.call('event_key', { animation: 'walk', frame: 6,  name: 'footstep_left' });
  await mcp.call('event_key', { animation: 'walk', frame: 18, name: 'footstep_right' });

  // (3) run (16f loop)
  await mcp.call('animation_create', { name: 'run', duration: 16, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'run', keys: genRun() });
  await hideAuraSlots('run', 16);
  await mcp.call('event_key', { animation: 'run', frame: 4,  name: 'dash_step_left' });
  await mcp.call('event_key', { animation: 'run', frame: 12, name: 'dash_step_right' });

  // (4) slash (30f loop in preview - with glowing Crescent Cleave Arc + Flying Sword Aura Wave!)
  await mcp.call('animation_create', { name: 'slash', duration: 30, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'slash', keys: genSlash() });

  // Slot keys for `slash_arc_fx` (active f=6..12)
  const arcSlotFrames = [
    { frame: 0,  attachment: '',             aM: 0 },
    { frame: 5,  attachment: '',             aM: 0 },
    { frame: 6,  attachment: 'slash_arc_fx', aM: 95 },
    { frame: 8,  attachment: 'slash_arc_fx', aM: 100 },
    { frame: 10, attachment: 'slash_arc_fx', aM: 60 },
    { frame: 12, attachment: '',             aM: 0 },
    { frame: 30, attachment: '',             aM: 0 },
  ];
  for (const sk of arcSlotFrames) {
    await mcp.call('slot_key', {
      animation: 'slash',
      slot: 'slash_arc_fx',
      frame: sk.frame,
      attachment: sk.attachment,
      color: { rM: 100, gM: 100, bM: 100, aM: sk.aM },
    });
  }

  // Slot keys for `slash_wave_fx` (active f=7..17)
  const waveSlotFrames = [
    { frame: 0,  attachment: '',              aM: 0 },
    { frame: 6,  attachment: '',              aM: 0 },
    { frame: 7,  attachment: 'slash_wave_fx', aM: 100 },
    { frame: 12, attachment: 'slash_wave_fx', aM: 100 },
    { frame: 15, attachment: 'slash_wave_fx', aM: 75 },
    { frame: 17, attachment: '',              aM: 0 },
    { frame: 30, attachment: '',              aM: 0 },
  ];
  for (const sk of waveSlotFrames) {
    await mcp.call('slot_key', {
      animation: 'slash',
      slot: 'slash_wave_fx',
      frame: sk.frame,
      attachment: sk.attachment,
      color: { rM: 100, gM: 100, bM: 100, aM: sk.aM },
    });
  }

  await mcp.call('event_key', { animation: 'slash', frame: 6,  name: 'katana_cleave' });
  await mcp.call('event_key', { animation: 'slash', frame: 7,  name: 'sword_aura_launch' });
  await mcp.call('event_key', { animation: 'slash', frame: 11, name: 'bamboo_target_sliced' });

  console.log('9. Rendering Setup Pose, Slash Aura Keyframes, Contact Sheets & GIFs...');
  await mcp.call('render_frame', {
    setup: true,
    bones: false,
    width: 880,
    height: 560,
    background: '#12151e',
    out: `${PREVIEW_DIR}/samurai_setup_pose.png`,
  });
  await mcp.call('render_frame', {
    setup: true,
    bones: true,
    width: 880,
    height: 560,
    background: '#12151e',
    out: `${PREVIEW_DIR}/samurai_setup_bones.png`,
  });

  // Render key slash frames: f=5 (overhead windup), f=8 (cleave + arc + wave launch), f=12 (wave slices bamboo!)
  for (const f of [5, 8, 12, 15]) {
    await mcp.call('render_frame', {
      animation: 'slash',
      frame: f,
      bones: false,
      width: 880,
      height: 560,
      background: '#12151e',
      out: `${PREVIEW_DIR}/samurai_slash_f${f}.png`,
    });
  }

  const animRenderSpecs = [
    { name: 'idle',  step: 4, cols: 5 },
    { name: 'walk',  step: 2, cols: 7 },
    { name: 'run',   step: 2, cols: 5 },
    { name: 'slash', step: 2, cols: 4 },
  ];

  for (const a of animRenderSpecs) {
    await mcp.call('render_animation', {
      animation: a.name,
      format: 'sheet',
      step: a.step,
      cols: a.cols,
      width: 440,
      height: 280,
      background: '#12151e',
      out: `${PREVIEW_DIR}/samurai_${a.name}_sheet.png`,
    });
    await mcp.call('render_animation', {
      animation: a.name,
      format: 'gif',
      fps: 24,
      width: 640,
      height: 400,
      background: '#12151e',
      out: `${PREVIEW_DIR}/samurai_${a.name}.gif`,
    });
  }

  console.log('10. Exporting Spine 4.2 and DragonBones 5.5...');
  const spineRes = await mcp.call('spine_export', {
    outDir: EXPORT_SPINE_DIR,
    version: '4.2',
  });
  console.log('Spine 4.2 Validation:', JSON.stringify(spineRes.validation));

  await mcp.call('dragonbones_export', {
    outDir: EXPORT_DB_DIR,
  });

  await mcp.call('project_save', {});

  // Copy previews to Artifact Directory
  for (const fn of fs.readdirSync(PREVIEW_DIR)) {
    fs.copyFileSync(path.join(PREVIEW_DIR, fn), path.join(ARTIFACT_DIR, fn));
  }
  console.log('Done! Project samurai-2d saved in workspace and previews copied to artifacts.');
} finally {
  mcp.close();
}
