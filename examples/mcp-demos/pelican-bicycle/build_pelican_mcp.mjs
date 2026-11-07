import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startMcp } from 'file:///C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/tools/mcp-client.mjs';

const BASE_DIR = 'C:/Users/Administrator/.gemini/antigravity/scratch/pelican-bicycle';
const PREVIEW_DIR = join(BASE_DIR, 'previews');
const EXPORT_SPINE_DIR = join(BASE_DIR, 'export/spine42');
const EXPORT_DB_DIR = join(BASE_DIR, 'export/dragonbones55');
mkdirSync(PREVIEW_DIR, { recursive: true });
mkdirSync(EXPORT_SPINE_DIR, { recursive: true });
mkdirSync(EXPORT_DB_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(join(BASE_DIR, 'layers_manifest.json'), 'utf8'));
const [OX, OY] = manifest.origin;
const J = manifest.joints;
const L = manifest.lengths;

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;

function toWorld(pt) {
  return [pt[0] - OX, pt[1] - OY];
}

function matFrom(x, y, deg) {
  const r = deg * DEG2RAD;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, x, y];
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

function invMat(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const id = 1 / det;
  const a = m[3] * id, b = -m[1] * id, c = -m[2] * id, d = m[0] * id;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

function applyMat(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function solve2BoneIK(hx, hy, tx, ty, L1, L2, bendRight = true) {
  const dx = tx - hx, dy = ty - hy;
  const d = Math.hypot(dx, dy);
  const dc = Math.max(Math.abs(L1 - L2) + 1e-4, Math.min(L1 + L2 - 1e-4, d));
  const base = Math.atan2(dy, dx);
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc)));
  const a = Math.acos(cosA);
  const theta1 = bendRight ? base - a : base + a;
  const kx = hx + L1 * Math.cos(theta1);
  const ky = hy + L1 * Math.sin(theta1);
  const theta2 = Math.atan2(ty - ky, tx - kx);
  return { kx, ky, theta1, theta2 };
}

// Define bone hierarchy in parent-first order with canvas joint & tip coordinates
const boneSpecs = [
  { name: 'bike_frame', parent: 'root', joint: J.bike_frame, tip: [J.bike_frame[0] + 80, J.bike_frame[1]] },
  { name: 'wheel_back', parent: 'bike_frame', joint: J.wheel_back, tip: [J.wheel_back[0] + 75, J.wheel_back[1]] },
  { name: 'wheel_front', parent: 'bike_frame', joint: J.wheel_front, tip: [J.wheel_front[0] + 75, J.wheel_front[1]] },
  { name: 'crank_gear', parent: 'bike_frame', joint: J.crank_gear, tip: J.pedal_r },
  { name: 'pedal_l', parent: 'crank_gear', joint: J.pedal_l, tip: [J.pedal_l[0] + 22, J.pedal_l[1]] },
  { name: 'pedal_r', parent: 'crank_gear', joint: J.pedal_r, tip: [J.pedal_r[0] + 22, J.pedal_r[1]] },
  { name: 'handlebar', parent: 'bike_frame', joint: J.handlebar, tip: J.grip_r },
  { name: 'basket_fish', parent: 'handlebar', joint: J.basket_fish, tip: [J.basket_fish[0] + 10, J.basket_fish[1] - 28] },
  { name: 'hip', parent: 'bike_frame', joint: J.hip, tip: [J.hip[0] + 35, J.hip[1]] },
  { name: 'tail', parent: 'hip', joint: J.tail, tip: [J.tail[0] - 46, J.tail[1] - 14] },
  { name: 'thigh_l', parent: 'hip', joint: J.thigh_l, tip: J.shin_l },
  { name: 'shin_l', parent: 'thigh_l', joint: J.shin_l, tip: J.foot_l },
  { name: 'foot_l', parent: 'shin_l', joint: J.foot_l, tip: [J.foot_l[0] + 28, J.foot_l[1]] },
  { name: 'thigh_r', parent: 'hip', joint: J.thigh_r, tip: J.shin_r },
  { name: 'shin_r', parent: 'thigh_r', joint: J.shin_r, tip: J.foot_r },
  { name: 'foot_r', parent: 'shin_r', joint: J.foot_r, tip: [J.foot_r[0] + 28, J.foot_r[1]] },
  { name: 'torso', parent: 'hip', joint: J.torso, tip: J.neck },
  { name: 'scarf', parent: 'torso', joint: J.scarf, tip: [J.scarf[0] - 55, J.scarf[1] + 4] },
  { name: 'scarf_tip', parent: 'scarf', joint: [J.scarf[0] - 55, J.scarf[1] + 4], tip: [J.scarf[0] - 95, J.scarf[1] + 12] },
  { name: 'neck', parent: 'torso', joint: J.neck, tip: J.head },
  { name: 'head', parent: 'neck', joint: J.head, tip: [J.head[0] + 90, J.head[1]] },
  { name: 'beak_pouch', parent: 'head', joint: J.beak_pouch, tip: [J.beak_pouch[0] + 85, J.beak_pouch[1] + 20] },
  { name: 'wing_l', parent: 'torso', joint: J.wing_l, tip: J.forewing_l },
  { name: 'forewing_l', parent: 'wing_l', joint: J.forewing_l, tip: J.grip_l },
  { name: 'wing_r', parent: 'torso', joint: J.wing_r, tip: J.forewing_r },
  { name: 'forewing_r', parent: 'wing_r', joint: J.forewing_r, tip: J.grip_r },
];

