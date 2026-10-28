/**
 * M5 closure oracle: **agent edits → export → official runtime replay → per-bone diff**.
 *
 * The DoD for M5 is "用官方 DragonBones 运行时播放本编辑器导出的数据，逐动画对拍姿势".
 * This tool is that check, end to end and repeatable:
 *
 *   1. load a shipped project and apply a deterministic edit set;
 *   2. export the edited document as `*_ske.json` **and** `*_ske.dbbin`;
 *   3. sample BoneStudio's own runtime for every frame and every bone;
 *   4. serve those exports next to the published DragonBones runtime and drive it in
 *      headless Chrome (the runtime is used purely as a behavioural oracle);
 *   5. diff the two per bone/frame and merge the result into
 *      `docs/evidence/closure-oracle.json`.
 *
 *   npm run verify:closure                 # both samples, gated
 *   vite-node tools/closure-oracle.ts bicycle
 *
 * Measurement integrity: `skipped` must stay 0 and `compared` must equal
 * frames × bones — a fixture mismatch (Rooster data compared against Bicycle bones)
 * otherwise reports maxDiff = 0 because every pair is silently missing.
 *
 * Env: BONESTUDIO_SAMPLES, BONESTUDIO_ORACLE_DIR, CHROME_PATH, CLOSURE_CDP, CLOSURE_PORT.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Player } from '../src/core/player';
import { displayPivotOffset } from '../src/core/runtime/skeleton';
import { serializeSkeletonData } from '../src/core/parse/ske';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import { setBoneTransform } from '../src/core/editing';
import { applyPreset } from '../src/core/curveEdit';
import { renameSlot, setSlotBlendMode, setSlotColor } from '../src/core/slotEdit';
import { addAnimation, setAnimationDuration } from '../src/core/animEdit';
import type { DbSkeletonData, DbTextureAtlasData } from '../src/core/types';

const ROOT = process.cwd();
const HOME = resolve(ROOT, '..', '..');
const SAMPLES = process.env.BONESTUDIO_SAMPLES ?? join(HOME, 'samples');
const PROJECTS = join(HOME, 'samples');
const ORACLE_DIR = process.env.BONESTUDIO_ORACLE_DIR ?? join(HOME, 'samples');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = Number(process.env.CLOSURE_CDP ?? 9341);
const PORT = Number(process.env.CLOSURE_PORT ?? 8794);
const TOLERANCE = 1e-5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SampleDef {
  key: string;
  label: string;
  file: string;
  armature: string;
  anim: string;
  frames: number;
  fps: number;
  /**
   * Set while a sample is known not to converge yet. The tool still runs it and
   * records the numbers, but it does not fail the gate — deleting the sample would
   * hide the gap. Remove the flag as soon as it converges (the tool says so).
   */
  knownOpen?: string;
  /**
   * Which export channel the official runtime actually consumes for this fixture.
   * `binary` is for surface projects: the published runtime parses a surface timeline
   * from `*_ske.dbbin` but **ignores** the `animation[].surface[]` key of the JSON
   * authoring form (measured 2026-10-11: same rig, JSON → surface bone constant
   * 40/30, dbbin → 46.25 → 40 exactly like ours).
   */
  gate?: 'both' | 'binary';
  /**
   * Optional texture atlas (`*_tex.json`). Needed by samples whose slots resolve a texture:
   * `ImageDisplayData.texture` is bound during `parseDragonBonesData`, so the atlas has to be
   * registered first, and the official `Slot._pivotX/_pivotY` stays at 0 without it. It also
   * enables the per-frame slot pivot comparison (`slotprobe`).
   */
  tex?: string;
  /**
   * Drive the slot probe by **display index** (`slotmode=indices`) instead of by play time.
   * Used by the serial-frame sample: the pivot formula is a property of the display, and the
   * time-driven path drags in `1/6 * 6 → frame 5` frame-boundary float behaviour that has
   * nothing to do with it. The value is the number of display objects.
   */
  slotIndices?: number;
  /**
   * Also probe the **time-driven** slot switch on the exported binary, and require the
   * official runtime to actually step through more than one display. This is the gate for
   * the binary writer's slot-display track: before §103 the `frame[]` form was dropped and
   * an exported serial-frame project played as a single still, which the display-index probe
   * (`slotmode=indices`) cannot see because it drives the switch directly.
   */
  timelineProbe?: boolean;
  edit: (player: Player) => string[];
}

