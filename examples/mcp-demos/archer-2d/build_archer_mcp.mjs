/**
 * Build the 'archer-2d' (2D Elven Archer / 精灵游侠弓箭手) skeletal animation project via BoneStudio MCP.
 * Incorporates the visual design, FK choreography, dynamic bow limb flexing, bowstring pull & vibration,
 * parabolic arrow trajectories, and spring-rocking Archery Target from ai_studio_code.html.
 *
 * Includes 28 modular skin-ready slots, 1 weighted cloak mesh, and 6 animations:
 *   1. idle           (警戒待机 - 32f loop)
 *   2. walk           (丛林巡逻 - 24f loop)
 *   3. run            (游侠疾跑 - 16f loop)
 *   4. aim_shoot      (蓄力平射 - 30f once, arrow flies & pins into rocking bullseye!)
 *   5. jump_multishot (跃起散射 - 34f once, backflip vault + 3 fan arrows pin & rock target!)
 *   6. hit            (角色受击 - 20f once, knockback + crimson flash)
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMcp } from 'file:///C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/tools/mcp-client.mjs';

const SCRATCH_DIR = 'C:/Users/Administrator/.gemini/antigravity/scratch/archer-2d';
const PREVIEW_DIR = `${SCRATCH_DIR}/previews`;
const EXPORT_SPINE_DIR = `${SCRATCH_DIR}/export/spine42`;
const EXPORT_DB_DIR = `${SCRATCH_DIR}/export/dragonbones55`;
const PROJECTS_DIR = 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects';

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
fs.mkdirSync(EXPORT_SPINE_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DB_DIR, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'layers_manifest.json'), 'utf8'));
const J = manifest.joints;
const CANVAS_W = manifest.canvasWidth;   // 880
const CANVAS_H = manifest.canvasHeight;  // 560
const OX = CANVAS_W / 2;                 // 440
const OY = CANVAS_H;                     // 560 (layers_add origin convention)
const S = 1.5;                           // 1.5x scale factor from ai_studio_code.html

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
// ============================================================================
const BONE_SPECS = [
  { name: 'shadow',        parent: 'root',         from: J.shadow,       to: [J.shadow[0] + 45, J.shadow[1]] },
  { name: 'target_stand',  parent: 'root',         from: J.target_stand, to: [J.target_stand[0], J.target_stand[1] - 90] },
  { name: 'target_pivot',  parent: 'target_stand', from: J.target_pivot, to: [J.target_pivot[0], J.target_pivot[1] - 95] },

  { name: 'hip',           parent: 'root',         from: J.hip,          to: [J.hip[0] + 30, J.hip[1]] },
  { name: 'torso',         parent: 'hip',          from: J.torso,        to: [J.torso[0], J.torso[1] - 90] },
  { name: 'quiver',        parent: 'torso',        from: J.quiver,       to: [J.quiver[0] - 18, J.quiver[1] - 42] },
  { name: 'cape_root',     parent: 'torso',        from: J.cape_root,    to: J.cape_mid },
  { name: 'cape_mid',      parent: 'cape_root',    from: J.cape_mid,     to: J.cape_tip },
  { name: 'cape_tip',      parent: 'cape_mid',     from: J.cape_tip,     to: [J.cape_tip[0] - 25, J.cape_tip[1] + 20] },

  { name: 'head',          parent: 'torso',        from: J.head,         to: [J.head[0], J.head[1] - 40] },
  { name: 'hair_braid',    parent: 'head',         from: J.hair_braid,   to: [J.hair_braid[0] - 38, J.hair_braid[1] + 38] },
  { name: 'hood_feather',  parent: 'head',         from: J.hood_feather, to: [J.hood_feather[0] - 50, J.hood_feather[1] - 12] },

  // Far Leg (thigh_r -> shin_r -> foot_r)
  { name: 'thigh_r',       parent: 'hip',          from: J.thigh_r,      to: J.shin_r },
  { name: 'shin_r',        parent: 'thigh_r',      from: J.shin_r,       to: J.foot_r },
  { name: 'foot_r',        parent: 'shin_r',       from: J.foot_r,       to: [J.foot_r[0] + 28, J.foot_r[1] + 6] },

  // Near Leg (thigh_l -> shin_l -> foot_l)
  { name: 'thigh_l',       parent: 'hip',          from: J.thigh_l,      to: J.shin_l },
  { name: 'shin_l',        parent: 'thigh_l',      from: J.shin_l,       to: J.foot_l },
  { name: 'foot_l',        parent: 'shin_l',       from: J.foot_l,       to: [J.foot_l[0] + 28, J.foot_l[1] + 6] },

  // Far Bow Arm (arm_upper_l -> arm_lower_l -> hand_l)
  { name: 'arm_upper_l',   parent: 'torso',        from: J.arm_upper_l,  to: J.arm_lower_l },
  { name: 'arm_lower_l',   parent: 'arm_upper_l',  from: J.arm_lower_l,  to: J.hand_l },
  { name: 'hand_l',        parent: 'arm_lower_l',  from: J.hand_l,       to: [J.hand_l[0] + 24, J.hand_l[1]] },
  { name: 'bow_limb_u',    parent: 'hand_l',       from: J.hand_l,       to: J.bow_tip_top },
  { name: 'bow_limb_d',    parent: 'hand_l',       from: J.hand_l,       to: J.bow_tip_bot },
  { name: 'string_upper',  parent: 'bow_limb_u',   from: J.bow_tip_top,  to: J.bow_nock },
  { name: 'string_lower',  parent: 'bow_limb_d',   from: J.bow_tip_bot,  to: J.bow_nock },
  { name: 'bow_nock',      parent: 'hand_l',       from: J.hand_l,       to: [J.hand_l[0] + 40, J.hand_l[1]] },

  // Near Draw Arm (arm_upper_r -> arm_lower_r)
  { name: 'arm_upper_r',   parent: 'torso',        from: J.arm_upper_r,  to: J.arm_lower_r },
  { name: 'arm_lower_r',   parent: 'arm_upper_r',  from: J.arm_lower_r,  to: J.hand_r },

  // Independent Projectile Arrows (parented to root for parabolic trajectory & target pinning)
  { name: 'arrow_main',    parent: 'root',         from: J.hand_l,       to: [J.hand_l[0] + 40, J.hand_l[1]] },
  { name: 'arrow_up',      parent: 'root',         from: J.hand_l,       to: [J.hand_l[0] + 40, J.hand_l[1]] },
  { name: 'arrow_down',    parent: 'root',         from: J.hand_l,       to: [J.hand_l[0] + 40, J.hand_l[1]] },
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
// Idle Frame 0 Pose (used as Setup Pose after slot_update so Setup Pose looks great!)
// ============================================================================
const IDLE0 = {
  hipX: 0,
  hipY: 0,
  hipRot: 0,
  torso: 4,
  head: -3,
  arm_upper_l: -32,
  arm_lower_l: -18,
  hand_l: 45,
  arm_upper_r: 14,
  arm_lower_r: -40,
  thigh_l: 9,
  shin_l: 6,
  foot_l: -13,
  thigh_r: -11,
  shin_r: 8,
  foot_r: 4,
};

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Converts an ai_studio_code.html pose object at frame `f` into BoneStudio bone_keys
 * (relative to IDLE0 setup pose!).
 */
