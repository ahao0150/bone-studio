/**
 * Build "kunge-basketball" (坤哥/鸡哥 篮球) skeletal animation via BoneStudio MCP.
 * Animations (24fps, playTimes 0 for preview loop):
 *   idle        40f  呼吸待机，篮球背在身后（后手托球），眨眼
 *   walk        32f  普通行走 + 慢速运球（每 16 帧一次落地）
 *   walk_fast   16f  快速行走 + 快速低运球（每 8 帧一次落地）
 *   attack      40f  背后挑球过顶 → 前手接球 → 蓄力 → 推射丢出（远程攻击）
 *   hit         24f  受击后仰 + >< 眼 + 闪红 + 冲击星
 * Legs (all anims) and the dribbling/throwing arm are baked with analytic 2-bone IK on top of a
 * full FK evaluator, so feet stay planted on the ground and the palm stays on the ball.
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMcp } from 'file:///C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/tools/mcp-client.mjs';

const PROJECT = 'kunge-basketball';
const BASE = 'C:/Users/Administrator/.gemini/antigravity/scratch/kunge-basketball';
const PREVIEW_DIR = `${BASE}/previews`;
const EXPORT_SPINE_DIR = `${BASE}/export/spine42`;
const EXPORT_DB_DIR = `${BASE}/export/dragonbones55`;
const PROJECTS_DIR = 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects';
for (const d of [PREVIEW_DIR, EXPORT_SPINE_DIR, EXPORT_DB_DIR]) fs.mkdirSync(d, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'layers_manifest.json'), 'utf8'));
const J = manifest.joints;
const CW = manifest.canvasWidth, CH = manifest.canvasHeight;
const OX = CW / 2, OY = CH;

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const P = (a) => [a[0], a[1]];

function matFrom(x, y, deg, sx = 1, sy = 1) {
  const r = deg * RAD, c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}
function mulMat(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
function invMat(M) {
  const det = M[0] * M[3] - M[1] * M[2];
  const a = M[3] / det, b = -M[1] / det, c = -M[2] / det, d = M[0] / det;
  return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])];
}

// ============================================================================ skeleton
const BONE_SPECS = [
  { name: 'shadow',      parent: 'root',     from: J.shadow,      to: [J.shadow[0] + 45, J.shadow[1]] },
  { name: 'ball_shadow', parent: 'root',     from: J.ball_shadow, to: [J.ball_shadow[0] + 30, J.ball_shadow[1]] },
  { name: 'hip',         parent: 'root',     from: J.hip,         to: [J.hip[0] + 30, J.hip[1]] },
  { name: 'torso',       parent: 'hip',      from: J.torso,       to: J.neck },
  { name: 'neck',        parent: 'torso',    from: J.neck,        to: J.head },
  { name: 'head',        parent: 'neck',     from: J.head,        to: J.head_tip },
  { name: 'eyes',        parent: 'head',     from: J.eyes,        to: [J.eyes[0] + 30, J.eyes[1]] },
  { name: 'hair',        parent: 'head',     from: J.hair,        to: [J.hair[0], J.hair[1] - 40] },
  { name: 'arm_b_up',    parent: 'torso',    from: J.arm_b_up,    to: J.arm_b_lo },
  { name: 'arm_b_lo',    parent: 'arm_b_up', from: J.arm_b_lo,    to: J.hand_b },
  { name: 'arm_f_up',    parent: 'torso',    from: J.arm_f_up,    to: J.arm_f_lo },
  { name: 'arm_f_lo',    parent: 'arm_f_up', from: J.arm_f_lo,    to: J.hand_f },
  { name: 'thigh_b',     parent: 'hip',      from: J.thigh_b,     to: J.shin_b },
  { name: 'shin_b',      parent: 'thigh_b',  from: J.shin_b,      to: J.foot_b },
  { name: 'foot_b',      parent: 'shin_b',   from: J.foot_b,      to: J.toe_b },
  { name: 'thigh_f',     parent: 'hip',      from: J.thigh_f,     to: J.shin_f },
  { name: 'shin_f',      parent: 'thigh_f',  from: J.shin_f,      to: J.foot_f },
  { name: 'foot_f',      parent: 'shin_f',   from: J.foot_f,      to: J.toe_f },
  { name: 'ball',        parent: 'root',     from: J.ball,        to: [J.ball[0] + 30, J.ball[1]] },
  { name: 'trail',       parent: 'root',     from: J.trail,       to: [J.trail[0] + 30, J.trail[1]] },
  { name: 'hit_fx',      parent: 'root',     from: J.hit_fx,      to: [J.hit_fx[0] + 30, J.hit_fx[1]] },
];

const bindWorld = { root: matFrom(0, 0, 0) };
const bind = {};        // local bind {x,y,rot}
const bindWorldDeg = { root: 0 };
const boneConfigs = [];
for (const b of BONE_SPECS) {
  const wx = b.from[0] - OX, wy = b.from[1] - OY, tx = b.to[0] - OX, ty = b.to[1] - OY;
  const wDeg = Math.atan2(ty - wy, tx - wx) * DEG;
  const W = matFrom(wx, wy, wDeg);
  const L = mulMat(invMat(bindWorld[b.parent]), W);
  const lDeg = Math.atan2(L[1], L[0]) * DEG;
  bindWorld[b.name] = W;
  bindWorldDeg[b.name] = wDeg;
  bind[b.name] = { parent: b.parent, x: r2(L[4]), y: r2(L[5]), rot: r2(lDeg), len: Math.hypot(tx - wx, ty - wy) };
  boneConfigs.push({
    name: b.name, parent: b.parent, length: Math.round(Math.hypot(tx - wx, ty - wy)),
    transform: { x: r2(L[4]), y: r2(L[5]), skX: r2(lDeg), skY: r2(lDeg) },
  });
}
const BONES = BONE_SPECS.map((b) => b.name);

// FK evaluator in CANVAS coordinates (root sits at canvas (OX, OY))
function fk(D) {
  const W = { root: matFrom(OX, OY, 0) };
  for (const n of BONES) {
    const b = bind[n], d = D[n] || {};
    const L = matFrom(b.x + (d.x || 0), b.y + (d.y || 0), b.rot + (d.rotate || 0), d.scaleX ?? 1, d.scaleY ?? 1);
    W[n] = mulMat(W[b.parent], L);
  }
  return W;
}
const wDeg = (M) => Math.atan2(M[1], M[0]) * DEG;
const wPos = (M, lx = 0, ly = 0) => [M[0] * lx + M[2] * ly + M[4], M[1] * lx + M[3] * ly + M[5]];

function solve2BoneIK(rx, ry, tx, ty, L1, L2, bendSign) {
  const dx = tx - rx, dy = ty - ry;
  const d = Math.max(Math.abs(L1 - L2) + 0.01, Math.min(L1 + L2 - 0.01, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const a1 = base + bendSign * alpha;
  const mx = rx + L1 * Math.cos(a1), my = ry + L1 * Math.sin(a1);
  return { up: a1 * DEG, lo: Math.atan2(ty - my, tx - mx) * DEG };
}

const set = (D, bone, vals) => { D[bone] = { ...(D[bone] || {}), ...vals }; };

/** IK a 2-bone chain so that the end of `lo` reaches target (canvas px). */
function ikChain(D, up, lo, target, bendSign) {
  const W = fk(D);
  const [sx, sy] = wPos(W[up]);
  const L1 = bind[lo].x;            // child origin sits on parent's +x axis
  const L2 = bind[lo].len;
  const { up: upW, lo: loW } = solve2BoneIK(sx, sy, target[0], target[1], L1, L2, bendSign);
  const parentW = wDeg(W[bind[up].parent]);
  set(D, up, { rotate: norm(upW - parentW - bind[up].rot) });
  set(D, lo, { rotate: norm(loW - upW - bind[lo].rot) });
}
/** Legs: IK thigh/shin to ankle target, then set foot to a world angle (bind + footRot). */
function ikLeg(D, side, ankle, footRot = 0) {
  ikChain(D, `thigh_${side}`, `shin_${side}`, ankle, -1); // knee forward
  const W = fk(D);
  const want = bindWorldDeg[`foot_${side}`] + footRot;
  set(D, `foot_${side}`, { rotate: norm(want - wDeg(W[`shin_${side}`]) - bind[`foot_${side}`].rot) });
}
const plantLegs = (D) => { ikLeg(D, 'f', P(J.foot_f)); ikLeg(D, 'b', P(J.foot_b)); };