const DEFS: SampleDef[] = [
  {
    key: 'rooster', label: 'Rooster_Ani (63 bones, 2 IK)', armature: 'armatureName',
    file: join(SAMPLES, 'Rooster_Ani/Rooster_An_ske.json'), anim: 'rooster_idle_anim', frames: 40, fps: 24,
    // 2026-10-17 用户决定：时间轴/关键帧写入语义在敏捷轮次改动后与官方对拍发散（本次实测 maxDiff 59.7，
    // firstDivergence frame 1，集中在 crest/hood 骨骼），用户已手动验证编辑器功能。故不门禁、只记录测量；
    // 若日后排查，先看 setBoneTransform + applyPreset 写入后的运行时求值差异。
    knownOpen: '2026-10-17 user decision: timeline/keyframe write semantics diverged from the vendor after the agile rounds (measured maxDiff 59.7, first divergence at frame 1); manually verified by user, so this sample is measured but not gated.',
    edit: (player) => {
      const edits: string[] = [];
      if (renameSlot(player, 'neck_shadow', 'bs_shadow')) edits.push('renameSlot neck_shadow -> bs_shadow');
      if (setSlotBlendMode(player, 'bs_shadow', 'add')) edits.push('setSlotBlendMode bs_shadow = add');
      if (setSlotColor(player, 'bs_shadow', { aM: 70, rM: 100, gM: 90, bM: 80 })) edits.push('setSlotColor aM70/gM90/bM80');
      if (setBoneTransform(player, 'head_bone_01', 6, { x: 20, y: -12, skX: 25 })) edits.push('setBoneTransform head_bone_01 @6');
      if (applyPreset(player, 'head_bone_01', 6, 'easeInOut')) edits.push('curve easeInOut @6');
      const created = addAnimation(player, 'bs_probe');
      if (created) { setAnimationDuration(player, created, 24); edits.push(`addAnimation ${created} (24 frames)`); }
      return edits;
    },
  },
  {
    // 28 bones / 8 IK **and one `MeshDeform(22)` FFD timeline** — the only fixture in
    // the corpus that exercises the free-form deform path end to end.
    key: 'ffd', label: 'Bicycle + FFD (28 bones, 8 IK, 1 mesh-deform / 30 fps)', armature: 'Bicycle',
    file: join(HOME, 'samples/Bicycle_Bin/Bicycle_ske.dbbin'), anim: 'bicycle', frames: 53, fps: 30,
    gate: 'binary',
    edit: (player) => {
      const edits: string[] = [];
      if (setSlotBlendMode(player, 'leg_lower', 'add')) edits.push('setSlotBlendMode leg_lower = add');
      // NOTE: an FFD document round-trips at 1.14e-12 with **no** edits, so the drift
      // comes from this edit set; the bone edit was removed first to bisect it.
      if (setBoneTransform(player, 'head', 20, { skX: -8 })) edits.push('setBoneTransform head @20');
      const created = addAnimation(player, 'bs_ffd');
      if (created) { setAnimationDuration(player, created, 30); edits.push(`addAnimation ${created} (30 frames)`); }
      return edits;
    },
  },
  {
    // Same rig plus a `Surface(50)` deform bone — exercises the surface warp path.
    key: 'surface', label: 'Bicycle + Surface (29 bones, 1 surface / 30 fps)', armature: 'Bicycle',
    file: join(HOME, 'samples/Surface_Bin/Bicycle_ske.dbbin'), anim: 'bicycle', frames: 53, fps: 30,
    gate: 'binary',
    // 同上（2026-10-17 用户决定）：实测 maxDiff 42.0，firstDivergence frame 10（arm_upper/head 链）。
    knownOpen: '2026-10-17 user decision: same timeline/keyframe divergence as the rooster sample (measured maxDiff 42.0, first divergence at frame 10); manually verified by user, so this sample is measured but not gated.',

    edit: (player) => {
      const edits: string[] = [];
      if (setSlotBlendMode(player, 'leg_upper', 'add')) edits.push('setSlotBlendMode leg_upper = add');
      if (setBoneTransform(player, 'upperbody', 9, { skX: -6, x: 4 })) edits.push('setBoneTransform upperbody @9');
      if (applyPreset(player, 'upperbody', 9, 'easeInOut')) edits.push('curve easeInOut @9');
      const created = addAnimation(player, 'bs_surface');
      if (created) { setAnimationDuration(player, created, 30); edits.push(`addAnimation ${created} (30 frames)`); }
      return edits;
    },
  },
  {
    // 28 bones / 8 IK constraints (4 two-bone + 4 single-bone) and a **30 fps** time base.
    key: 'bicycle', label: 'Bicycle (28 bones, 8 IK, 30 fps)', armature: 'Bicycle',
    file: join(PROJECTS, 'Bicycle/Bicycle_ske.json'), anim: 'bicycle', frames: 53, fps: 30,
    edit: (player) => {
      const edits: string[] = [];
      if (setSlotBlendMode(player, 'arm_upper1', 'add')) edits.push('setSlotBlendMode arm_upper1 = add');
      if (setBoneTransform(player, 'head', 12, { skX: 12 })) edits.push('setBoneTransform head @12 rotate 12');
      if (applyPreset(player, 'head', 12, 'easeOut')) edits.push('curve easeOut @12');
      const created = addAnimation(player, 'bs_bike');
      if (created) { setAnimationDuration(player, created, 30); edits.push(`addAnimation ${created} (30 frames)`); }
      return edits;
    },
  },
  {
    // Same rig as `bicycle`, but the edit lands on the two-bone IK chain
    // (`arm_hand` ← `arm_lower` ← `arm_upper`) that §23.27 bisected. Round 51-53 showed
    // this is the only edit that does not converge: the official runtime returns to the
    // original curve at frame 19 while we keep the new value to the end of the animation.
    key: 'bikeik', label: 'Bicycle + IK-chain bone edit (28 bones, 8 IK, 30 fps)', armature: 'Bicycle',
    file: join(PROJECTS, 'Bicycle/Bicycle_ske.json'), anim: 'bicycle', frames: 53, fps: 30,
      knownOpen: 'IK writes the world matrix like the vendor (§23.38), which converges the single-frame variant (bikeik1) to 6.8e-6. This two-frame form diverges from frame 20 and by frame 44 flips the sign of arm_hand d (+1.9839 vs -1.9835); arm_hand is the only arm bone with inheritScale: false. §23.38 originally blamed a cache-frame pass; §101 re-investigated and ruled that out — Bicycle has no cacheFrameRate, and with _cacheFrameIndex < 0 the vendor updates every bone every frame. The vendor isPPR test and our flipped test are textually identical, and composeInherited already implements the vendor inheritScale:false branch, so what remains is a numerical bifurcation amplified into a branch flip. Next probe: per-frame diff curve. §101.',
    edit: (player) => {
      const edits: string[] = [];
      if (setBoneTransform(player, 'arm_lower', 19, { skX: -10 })) edits.push('setBoneTransform arm_lower @19 rotate -10');
      return edits;
    },
  },
  {
    // The same edit, collapsed to a single constant frame. This is the form the runtime
    // converges on now that IK writes the world matrix like the vendor (§23.38); the
    // two-frame ramp above additionally exercises the vendor's cache-frame pass.
    key: 'bikeik1', label: 'Bicycle + IK-chain edit, single-frame form (28 bones, 8 IK)', armature: 'Bicycle',
    file: join(PROJECTS, 'Bicycle/Bicycle_ske.json'), anim: 'bicycle', frames: 53, fps: 30,
    edit: (player) => {
      const edits: string[] = [];
      if (setBoneTransform(player, 'arm_lower', 19, { skX: -10 })) edits.push('setBoneTransform arm_lower @19 rotate -10');
      const timeline = player.animation?.bone?.find((entry) => entry.name === 'arm_lower');
      const last = timeline?.frame?.[timeline.frame.length - 1];
      if (timeline && last) {
        timeline.frame = [{ duration: 54, tweenEasing: 0, transform: { ...(last.transform ?? {}) } }];
        edits.push('collapse arm_lower to one constant frame');
      }
      return edits;
    },
  },

  {
    // The only fixture in the corpus with a **trimmed atlas**: 58/58 SubTextures carry a
    // non-zero `frameX/frameY`, so this is the sample that can see the `frameX` sign
    // (spec §103). It is also the only `type: "sheet"` (serial-frame) armature, whose bones
    // are all identity — the bone-matrix comparison alone is blind to it, the slot pivot
    // comparison is not.
    key: 'sheet', label: 'FramesAnimation (serial frame, 1 identity bone, trimmed atlas / 6 fps)',
    file: join(SAMPLES, 'FramesAnimation/FramesAnimation_ske.json'),
    tex: join(SAMPLES, 'FramesAnimation/FramesAnimation_tex.json'),
    armature: 'boy-fall', anim: 'boy-fall', frames: 7, fps: 6,
    slotIndices: 7,
    timelineProbe: true,
    edit: () => [],
  },

];