const worldMats = { root: matFrom(0, 0, 0) };
const bindWorldAngles = { root: 0 };
const localSpecs = [];

for (const b of boneSpecs) {
  const [wx, wy] = toWorld(b.joint);
  const [tx, ty] = toWorld(b.tip);
  const deg = Math.atan2(ty - wy, tx - wx) * RAD2DEG;
  const len = Math.hypot(tx - wx, ty - wy);
  const W = matFrom(wx, wy, deg);
  const P = worldMats[b.parent];
  const M = mulMat(invMat(P), W);
  const localDeg = Math.atan2(M[1], M[0]) * RAD2DEG;
  worldMats[b.name] = W;
  bindWorldAngles[b.name] = deg;
  localSpecs.push({
    name: b.name,
    parent: b.parent,
    length: r3(len),
    transform: {
      x: r3(M[4]),
      y: r3(M[5]),
      skX: r3(localDeg),
      skY: r3(localDeg),
    },
  });
}

// Compute local coordinates of sockets in parent spaces for forward kinematics during animation
const thighHipLocalInHip = applyMat(invMat(worldMats.hip), ...toWorld(J.thigh_r));
const shoulderRLocalInTorso = applyMat(invMat(worldMats.torso), ...toWorld(J.wing_r));
const shoulderLLocalInTorso = applyMat(invMat(worldMats.torso), ...toWorld(J.wing_l));
const gripRLocalInHandlebar = applyMat(invMat(worldMats.handlebar), ...toWorld(J.grip_r));
const gripLLocalInHandlebar = applyMat(invMat(worldMats.handlebar), ...toWorld(J.grip_l));