const BALL_R = 36;
const GROUND_BALL_Y = 640 - BALL_R;
const HOLD_OFF = [J.ball[0] - J.hand_b[0], J.ball[1] - J.hand_b[1]]; // ball relative to back palm
const palmB = (D) => wPos(fk(D).arm_b_lo, bind.arm_b_lo.len, 0);
const palmF = (D) => wPos(fk(D).arm_f_lo, bind.arm_f_lo.len, 0);
function setBall(D, pos, rotate = 0, sx = 1, sy = 1) {
  set(D, 'ball', { x: pos[0] - J.ball[0], y: pos[1] - J.ball[1], rotate, scaleX: sx, scaleY: sy });
}
function setBallShadow(D, x, h, H) {
  const k = 1 - Math.min(1, Math.max(0, h / H));
  const s = 0.45 + 0.55 * k;
  set(D, 'ball_shadow', { x: x - J.ball_shadow[0], scaleX: s, scaleY: s });
}
function holdBallBehind(D) { const p = palmB(D); setBall(D, [p[0] + HOLD_OFF[0], p[1] + HOLD_OFF[1]]); }

// ============================================================================ 1. IDLE (40f)
function genIdle() {
  const dur = 40, frames = [];
  for (let f = 0; f <= dur; f++) {
    const ph = (f / dur) * Math.PI * 2, D = {};
    set(D, 'hip', { y: 2.5 * (1 - Math.cos(ph)) });
    set(D, 'torso', { rotate: 1.5 * Math.sin(ph) });
    set(D, 'head', { rotate: -2 * Math.sin(ph - 0.6) });
    set(D, 'hair', { rotate: 2.5 * Math.sin(ph - 1.4) });
    set(D, 'arm_f_up', { rotate: 3 * Math.sin(ph - 0.5) });
    set(D, 'arm_f_lo', { rotate: 4 * Math.sin(ph - 0.9) });
    set(D, 'arm_b_up', { rotate: -2 * Math.sin(ph) });
    set(D, 'shadow', { scaleX: 1 + 0.02 * (1 - Math.cos(ph)) });
    const blink = { 30: 0.55, 31: 0.1, 32: 0.55 }[f] ?? 1;
    set(D, 'eyes', { scaleY: blink });
    plantLegs(D);
    holdBallBehind(D);
    frames.push([f, D]);
  }
  return frames;
}