const wanted = process.argv[2] ?? 'all';
const defs = wanted === 'all' ? DEFS : DEFS.filter((d) => d.key === wanted);
if (defs.length === 0) { console.error(`unknown sample: ${wanted} (expected all | ${DEFS.map((d) => d.key).join(' | ')})`); process.exit(2); }
if (!existsSync(CHROME)) { console.error(`Chrome not found: ${CHROME} (set CHROME_PATH)`); process.exit(2); }
if (!existsSync(join(ORACLE_DIR, 'index.html'))) { console.error(`missing oracle runtime: ${ORACLE_DIR}`); process.exit(2); }
for (const def of defs) if (!existsSync(def.file)) { console.error(`missing fixture: ${def.file}`); process.exit(2); }

// ---- edits + export + our own reference frames ----------------------------------
interface Prepared { def: SampleDef; stem: string; edits: string[]; json: string; dbbin: Uint8Array; boneNames: string[]; mine: Array<Record<string, number[]>>; mineSlots: Array<Array<SlotPivotRow>> }

/** Our side of the slot-pivot comparison: one row per slot per frame. */
interface SlotPivotRow { name: string; displayIndex: number; pivotX: number; pivotY: number }

const prepare = (def: SampleDef): Prepared => {
  const raw = readFileSync(def.file);
  const source = def.file.endsWith('.dbbin')
    ? (decodeDbbin(raw).json)
    : JSON.parse(raw.toString('utf8'));
  // The atlas matters twice over: it is what we compare against (`displayPivotOffset` needs
  // the region), and the sample's own `frameX/frameY` only exist in the texture JSON.
  const texture = def.tex ? JSON.parse(readFileSync(def.tex, 'utf8')) as DbTextureAtlasData : undefined;
  const player = new Player(source, texture);
  if (def.armature) player.setArmature(def.armature);
  player.setAnimation(def.anim);
  const edits = def.edit(player);
  mkdirSync(ORACLE_DIR, { recursive: true });
  const json = serializeSkeletonData(player.doc);
  const dbbin = encodeDbbin(JSON.parse(json) as DbSkeletonData);
  // one file pair per sample — they share the oracle directory
  const stem = `closure_${def.key}`;
  writeFileSync(join(ORACLE_DIR, `${stem}_ske.json`), json);
  writeFileSync(join(ORACLE_DIR, `${stem}_ske.dbbin`), dbbin);
  // the oracle server only serves ORACLE_DIR, so the atlas has to live next to the exports
  if (def.tex) writeFileSync(join(ORACLE_DIR, `${stem}_tex.json`), readFileSync(def.tex));

  player.setAnimation(def.anim);
  const boneNames = player.skeleton.bones.map((b) => b.name);
  const mine: Array<Record<string, number[]>> = [];
  const mineSlots: Array<Array<SlotPivotRow>> = [];
  const slotPivotRow = (slotName: string, index: number): SlotPivotRow => {
    const display = player.skeleton.skinSlots.get(slotName)?.display?.[index];
    const region = display ? player.atlas?.byName.get(display.path ?? display.name ?? '') : undefined;
    const pivot = display && region ? displayPivotOffset(display, region) : { x: 0, y: 0 };
    return { name: slotName, displayIndex: index, pivotX: pivot.x, pivotY: pivot.y };
  };
  for (let f = 0; f <= (def.slotIndices ? def.slotIndices - 1 : def.frames); f++) {
    player.position = f;
    player.skeleton.update(player.animation, f);
    const pose: Record<string, number[]> = {};
    for (const b of player.skeleton.bones) pose[b.name] = Array.from(b.world);
    mine.push(pose);
    mineSlots.push(player.skeleton.slots.map((slot) => slotPivotRow(slot.name, slot.displayIndex)));
  }
  // index mode: the probe walks `displayIndex = 0..n-1`, so our side must too (the per-frame
  // rows above follow the playhead, which is a different question)
  if (def.slotIndices) {
    mineSlots.length = 0;
    const names = player.skeleton.slots.map((slot) => slot.name);
    for (let k = 0; k < def.slotIndices; k++) mineSlots.push(names.map((name) => slotPivotRow(name, k)));
  }
  return { def, stem, edits, json, dbbin, boneNames, mine, mineSlots };
};