function buildAnimationKeys({ duration = 24, amplitude = 1.0, pouchOpen = 1.0 }) {
  const keys = [];
  // Step every 2 frames (0, 2, 4, ..., 24) -> 30 deg per 2 frames for wheels & crank (well under 180 deg so expandRotations unwraps 360 deg cleanly!)
  for (let f = 0; f <= duration; f += 2) {
    const u = f / duration; // 0 .. 1
    const phase = u * Math.PI * 2;
    const phase2 = phase * 2; // 2 pedal power strokes per revolution

    // 1. Wheels & Crank spin 360 deg clockwise (+360) per cycle
    const spinDeg = r3(u * 360);
    keys.push({ bone: 'wheel_back', frame: f, rotate: spinDeg });
    keys.push({ bone: 'wheel_front', frame: f, rotate: spinDeg });
    keys.push({ bone: 'crank_gear', frame: f, rotate: spinDeg });
    // Pedals counter-rotate -spinDeg so platforms stay horizontal
    keys.push({ bone: 'pedal_r', frame: f, rotate: r3(-spinDeg) });
    keys.push({ bone: 'pedal_l', frame: f, rotate: r3(-spinDeg) });

    // 2. Subtle bicycle frame suspension bounce & pitch
    const bikeY = r3(Math.sin(phase2) * 2.2 * amplitude);
    const bikeRot = r3(Math.cos(phase2) * 0.8 * amplitude);
    keys.push({ bone: 'bike_frame', frame: f, x: 0, y: bikeY, rotate: bikeRot });

    // 3. Handlebar & basket fish secondary motion
    const barRot = r3(Math.sin(phase) * 1.2 * amplitude);
    keys.push({ bone: 'handlebar', frame: f, rotate: barRot });
    const fishY = r3(Math.sin(phase2 - 0.7) * 3.5 * amplitude);
    const fishRot = r3(Math.cos(phase2 - 0.5) * 8.0 * amplitude);
    keys.push({ bone: 'basket_fish', frame: f, x: 0, y: fishY, rotate: fishRot });

    // 4. Pelican hip & torso bobbing + leaning with pedaling rhythm
    const hipY = r3(Math.sin(phase2 - 0.3) * 3.0 * amplitude);
    const hipRot = r3(Math.sin(phase) * 2.0 * amplitude);
    keys.push({ bone: 'hip', frame: f, x: 0, y: hipY, rotate: hipRot });

    const tailRot = r3(Math.sin(phase2 - 0.8) * 7.5 * amplitude);
    keys.push({ bone: 'tail', frame: f, rotate: tailRot });

    const torsoRot = r3(Math.sin(phase2 - 0.4) * 3.2 * amplitude);
    keys.push({ bone: 'torso', frame: f, rotate: torsoRot });

    // 5. Neck, Head, Beak Pouch & Scarf secondary animation
    const neckRot = r3(-torsoRot * 0.65 + Math.cos(phase2) * 2.8 * amplitude);
    keys.push({ bone: 'neck', frame: f, rotate: neckRot });

    const headRot = r3(-neckRot * 0.5 + Math.sin(phase2 + 0.4) * 3.0 * amplitude);
    keys.push({ bone: 'head', frame: f, rotate: headRot });

    // Pelican throat pouch jiggles & opens cheerfully
    const pouchRot = r3((Math.sin(phase2 - 0.9) * 6.5 + (1 - Math.cos(phase)) * 4.5 * pouchOpen) * amplitude);
    const pouchScaleY = r3(1 + Math.sin(phase2 - 0.6) * 0.06 * pouchOpen * amplitude);
    keys.push({ bone: 'beak_pouch', frame: f, rotate: pouchRot, scaleX: 1, scaleY: pouchScaleY });

    // Scarf waves in the wind
    const scarfRot = r3(Math.sin(phase2 - 0.5) * 9.0 * amplitude);
    const scarfTipRot = r3(Math.sin(phase2 - 1.4) * 14.0 * amplitude);
    keys.push({ bone: 'scarf', frame: f, rotate: scarfRot });
    keys.push({ bone: 'scarf_tip', frame: f, rotate: scarfTipRot });

    // 6. Exact Forward Kinematics of Bike -> Hip -> Torso & Handlebar at frame f
    const [bfWx, bfWy] = toWorld(J.bike_frame);
    const W_bike = matFrom(bfWx, bfWy + bikeY, bindWorldAngles.bike_frame + bikeRot);

    // Crank & Pedals in world space at frame f
    const crankWorldDeg = bindWorldAngles.crank_gear + bikeRot + spinDeg;
    const crankRad = crankWorldDeg * DEG2RAD;
    const [crankWx, crankWy] = [W_bike[4], W_bike[5]];
    const pedalRWx = crankWx + L.CRANK_R * Math.cos(crankRad);
    const pedalRWy = crankWy + L.CRANK_R * Math.sin(crankRad);
    const pedalLWx = crankWx - L.CRANK_R * Math.cos(crankRad);
    const pedalLWy = crankWy - L.CRANK_R * Math.sin(crankRad);

    // Hip world matrix at frame f
    const hipLocal = localSpecs.find((x) => x.name === 'hip').transform;
    const M_hip = matFrom(hipLocal.x, hipLocal.y + hipY, hipLocal.skY + hipRot);
    const W_hip = mulMat(W_bike, M_hip);
    const hipWorldDeg = bindWorldAngles.hip + bikeRot + hipRot;

    // Thigh socket in world space at frame f
    const [thighHipWx, thighHipWy] = applyMat(W_hip, thighHipLocalInHip[0], thighHipLocalInHip[1]);

    // Solve 2-bone IK for Right Leg (thigh_r -> shin_r -> foot_r)
    const targetFootR = [pedalRWx, pedalRWy + L.ANKLE_OFFSET_Y];
    const ikR = solve2BoneIK(thighHipWx, thighHipWy, targetFootR[0], targetFootR[1], L.L_THIGH, L.L_SHIN, true);
    const thighRWorldDeg = ikR.theta1 * RAD2DEG;
    const shinRWorldDeg = ikR.theta2 * RAD2DEG;
    const dThighR = r3((thighRWorldDeg - bindWorldAngles.thigh_r) - (hipWorldDeg - bindWorldAngles.hip));
    const dShinR = r3((shinRWorldDeg - thighRWorldDeg) - (bindWorldAngles.shin_r - bindWorldAngles.thigh_r));
    // Natural slight foot ankling tilt (+6 deg sin) while keeping foot planted on horizontal pedal
    const desiredFootRDeg = Math.sin(crankRad) * 6.0;
    const dFootR = r3((desiredFootRDeg - bindWorldAngles.foot_r) - (shinRWorldDeg - bindWorldAngles.shin_r));
    keys.push({ bone: 'thigh_r', frame: f, rotate: dThighR });
    keys.push({ bone: 'shin_r', frame: f, rotate: dShinR });
    keys.push({ bone: 'foot_r', frame: f, rotate: dFootR });

    // Solve 2-bone IK for Left Leg (thigh_l -> shin_l -> foot_l)
    const targetFootL = [pedalLWx, pedalLWy + L.ANKLE_OFFSET_Y];
    const ikL = solve2BoneIK(thighHipWx, thighHipWy, targetFootL[0], targetFootL[1], L.L_THIGH, L.L_SHIN, true);
    const thighLWorldDeg = ikL.theta1 * RAD2DEG;
    const shinLWorldDeg = ikL.theta2 * RAD2DEG;
    const dThighL = r3((thighLWorldDeg - bindWorldAngles.thigh_l) - (hipWorldDeg - bindWorldAngles.hip));
    const dShinL = r3((shinLWorldDeg - thighLWorldDeg) - (bindWorldAngles.shin_l - bindWorldAngles.thigh_l));
    const desiredFootLDeg = -Math.sin(crankRad) * 6.0;
    const dFootL = r3((desiredFootLDeg - bindWorldAngles.foot_l) - (shinLWorldDeg - bindWorldAngles.shin_l));
    keys.push({ bone: 'thigh_l', frame: f, rotate: dThighL });
    keys.push({ bone: 'shin_l', frame: f, rotate: dShinL });
    keys.push({ bone: 'foot_l', frame: f, rotate: dFootL });

    // Torso & Handlebar world matrices for Wing IK
    const torsoLocal = localSpecs.find((x) => x.name === 'torso').transform;
    const M_torso = matFrom(torsoLocal.x, torsoLocal.y, torsoLocal.skY + torsoRot);
    const W_torso = mulMat(W_hip, M_torso);
    const torsoWorldDeg = hipWorldDeg + (bindWorldAngles.torso - bindWorldAngles.hip) + torsoRot;

    const barLocal = localSpecs.find((x) => x.name === 'handlebar').transform;
    const M_bar = matFrom(barLocal.x, barLocal.y, barLocal.skY + barRot);
    const W_bar = mulMat(W_bike, M_bar);

    const [shRWx, shRWy] = applyMat(W_torso, shoulderRLocalInTorso[0], shoulderRLocalInTorso[1]);
    const [shLWx, shLWy] = applyMat(W_torso, shoulderLLocalInTorso[0], shoulderLLocalInTorso[1]);
    const [gripRWx, gripRWy] = applyMat(W_bar, gripRLocalInHandlebar[0], gripRLocalInHandlebar[1]);
    const [gripLWx, gripLWy] = applyMat(W_bar, gripLLocalInHandlebar[0], gripLLocalInHandlebar[1]);

    // Solve 2-bone IK for Right Wing (wing_r -> forewing_r)
    const ikWingR = solve2BoneIK(shRWx, shRWy, gripRWx, gripRWy, L.L_WING_UPPER, L.L_WING_FORE, false);
    const wingRWorldDeg = ikWingR.theta1 * RAD2DEG;
    const forewingRWorldDeg = ikWingR.theta2 * RAD2DEG;
    const dWingR = r3((wingRWorldDeg - bindWorldAngles.wing_r) - (torsoWorldDeg - bindWorldAngles.torso));
    const dForewingR = r3((forewingRWorldDeg - wingRWorldDeg) - (bindWorldAngles.forewing_r - bindWorldAngles.wing_r));
    keys.push({ bone: 'wing_r', frame: f, rotate: dWingR });
    keys.push({ bone: 'forewing_r', frame: f, rotate: dForewingR });

    // Solve 2-bone IK for Left Wing (wing_l -> forewing_l)
    const ikWingL = solve2BoneIK(shLWx, shLWy, gripLWx, gripLWy, L.L_WING_UPPER, L.L_WING_FORE, false);
    const wingLWorldDeg = ikWingL.theta1 * RAD2DEG;
    const forewingLWorldDeg = ikWingL.theta2 * RAD2DEG;
    const dWingL = r3((wingLWorldDeg - bindWorldAngles.wing_l) - (torsoWorldDeg - bindWorldAngles.torso));
    const dForewingL = r3((forewingLWorldDeg - wingLWorldDeg) - (bindWorldAngles.forewing_l - bindWorldAngles.wing_l));
    keys.push({ bone: 'wing_l', frame: f, rotate: dWingL });
    keys.push({ bone: 'forewing_l', frame: f, rotate: dForewingL });
  }
  return keys;
}