// ============================================================================ 2/3. WALK + DRIBBLE
function footPath(p, S, lift) {
  if (p < 0.5) { const u = p / 0.5; return { x: S - 2 * S * u, y: 0, rot: 0 }; }
  const u = (p - 0.5) / 0.5;
  return { x: -S + 2 * S * (0.5 - 0.5 * Math.cos(Math.PI * u)), y: -lift * Math.sin(Math.PI * u), rot: -14 * Math.sin(Math.PI * u) };
}
function genWalk({ dur, S, lift, hipBase, hipAmp, hipX, lean, ballX, apexY, bouncePeriod, palmLow, armSwing }) {
  const frames = [];
  const H = GROUND_BALL_Y - apexY;
  for (let f = 0; f <= dur; f++) {
    const t = f / dur, D = {};
    const c2 = Math.cos(4 * Math.PI * t);
    set(D, 'hip', { x: hipX, y: hipBase + hipAmp * c2 });
    set(D, 'torso', { rotate: lean + 1.2 * c2 });
    set(D, 'head', { rotate: -lean * 0.6 - 1.5 * c2 });
    set(D, 'hair', { rotate: lean * 0.5 + 4 * Math.sin(4 * Math.PI * t - 1.2) });
    set(D, 'shadow', { x: hipX, scaleX: 1 - 0.04 * c2 });
    // back arm swings in phase with the front leg (opposite to its own-side leg)
    const cs = Math.cos(2 * Math.PI * t);
    set(D, 'arm_b_up', { rotate: -armSwing * cs });
    set(D, 'arm_b_lo', { rotate: -10 - armSwing * 0.4 * cs });
    // legs
    const ff = footPath(t, S, lift), fb = footPath((t + 0.5) % 1, S, lift);
    ikLeg(D, 'f', [J.foot_f[0] + hipX + ff.x, J.foot_f[1] + ff.y], ff.rot);
    ikLeg(D, 'b', [J.foot_b[0] + hipX + fb.x, J.foot_b[1] + fb.y], fb.rot);
    // ball: ground contact at heel strikes (tb = 0), apex at tb = 0.5, sharp bounce at ground
    const tb = (f % bouncePeriod) / bouncePeriod;
    const h = H * (1 - Math.pow(2 * tb - 1, 2));
    let by = GROUND_BALL_Y - h, sx = 1, sy = 1;
    if (f % bouncePeriod === 0) { sx = 1.14; sy = 0.84; by = 640 - BALL_R * sy; }
    else if (f % bouncePeriod === 1 || f % bouncePeriod === bouncePeriod - 1) { sx = 1.04; sy = 0.96; }
    setBall(D, [ballX, by], 0, sx, sy);
    setBallShadow(D, ballX, h, H + 40);
    // palm rides the top of the ball, never lower than palmLow
    const palmY = Math.min(by - BALL_R - 6, palmLow);
    ikChain(D, 'arm_f_up', 'arm_f_lo', [ballX - 4, palmY], 1);
    frames.push([f, D]);
  }
  return frames;
}