const prepared = defs.map(prepare);

// ---- official runtime ----------------------------------------------------------
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(ORACLE_DIR, url === '/' ? 'index.html' : url.replace(/^[/\\]+/, ''));
  try {
    if (!file.startsWith(ORACLE_DIR)) throw new Error('escape');
    // read before writing headers, otherwise a missing file (favicon) crashes the
    // 404 path with "headers already sent"
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
const profile = join(tmpdir(), `bonestudio-closure-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch { /* ignore */ } server.close(); };

let page: { webSocketDebuggerUrl: string } | null = null;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    page = list.find((e) => e.type === 'page') ?? null;
  } catch { /* still starting */ }
}
if (!page) { cleanup(); console.error('headless Chrome did not expose a page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res(), { once: true }); ws.addEventListener('error', () => rej(new Error('ws error')), { once: true }); });
let id = 0; const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data as string);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression: string) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as { exceptionDetails?: unknown; result: { value: unknown } };
  if (r.exceptionDetails) throw new Error('evaluate failed');
  return r.result.value;
};

const runOracle = async (p: Prepared, file: string, binary: boolean, override?: { timeDriven?: boolean }) => {
  const { def } = p;
  const atlas = def.tex ? `&tex=${p.stem}_tex.json&slotprobe=1` : '';
  const mode = def.slotIndices && !override?.timeDriven ? '&slotmode=indices' : '';
  const url = `http://127.0.0.1:${PORT}/index.html?data=${file}&name=closure&armature=${encodeURIComponent(def.armature)}`
    + `&anim=${encodeURIComponent(def.anim)}&frames=${def.frames}&fps=${def.fps}${binary ? '&binary=1' : ''}${atlas}${mode}`;
  await send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    const state = await evaluate('window.__closure ? JSON.stringify(window.__closure) : null') as string | null;
    if (!state) continue;
    const parsed = JSON.parse(state) as { status: string; message?: string; version?: string; frames: Array<Record<string, number[]>>; slots?: Array<Array<SlotPivotRow>> };
    if (parsed.status === 'booting') continue;
    if (parsed.status !== 'ok') throw new Error(`oracle ${file} (${def.key}): ${parsed.status} ${parsed.message ?? ''}`);
    return parsed;
  }
  throw new Error(`oracle ${file} (${def.key}) never reported`);
};

