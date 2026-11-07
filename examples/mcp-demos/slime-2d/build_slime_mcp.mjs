/**
 * build_slime_mcp.mjs
 *
 * End-to-end BoneStudio MCP pipeline for 'slime-2d' (星露晶核史莱姆王 · 2D非人形半透明软体史莱姆):
 *   1. Creates 'slime-2d' (800x520, 24fps)
 *   2. Creates 15 non-humanoid soft-body bones in 0-deg horizontal reference orientation:
 *      - root -> shadow
 *      - root -> body_base (bottom contact pivot at y=406 so scaleY squashes/melts right onto the floor!)
 *      - body_base -> body_mid -> cheek_l, cheek_r, core, bubbles_back, bubbles_front, face (-> eyes, mouth), body_top (-> crest_drop), fx_splash
 *   3. Imports 18 translucent SVG->PNG layers at root via layers_add (with left/top bounds)
 *   4. Rebinds all 18 slots to their target bones with zIndex (zero-drift rebase)
 *   5. Builds 6x6 multi-bone soft-body weighted meshes for `slime_body` and `slime_back_rim`
 *      bound to `['body_base', 'body_mid', 'body_top', 'cheek_l', 'cheek_r']`
 *   6. Authors 5 complete 24fps animations (`playTimes: 0` for seamless loop preview in BoneStudio):
 *      - `idle`     (待机 - 32f): Jelly breathing, floating inner crystal core, drifting air bubbles, crown lag, eye blink
 *      - `hop_walk` (跳跃行走 - 24f): Anticipation squash, elastic launch stretch, mid-air arc, landing squash & jelly jiggle
 *      - `hop_run`  (跳跃奔跑 - 16f): High-speed forward-tilted bounding leaps, spinning core, flying slime droplets burst
 *      - `hit`      (受击 - 20f): Knockback shear, high-frequency damped jelly oscillation, '> <' tearful eyes + wail mouth, crimson flash & droplets
 *      - `die`      (死亡 - 34f): Unstable critical swelling & quivering ('X X' dizzy eyes) -> dramatic liquefaction melt into a wide flat puddle, crown & core drop and bounce!
 *   7. Exports Spine 4.2 (with validation) & DragonBones 5.5 and renders PNG/GIF previews.
 */

import fs from 'node:fs';
import path from 'node:path';
import { startMcp } from 'file:///C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/tools/mcp-client.mjs';

const SCRATCH_DIR = 'C:/Users/Administrator/.gemini/antigravity/scratch/slime-2d';
const PREVIEW_DIR = `${SCRATCH_DIR}/previews`;
const ARTIFACT_DIR = 'C:/Users/Administrator/.gemini/antigravity/brain/64c3fdc2-7eec-43b3-a77d-96c0cb31e6b6';
const EXPORT_SPINE_DIR = `${SCRATCH_DIR}/export_spine`;
const EXPORT_DB_DIR = `${SCRATCH_DIR}/export_db`;
const PROJECTS_DIR = 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects';

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
fs.mkdirSync(EXPORT_SPINE_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DB_DIR, { recursive: true });

// Remove stale lock if present
const lockPath = path.join(PROJECTS_DIR, 'slime-2d', '.lock.json');
if (fs.existsSync(lockPath)) {
  try { fs.unlinkSync(lockPath); } catch {}
}