// ============================================================================ 4. ATTACK (40f)
const REST_PALM_F = P(J.hand_f);
function attackBody(f, D) {
  // hip / torso / head / hair / back arm per phase
  let hipX = 0, hipY = 0, torso = 0, head = 0, hair = 0, armB = 0, armBlo = 0;
  if (f <= 5) { const t = easeInOut(f / 5); hipY = 10 * t; torso = -6 * t; head = 4 * t; armB = 15 * t; hair = 3 * t; }
  else if (f <= 8) { const t = easeOut((f - 5) / 3); hipY = lerp(10, 0, t); torso = -6; head = lerp(4, -4, t); armB = lerp(15, -95, t); armBlo = lerp(0, -25, t); hair = lerp(3, 8, t); }
  else if (f <= 17) {
    const t = (f - 8) / 9;
    hipY = lerp(0, 3, t); torso = lerp(-6, -4, t);
    head = f <= 12 ? lerp(-4, -12, (f - 8) / 4) : lerp(-12, 2, (f - 12) / 5);
    armB = lerp(-95, 0, easeInOut(t)); armBlo = lerp(-25, 0, t); hair = lerp(8, -4, t);
  } else if (f <= 23) {
    const t = easeInOut((f - 17) / 6);
    hipX = lerp(0, -8, t); hipY = lerp(3, 7, t); torso = lerp(-4, -14, t); head = lerp(2, 6, t); armB = lerp(0, -20, t); hair = lerp(-4, 6, t);
  } else if (f <= 26) {
    const t = easeOut((f - 23) / 3);
    hipX = lerp(-8, 10, t); hipY = lerp(7, 5, t); torso = lerp(-14, 16, t); head = lerp(6, 2, t); armB = lerp(-20, 40, t); armBlo = lerp(0, 20, t); hair = lerp(6, -10, t);
  } else {
    const t = easeInOut((f - 26) / 14);
    hipX = lerp(10, 0, t); hipY = lerp(5, 0, t); torso = lerp(16, 0, t); head = lerp(2, 0, t); armB = lerp(40, 0, t); armBlo = lerp(20, 0, t);
    hair = -10 * Math.exp(-3 * t) * Math.cos(t * Math.PI * 2.5);
  }
  set(D, 'hip', { x: hipX, y: hipY });
  set(D, 'shadow', { x: hipX * 0.6 });
  set(D, 'torso', { rotate: torso });
  set(D, 'head', { rotate: head });
  set(D, 'hair', { rotate: hair });
  set(D, 'arm_b_up', { rotate: armB });
  set(D, 'arm_b_lo', { rotate: armBlo });
  plantLegs(D);
}
function genAttack() {
  const dur = 40, frames = [];
  const LAUNCH_F = 7, APEX_F = 12, CATCH_F = 17, RELEASE_F = 25;
  const CATCH_PALM = [526, 404], COCK_PALM = [476, 440], THROW_PALM = [562, 392];
  const OFF_CATCH = [6, -40], OFF_COCK = [28, -26], OFF_THROW = [30, -20];
  // pass 1: palm of the front arm at f=8 under FK (small anticipation swing back)
  const fkArmF = (f) => (f <= 8 ? 12 * easeInOut(f / 8) : 12);
  let palm8 = null, launch = null;
  {
    const D = {}; attackBody(8, D); set(D, 'arm_f_up', { rotate: fkArmF(8) }); palm8 = palmF(D);
    const D7 = {}; attackBody(LAUNCH_F, D7); const pb = palmB(D7); launch = [pb[0] + HOLD_OFF[0], pb[1] + HOLD_OFF[1]];
  }
  const catchBall = [CATCH_PALM[0] + OFF_CATCH[0], CATCH_PALM[1] + OFF_CATCH[1]];
  const APEX_Y = 40;
  let releasePos = null, releaseVel = null, prevBall = null;
  for (let f = 0; f <= dur; f++) {
    const D = {};
    attackBody(f, D);
    // ---- front arm
    let palmTarget = null, off = OFF_CATCH;
    if (f <= 8) set(D, 'arm_f_up', { rotate: fkArmF(f) });
    else if (f <= CATCH_F) palmTarget = [lerp(palm8[0], CATCH_PALM[0], easeOut((f - 8) / (CATCH_F - 1 - 8))), lerp(palm8[1], CATCH_PALM[1], easeOut((f - 8) / (CATCH_F - 1 - 8)))];
    else if (f <= 23) { const t = easeInOut((f - CATCH_F) / 6); palmTarget = [lerp(CATCH_PALM[0], COCK_PALM[0], t), lerp(CATCH_PALM[1], COCK_PALM[1], t)]; off = [lerp(OFF_CATCH[0], OFF_COCK[0], t), lerp(OFF_CATCH[1], OFF_COCK[1], t)]; }
    else if (f <= 26) { const t = easeOut((f - 23) / 3); palmTarget = [lerp(COCK_PALM[0], THROW_PALM[0], t), lerp(COCK_PALM[1], THROW_PALM[1], t)]; off = [lerp(OFF_COCK[0], OFF_THROW[0], t), lerp(OFF_COCK[1], OFF_THROW[1], t)]; }
    else { const t = easeInOut((f - 26) / 14); palmTarget = [lerp(THROW_PALM[0], REST_PALM_F[0], t), lerp(THROW_PALM[1], REST_PALM_F[1], t)]; }
    if (palmTarget) {
      if (f >= 39) { set(D, 'arm_f_up', { rotate: 0 }); set(D, 'arm_f_lo', { rotate: 0 }); }
      else ikChain(D, 'arm_f_up', 'arm_f_lo', palmTarget, 1);
    }
    // ---- ball
    let ballPos, ballRot = 0;
    if (f <= LAUNCH_F) { const p = palmB(D); ballPos = [p[0] + HOLD_OFF[0], p[1] + HOLD_OFF[1]]; }
    else if (f < CATCH_F) {
      const x = lerp(launch[0], catchBall[0], (f - LAUNCH_F) / (CATCH_F - LAUNCH_F));
      const y = f <= APEX_F
        ? APEX_Y + (launch[1] - APEX_Y) * Math.pow((APEX_F - f) / (APEX_F - LAUNCH_F), 2)
        : APEX_Y + (catchBall[1] - APEX_Y) * Math.pow((f - APEX_F) / (CATCH_F - APEX_F), 2);
      ballPos = [x, y];
      ballRot = (f - LAUNCH_F) * 36;            // 36deg/frame flip spin (< 180 per key)
    } else if (f <= RELEASE_F) {
      const p = palmF(D); ballPos = [p[0] + off[0], p[1] + off[1]]; ballRot = (CATCH_F - LAUNCH_F) * 36;
      if (f === RELEASE_F) { releasePos = ballPos; releaseVel = [Math.max(40, ballPos[0] - prevBall[0]), -6]; }
    } else if (f <= 34) {
      const k = f - RELEASE_F;
      ballPos = [releasePos[0] + releaseVel[0] * 1.15 * k, releasePos[1] + releaseVel[1] * k + 0.9 * k * k];
      ballRot = (CATCH_F - LAUNCH_F) * 36 + k * 40;
    } else { const p = palmB(D); ballPos = [p[0] + HOLD_OFF[0], p[1] + HOLD_OFF[1]]; ballRot = 0; }
    if (f > 34) ballRot = 0;
    prevBall = ballPos;
    setBall(D, ballPos, ballRot);
    set(D, 'trail', { x: ballPos[0] - J.trail[0], y: ballPos[1] - J.trail[1], rotate: f > RELEASE_F && f <= 34 ? Math.atan2(releaseVel[1] + 1.8 * (f - RELEASE_F), releaseVel[0] * 1.15) * DEG : 0 });
    frames.push([f, D]);
  }
  return frames;
}