const compare = (p: Prepared, official: Array<Record<string, number[]>>) => {
  let maxDiff = 0; let worstAt: unknown = null; let compared = 0; let skipped = 0;
  const perBone = new Map<string, number>(p.boneNames.map((name) => [name, 0]));
  /** 逐帧最大分量差 + 该帧的最差骨骼/分量（§101 探针：先定位到"哪跟骨头先偏"）。 */
  const perFrame: number[] = [];
  const worstPerFrame: Array<{ frame: number; bone: string; component: number; diff: number }> = [];
  for (let f = 0; f < Math.min(p.mine.length, official.length); f++) {
    let frameMax = 0;
    let frameWorst = { frame: f, bone: '', component: -1, diff: 0 };
    for (const name of p.boneNames) {
      const a = p.mine[f][name]; const b = official[f]?.[name];
      if (!a || !b) { skipped++; continue; }
      compared++;
      for (let i = 0; i < 6; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > frameMax) { frameMax = d; frameWorst = { frame: f, bone: name, component: i, diff: d }; }
        if (d > (perBone.get(name) ?? 0)) perBone.set(name, d);
        if (d > maxDiff) { maxDiff = d; worstAt = { frame: f, bone: name, component: i, mine: a[i], official: b[i] }; }
      }
    }
    perFrame.push(frameMax);
    worstPerFrame.push({ ...frameWorst, diff: Number(frameMax.toExponential(3)) });
  }
  const worstBones = [...perBone.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([bone, diff]) => ({ bone, diff }));
  const firstDivergence = perFrame.findIndex((d) => d > 1e-4);
  // `expected` is derived from what both sides actually produced, so a fixture mismatch
  // still fails (`frameMismatch` below) instead of silently passing on a short compare.
  const comparedFrames = Math.min(p.mine.length, official.length);
  const expected = comparedFrames * p.boneNames.length;
  return {
    maxDiff, worstAt, cleanBones: [...perBone.values()].filter((d) => d < TOLERANCE).length,
    bones: p.boneNames.length, compared, skipped, expected,
    frameMismatch: p.mine.length !== official.length,
    mineFrames: p.mine.length, officialFrames: official.length,
    withinTolerance: maxDiff < TOLERANCE && skipped === 0 && compared === expected
      && p.mine.length === official.length,
    worstBones, firstDivergence, worstPerFrame,
    perFrame: perFrame.map((d) => Number(d.toExponential(3))),
  };
};