function buildKeysForFrame(f, p) {
  const {
    hipX = 0,
    hipY = 0,
    hipRot = 0,
    torso = 4,
    head = -3,
    armL = -32,
    forearmL = -18,
    handL = 45,
    armR = 14,
    forearmR = -40,
    thighL = 9,
    calfL = 6,
    footL = -13,
    thighR = -11,
    calfR = 8,
    footR = 4,
    bowPull = 0,
    stringVib = 0,
    capeRootRot = 0,
    capeMidRot = 0,
    capeTipRot = 0,
    hairRot = 0,
    featherRot = 0,
    quiverRot = 0,
    targetAngle = 0,
  } = p;

  const keys = [];
  const add = (bone, vals) => {
    const k = { bone, frame: f };
    for (const [key, v] of Object.entries(vals)) {
      if (v !== undefined) k[key] = r2(v);
    }
    keys.push(k);
  };

  // 1. Hip & Shadow (hipX, hipY from HTML are scaled by S = 1.5)
  const dx = hipX * S;
  const dy = hipY * S;
  add('hip', { x: dx, y: dy, rotate: hipRot - IDLE0.hipRot });

  const shadowScale = clamp(1.0 + (hipY * 0.25) / 42, 0.38, 1.22);
  add('shadow', { x: dx, y: 0, scaleX: shadowScale, scaleY: shadowScale });

  // 2. Torso, Head, Hair, Feather, Quiver, Cloak
  add('torso', { rotate: torso - IDLE0.torso });
  add('head', { rotate: head - IDLE0.head });
  add('hair_braid', { rotate: hairRot });
  add('hood_feather', { rotate: featherRot });
  add('quiver', { rotate: quiverRot });
  add('cape_root', { rotate: capeRootRot });
  add('cape_mid', { rotate: capeMidRot });
  add('cape_tip', { rotate: capeTipRot });

  // 3. Legs (relative to IDLE0)
  add('thigh_l', { rotate: thighL - IDLE0.thigh_l });
  add('shin_l',  { rotate: calfL  - IDLE0.shin_l });
  add('foot_l',  { rotate: footL  - IDLE0.foot_l });

  add('thigh_r', { rotate: thighR - IDLE0.thigh_r });
  add('shin_r',  { rotate: calfR  - IDLE0.shin_r });
  add('foot_r',  { rotate: footR  - IDLE0.foot_r });

  // 4. Bow Arm & Draw Arm (relative to IDLE0)
  add('arm_upper_l', { rotate: armL     - IDLE0.arm_upper_l });
  add('arm_lower_l', { rotate: forearmL - IDLE0.arm_lower_l });
  add('hand_l',      { rotate: handL    - IDLE0.hand_l });

  add('arm_upper_r', { rotate: armR     - IDLE0.arm_upper_r });
  add('arm_lower_r', { rotate: forearmR - IDLE0.arm_lower_r });

  // 5. Dynamic Bow Limb Flexing & Bowstring Pull + Vibration (matching HTML lines 1002-1018)
  const limbRot = -9.5 * bowPull; // upper limb flexes CCW (-9.5 deg), lower limb flexes CW (+9.5 deg)
  add('bow_limb_u', { rotate: limbRot });
  add('bow_limb_d', { rotate: -limbRot });

  const rLimb = limbRot * RAD;
  const tipTopX = -12 * Math.cos(rLimb) - (-102) * Math.sin(rLimb);
  const tipTopY = -12 * Math.sin(rLimb) + (-102) * Math.cos(rLimb);
  const nockX = -12 - bowPull * 63 + stringVib * 13.5;

  const strAngleDeg = Math.atan2(0 - tipTopY, nockX - tipTopX) * DEG;
  const strLen = Math.hypot(nockX - tipTopX, 0 - tipTopY);
  const strScale = strLen / 102.0;

  add('string_upper', { rotate: (strAngleDeg - 90) - limbRot,  scaleX: strScale });
  add('string_lower', { rotate: -(strAngleDeg - 90) + limbRot, scaleX: strScale });
  add('bow_nock',     { x: nockX + 12, y: 0, rotate: 0 });

  // 6. Archery Target spring rocking
  add('target_pivot', { rotate: targetAngle });

  return keys;
}