const mcp = startMcp({
  BONESTUDIO_PROJECTS: 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects',
});

try {
  await mcp.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'Antigravity', version: '1.0' },
  });

  // Step 0: Register MCP session
  const sessionInfo = await mcp.call('session_set', {
    name: 'Antigravity·骨骼动画师',
    task: '制作鹈鹕骑自行车骨骼动画 (pelican-bicycle)',
  });
  console.log('1. session_set:', JSON.stringify(sessionInfo));

  // Step 1: Create new project
  const projInfo = await mcp.call('project_new', {
    name: 'pelican-bicycle',
    frameRate: 24,
  });
  console.log('2. project_new:', JSON.stringify(projInfo));

  // Step 2: Create all 26 bones in parent-first order
  for (const b of localSpecs) {
    await mcp.call('bone_create', {
      name: b.name,
      parent: b.parent,
      length: b.length,
      transform: b.transform,
    });
  }
  console.log(`3. bone_create: created ${localSpecs.length} bones`);

  // Step 3: Batch import all 24 SVG->PNG layers onto root at their exact canvas coordinates
  const layersPayload = manifest.layers.map((l) => ({
    file: l.file,
    name: l.name,
    bone: 'root',
    left: l.left,
    top: l.top,
  }));
  const layersRes = await mcp.call('layers_add', {
    layers: layersPayload,
    canvasWidth: manifest.canvasWidth,
    canvasHeight: manifest.canvasHeight,
  });
  console.log(`4. layers_add: added ${layersRes.added} layers`);

  // Step 4: Attach each slot to its target bone (automatically rebases local display transform while preserving world coordinates!) and set draw order
  for (const l of manifest.layers) {
    await mcp.call('slot_update', {
      slot: l.name,
      bone: l.bone,
      zIndex: l.zIndex,
    });
  }
  console.log('5. slot_update: bound all 24 slots to their bones and set zIndex order');

  // Step 5: Convert scarf into a 4x2 weighted mesh bound to [torso, scarf, scarf_tip]
  await mcp.call('mesh_create', { slot: 'scarf', cols: 4, rows: 2 });
  const weightsRes = await mcp.call('weights_auto', {
    slot: 'scarf',
    bones: ['torso', 'scarf', 'scarf_tip'],
    maxInfluences: 2,
  });
  console.log('6. mesh_create + weights_auto on scarf:', JSON.stringify(weightsRes));

  // Step 6: Render setup pose (both clean and with bone overlay)
  const setupRender = await mcp.call('render_frame', {
    out: join(PREVIEW_DIR, 'setup_pose.png'),
    setup: true,
    width: 800,
    height: 700,
    fit: 'content',
    background: 'light',
  });
  await mcp.call('render_frame', {
    out: join(PREVIEW_DIR, 'setup_bones.png'),
    setup: true,
    bones: 'on',
    width: 800,
    height: 700,
    bounds: setupRender.bounds,
    background: 'light',
  });
  console.log('7. render_frame (setup):', JSON.stringify(setupRender));

  // Step 7: Populate `idle` (default animation) and `ride` with the cycling animation, plus `sprint`
  const rideKeys = buildAnimationKeys({ duration: 24, amplitude: 1.0, pouchOpen: 1.0 });
  await mcp.call('animation_update', { animation: 'idle', duration: 24, playTimes: 0 });
  await mcp.call('bone_keys', { animation: 'idle', keys: rideKeys });

  await mcp.call('animation_create', { name: 'ride', duration: 24, playTimes: 0 });
  const rideRes = await mcp.call('bone_keys', { animation: 'ride', keys: rideKeys });
  await mcp.call('event_key', { animation: 'ride', frame: 0, name: 'pedal_down_right', kind: 'sound' });
  await mcp.call('event_key', { animation: 'ride', frame: 12, name: 'pedal_down_left', kind: 'sound' });
  console.log('8. bone_keys (ride):', JSON.stringify(rideRes));

  // Also create an energetic `sprint` animation (16 frames, faster cadence & bigger bounce)
  const sprintKeys = buildAnimationKeys({ duration: 16, amplitude: 1.45, pouchOpen: 1.6 });
  await mcp.call('animation_create', { name: 'sprint', duration: 16, playTimes: 0 });
  const sprintRes = await mcp.call('bone_keys', { animation: 'sprint', keys: sprintKeys });
  console.log('9. bone_keys (sprint):', JSON.stringify(sprintRes));

  // Step 8: Render contact sheets and GIFs for inspection
  const sheetRide = await mcp.call('render_animation', {
    animation: 'ride',
    format: 'sheet',
    out: join(PREVIEW_DIR, 'ride_sheet.png'),
    width: 260,
    height: 230,
    step: 2,
    columns: 6,
    fit: 'content',
    background: 'light',
  });
  await mcp.call('render_animation', {
    animation: 'ride',
    format: 'sheet',
    out: join(PREVIEW_DIR, 'ride_bones_sheet.png'),
    width: 260,
    height: 230,
    step: 2,
    columns: 6,
    bones: 'on',
    bounds: sheetRide.bounds,
    background: 'light',
  });
  const gifRide = await mcp.call('render_animation', {
    animation: 'ride',
    format: 'gif',
    out: join(PREVIEW_DIR, 'ride.gif'),
    width: 480,
    height: 420,
    step: 1,
    bounds: sheetRide.bounds,
    background: 'light',
  });
  const sheetSprint = await mcp.call('render_animation', {
    animation: 'sprint',
    format: 'sheet',
    out: join(PREVIEW_DIR, 'sprint_sheet.png'),
    width: 260,
    height: 230,
    step: 2,
    columns: 4,
    fit: 'content',
    background: 'light',
  });
  const gifSprint = await mcp.call('render_animation', {
    animation: 'sprint',
    format: 'gif',
    out: join(PREVIEW_DIR, 'sprint.gif'),
    width: 480,
    height: 420,
    step: 1,
    bounds: sheetSprint.bounds,
    background: 'light',
  });
  console.log('10. render_animation:', JSON.stringify({ sheetRide, gifRide, sheetSprint, gifSprint }));

  // Step 9: Save cover.png into workspace project folder so Welcome Screen shows a crisp thumbnail
  const coverPath = 'C:/Users/Administrator/Documents/Codex/2026-10-11/a-b-n/outputs/bone-studio/projects/pelican-bicycle/cover.png';
  await mcp.call('render_frame', {
    out: coverPath,
    animation: 'ride',
    frame: 0,
    width: 320,
    height: 320,
    fit: 'content',
    background: 'dark',
  });

  // Step 10: Export Spine 4.2 (with official spine-core 4.2 runtime validation!) and DragonBones 5.5
  const spine42 = await mcp.call('spine_export', {
    outDir: EXPORT_SPINE_DIR,
    name: 'pelican-bicycle',
    version: '4.2',
    validate: true,
  });
  console.log('11. spine_export (4.2):', JSON.stringify(spine42, null, 2));

  const db55 = await mcp.call('dragonbones_export', {
    outDir: EXPORT_DB_DIR,
    name: 'pelican-bicycle',
  });
  console.log('12. dragonbones_export (5.5):', JSON.stringify(db55));

  const editorUrl = await mcp.call('editor_url', {
    animation: 'ride',
    frame: 0,
    play: true,
  });
  console.log('13. editor_url:', JSON.stringify(editorUrl));

  const summary = await mcp.call('skeleton_summary', {});
  console.log('14. skeleton_summary:', JSON.stringify(summary, null, 2));
} finally {
  mcp.close();
}