const manifest = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'layers_manifest.json'), 'utf8'));
const J = manifest.joints;
const CANVAS_W = manifest.canvasWidth;   // 800
const CANVAS_H = manifest.canvasHeight;  // 520
const OX = CANVAS_W / 2;                 // 400
const OY = CANVAS_H;                     // 520 (layers_add origin convention)

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
// 15-Bone Non-Humanoid Soft-Body Hierarchy (All 0° Horizontal Bind Orientation!)
// Because every bone has wDeg = 0°, bone_keys `x, y, scaleX, scaleY, rotation`
// align 1:1 with canvas horizontal (+X right), vertical (+Y down), width scale,
// and height scale! And `body_base` sits right at the bottom contact (400, 406),
// so scaling `scaleY` on `body_base` squashes or melts the slime directly onto
// the ground plane without floating or sinking!
// ============================================================================
const BONE_SPECS = [
  { name: 'shadow',        parent: 'root',      from: J.shadow,        to: [J.shadow[0] + 40, J.shadow[1]] },
  { name: 'body_base',     parent: 'root',      from: J.body_base,     to: [J.body_base[0] + 40, J.body_base[1]] },
  { name: 'body_mid',      parent: 'body_base', from: J.body_mid,      to: [J.body_mid[0] + 36, J.body_mid[1]] },
  { name: 'cheek_l',       parent: 'body_mid',  from: J.cheek_l,       to: [J.cheek_l[0] + 24, J.cheek_l[1]] },
  { name: 'cheek_r',       parent: 'body_mid',  from: J.cheek_r,       to: [J.cheek_r[0] + 24, J.cheek_r[1]] },
  { name: 'core',          parent: 'body_mid',  from: J.core,          to: [J.core[0] + 28, J.core[1]] },
  { name: 'bubbles_back',  parent: 'body_mid',  from: J.bubbles_back,  to: [J.bubbles_back[0] + 24, J.bubbles_back[1]] },
  { name: 'bubbles_front', parent: 'body_mid',  from: J.bubbles_front, to: [J.bubbles_front[0] + 24, J.bubbles_front[1]] },
  { name: 'face',          parent: 'body_mid',  from: J.face,          to: [J.face[0] + 28, J.face[1]] },
  { name: 'eyes',          parent: 'face',      from: J.eyes,          to: [J.eyes[0] + 24, J.eyes[1]] },
  { name: 'mouth',         parent: 'face',      from: J.mouth,         to: [J.mouth[0] + 20, J.mouth[1]] },
  { name: 'body_top',      parent: 'body_mid',  from: J.body_top,      to: [J.body_top[0] + 32, J.body_top[1]] },
  { name: 'crest_drop',    parent: 'body_top',  from: J.crest_drop,    to: [J.crest_drop[0] + 28, J.crest_drop[1]] },
  { name: 'fx_splash',     parent: 'body_mid',  from: J.fx_splash,     to: [J.fx_splash[0] + 32, J.fx_splash[1]] },
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

// Helper to flatten per-bone keyframe lists into `bone_keys({ animation, keys })`
function flattenTrack(bone, keyframes) {
  return keyframes.map((kf) => ({ bone, ...kf }));
}

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
    name: 'Antigravity·星露晶核史莱姆(slime-2d)',
    task: '制作2D非人形半透明软体史莱姆骨骼与待机/跳跃行走/跳跃奔跑/受击/死亡融化5套动画',
  });

  console.log('2. Creating project slime-2d...');
  await mcp.call('project_new', { name: 'slime-2d' });

  console.log(`3. Creating ${boneConfigs.length} soft-body bones...`);
  for (const b of boneConfigs) {
    await mcp.call('bone_create', b);
  }

  console.log(`4. Importing ${manifest.layers.length} translucent PNG layers at root...`);
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

  // Hide alternative facial expressions & splash VFX in Setup Pose by default
  const defaultHidden = ['eyes_blink', 'eyes_hurt', 'eyes_dizzy', 'mouth_wail', 'splash_droplets_fx'];
  for (const slotName of defaultHidden) {
    await mcp.call('slot_update', {
      slot: slotName,
      attachment: '',
      color: { rM: 100, gM: 100, bM: 100, aM: 0 },
    });
  }

  console.log('6. Building 6x6 multi-bone soft-body weighted meshes for slime_body & slime_back_rim...');
  const softBodyBones = ['body_base', 'body_mid', 'body_top', 'cheek_l', 'cheek_r'];
  for (const meshSlot of ['slime_body', 'slime_back_rim']) {
    await mcp.call('mesh_create', { slot: meshSlot, cols: 6, rows: 6 });
    await mcp.call('weights_auto', { slot: meshSlot, bones: softBodyBones });
  }

  const ALL_EXPR_SLOTS = [
    'eyes_normal',
    'eyes_blink',
    'eyes_hurt',
    'eyes_dizzy',
    'mouth_smile',
    'mouth_wail',
    'splash_droplets_fx',
  ];

  async function setExpressionState(animation, frame, visibleSlots, extraColors = {}) {
    const visSet = new Set(visibleSlots);
    for (const slot of ALL_EXPR_SLOTS) {
      const isVis = visSet.has(slot);
      const custom = extraColors[slot] || {};
      const aM = custom.aM ?? (isVis ? 100 : 0);
      await mcp.call('slot_key', {
        animation,
        slot,
        frame,
        attachment: aM > 0 ? slot : '',
        color: {
          rM: custom.rM ?? 100,
          gM: custom.gM ?? 100,
          bM: custom.bM ?? 100,
          aM,
        },
      });
    }
  }

  // ==========================================================================
  // ANIMATION 1: IDLE (待机 - 32f @ 24fps, playTimes: 0)
  // ==========================================================================
  console.log('7. Authoring animation: idle (32f)...');
  await mcp.call('animation_update', { animation: 'idle', duration: 32, playTimes: 0 });

  const idleKeys = [
    ...flattenTrack('body_base', [
      { frame: 0,  x: 0, y: 0, scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  x: 0, y: 0, scaleX: 1.06, scaleY: 0.94, curve: 'easeInOut' },
      { frame: 16, x: 0, y: 0, scaleX: 0.97, scaleY: 1.04, curve: 'easeInOut' },
      { frame: 24, x: 0, y: 0, scaleX: 1.05, scaleY: 0.95, curve: 'easeInOut' },
      { frame: 32, x: 0, y: 0, scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('shadow', [
      { frame: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  scaleX: 1.06, scaleY: 1.02, curve: 'easeInOut' },
      { frame: 16, scaleX: 0.96, scaleY: 0.98, curve: 'easeInOut' },
      { frame: 24, scaleX: 1.05, scaleY: 1.02, curve: 'easeInOut' },
      { frame: 32, scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('body_mid', [
      { frame: 0,  x: 0, y: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 10, x: 0, y: 3,  scaleX: 1.04, scaleY: 0.97, curve: 'easeInOut' },
      { frame: 18, x: 0, y: -3, scaleX: 0.98, scaleY: 1.03, curve: 'easeInOut' },
      { frame: 26, x: 0, y: 2,  scaleX: 1.03, scaleY: 0.98, curve: 'easeInOut' },
      { frame: 32, x: 0, y: 0,  scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('cheek_l', [
      { frame: 0,  x: 0,  y: 0,  curve: 'easeInOut' },
      { frame: 9,  x: -5, y: 2,  curve: 'easeInOut' },
      { frame: 17, x: 3,  y: -2, curve: 'easeInOut' },
      { frame: 25, x: -4, y: 2,  curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0 },
    ]),
    ...flattenTrack('cheek_r', [
      { frame: 0,  x: 0,  y: 0,  curve: 'easeInOut' },
      { frame: 9,  x: 5,  y: 2,  curve: 'easeInOut' },
      { frame: 17, x: -3, y: -2, curve: 'easeInOut' },
      { frame: 25, x: 4,  y: 2,  curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0 },
    ]),
    ...flattenTrack('core', [
      { frame: 0,  x: 0,  y: 0,  rotation: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  x: 2,  y: -6, rotation: 8,  scaleX: 1.05, scaleY: 1.05, curve: 'easeInOut' },
      { frame: 16, x: 0,  y: 4,  rotation: 0,  scaleX: 0.98, scaleY: 0.98, curve: 'easeInOut' },
      { frame: 24, x: -2, y: -5, rotation: -8, scaleX: 1.04, scaleY: 1.04, curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0,  rotation: 0,  scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('bubbles_back', [
      { frame: 0,  x: 0,  y: 0,  rotation: 0,  curve: 'easeInOut' },
      { frame: 11, x: -3, y: -7, rotation: -6, curve: 'easeInOut' },
      { frame: 22, x: 2,  y: 4,  rotation: 5,  curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0,  rotation: 0 },
    ]),
    ...flattenTrack('bubbles_front', [
      { frame: 0,  x: 0,  y: 0,  rotation: 0,  curve: 'easeInOut' },
      { frame: 10, x: 3,  y: 5,  rotation: 7,  curve: 'easeInOut' },
      { frame: 21, x: -2, y: -8, rotation: -5, curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0,  rotation: 0 },
    ]),
    ...flattenTrack('face', [
      { frame: 0,  x: 0, y: 0,  curve: 'easeInOut' },
      { frame: 9,  x: 0, y: 3,  curve: 'easeInOut' },
      { frame: 17, x: 0, y: -3, curve: 'easeInOut' },
      { frame: 25, x: 0, y: 2,  curve: 'easeInOut' },
      { frame: 32, x: 0, y: 0 },
    ]),
    ...flattenTrack('crest_drop', [
      { frame: 0,  x: 0,  y: 0,  rotation: 0,  curve: 'easeInOut' },
      { frame: 10, x: 2,  y: 2,  rotation: 9,  curve: 'easeInOut' },
      { frame: 18, x: -2, y: -2, rotation: -7, curve: 'easeInOut' },
      { frame: 26, x: 2,  y: 2,  rotation: 8,  curve: 'easeInOut' },
      { frame: 32, x: 0,  y: 0,  rotation: 0 },
    ]),
  ];
  await mcp.call('bone_keys', { animation: 'idle', keys: idleKeys });

  await setExpressionState('idle', 0,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('idle', 13, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('idle', 14, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('idle', 17, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('idle', 18, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('idle', 32, ['eyes_normal', 'mouth_smile']);
  await mcp.call('slot_key', { animation: 'idle', slot: 'slime_body', frame: 0,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'idle', slot: 'slime_body', frame: 32, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });

  // ==========================================================================
  // ANIMATION 2: HOP_WALK (跳跃行走 - 24f @ 24fps, playTimes: 0)
  // ==========================================================================
  console.log('8. Authoring animation: hop_walk (24f)...');
  await mcp.call('animation_create', { name: 'hop_walk', duration: 24, playTimes: 0 });

  const hopWalkKeys = [
    ...flattenTrack('body_base', [
      { frame: 0,  x: 0,  y: 0,   rotation: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 4,  x: -4, y: 0,   rotation: -3, scaleX: 1.18, scaleY: 0.80, curve: 'easeIn' },
      { frame: 7,  x: 4,  y: -52, rotation: 6,  scaleX: 0.84, scaleY: 1.22, curve: 'easeOut' },
      { frame: 11, x: 8,  y: -78, rotation: 2,  scaleX: 1.04, scaleY: 0.96, curve: 'easeIn' },
      { frame: 15, x: 4,  y: -20, rotation: -5, scaleX: 0.87, scaleY: 1.16, curve: 'easeIn' },
      { frame: 17, x: 0,  y: 0,   rotation: -2, scaleX: 1.24, scaleY: 0.76, curve: 'easeOut' },
      { frame: 20, x: 0,  y: 0,   rotation: 2,  scaleX: 0.93, scaleY: 1.08, curve: 'easeInOut' },
      { frame: 22, x: 0,  y: 0,   rotation: -1, scaleX: 1.04, scaleY: 0.96, curve: 'easeInOut' },
      { frame: 24, x: 0,  y: 0,   rotation: 0,  scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('shadow', [
      { frame: 0,  x: 0,  y: 0, scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 4,  x: -4, y: 0, scaleX: 1.16, scaleY: 1.08, curve: 'easeIn' },
      { frame: 7,  x: 4,  y: 0, scaleX: 0.76, scaleY: 0.78, curve: 'easeOut' },
      { frame: 11, x: 8,  y: 0, scaleX: 0.62, scaleY: 0.64, curve: 'easeIn' },
      { frame: 15, x: 4,  y: 0, scaleX: 0.84, scaleY: 0.85, curve: 'easeIn' },
      { frame: 17, x: 0,  y: 0, scaleX: 1.22, scaleY: 1.12, curve: 'easeOut' },
      { frame: 20, x: 0,  y: 0, scaleX: 0.95, scaleY: 0.96, curve: 'easeInOut' },
      { frame: 24, x: 0,  y: 0, scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('cheek_l', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 4,  x: -10, y: 6,  curve: 'easeIn' },
      { frame: 7,  x: 8,   y: -6, curve: 'easeOut' },
      { frame: 11, x: -3,  y: 0,  curve: 'easeIn' },
      { frame: 17, x: -14, y: 8,  curve: 'easeOut' },
      { frame: 20, x: 5,   y: -4, curve: 'easeInOut' },
      { frame: 24, x: 0,   y: 0 },
    ]),
    ...flattenTrack('cheek_r', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 4,  x: 10,  y: 6,  curve: 'easeIn' },
      { frame: 7,  x: -8,  y: -6, curve: 'easeOut' },
      { frame: 11, x: 3,   y: 0,  curve: 'easeIn' },
      { frame: 17, x: 14,  y: 8,  curve: 'easeOut' },
      { frame: 20, x: -5,  y: -4, curve: 'easeInOut' },
      { frame: 24, x: 0,   y: 0 },
    ]),
    ...flattenTrack('core', [
      { frame: 0,  x: 0,  y: 0,   rotation: 0,   curve: 'easeInOut' },
      { frame: 4,  x: 0,  y: 8,   rotation: -8,  curve: 'easeIn' },
      { frame: 7,  x: -2, y: 12,  rotation: 12,  curve: 'easeOut' },
      { frame: 12, x: 2,  y: -10, rotation: 22,  curve: 'easeIn' },
      { frame: 18, x: 0,  y: 14,  rotation: -14, curve: 'easeOut' },
      { frame: 21, x: 0,  y: -6,  rotation: 6,   curve: 'easeInOut' },
      { frame: 24, x: 0,  y: 0,   rotation: 0 },
    ]),
    ...flattenTrack('face', [
      { frame: 0,  x: 0, y: 0,  curve: 'easeInOut' },
      { frame: 4,  x: 0, y: 6,  curve: 'easeIn' },
      { frame: 8,  x: 2, y: -6, curve: 'easeOut' },
      { frame: 12, x: 2, y: -8, curve: 'easeIn' },
      { frame: 17, x: 0, y: 10, curve: 'easeOut' },
      { frame: 20, x: 0, y: -4, curve: 'easeInOut' },
      { frame: 24, x: 0, y: 0 },
    ]),
    ...flattenTrack('crest_drop', [
      { frame: 0,  x: 0,  y: 0,   rotation: 0,   curve: 'easeInOut' },
      { frame: 4,  x: -2, y: 5,   rotation: -12, curve: 'easeIn' },
      { frame: 8,  x: -6, y: 6,   rotation: -22, curve: 'easeOut' },
      { frame: 12, x: 4,  y: -10, rotation: 16,  curve: 'easeIn' },
      { frame: 18, x: 4,  y: 10,  rotation: 24,  curve: 'easeOut' },
      { frame: 21, x: -2, y: -4,  rotation: -10, curve: 'easeInOut' },
      { frame: 24, x: 0,  y: 0,   rotation: 0 },
    ]),
  ];
  await mcp.call('bone_keys', { animation: 'hop_walk', keys: hopWalkKeys });

  await setExpressionState('hop_walk', 0,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_walk', 3,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_walk', 4,  ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hop_walk', 6,  ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hop_walk', 7,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_walk', 16, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_walk', 17, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hop_walk', 19, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hop_walk', 20, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_walk', 24, ['eyes_normal', 'mouth_smile']);
  await mcp.call('slot_key', { animation: 'hop_walk', slot: 'slime_body', frame: 0,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'hop_walk', slot: 'slime_body', frame: 24, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('event_key', { animation: 'hop_walk', frame: 5,  name: 'slime_hop_launch' });
  await mcp.call('event_key', { animation: 'hop_walk', frame: 17, name: 'slime_hop_land' });

  // ==========================================================================
  // ANIMATION 3: HOP_RUN (跳跃奔跑 - 16f @ 24fps, playTimes: 0)
  // ==========================================================================
  console.log('9. Authoring animation: hop_run (16f)...');
  await mcp.call('animation_create', { name: 'hop_run', duration: 16, playTimes: 0 });

  const hopRunKeys = [
    ...flattenTrack('body_base', [
      { frame: 0,  x: 0,   y: 0,    rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 3,  x: -14, y: 0,    rotation: -8,  scaleX: 1.30, scaleY: 0.70, curve: 'easeIn' },
      { frame: 6,  x: 12,  y: -78,  rotation: 16,  scaleX: 0.76, scaleY: 1.32, curve: 'easeOut' },
      { frame: 8,  x: 20,  y: -112, rotation: 6,   scaleX: 1.06, scaleY: 0.94, curve: 'easeIn' },
      { frame: 11, x: 10,  y: -28,  rotation: -12, scaleX: 0.82, scaleY: 1.22, curve: 'easeIn' },
      { frame: 13, x: -4,  y: 0,    rotation: -4,  scaleX: 1.34, scaleY: 0.68, curve: 'easeOut' },
      { frame: 15, x: 2,   y: 0,    rotation: 3,   scaleX: 0.92, scaleY: 1.08, curve: 'easeInOut' },
      { frame: 16, x: 0,   y: 0,    rotation: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('shadow', [
      { frame: 0,  x: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 3,  x: -14, scaleX: 1.28, scaleY: 1.15, curve: 'easeIn' },
      { frame: 6,  x: 12,  scaleX: 0.65, scaleY: 0.65, curve: 'easeOut' },
      { frame: 8,  x: 20,  scaleX: 0.48, scaleY: 0.50, curve: 'easeIn' },
      { frame: 11, x: 10,  scaleX: 0.78, scaleY: 0.78, curve: 'easeIn' },
      { frame: 13, x: -4,  scaleX: 1.32, scaleY: 1.18, curve: 'easeOut' },
      { frame: 16, x: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('cheek_l', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 3,  x: -16, y: 8,  curve: 'easeIn' },
      { frame: 6,  x: 12,  y: -8, curve: 'easeOut' },
      { frame: 13, x: -18, y: 10, curve: 'easeOut' },
      { frame: 16, x: 0,   y: 0 },
    ]),
    ...flattenTrack('cheek_r', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 3,  x: 16,  y: 8,  curve: 'easeIn' },
      { frame: 6,  x: -12, y: -8, curve: 'easeOut' },
      { frame: 13, x: 18,  y: 10, curve: 'easeOut' },
      { frame: 16, x: 0,   y: 0 },
    ]),
    ...flattenTrack('core', [
      { frame: 0,  x: 0,  y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 3,  x: -4, y: 10,  rotation: -18, scaleX: 1.08, scaleY: 0.94, curve: 'easeIn' },
      { frame: 6,  x: -6, y: 14,  rotation: 28,  scaleX: 1.12, scaleY: 1.12, curve: 'easeOut' },
      { frame: 9,  x: 6,  y: -14, rotation: 45,  scaleX: 1.06, scaleY: 1.06, curve: 'easeIn' },
      { frame: 13, x: 4,  y: 16,  rotation: -22, scaleX: 1.14, scaleY: 0.90, curve: 'easeOut' },
      { frame: 16, x: 0,  y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('crest_drop', [
      { frame: 0,  x: 0,   y: 0,   rotation: 0,   curve: 'easeInOut' },
      { frame: 3,  x: -6,  y: 8,   rotation: -20, curve: 'easeIn' },
      { frame: 6,  x: -12, y: 10,  rotation: -35, curve: 'easeOut' },
      { frame: 9,  x: 8,   y: -14, rotation: 26,  curve: 'easeIn' },
      { frame: 13, x: 10,  y: 14,  rotation: 32,  curve: 'easeOut' },
      { frame: 16, x: 0,   y: 0,   rotation: 0 },
    ]),
    ...flattenTrack('fx_splash', [
      { frame: 0,  x: 0, y: 0,   scaleX: 0.70, scaleY: 0.70 },
      { frame: 4,  x: 0, y: 10,  scaleX: 0.82, scaleY: 0.82, curve: 'easeOut' },
      { frame: 7,  x: 0, y: -15, scaleX: 1.24, scaleY: 1.18 },
      { frame: 12, x: 0, y: 18,  scaleX: 0.85, scaleY: 0.80, curve: 'easeOut' },
      { frame: 15, x: 0, y: 4,   scaleX: 1.32, scaleY: 1.15 },
      { frame: 16, x: 0, y: 0,   scaleX: 0.70, scaleY: 0.70 },
    ]),
  ];
  await mcp.call('bone_keys', { animation: 'hop_run', keys: hopRunKeys });

  await setExpressionState('hop_run', 0,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_run', 2,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_run', 3,  ['eyes_blink',  'mouth_wail']);
  await setExpressionState('hop_run', 4,  ['eyes_normal', 'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('hop_run', 7,  ['eyes_normal', 'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('hop_run', 8,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_run', 11, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_run', 12, ['eyes_blink',  'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('hop_run', 14, ['eyes_blink',  'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('hop_run', 15, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hop_run', 16, ['eyes_normal', 'mouth_smile']);
  await mcp.call('slot_key', { animation: 'hop_run', slot: 'slime_body', frame: 0,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'hop_run', slot: 'slime_body', frame: 16, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('event_key', { animation: 'hop_run', frame: 4,  name: 'slime_dash_launch' });
  await mcp.call('event_key', { animation: 'hop_run', frame: 13, name: 'slime_dash_slam' });

  // ==========================================================================
  // ANIMATION 4: HIT (受击 - 20f @ 24fps, playTimes: 0)
  // ==========================================================================
  console.log('10. Authoring animation: hit (20f)...');
  await mcp.call('animation_create', { name: 'hit', duration: 20, playTimes: 0 });

  const hitKeys = [
    ...flattenTrack('body_base', [
      { frame: 0,  x: 0,   y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeOut' },
      { frame: 2,  x: -28, y: -14, rotation: -16, scaleX: 0.78, scaleY: 1.26, curve: 'easeOut' },
      { frame: 5,  x: -42, y: 0,   rotation: -8,  scaleX: 1.32, scaleY: 0.72, curve: 'easeInOut' },
      { frame: 8,  x: -18, y: -8,  rotation: 12,  scaleX: 0.86, scaleY: 1.16, curve: 'easeInOut' },
      { frame: 11, x: -26, y: 0,   rotation: -9,  scaleX: 1.18, scaleY: 0.84, curve: 'easeInOut' },
      { frame: 14, x: -8,  y: 0,   rotation: 6,   scaleX: 0.93, scaleY: 1.07, curve: 'easeInOut' },
      { frame: 17, x: -3,  y: 0,   rotation: -3,  scaleX: 1.05, scaleY: 0.96, curve: 'easeInOut' },
      { frame: 20, x: 0,   y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('shadow', [
      { frame: 0,  x: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeOut' },
      { frame: 2,  x: -28, scaleX: 0.82, scaleY: 0.85, curve: 'easeOut' },
      { frame: 5,  x: -42, scaleX: 1.28, scaleY: 1.14, curve: 'easeInOut' },
      { frame: 8,  x: -18, scaleX: 0.90, scaleY: 0.92, curve: 'easeInOut' },
      { frame: 11, x: -26, scaleX: 1.15, scaleY: 1.06, curve: 'easeInOut' },
      { frame: 14, x: -8,  scaleX: 0.96, scaleY: 0.98, curve: 'easeInOut' },
      { frame: 20, x: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('cheek_l', [
      { frame: 0,  x: 0,   y: 0,   curve: 'easeOut' },
      { frame: 2,  x: -22, y: -10, curve: 'easeOut' },
      { frame: 5,  x: -16, y: 10,  curve: 'easeInOut' },
      { frame: 8,  x: 14,  y: -6,  curve: 'easeInOut' },
      { frame: 11, x: -10, y: 5,   curve: 'easeInOut' },
      { frame: 14, x: 6,   y: -3,  curve: 'easeInOut' },
      { frame: 20, x: 0,   y: 0 },
    ]),
    ...flattenTrack('cheek_r', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeOut' },
      { frame: 2,  x: -18, y: 8,  curve: 'easeOut' },
      { frame: 5,  x: 18,  y: 10, curve: 'easeInOut' },
      { frame: 8,  x: 16,  y: -8, curve: 'easeInOut' },
      { frame: 11, x: 10,  y: 5,  curve: 'easeInOut' },
      { frame: 14, x: -5,  y: -3, curve: 'easeInOut' },
      { frame: 20, x: 0,   y: 0 },
    ]),
    ...flattenTrack('core', [
      { frame: 0,  x: 0,   y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeOut' },
      { frame: 3,  x: 18,  y: -12, rotation: 32,  scaleX: 1.18, scaleY: 1.18, curve: 'easeInOut' },
      { frame: 6,  x: -16, y: 12,  rotation: -28, scaleX: 0.92, scaleY: 0.92, curve: 'easeInOut' },
      { frame: 9,  x: 12,  y: -8,  rotation: 20,  scaleX: 1.08, scaleY: 1.08, curve: 'easeInOut' },
      { frame: 12, x: -8,  y: 6,   rotation: -14, scaleX: 0.96, scaleY: 0.96, curve: 'easeInOut' },
      { frame: 16, x: 4,   y: -3,  rotation: 6,   scaleX: 1.02, scaleY: 1.02, curve: 'easeInOut' },
      { frame: 20, x: 0,   y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00 },
    ]),
    ...flattenTrack('crest_drop', [
      { frame: 0,  x: 0,   y: 0,   rotation: 0,   curve: 'easeOut' },
      { frame: 3,  x: 22,  y: -26, rotation: 42,  curve: 'easeOut' },
      { frame: 6,  x: -18, y: 8,   rotation: -34, curve: 'easeInOut' },
      { frame: 10, x: 12,  y: -10, rotation: 24,  curve: 'easeInOut' },
      { frame: 14, x: -6,  y: 4,   rotation: -12, curve: 'easeInOut' },
      { frame: 20, x: 0,   y: 0,   rotation: 0 },
    ]),
    ...flattenTrack('fx_splash', [
      { frame: 0,  x: 0,   y: 0,   scaleX: 0.50, scaleY: 0.50 },
      { frame: 1,  x: 0,   y: 0,   scaleX: 0.75, scaleY: 0.75, curve: 'easeOut' },
      { frame: 4,  x: -10, y: -12, scaleX: 1.25, scaleY: 1.22, curve: 'easeOut' },
      { frame: 9,  x: -18, y: 6,   scaleX: 1.48, scaleY: 1.35 },
      { frame: 20, x: 0,   y: 0,   scaleX: 0.50, scaleY: 0.50 },
    ]),
  ];
  await mcp.call('bone_keys', { animation: 'hit', keys: hitKeys });

  await setExpressionState('hit', 0,  ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hit', 1,  ['eyes_hurt',   'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('hit', 8,  ['eyes_hurt',   'mouth_wail', 'splash_droplets_fx'], {
    splash_droplets_fx: { aM: 45 },
  });
  await setExpressionState('hit', 9,  ['eyes_hurt',   'mouth_wail']);
  await setExpressionState('hit', 15, ['eyes_hurt',   'mouth_wail']);
  await setExpressionState('hit', 16, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hit', 18, ['eyes_blink',  'mouth_smile']);
  await setExpressionState('hit', 19, ['eyes_normal', 'mouth_smile']);
  await setExpressionState('hit', 20, ['eyes_normal', 'mouth_smile']);

  await mcp.call('slot_key', { animation: 'hit', slot: 'slime_body', frame: 0,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'hit', slot: 'slime_body', frame: 2,  color: { rM: 100, gM: 55,  bM: 75,  aM: 100 } });
  await mcp.call('slot_key', { animation: 'hit', slot: 'slime_body', frame: 6,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'hit', slot: 'slime_body', frame: 20, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('event_key', { animation: 'hit', frame: 1, name: 'slime_hit_impact' });

  // ==========================================================================
  // ANIMATION 5: DIE (死亡 - 34f @ 24fps, playTimes: 0)
  // ==========================================================================
  console.log('11. Authoring animation: die (34f)...');
  await mcp.call('animation_create', { name: 'die', duration: 34, playTimes: 0 });

  const dieKeys = [
    ...flattenTrack('body_base', [
      { frame: 0,  x: 0,   y: 0, rotation: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 2,  x: -8,  y: 0, rotation: -5, scaleX: 1.14, scaleY: 1.10, curve: 'easeInOut' },
      { frame: 4,  x: 8,   y: 0, rotation: 5,  scaleX: 1.20, scaleY: 1.18, curve: 'easeInOut' },
      { frame: 6,  x: -6,  y: 0, rotation: -4, scaleX: 1.26, scaleY: 1.24, curve: 'easeInOut' },
      { frame: 8,  x: 4,   y: 0, rotation: 3,  scaleX: 1.30, scaleY: 1.26, curve: 'easeIn' },
      { frame: 14, x: 0,   y: 0, rotation: -2, scaleX: 1.54, scaleY: 0.42, curve: 'easeOut' },
      { frame: 18, x: 0,   y: 0, rotation: 0,  scaleX: 1.66, scaleY: 0.27, curve: 'easeInOut' },
      { frame: 22, x: 0,   y: 0, rotation: 0,  scaleX: 1.58, scaleY: 0.32, curve: 'easeInOut' },
      { frame: 26, x: 0,   y: 0, rotation: 0,  scaleX: 1.64, scaleY: 0.28, curve: 'easeInOut' },
      { frame: 34, x: 0,   y: 0, rotation: 0,  scaleX: 1.64, scaleY: 0.28 },
    ]),
    ...flattenTrack('shadow', [
      { frame: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  scaleX: 1.26, scaleY: 1.15, curve: 'easeIn' },
      { frame: 18, scaleX: 1.65, scaleY: 1.28, curve: 'easeOut' },
      { frame: 34, scaleX: 1.65, scaleY: 1.28 },
    ]),
    ...flattenTrack('cheek_l', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 8,  x: -10, y: -6, curve: 'easeIn' },
      { frame: 18, x: -24, y: 14, curve: 'easeOut' },
      { frame: 34, x: -24, y: 14 },
    ]),
    ...flattenTrack('cheek_r', [
      { frame: 0,  x: 0,   y: 0,  curve: 'easeInOut' },
      { frame: 8,  x: 10,  y: -6, curve: 'easeIn' },
      { frame: 18, x: 24,  y: 14, curve: 'easeOut' },
      { frame: 34, x: 24,  y: 14 },
    ]),
    ...flattenTrack('core', [
      { frame: 0,  x: 0,   y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 4,  x: -6,  y: -8,  rotation: -20, scaleX: 1.05, scaleY: 1.05, curve: 'easeInOut' },
      { frame: 8,  x: 6,   y: -14, rotation: 25,  scaleX: 1.10, scaleY: 1.10, curve: 'easeIn' },
      { frame: 14, x: -8,  y: 18,  rotation: -38, scaleX: 0.68, scaleY: 2.10, curve: 'easeOut' },
      { frame: 18, x: -12, y: 28,  rotation: -52, scaleX: 0.62, scaleY: 3.10, curve: 'easeInOut' },
      { frame: 22, x: -12, y: 22,  rotation: -46, scaleX: 0.64, scaleY: 2.80, curve: 'easeInOut' },
      { frame: 26, x: -12, y: 28,  rotation: -50, scaleX: 0.62, scaleY: 3.05, curve: 'easeInOut' },
      { frame: 34, x: -12, y: 28,  rotation: -50, scaleX: 0.62, scaleY: 3.05 },
    ]),
    ...flattenTrack('face', [
      { frame: 0,  x: 0, y: 0,  rotation: 0,  scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  x: 0, y: -6, rotation: -4, scaleX: 1.02, scaleY: 1.02, curve: 'easeIn' },
      { frame: 18, x: 6, y: 24, rotation: 8,  scaleX: 0.68, scaleY: 2.65, curve: 'easeOut' },
      { frame: 34, x: 6, y: 24, rotation: 8,  scaleX: 0.68, scaleY: 2.65 },
    ]),
    ...flattenTrack('crest_drop', [
      { frame: 0,  x: 0,  y: 0,   rotation: 0,   scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 4,  x: -6, y: -4,  rotation: -14, scaleX: 1.00, scaleY: 1.00, curve: 'easeInOut' },
      { frame: 8,  x: 8,  y: -12, rotation: 18,  scaleX: 0.95, scaleY: 0.95, curve: 'easeOut' },
      { frame: 12, x: 16, y: -48, rotation: 36,  scaleX: 0.72, scaleY: 1.85, curve: 'easeIn' },
      { frame: 18, x: 24, y: 12,  rotation: 52,  scaleX: 0.62, scaleY: 3.20, curve: 'easeOut' },
      { frame: 21, x: 26, y: -12, rotation: 40,  scaleX: 0.64, scaleY: 2.85, curve: 'easeIn' },
      { frame: 25, x: 28, y: 14,  rotation: 56,  scaleX: 0.62, scaleY: 3.15, curve: 'easeOut' },
      { frame: 34, x: 28, y: 14,  rotation: 56,  scaleX: 0.62, scaleY: 3.15 },
    ]),
    ...flattenTrack('bubbles_back', [
      { frame: 0,  x: 0,   y: 0,   scaleX: 1.0, scaleY: 1.0 },
      { frame: 8,  x: -8,  y: -16, scaleX: 1.2, scaleY: 1.2 },
      { frame: 18, x: -18, y: -36, scaleX: 0.5, scaleY: 1.8 },
      { frame: 34, x: -18, y: -36, scaleX: 0.5, scaleY: 1.8 },
    ]),
    ...flattenTrack('bubbles_front', [
      { frame: 0,  x: 0,  y: 0,   scaleX: 1.0, scaleY: 1.0 },
      { frame: 8,  x: 8,  y: -18, scaleX: 1.2, scaleY: 1.2 },
      { frame: 18, x: 20, y: -40, scaleX: 0.5, scaleY: 1.8 },
      { frame: 34, x: 20, y: -40, scaleX: 0.5, scaleY: 1.8 },
    ]),
    ...flattenTrack('fx_splash', [
      { frame: 0,  x: 0, y: 0,   scaleX: 0.50, scaleY: 0.50 },
      { frame: 8,  x: 0, y: -12, scaleX: 0.85, scaleY: 0.85, curve: 'easeOut' },
      { frame: 14, x: 0, y: 10,  scaleX: 1.38, scaleY: 2.40, curve: 'easeOut' },
      { frame: 18, x: 0, y: 24,  scaleX: 1.52, scaleY: 2.80 },
      { frame: 34, x: 0, y: 24,  scaleX: 1.52, scaleY: 2.80 },
    ]),
  ];
  await mcp.call('bone_keys', { animation: 'die', keys: dieKeys });

  await setExpressionState('die', 0,  ['eyes_hurt',  'mouth_wail']);
  await setExpressionState('die', 3,  ['eyes_hurt',  'mouth_wail']);
  await setExpressionState('die', 4,  ['eyes_dizzy', 'mouth_wail']);
  await setExpressionState('die', 7,  ['eyes_dizzy', 'mouth_wail']);
  await setExpressionState('die', 8,  ['eyes_dizzy', 'mouth_wail', 'splash_droplets_fx']);
  await setExpressionState('die', 15, ['eyes_dizzy', 'mouth_wail', 'splash_droplets_fx'], {
    splash_droplets_fx: { aM: 35 },
  });
  await setExpressionState('die', 16, ['eyes_dizzy', 'mouth_wail']);
  await setExpressionState('die', 34, ['eyes_dizzy', 'mouth_wail']);

  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 0,  color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 3,  color: { rM: 100, gM: 65,  bM: 85,  aM: 100 } });
  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 6,  color: { rM: 100, gM: 95,  bM: 60,  aM: 100 } });
  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 8,  color: { rM: 100, gM: 55,  bM: 80,  aM: 100 } });
  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 18, color: { rM: 88,  gM: 96,  bM: 100, aM: 92 } });
  await mcp.call('slot_key', { animation: 'die', slot: 'slime_body', frame: 34, color: { rM: 88,  gM: 96,  bM: 100, aM: 92 } });
  await mcp.call('event_key', { animation: 'die', frame: 8,  name: 'slime_melt_burst' });
  await mcp.call('event_key', { animation: 'die', frame: 18, name: 'slime_puddle_collapsed' });

  console.log('12. Rendering Setup Pose, Keyframes, Contact Sheets & GIFs...');
  await mcp.call('render_frame', {
    setup: true,
    bones: false,
    width: CANVAS_W,
    height: CANVAS_H,
    background: '#121826',
    out: `${PREVIEW_DIR}/slime_setup_pose.png`,
  });
  await mcp.call('render_frame', {
    setup: true,
    bones: true,
    width: CANVAS_W,
    height: CANVAS_H,
    background: '#121826',
    out: `${PREVIEW_DIR}/slime_setup_bones.png`,
  });

  const animRenderSpecs = [
    { name: 'idle',     step: 4, cols: 5 },
    { name: 'hop_walk', step: 3, cols: 5 },
    { name: 'hop_run',  step: 2, cols: 5 },
    { name: 'hit',      step: 2, cols: 6 },
    { name: 'die',      step: 3, cols: 4 },
  ];

  for (const a of animRenderSpecs) {
    await mcp.call('render_animation', {
      animation: a.name,
      format: 'sheet',
      step: a.step,
      cols: a.cols,
      width: 400,
      height: 260,
      background: '#121826',
      out: `${PREVIEW_DIR}/slime_${a.name}_sheet.png`,
    });
    await mcp.call('render_animation', {
      animation: a.name,
      format: 'gif',
      fps: 24,
      width: 600,
      height: 390,
      background: '#121826',
      out: `${PREVIEW_DIR}/slime_${a.name}.gif`,
    });
  }

  console.log('13. Exporting Spine 4.2 and DragonBones 5.5...');
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
  fs.copyFileSync(path.join(SCRATCH_DIR, 'slime_setup_preview.png'), path.join(ARTIFACT_DIR, 'slime_setup_preview.png'));
  fs.copyFileSync(path.join(SCRATCH_DIR, 'slime_hit_preview.png'), path.join(ARTIFACT_DIR, 'slime_hit_preview.png'));
  console.log('Done! Project slime-2d saved in workspace and previews copied to artifacts.');
} finally {
  mcp.close();
}