/**
 * Helper to compute projectile arrow bone keyframe (parented to root).
 * In bind pose, arrow_main / arrow_up / arrow_down is at J.hand_l (249, 325) with 0 deg.
 * So setting x = canvasX - 249, y = canvasY - 325 places the arrow tip/center at (canvasX, canvasY)!
 */
function buildProjectileKey(bone, f, canvasX, canvasY, angleDeg) {
  return {
    bone,
    frame: f,
    x: r2(canvasX - J.hand_l[0]),
    y: r2(canvasY - J.hand_l[1]),
    rotate: r2(angleDeg),
  };
}

/**
 * Computes the pinned world position & angle of an arrow stuck into target_pivot (740, 332)
 * when target_pivot rocks by `targetAngle` degrees!
 */
function buildPinnedProjectileKey(bone, f, hitX, hitY, hitAngleDeg, targetAngle) {
  const pivotX = J.target_pivot[0];
  const pivotY = J.target_pivot[1];
  const lx = hitX - pivotX;
  const ly = hitY - pivotY;
  const r = targetAngle * RAD;
  const rx = pivotX + lx * Math.cos(r) - ly * Math.sin(r);
  const ry = pivotY + lx * Math.sin(r) + ly * Math.cos(r);
  return buildProjectileKey(bone, f, rx, ry, hitAngleDeg + targetAngle);
}

// ============================================================================
// 1. IDLE (警戒待机 - 32 frames, loop)
// ============================================================================
function genIdle() {
  const dur = 32;
  const keys = [];
  for (let f = 0; f <= dur; f += 2) {
    const phase = (f / dur) * Math.PI * 2;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    keys.push(...buildKeysForFrame(f, {
      hipX: 0,
      hipY: s * 2.5,
      torso: 4 + s * 1.5,
      head: -3 - s * 1.5,
      armL: -32 + s * 3,
      forearmL: -18 - c * 3,
      handL: 45,
      armR: 14 - s * 3,
      forearmR: -40 + c * 4,
      thighL: 9 - s * 2,
      calfL: 6 + s * 4,
      footL: -13,
      thighR: -11 - s * 2,
      calfR: 8 + s * 4,
      footR: 4,
      capeRootRot: 3 * s,
      capeMidRot: 5 * c,
      capeTipRot: 7 * Math.sin(phase - 1),
      hairRot: 4 * c,
      featherRot: 3 * s,
    }));
  }
  return keys;
}