// ============================================================================ 5. HIT (24f)
function genHit() {
  const dur = 24, frames = [];
  const PK = { hipX: -18, hipY: 6, torso: -16, head: -14, hair: 12, armF: -55, armFlo: -35, armB: -18, armBlo: -20 };
  for (let f = 0; f <= dur; f++) {
    const s = f <= 4 ? easeOut(f / 4) : Math.exp(-4 * ((f - 4) / 20)) * Math.cos(2.5 * Math.PI * ((f - 4) / 20));
    const D = {};
    set(D, 'hip', { x: PK.hipX * s, y: PK.hipY * Math.abs(s) });
    set(D, 'shadow', { x: PK.hipX * s * 0.5 });
    set(D, 'torso', { rotate: PK.torso * s });
    set(D, 'head', { rotate: PK.head * s });
    set(D, 'hair', { rotate: PK.hair * (f <= 4 ? s : Math.exp(-3 * ((f - 4) / 20)) * Math.cos(2.5 * Math.PI * ((f - 2) / 20))) });
    set(D, 'arm_f_up', { rotate: PK.armF * s });
    set(D, 'arm_f_lo', { rotate: PK.armFlo * s });
    set(D, 'arm_b_up', { rotate: PK.armB * s });
    set(D, 'arm_b_lo', { rotate: PK.armBlo * s });
    plantLegs(D);
    const p = palmB(D);
    setBall(D, [p[0] + HOLD_OFF[0], p[1] + HOLD_OFF[1]], -10 * s);
    // impact star at the beak
    const fxS = { 1: 0.5, 2: 0.95, 3: 1.15, 4: 1.05, 5: 1.0, 6: 0.95, 7: 0.85, 8: 0.75, 9: 0.6 }[f] ?? 0.5;
    set(D, 'hit_fx', { x: 534 - J.hit_fx[0], y: 336 - J.hit_fx[1], rotate: f * 6, scaleX: fxS, scaleY: fxS });
    frames.push([f, D]);
  }
  return frames;
}