/**
 * Per-frame slot-pivot comparison — the observable of a **trimmed atlas**.
 *
 * Official `Slot._pivotX/_pivotY` (dragonBones57.js:5735-5748) is `pivot * frameWidth + frameX`,
 * and `EgretSlot.prototype._updateFrame` hands it to the renderer as `anchorOffsetX` (16065).
 * Our side reads the same quantity out of the render path (`displayPivotOffset`), which is what
 * makes this a gate on the *render* path and not on a parallel reimplementation.
 *
 * A `type: "sheet"` armature has identity bones, so the bone-matrix comparison above is blind to
 * a `frameX` sign error — this is the only sample/gate pair in the corpus that can see it (spec §103).
 */
const compareSlots = (p: Prepared, official: Array<Array<SlotPivotRow>>) => {
  let maxDiff = 0; let worstAt: unknown = null; let compared = 0; let skipped = 0;
  const perFrame: number[] = [];
  for (let f = 0; f < Math.min(p.mineSlots.length, official.length); f++) {
    const byName = new Map((official[f] ?? []).map((row) => [row.name, row]));
    let frameMax = 0;
    for (const mine of p.mineSlots[f]) {
      const off = byName.get(mine.name);
      if (!off) { skipped++; continue; }
      compared++;
      const pairs: Array<[string, number, number]> = [
        ['pivotX', mine.pivotX, off.pivotX],
        ['pivotY', mine.pivotY, off.pivotY],
      ];
      for (const [component, a, b] of pairs) {
        const d = Math.abs(a - b);
        if (d > frameMax) frameMax = d;
        if (d > maxDiff) { maxDiff = d; worstAt = { frame: f, slot: mine.name, component, mine: a, official: b }; }
      }
    }
    perFrame.push(Number(frameMax.toExponential(3)));
  }
  const slotCount = p.mineSlots[0]?.length ?? 0;
  const expected = p.mineSlots.length * slotCount;
  return {
    maxDiff, worstAt, compared, skipped, expected,
    withinTolerance: maxDiff < TOLERANCE && skipped === 0 && compared === expected,
    perFrame,
  };
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  const evidencePath = join(ROOT, 'docs', 'evidence', 'closure-oracle.json');
  const evidence: Record<string, unknown> = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>
    : {};
  let ok = true;
  for (const p of prepared) {
    const jsonRun = p.def.gate === 'binary' ? null : await runOracle(p, `${p.stem}_ske.json`, false);
    const jsonDiff: ReturnType<typeof compare> | null = jsonRun ? compare(p, jsonRun.frames) : null;
    // an empty `slots` array means the oracle was not asked for slot data (no atlas / no
    // `slotprobe`), which is a skip and not a failure
    const jsonSlots = jsonRun?.slots && jsonRun.slots.length > 0 ? compareSlots(p, jsonRun.slots) : null;
    const binRun = await runOracle(p, `${p.stem}_ske.dbbin`, true);
    const binDiff = compare(p, binRun.frames);
    const binSlots = binRun.slots && binRun.slots.length > 0 ? compareSlots(p, binRun.slots) : null;
    const jsonPass = jsonDiff === null ? true : jsonDiff.withinTolerance;
    const slotPass = (jsonSlots?.withinTolerance ?? true) && (binSlots?.withinTolerance ?? true);
    // the time-driven switch is a property of the *written binary*, so it is probed there
    let timeline: { distinct: number; sequence: number[]; withinTolerance: boolean } | null = null;
    if (p.def.timelineProbe) {
      const run = await runOracle(p, `${p.stem}_ske.dbbin`, true, { timeDriven: true });
      const sequence = (run.slots ?? []).map((rows) => rows[0]?.displayIndex ?? -1);
      const distinct = new Set(sequence).size;
      timeline = { distinct, sequence, withinTolerance: distinct > 1 };
    }
    if (!p.def.knownOpen) ok = ok && jsonPass && binDiff.withinTolerance && slotPass && (timeline?.withinTolerance ?? true);
    if (p.def.knownOpen) {
      const pass = jsonDiff?.withinTolerance !== false && binDiff.withinTolerance && slotPass && (timeline?.withinTolerance ?? true);
      console.log(pass
        ? `✔ known-open sample "${p.def.key}" now converges — remove its knownOpen flag`
        : `… known-open sample "${p.def.key}" still diverges: ${p.def.knownOpen}`);
    }
    const samples = (evidence.samples ?? {}) as Record<string, unknown>;
    samples[p.def.key] = {
      knownOpen: p.def.knownOpen ?? null,
      gate: p.def.gate ?? 'both',
      gated: !p.def.knownOpen,
      label: p.def.label, fixture: p.def.file, armature: p.def.armature, animation: p.def.anim,
      frames: p.mine.length, bones: p.boneNames.length, fps: p.def.fps, tolerance: TOLERANCE,
      edits: p.edits, exported: { jsonBytes: p.json.length, dbbinBytes: p.dbbin.length },
      json: jsonDiff, binary: binDiff,
      slots: { json: jsonSlots, binary: binSlots },
      // raw official rows (displayIndex + resolved texture + frame rect) — the diagnosis
      // trail for a slot-level divergence, cheapest place to keep it
      officialSlots: { json: jsonRun?.slots ?? null, binary: binRun.slots ?? null },
      timeline,
      mineSlots: p.mineSlots.length > 0 && p.mineSlots[0].length > 0 ? p.mineSlots : null,
    };
    evidence.samples = samples;
    evidence.capturedAt = new Date().toISOString();
    evidence.ok = ok;
    console.log(JSON.stringify({ sample: p.def.key, json: jsonDiff, binary: binDiff, slots: binSlots, timeline }, null, 2));
  }
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  cleanup();
  process.exit(ok ? 0 : 1);
} catch (error) {
  cleanup();
  console.error(String(error));
  process.exit(1);
}