// ============================================================================
// 2. WALK (丛林巡逻 - 24 frames, loop)
// ============================================================================
function genWalk() {
  const dur = 24;
  const keys = [];
  for (let f = 0; f <= dur; f += 2) {
    const phase = (f / dur) * Math.PI * 2;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const sR = Math.sin(phase + Math.PI);
    const cR = Math.cos(phase + Math.PI);

    const thighL = s * 30;
    const calfL = Math.max(0, c * 36) + 6;
    const footL = -thighL * 0.3 - calfL * 0.3;

    const thighR = sR * 30;
    const calfR = Math.max(0, cR * 36) + 6;
    const footR = -thighR * 0.3 - calfR * 0.3;

    keys.push(...buildKeysForFrame(f, {
      hipX: 0,
      hipY: -Math.abs(s) * 5.5 + 2,
      torso: 8 + Math.cos(phase * 2) * 2,
      head: -6 - Math.cos(phase * 2) * 1.5,
      thighL,
      calfL,
      footL,
      thighR,
      calfR,
      footR,
      armL: -38 - s * 12,
      forearmL: -22,
      handL: 50,
      armR: -sR * 24 + 8,
      forearmR: -35 - Math.max(0, -sR) * 15,
      capeRootRot: 12 + 6 * Math.sin(phase * 2),
      capeMidRot: 8 * Math.cos(phase * 2 - 0.8),
      capeTipRot: 12 * Math.sin(phase * 2 - 1.4),
      hairRot: 8 + 6 * Math.sin(phase * 2),
      featherRot: 5 * Math.cos(phase * 2),
      quiverRot: 3 * Math.sin(phase * 2),
    }));
  }
  return keys;
}

// ============================================================================
// 3. RUN (游侠疾跑 - 16 frames, loop)
// ============================================================================
function genRun() {
  const dur = 16;
  const keys = [];
  for (let f = 0; f <= dur; f += 2) {
    const phase = (f / dur) * Math.PI * 2;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const sR = Math.sin(phase + Math.PI);
    const cR = Math.cos(phase + Math.PI);

    keys.push(...buildKeysForFrame(f, {
      hipX: 6,
      hipY: Math.sin(phase * 2 - 0.5) * 9 + 6,
      torso: 24 + Math.cos(phase * 2) * 4,
      head: -20 - Math.cos(phase * 2) * 3,
      thighL: s * 54 - 5,
      calfL: Math.max(0, c * 70 + 20),
      footL: c * 20,
      thighR: sR * 54 - 5,
      calfR: Math.max(0, cR * 70 + 20),
      footR: cR * 20,
      armL: -s * 35 - 10,
      forearmL: -45,
      handL: 65,
      armR: -sR * 50 + 10,
      forearmR: -60 + cR * 18,
      capeRootRot: 28 + 10 * Math.sin(phase * 2),
      capeMidRot: 14 * Math.cos(phase * 2 - 0.7),
      capeTipRot: 18 * Math.sin(phase * 2 - 1.3),
      hairRot: 18 + 10 * Math.sin(phase * 2),
      featherRot: 10 * Math.cos(phase * 2),
      quiverRot: 6 * Math.sin(phase * 2),
    }));
  }
  return keys;
}