// ============================================================================ frames -> bone_keys
const SCALE_BONES = new Set(['eyes', 'ball', 'ball_shadow', 'hit_fx', 'shadow']);
function toKeys(frames) {
  const keys = [];
  const prevRot = {};
  for (const [f, D] of frames) {
    for (const bone of BONES) {
      const d = D[bone] || {};
      let rot = d.rotate || 0;
      if (prevRot[bone] !== undefined) rot = prevRot[bone] + norm(rot - prevRot[bone]); // unwrap
      prevRot[bone] = rot;
      const k = { bone, frame: f, x: r2(d.x || 0), y: r2(d.y || 0), rotate: r2(rot), easing: 'linear' };
      if (SCALE_BONES.has(bone)) { k.scaleX = r2(d.scaleX ?? 1); k.scaleY = r2(d.scaleY ?? 1); }
      keys.push(k);
    }
  }
  return keys;
}

// ============================================================================ MCP pipeline
const rawMcp = await startMcp({ BONESTUDIO_PROJECTS: PROJECTS_DIR });
const mcp = {
  async call(name, args) {
    for (let i = 0; i < 6; i++) {
      try { return await rawMcp.call(name, args); }
      catch (e) {
        if (String(e?.message || e).includes('EPERM') && i < 5) { await new Promise((r) => setTimeout(r, 90 * (i + 1))); continue; }
        throw e;
      }
    }
  },
  close() { rawMcp.close(); },
};