// ============================================================================
// 4. AIM_SHOOT (蓄力平射 - 30 frames, once)
//   f=0..6   (0.00..0.22): Reach to quiver + raise bow
//   f=6..18  (0.22..0.62): Full Draw (bow limbs flex, string & arrow_nocked pull back!)
//   f=18..23 (0.62..0.78): Release & Recoil! arrow_main flies to bullseye (722, 240) at f=22!
//   f=22..30 (0.78..1.00): Target rocks with pinned arrow while archer recovers to idle!
// ============================================================================
function genAimShoot() {
  const dur = 30;
  const keys = [];
  const hitX = 720;
  const hitY = 238;
  const hitAngle = 3.5;

  for (let f = 0; f <= dur; f += 1) {
    const u = f / dur;
    let pose = {};
    let targetAngle = 0;

    // Target rocking physics after arrow strikes at f=22
    if (f >= 22) {
      const tf = (f - 22) / 8; // 0..1
      targetAngle = 18 * Math.exp(-3.2 * tf) * Math.sin(tf * Math.PI * 2.5);
    }

    if (u < 0.22) {
      const t = u / 0.22;
      pose = {
        hipX: lerp(0, -10, t),
        hipY: lerp(0, 4, t),
        torso: lerp(4, -4, t),
        head: lerp(-3, 4, t),
        armL: lerp(-32, -88, t),
        forearmL: lerp(-18, -2, t),
        handL: lerp(45, 90, t),
        armR: lerp(14, -125, t),
        forearmR: lerp(-40, -85, t),
        thighL: lerp(9, -16, t),
        calfL: lerp(6, 18, t),
        footL: lerp(-13, -2, t),
        thighR: lerp(-11, 18, t),
        calfR: lerp(8, 6, t),
        footR: lerp(4, -16, t),
        bowPull: 0,
        capeRootRot: 6 * t,
        targetAngle,
      };
    } else if (u < 0.60) {
      const t = (u - 0.22) / 0.38;
      const ease = 1 - Math.pow(1 - t, 3);
      pose = {
        hipX: -12,
        hipY: 6,
        torso: lerp(-4, -10, ease),
        head: lerp(4, 10, ease),
        armL: -90,
        forearmL: 0,
        handL: 90,
        armR: lerp(-85, -18, ease),
        forearmR: lerp(-15, -122, ease),
        thighL: -22,
        calfL: 24,
        footL: -2,
        thighR: 24,
        calfR: 8,
        footR: -20,
        bowPull: ease,
        capeRootRot: 6 + 6 * ease,
        capeMidRot: 8 * ease,
        hairRot: 8 * ease,
        targetAngle,
      };
    } else if (u < 0.78) {
      const t = (u - 0.60) / 0.18;
      // High-frequency bowstring vibration immediately after release (f=18..22)
      const vib = Math.exp(-3.5 * t) * Math.sin(t * Math.PI * 4);
      pose = {
        hipX: -16,
        hipY: 6,
        torso: -14,
        head: 12,
        armL: -96,
        forearmL: -4,
        handL: 92,
        armR: lerp(-18, 25, t),
        forearmR: lerp(-122, -95, t),
        thighL: -22,
        calfL: 24,
        footL: -2,
        thighR: 24,
        calfR: 8,
        footR: -20,
        bowPull: 0,
        stringVib: vib,
        capeRootRot: 18 * Math.sin(t * Math.PI),
        capeMidRot: 14 * Math.sin(t * Math.PI),
        hairRot: 14,
        targetAngle,
      };
    } else {
      const t = (u - 0.78) / 0.22;
      pose = {
        hipX: lerp(-16, 0, t),
        hipY: lerp(6, 0, t),
        torso: lerp(-14, 4, t),
        head: lerp(12, -3, t),
        armL: lerp(-96, -32, t),
        forearmL: lerp(-4, -18, t),
        handL: lerp(92, 45, t),
        armR: lerp(25, 14, t),
        forearmR: lerp(-95, -40, t),
        thighL: lerp(-22, 9, t),
        calfL: lerp(24, 6, t),
        footL: lerp(-2, -13, t),
        thighR: lerp(24, -11, t),
        calfR: 8,
        footR: lerp(-20, 4, t),
        bowPull: 0,
        capeRootRot: lerp(10, 0, t),
        targetAngle,
      };
    }

    keys.push(...buildKeysForFrame(f, pose));

    // Parabolic flight of arrow_main from f=18 (launch at (325, 224)) to f=22 (hit bullseye (720, 238))
    if (f < 18) {
      keys.push(buildProjectileKey('arrow_main', f, 325, 224, -3));
    } else if (f <= 22) {
      const ft = (f - 18) / 4; // 0..1
      const ax = lerp(325, hitX, ft);
      const ay = lerp(224, hitY, ft) - 18 * Math.sin(ft * Math.PI);
      const ang = lerp(-4, hitAngle, ft);
      keys.push(buildProjectileKey('arrow_main', f, ax, ay, ang));
    } else {
      // Pinned in the rocking target!
      keys.push(buildPinnedProjectileKey('arrow_main', f, hitX, hitY, hitAngle, targetAngle));
    }
  }
  return keys;
}

// ============================================================================
// 5. JUMP_MULTISHOT (跃起散射 - 34 frames, once)
//   f=0..14  (0.00..0.42): Backflip-vault leap high into the air, aiming bow downward, full draw!
//   f=14..22 (0.42..0.65): Mid-air 3-arrow fan volley! 3 arrows streak into target at f=19!
//   f=19..34 (0.65..1.00): Target rocks wildly with all 3 pinned arrows while archer lands & recovers!
// ============================================================================
function genJumpMultishot() {
  const dur = 34;
  const keys = [];

  // 3 target impact points (upper ring, bullseye, lower ring)
  const hits = [
    { bone: 'arrow_up',   x: 722, y: 192, ang: 5  },
    { bone: 'arrow_main', x: 718, y: 242, ang: 14 },
    { bone: 'arrow_down', x: 722, y: 292, ang: 23 },
  ];

  for (let f = 0; f <= dur; f += 1) {
    const u = f / dur;
    let pose = {};
    let targetAngle = 0;

    if (f >= 19) {
      const tf = (f - 19) / 15;
      targetAngle = 25 * Math.exp(-3.0 * tf) * Math.sin(tf * Math.PI * 3.0);
    }

    if (u < 0.42) {
      const t = u / 0.42;
      const jumpArc = Math.sin(t * Math.PI * 0.5);
      pose = {
        hipX: lerp(0, -35, jumpArc),
        hipY: lerp(15, -95, jumpArc),
        hipRot: lerp(0, -18, jumpArc),
        torso: 12,
        head: -8,
        armL: lerp(-32, -68, jumpArc),
        forearmL: 0,
        handL: 90,
        armR: lerp(14, -5, jumpArc),
        forearmR: lerp(-40, -120, jumpArc),
        thighL: lerp(9, -55, jumpArc),
        calfL: lerp(6, 85, jumpArc),
        footL: lerp(-13, 25, jumpArc),
        thighR: lerp(-11, -20, jumpArc),
        calfR: lerp(8, 75, jumpArc),
        footR: lerp(4, 30, jumpArc),
        bowPull: Math.max(0, (t - 0.25) / 0.75),
        capeRootRot: 36 * jumpArc,
        capeMidRot: 22 * jumpArc,
        capeTipRot: 18 * jumpArc,
        hairRot: 24 * jumpArc,
        featherRot: 14 * jumpArc,
        targetAngle,
      };
    } else if (u < 0.65) {
      const t = (u - 0.42) / 0.23;
      const vib = Math.exp(-3.5 * t) * Math.sin(t * Math.PI * 4);
      pose = {
        hipX: lerp(-35, -50, t),
        hipY: lerp(-95, -75, t),
        hipRot: -12,
        torso: -10,
        head: 8,
        armL: -75,
        forearmL: -5,
        handL: 90,
        armR: lerp(-5, 30, Math.min(1, t * 2.5)),
        forearmR: lerp(-120, -90, Math.min(1, t * 2.5)),
        thighL: -45,
        calfL: 70,
        footL: 20,
        thighR: -15,
        calfR: 65,
        footR: 25,
        bowPull: 0,
        stringVib: vib,
        capeRootRot: 42,
        capeMidRot: 28,
        capeTipRot: 22,
        hairRot: 28,
        targetAngle,
      };
    } else {
      const t = (u - 0.65) / 0.35;
      const ease = t * t;
      const hipY = t < 0.7 ? lerp(-75, 16, t / 0.7) : lerp(16, 0, (t - 0.7) / 0.3);
      pose = {
        hipX: lerp(-50, 0, ease),
        hipY,
        hipRot: lerp(-12, 0, ease),
        torso: lerp(-10, 4, Math.sin(t * Math.PI * 0.5)),
        head: lerp(8, -3, ease),
        armL: lerp(-75, -32, ease),
        forearmL: -18,
        handL: lerp(90, 45, ease),
        armR: lerp(30, 14, ease),
        forearmR: lerp(-90, -40, ease),
        thighL: lerp(-35, 9, ease),
        calfL: lerp(55, 6, ease),
        footL: lerp(-10, -13, ease),
        thighR: lerp(25, -11, ease),
        calfR: lerp(35, 8, ease),
        footR: 4,
        bowPull: 0,
        capeRootRot: lerp(36, 0, ease),
        capeMidRot: lerp(20, 0, ease),
        hairRot: lerp(20, 0, ease),
        targetAngle,
      };
    }

    keys.push(...buildKeysForFrame(f, pose));

    // 3 spread-shot arrows launch at f=14 from mid-air bow position (275, 135) and hit target at f=19
    const launchX = 275;
    const launchY = 135;
    for (const h of hits) {
      if (f < 14) {
        keys.push(buildProjectileKey(h.bone, f, launchX, launchY, h.ang));
      } else if (f <= 19) {
        const ft = (f - 14) / 5;
        const ax = lerp(launchX, h.x, ft);
        const ay = lerp(launchY, h.y, ft) - 14 * Math.sin(ft * Math.PI);
        keys.push(buildProjectileKey(h.bone, f, ax, ay, h.ang));
      } else {
        keys.push(buildPinnedProjectileKey(h.bone, f, h.x, h.y, h.ang, targetAngle));
      }
    }
  }
  return keys;
}