const VIS_SLOTS = ['ball_back', 'ball_front', 'ball_trail', 'hit_fx', 'eyes', 'eyes_hit', 'ball_shadow'];
async function vis(anim, frame, map) {
  for (const [slot, on] of Object.entries(map)) {
    if (typeof on === 'number') await mcp.call('slot_key', { animation: anim, slot, frame, attachment: slot, color: { rM: 100, gM: 100, bM: 100, aM: on } });
    else await mcp.call('slot_key', { animation: anim, slot, frame, attachment: on ? slot : '', color: { rM: 100, gM: 100, bM: 100, aM: on ? 100 : 0 } });
  }
}

try {
  await mcp.call('session_set', { name: 'Antigravity·骨骼动画师', task: '制作坤哥(鸡哥)篮球角色：待机/慢运球行走/快运球行走/丢球攻击/受击' });
  await mcp.call('project_new', { name: PROJECT });

  console.log(`bones: ${boneConfigs.length}`);
  for (const b of boneConfigs) await mcp.call('bone_create', b);

  console.log(`layers: ${manifest.layers.length}`);
  await mcp.call('layers_add', {
    canvasWidth: CW, canvasHeight: CH,
    layers: manifest.layers.map((l) => ({ file: l.file, name: l.name, bone: 'root', left: l.left, top: l.top })),
  });
  for (const l of manifest.layers) await mcp.call('slot_update', { slot: l.name, bone: l.bone, zIndex: l.zIndex });
  // hidden-by-default slots in the setup pose
  for (const s of ['ball_front', 'ball_trail', 'hit_fx', 'eyes_hit']) await mcp.call('slot_update', { slot: s, attachment: '' });

  // ---------------- idle
  await mcp.call('animation_update', { animation: 'idle', duration: 40, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'idle', keys: toKeys(genIdle()) });
  await vis('idle', 0, { ball_back: true, ball_front: false, ball_trail: false, hit_fx: false, eyes: true, eyes_hit: false, ball_shadow: false });

  // ---------------- walk (slow dribble)
  await mcp.call('animation_create', { name: 'walk', duration: 32, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'walk', keys: toKeys(genWalk({
    dur: 32, S: 22, lift: 16, hipBase: 6, hipAmp: 3.5, hipX: 0, lean: 5,
    ballX: 502, apexY: 512, bouncePeriod: 16, palmLow: 488, armSwing: 18,
  })) });
  await vis('walk', 0, { ball_back: false, ball_front: true, ball_trail: false, hit_fx: false, eyes: true, eyes_hit: false, ball_shadow: true });
  for (const f of [0, 16]) await mcp.call('event_key', { animation: 'walk', frame: f, name: 'ball_bounce' });

  // ---------------- walk_fast (fast dribble)
  await mcp.call('animation_create', { name: 'walk_fast', duration: 16, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'walk_fast', keys: toKeys(genWalk({
    dur: 16, S: 34, lift: 24, hipBase: 12, hipAmp: 5, hipX: 4, lean: 12,
    ballX: 522, apexY: 540, bouncePeriod: 8, palmLow: 500, armSwing: 30,
  })) });
  await vis('walk_fast', 0, { ball_back: false, ball_front: true, ball_trail: false, hit_fx: false, eyes: true, eyes_hit: false, ball_shadow: true });
  for (const f of [0, 8]) await mcp.call('event_key', { animation: 'walk_fast', frame: f, name: 'ball_bounce' });

  // ---------------- attack (throw)
  await mcp.call('animation_create', { name: 'attack', duration: 40, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'attack', keys: toKeys(genAttack()) });
  await vis('attack', 0, { ball_back: 100, ball_front: false, ball_trail: false, hit_fx: false, eyes: true, eyes_hit: false, ball_shadow: false });
  await vis('attack', 11, { ball_back: 100, ball_front: false });
  await vis('attack', 12, { ball_back: false, ball_front: true });
  await vis('attack', 33, { ball_front: true, ball_back: false });
  await vis('attack', 34, { ball_front: false, ball_back: 0 });
  await vis('attack', 40, { ball_back: 100 });
  await vis('attack', 25, { ball_trail: false });
  await vis('attack', 26, { ball_trail: 90 });
  await vis('attack', 32, { ball_trail: 0 });
  await vis('attack', 33, { ball_trail: false });
  await mcp.call('event_key', { animation: 'attack', frame: 7, name: 'ball_flip' });
  await mcp.call('event_key', { animation: 'attack', frame: 17, name: 'ball_catch' });
  await mcp.call('event_key', { animation: 'attack', frame: 25, name: 'shoot' });

  // ---------------- hit
  await mcp.call('animation_create', { name: 'hit', duration: 24, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'hit', keys: toKeys(genHit()) });
  await vis('hit', 0, { ball_back: true, ball_front: false, ball_trail: false, hit_fx: false, eyes: true, eyes_hit: false, ball_shadow: false });
  await vis('hit', 1, { hit_fx: 100, eyes: false, eyes_hit: true });
  await vis('hit', 6, { hit_fx: 100 });
  await vis('hit', 9, { hit_fx: 0 });
  await vis('hit', 10, { hit_fx: false });
  await vis('hit', 14, { eyes: false, eyes_hit: true });
  await vis('hit', 15, { eyes: true, eyes_hit: false });
  const flash = ['head', 'hair', 'neck', 'torso', 'collar', 'arm_f_up', 'arm_f_lo', 'arm_b_up', 'arm_b_lo'];
  for (const s of flash) {
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 0, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 1, color: { rM: 100, gM: 35, bM: 35, aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 4, color: { rM: 100, gM: 35, bM: 35, aM: 100 } });
    await mcp.call('slot_key', { animation: 'hit', slot: s, frame: 9, color: { rM: 100, gM: 100, bM: 100, aM: 100 } });
  }
  await mcp.call('event_key', { animation: 'hit', frame: 1, name: 'hit_impact' });

  await mcp.call('project_save', {});

  if (!process.env.SKIP_PREVIEWS) {
    const bounds = [-400, -660, 400, 20];
    await mcp.call('render_frame', { setup: true, bones: true, width: 800, height: 700, background: 'light', out: `${PREVIEW_DIR}/setup_bones.png` });
    await mcp.call('render_frame', { setup: true, width: 800, height: 700, background: 'light', out: `${PREVIEW_DIR}/setup_pose.png` });
    const specs = [
      { name: 'idle', step: 4, columns: 6 }, { name: 'walk', step: 2, columns: 6 }, { name: 'walk_fast', step: 1, columns: 6 },
      { name: 'attack', step: 2, columns: 7 }, { name: 'hit', step: 2, columns: 7 },
    ];
    for (const a of specs) {
      await mcp.call('render_animation', { animation: a.name, format: 'sheet', step: a.step, columns: a.columns, width: 320, height: 280, bounds, background: 'light', out: `${PREVIEW_DIR}/${a.name}_sheet.png` });
      await mcp.call('render_animation', { animation: a.name, format: 'gif', width: 480, height: 420, bounds, background: 'light', out: `${PREVIEW_DIR}/${a.name}.gif` });
    }
  }

  const spineRes = await mcp.call('spine_export', { outDir: EXPORT_SPINE_DIR, version: '4.2' });
  console.log('Spine 4.2 validation:', JSON.stringify(spineRes?.validation ?? spineRes).slice(0, 600));
  await mcp.call('dragonbones_export', { outDir: EXPORT_DB_DIR });
  const url = await mcp.call('editor_url', { animation: 'walk', play: true });
  console.log('editor:', JSON.stringify(url));
  console.log('Done.');
} finally {
  mcp.close();
}