// ============================================================================
// 6. HIT (角色受击 - 20 frames, once)
// ============================================================================
function genHit() {
  const dur = 20;
  const keys = [];
  for (let f = 0; f <= dur; f += 1) {
    const u = f / dur;
    let pose = {};
    if (u < 0.30) {
      const t = u / 0.30;
      const ease = 1 - Math.pow(1 - t, 3);
      pose = {
        hipX: lerp(0, -45, ease),
        hipY: lerp(0, -12, ease),
        torso: lerp(4, -30, ease),
        head: lerp(-3, -25, ease),
        armL: lerp(-32, -60, ease),
        forearmL: lerp(-18, -35, ease),
        handL: lerp(45, 20, ease),
        armR: lerp(14, 50, ease),
        forearmR: lerp(-40, -30, ease),
        thighL: lerp(9, -40, ease),
        calfL: lerp(6, 50, ease),
        footL: lerp(-13, 20, ease),
        thighR: lerp(-11, -15, ease),
        calfR: lerp(8, 40, ease),
        footR: lerp(4, 15, ease),
        capeRootRot: 32 * ease,
        capeMidRot: 24 * ease,
        hairRot: 28 * ease,
        featherRot: 18 * ease,
      };
    } else {
      const t = (u - 0.30) / 0.70;
      pose = {
        hipX: lerp(-45, 0, t),
        hipY: lerp(-12, 0, t),
        torso: lerp(-30, 4, t),
        head: lerp(-25, -3, t),
        armL: lerp(-60, -32, t),
        forearmL: lerp(-35, -18, t),
        handL: lerp(20, 45, t),
        armR: lerp(50, 14, t),
        forearmR: lerp(-30, -40, t),
        thighL: lerp(-40, 9, t),
        calfL: lerp(50, 6, t),
        footL: lerp(20, -13, t),
        thighR: lerp(-15, -11, t),
        calfR: lerp(40, 8, t),
        footR: lerp(15, 4, t),
        capeRootRot: lerp(32, 0, t),
        capeMidRot: lerp(24, 0, t),
        hairRot: lerp(28, 0, t),
        featherRot: lerp(18, 0, t),
      };
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
    name: 'Antigravity·骨骼动画师',
    task: '制作2D精灵弓箭手6套动作与可换装皮肤部件',
  });

  console.log('2. Creating project archer-2d...');
  await mcp.call('project_new', { name: 'archer-2d' });

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

  console.log('6. Converting cape_back into a 4x3 weighted mesh...');
  await mcp.call('mesh_create', { slot: 'cape_back', cols: 4, rows: 3 });
  await mcp.call('weights_auto', {
    slot: 'cape_back',
    bones: ['torso', 'cape_root', 'cape_mid', 'cape_tip'],
  });

  console.log('7. Rotating Setup Pose to IDLE0 (警戒待机) so Setup view & thumbnails look natural...');
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
  async function hideAllArrows(animName, dur) {
    for (const s of ['arrow_nocked', 'arrow_main', 'arrow_spread_up', 'arrow_spread_down']) {
      await mcp.call('slot_key', { animation: animName, slot: s, frame: 0,   attachment: '', color: { aM: 0 } });
      await mcp.call('slot_key', { animation: animName, slot: s, frame: dur, attachment: '', color: { aM: 0 } });
    }
  }

  console.log('8. Authoring 6 animations...');
  // (1) idle (32f loop)
  await mcp.call('animation_update', { animation: 'idle', duration: 32, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'idle', keys: genIdle() });
  await hideAllArrows('idle', 32);

  // (2) walk (24f loop)
  await mcp.call('animation_create', { name: 'walk', duration: 24, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'walk', keys: genWalk() });
  await hideAllArrows('walk', 24);
  await mcp.call('event_key', { animation: 'walk', frame: 6,  name: 'footstep_left' });
  await mcp.call('event_key', { animation: 'walk', frame: 18, name: 'footstep_right' });

  // (3) run (16f loop)
  await mcp.call('animation_create', { name: 'run', duration: 16, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'run', keys: genRun() });
  await hideAllArrows('run', 16);
  await mcp.call('event_key', { animation: 'run', frame: 4,  name: 'run_step_left' });
  await mcp.call('event_key', { animation: 'run', frame: 12, name: 'run_step_right' });

  // (4) aim_shoot (蓄力平射 - 30f loop in preview)
  await mcp.call('animation_create', { name: 'aim_shoot', duration: 30, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'aim_shoot', keys: genAimShoot() });
  // Hide spread arrows
  for (const s of ['arrow_spread_up', 'arrow_spread_down']) {
    await mcp.call('slot_key', { animation: 'aim_shoot', slot: s, frame: 0,  attachment: '', color: { aM: 0 } });
    await mcp.call('slot_key', { animation: 'aim_shoot', slot: s, frame: 30, attachment: '', color: { aM: 0 } });
  }
  // arrow_nocked visible during draw (f=4..17), hides at release (f=18)
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_nocked', frame: 0,  attachment: '',             color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_nocked', frame: 4,  attachment: 'arrow_nocked', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_nocked', frame: 17, attachment: 'arrow_nocked', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_nocked', frame: 18, attachment: '',             color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_nocked', frame: 30, attachment: '',             color: { aM: 0 } });
  // arrow_main appears at release (f=18), flies to target, stays pinned & fades at end
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_main', frame: 0,  attachment: '',           color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_main', frame: 17, attachment: '',           color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_main', frame: 18, attachment: 'arrow_main', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_main', frame: 28, attachment: 'arrow_main', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'aim_shoot', slot: 'arrow_main', frame: 30, attachment: '',           color: { aM: 0 } });
  await mcp.call('event_key', { animation: 'aim_shoot', frame: 6,  name: 'bow_draw' });
  await mcp.call('event_key', { animation: 'aim_shoot', frame: 18, name: 'shoot_arrow' });
  await mcp.call('event_key', { animation: 'aim_shoot', frame: 22, name: 'bullseye_hit' });

  // (5) jump_multishot (跃起散射 - 34f loop in preview)
  await mcp.call('animation_create', { name: 'jump_multishot', duration: 34, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'jump_multishot', keys: genJumpMultishot() });
  // arrow_nocked visible during mid-air draw (f=4..13), hides at volley release (f=14)
  await mcp.call('slot_key', { animation: 'jump_multishot', slot: 'arrow_nocked', frame: 0,  attachment: '',             color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'jump_multishot', slot: 'arrow_nocked', frame: 4,  attachment: 'arrow_nocked', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'jump_multishot', slot: 'arrow_nocked', frame: 13, attachment: 'arrow_nocked', color: { aM: 100 } });
  await mcp.call('slot_key', { animation: 'jump_multishot', slot: 'arrow_nocked', frame: 14, attachment: '',             color: { aM: 0 } });
  await mcp.call('slot_key', { animation: 'jump_multishot', slot: 'arrow_nocked', frame: 34, attachment: '',             color: { aM: 0 } });
  // All 3 projectile arrows appear at f=14, streak into target at f=19, rock with target until f=32
  for (const s of ['arrow_main', 'arrow_spread_up', 'arrow_spread_down']) {
    await mcp.call('slot_key', { animation: 'jump_multishot', slot: s, frame: 0,  attachment: '', color: { aM: 0 } });
    await mcp.call('slot_key', { animation: 'jump_multishot', slot: s, frame: 13, attachment: '', color: { aM: 0 } });
    await mcp.call('slot_key', { animation: 'jump_multishot', slot: s, frame: 14, attachment: s,  color: { aM: 100 } });
    await mcp.call('slot_key', { animation: 'jump_multishot', slot: s, frame: 32, attachment: s,  color: { aM: 100 } });
    await mcp.call('slot_key', { animation: 'jump_multishot', slot: s, frame: 34, attachment: '', color: { aM: 0 } });
  }
  await mcp.call('event_key', { animation: 'jump_multishot', frame: 2,  name: 'vault_jump' });
  await mcp.call('event_key', { animation: 'jump_multishot', frame: 14, name: 'multishot_fire' });
  await mcp.call('event_key', { animation: 'jump_multishot', frame: 19, name: 'target_triple_hit' });
  await mcp.call('event_key', { animation: 'jump_multishot', frame: 28, name: 'land_recover' });

  // (6) hit (角色受击 - 20f loop in preview)
  await mcp.call('animation_create', { name: 'hit', duration: 20, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'hit', keys: genHit() });
  await hideAllArrows('hit', 20);
  const flashSlots = ['torso_armor', 'head_elf', 'hood_feather', 'arm_upper_r', 'arm_lower_r', 'thigh_l', 'shin_l', 'cape_back'];
  for (const s of flashSlots) {
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 0, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 2, color: { rM: 100, gM: 25,  bM: 25,  aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 5, color: { rM: 100, gM: 25,  bM: 25,  aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 9, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  }
  await mcp.call('event_key', { animation: 'hit', frame: 2, name: 'hit_impact' });

  if (!process.env.SKIP_PREVIEWS) {
    console.log('9. Rendering setup pose & animation contact sheets + GIFs...');
    await mcp.call('render_frame', {
      setup: true,
      bones: false,
      width: 880,
      height: 560,
      background: '#0b2228',
      out: `${PREVIEW_DIR}/setup_pose.png`,
    });
    await mcp.call('render_frame', {
      setup: true,
      bones: true,
      width: 880,
      height: 560,
      background: '#0b2228',
      out: `${PREVIEW_DIR}/setup_bones.png`,
    });

    const animRenderSpecs = [
      { name: 'idle',           step: 4, cols: 5 },
      { name: 'walk',           step: 2, cols: 7 },
      { name: 'run',            step: 2, cols: 5 },
      { name: 'aim_shoot',      step: 2, cols: 6 },
      { name: 'jump_multishot', step: 2, cols: 6 },
      { name: 'hit',            step: 2, cols: 6 },
    ];

    for (const a of animRenderSpecs) {
      await mcp.call('render_animation', {
        animation: a.name,
        format: 'sheet',
        step: a.step,
        cols: a.cols,
        width: 380,
        height: 240,
        background: '#0b2228',
        out: `${PREVIEW_DIR}/${a.name}_sheet.png`,
      });
      await mcp.call('render_animation', {
        animation: a.name,
        format: 'gif',
        fps: 24,
        width: 640,
        height: 400,
        background: '#0b2228',
        out: `${PREVIEW_DIR}/${a.name}.gif`,
      });
    }
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
  console.log('Done! Project archer-2d saved in workspace.');
} finally {
  mcp.close();
}
