import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Player } from '../core/player';
import { clearAutosave, describeAutosaveAge, readAutosave, writeAutosave } from '../core/project/autosave';
import type { DbArmatureData, DbColorTransform, DbTextureAtlasData } from '../core/types';
import { serializeSkeletonData } from '../core/parse/ske';
import { serializeSpineSkeleton } from '../core/export/spine';
import { serializeSpineAtlas } from '../core/export/atlas';
import { buildZip } from '../core/export/zip';
import { coverKey, readCovers, writeCover } from '../core/project/covers';
import { renderCover } from '../render/coverRenderer';
import { renderCoverAnimation, type CoverAnimation } from '../render/coverAnimation';
import { ExportDialog } from './ExportDialog';
import type { ExportRequest } from './exportFormats';
import { importImageIntoAtlas } from '../core/assetImport';
import type { RasterImage } from '../core/raster';
import { classifyJsonFile } from '../core/import/spineDetect';
import { decodePngInBrowser, encodePngInBrowser } from './pngBrowser';
import { decodeDbbin } from '../core/parse/dbbinDecode';
import {
  parseDbproj, serializeDbproj, unwrapProjectSkeleton, wrapSkeletonAsProject,
} from '../core/project/dbproj';
import { emptySheetSkeleton, emptySkeleton } from '../core/project/newProject';
import {
  addIkConstraint, addIkConstraintWithTarget, ikRoleOf, removeIkConstraint,
  setIkConstraint, validateIkConstraint,
} from '../core/ikEdit';
import { ffdKeyAt, removeFfdKeyframe, setFfdVertex } from '../core/ffdEdit';
import { ikBindValues, ikKeyAt, readIkKey, removeIkKeyframe, setIkKeyframe } from '../core/ikKeyEdit';
import { autoWeightMesh } from '../core/weightsAuto';
import {
  addBoundingBoxPointOnEdge, addBoundingBoxSlot, boundingBoxOf, boundingBoxPoints,
  removeBoundingBoxPoint, writeBoundingBox,
} from '../core/bboxEdit';
import { buildMeshFromOutline, outlineFromAlpha } from '../core/meshOutline';

/** 官方 `Mesh.densityNumArr`：密度 1~5 对应的轮廓阈值（越大点越多）。 */
const DENSITY_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7];
/** 官方网格编辑器 `_11511` 的四个工具（外加兼容旧的「添加边线」）；工具离开这一组即退出编辑。 */
const MESH_EDIT_TOOLS: readonly ToolId[] = ['mesh', 'meshAdd', 'meshDelete', 'meshOutline', 'meshEdge'];
import { addBone, addBoneBetween, cloneBone, relatedBoneNames, removeBone, setBoneLength, setBoneParent } from '../core/boneEdit';
import { copyBoneSubtree, pasteBoneSubtree, type BoneClipboard } from '../core/boneClipboard';
import { encodeDbbin } from '../core/export/dbbin';
import { HeadButton, MenuBar, Panel, StatusBar, Tabs, ToolRail, type MenuDef, type ToolId, TOOLS, PLAYBACK_LOCKED_TOOLS, STRUCTURE_MESH_TOOLS } from './chrome';
import { InfoPanel, ProjectBrowser, PropertiesPanel, type BoneRow } from './panels';
import { TimelineDock } from './TimelineDock';
import { extraTracks, type ExtraTrack } from '../core/timelineTracks';
import { boneChannelKeys } from '../core/boneChannels';
import { addEventFrame, eventsAt, removeEventFrame, updateEventParams } from '../core/eventEdit';
import {
  allTrackRefs, copyTrackKeys, deleteTrackKeys, expandTrackRef, mergeTrackRefs, pasteTrackKeys,
  type TrackClipboard, type TrackKeyRef,
} from '../core/trackKeyEdit';
import { BoneFramePanel } from './BoneFramePanel';
import { EventPanel } from './EventPanel';
import { CurvePanel } from './CurvePanel';
import { SheetPanel, SheetProperties, SheetToolbar } from './SheetPanel';
import { SnapBar, readSnapSettings, writeSnapSettings, type SnapSettings } from './SnapBar';
import { prepareReference, type SnapReference } from '../core/snapFit';
import { boneTipSnap, fitMeshContour, jointCoverSnap, referenceIoU, snapOrder, snapSlot, weldAllWeights, type RefFrame } from '../core/snapAssemble';

/** 浏览器里把图片 URL 读成 straight RGBA 光栅 */
async function rasterFromUrl(url: string): Promise<RasterImage | null> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { return null; }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(data.buffer.slice(0)) };
}
import { SheetFrameBar } from './SheetFrameBar';
import { SymbolLibraryTree } from './SymbolLibraryTree';
import { DrawOrderPanel } from './DrawOrderPanel';
import { fitStageMenu } from './stageMenuFit';
import { NewProjectDialog, type NewProjectKind } from './NewProjectDialog';
import { NewSymbolDialog } from './NewSymbolDialog';
import { RenameDialog } from './RenameDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { closeOne, closeOthers, nextActiveAfterClose } from '../core/documents';
import { bindingOf, findConflict, labelOf, matchHotkey, readHotkeys, writeHotkeys } from '../core/hotkeys';
import { isDesktopEdge } from '../core/browserEnv';
import { readLocale, setLocale, writeLocale, type Locale } from '../i18n';
import { addArmature, mergeSkeletonDoc, removeArmature, type SymbolKind } from '../core/armatureEdit';
import { removeRegion, removeSubTexture } from '../core/textureEdit';
import { parseTextureAtlas } from '../core/parse/texture';
import { readSceneTreeFilter, writeSceneTreeFilter } from '../core/sceneTreeFilter';
import { readStageFilter, toggleStageFilter, writeStageFilter, type StageFilter } from '../core/stageFilter';
import { childLocalValues, displayOverridesFor, shouldFreezeChildren, snapshotChildWorlds, snapshotSlotWorlds } from '../core/inheritEdit';
import {
  appendSheetFrame, applyFrameToAll, flipFrame, frameAnchorWorld, isLooping, isSheetArmature, pivotFromUi, readFrameValues, readSheetFrames, removeFrame, sortFramesByName,
  setFrameAnchorWorld, setFramePivot, setFramePosition, setFrameRate, setLoop as applySheetLoop, setPlayTimes,
} from '../core/sheetEdit';
import { apply, IDENTITY, invert, parseBoolean, type Mat2D } from '../core/runtime/math';
import { readSlotDisplayTransform, setSlotDisplayTransform, slotParentWorld, slotPoseEditable } from '../core/slotPose';
import { vertexWeightByBone } from '../core/weightPie';
import { SlotPanel } from './SlotPanel';
import { MeshEditorBar } from './MeshEditorBar';
import { AnimationPanel } from './AnimationPanel';
import { TransformBar } from './TransformBar';
import { Sash, useStoredSize } from './Sash';
import { SettingsDialog } from './SettingsDialog';
import type { WelcomeSample } from './WelcomeScreen';
import { HelpDialog, type HelpTopic } from './HelpDialog';
import { AiMcpDialog } from './AiMcpDialog';
import { exportSpine4 } from '../core/export/spine4';
import { allowKey, allowTool, assertWritable, installDomGuard, isReadonly, setReadonly } from '../core/readonlyGuard';
import { LiveSync } from './LiveSync';
import { PluginDialog } from './PluginDialog';

import {
  installPlugin, parseManifest, readPlugins, removePlugin, setPluginEnabled,
  type PluginManifest,
} from '../plugins/registry';
import { activatePlugin, deactivatePlugin, type PluginActivation } from '../plugins/loader';
import { applyAiCommands, planAiCommands } from '../ai/pluginApi';
import { registerBuiltinCapabilities } from '../ai/capabilities';
import {
  DEFAULT_SETTINGS, RECENTS_KEY, colorToNumber, pushRecent, readGuides, readRecents, readSettings,
  writeGuides, writeSettings, type GuideLine, type RecentEntry, type StudioSettings,
} from '../core/project/settings';
import { Viewer } from './Viewer';
import { SwapImageDialog } from './SwapImageDialog';
import {
  keyFrameMap, keyFrames, neighbourKeyFrame, readBoneTransform, relatedBone, removeKeyFrame,
  addMeshWeightBone, removeMeshWeightBone, renameBone, reorderSlot, restoreArmature,
  effectiveTransform, sampleTransform, setBoneTransform, setTweenEasing, setVertexWeight, meshWeightBones,
  boneChannelKeyAt, insertFrameAt, removeBoneChannelKey, removeFrameAt, setBoneChannelTransform,
  snapshotArmature, type BoneChannel, type BoneTransformValues, type SlotOrderMode,
} from '../core/editing';
import {
  addMeshVertexOnEdge, addUserEdge, convertMeshToImage, findMesh, findUserEdgeIndex, isBakedMesh, isDefaultRectMesh,
  isMeshDisplay, meshVertexCount, removeMeshVertex, removeUserEdge, resetMeshGeometry, setMeshVertex,
} from '../core/meshEdit';
import {
  copyKeys, deleteKeys, distributeKeys, moveKeys, pasteKeys, scaleKeys, type KeyClipboard, type KeySelectionEntry,
} from '../core/keyEdit';
import {
  applyPreset, copyCurve, curveEditable, pasteCurve, readKeyCurve, readKeyTween, setKeyCurve, setTweenRotate, type CurveClipboard,
  type CurvePresetName,
} from '../core/curveEdit';
import { setSpanTween } from '../core/spanTween';
import { applyMultiFrameDelta, autoKeyEdit, pruneRedundantKeys } from '../core/keyAssist';
import type { BoneChannelName } from '../core/boneChannels';
import { addAnimation, animationNames, cloneAnimation, removeAnimation, reorderAnimation } from '../core/animEdit';
import {
  bindOrder, drawOrder, moveSlotOrder, namesToOrder, orderMarks, removeZOrderKeyframe,
  setBindOrder, setZOrderKeyframe, zOrderKeyed, zOrderKeyStatus,
} from '../core/zorderEdit';
import { slotDisplayUsage } from '../core/library';
import {
  addSlot, blendModeLabel, colorKeyAt, displayKeyAt, readSlotColor, removeSlot, removeSlotColorKeyframe,
  removeSlotDisplayKeyframe, renameSlot, setSlotBlendMode, setSlotColor, setSlotColorKeyframe, setSlotDisplayKeyframe, slotColorAt,
  appendSlotDisplay, convertDisplayToArmature, removeSlotDisplay, setSlotDisplayIndex, slotData, swapDisplayImage,
} from '../core/slotEdit';

/** `type: "surface"` bones recovered by the binary reader (grid size + deform key count). */
function decodeSurfaceBones(json: unknown): Array<{ name: string; vertices: number; timelines: number }> {
  const out: Array<{ name: string; vertices: number; timelines: number }> = [];
  const doc = json as {
    armature?: Array<{
      bone?: Array<{ name?: string; type?: unknown; vertices?: unknown[] }>;
      animation?: Array<{ surface?: Array<{ frame?: unknown[] }> }>;
    }>;
  };
  for (const armature of doc.armature ?? []) {
    const timelines = (armature.animation ?? []).flatMap((animation) => animation.surface ?? []).length;
    for (const bone of armature.bone ?? []) {
      if (bone.type === 'surface') {
        out.push({ name: bone.name ?? '', vertices: (bone.vertices?.length ?? 0) / 2, timelines });
      }
    }
  }
  return out;
}

/** 只读观看：文件 / 编辑 / 动画 菜单里的命令全部置灰（视图、窗口、AI、帮助照常） */
const READONLY_MENU_BLOCK = new Set(['文件', '编辑', '动画']);
function readonlyMenus(menus: MenuDef[]): MenuDef[] {
  return menus.map((m) => (READONLY_MENU_BLOCK.has(m.label) ? { ...m, items: m.items.map((it) => (it.kind === 'sep' ? it : { ...it, disabled: true })) } : m));
}

interface SampleDef {
  name: string;
  skeleton: string;
  texture: string;
  image: string;
  /** 文件所在路由：内置示例 `/dbsamples`（缺省），AI 工程 `/aiprojects` */
  root?: string;
}
const AI_ROOT = '/aiprojects';
const rootOf = (sample: { root?: string }) => sample.root ?? '/dbsamples';

interface AiProjectState { thumb: string; lockedBy: { sessionId: string; displayName: string } | null }

interface PendingLoad {
  skeleton?: unknown;
  texture?: DbTextureAtlasData;
  imageUrl?: string;
  /** 打开的 .dbproj 外壳：保存时原样写回（stage / library / timeline 不丢） */
  project?: Record<string, unknown>;
  /** .dbproj 的文件名（去掉扩展名后用作保存的默认名） */
  projectName?: string;
  /** 内置样例在 samples 根下的相对目录（页签「打开项目所在资源管理器」） */
  sampleDir?: string;
  /** `sampleDir` 属于哪个根：内置示例 `/dbsamples`（缺省）或 AI 工作区 `/aiprojects` */
  dirSource?: 'samples' | 'ai';
  /** 文档属于工作区工程 `projects/<name>` 时记名字：Ctrl+S 写回该项目而不是下载文件 */
  workspaceName?: string;
  /** 打开来源：Spine 导入的文档在页签/提示里标出来（保存仍是普通 DB 工程） */
  source?: 'file' | 'spine';
}

/** P-09 可自定义的工具键：键 -> [动作 id, 工具 id]（官方 `Setting.hotkey`） */
const HOTKEY_TOOL_KEYS: Record<string, [string, ToolId]> = {
  q: ['tool.select', 'select'],
  w: ['tool.pose', 'pose'],
  e: ['tool.bone', 'bone'],
  r: ['tool.weight', 'weight'],
  z: ['tool.move', 'move'],
  x: ['tool.rotate', 'rotate'],
  c: ['tool.scale', 'scale'],
  v: ['tool.free', 'free'],
};

/** P-19 一份打开的文档（页签）：自带 Player、图集 URL 与撤销栈 */
interface OpenDocument {
  id: string;
  name: string;
  player: Player;
  atlasUrl: string | null;
  texture: DbTextureAtlasData | null;
  history: { stack: string[]; index: number };
  /** 内置样例目录；本机文件打开时浏览器不给路径，留空 */
  sampleDir?: string;
  /** `sampleDir` 属于哪个根：内置示例（缺省）或 AI 工作区 */
  dirSource?: 'samples' | 'ai';
  /** 保存元数据：切页签时恢复到 projectRef / projectNameRef / workspaceRef */
  project?: Record<string, unknown>;
  projectName?: string;
  workspaceName?: string;
}

/** Canvas backdrops. `checker` mirrors DragonBones 的舞台底纹
 *  (`assets/stage/canvasBg.png`, 16x16 white/#cccccc) — measured, see docs/UX-DESIGN.md. */
const STAGE_BACKGROUNDS = [
  // official stage grid: black/white checker, one cell = 100 px at 100% zoom
  { id: 'checker', name: '棋盘（100px 格）', css: 'repeating-conic-gradient(#ffffff 0% 25%, #cccccc 0% 50%) 50% / 100px 100px' },
  { id: 'checkerDark', name: '深色棋盘', css: 'repeating-conic-gradient(#3f3f3f 0% 25%, #2e2e2e 0% 50%) 50% / 100px 100px' },
  { id: 'dark', name: '深灰', css: '#2b2b2b' },
  { id: 'mid', name: '中灰', css: '#808080' },
  { id: 'light', name: '浅灰', css: '#e6e6e6' },
  { id: 'white', name: '白色', css: '#ffffff' },
  { id: 'doc', name: '文档背景色', css: '' },
];

/** 欢迎页封面 / 悬停预览用：从示例目录新建一个独立的 Player（绑定姿态），不碰当前工程。 */
async function fetchSamplePreview(sample: SampleDef): Promise<{ player: Player; imageUrl: string }> {
  const skeleton = sample.skeleton.toLowerCase().endsWith('.dbbin')
    ? decodeDbbin(await fetch(`${rootOf(sample)}/${sample.skeleton}`).then((r) => r.arrayBuffer())).json
    : await fetch(`${rootOf(sample)}/${sample.skeleton}`).then((r) => r.json());
  const texture = await fetch(`${rootOf(sample)}/${sample.texture}`).then((r) => r.json()) as DbTextureAtlasData;
  const imageUrl = URL.createObjectURL(await fetch(`${rootOf(sample)}/${sample.image}`).then((r) => r.blob()));
  const player = new Player(skeleton, texture);
  player.playing = false;
  player.setupPose = true;
  player.position = 0;
  player.applyPose();
  return { player, imageUrl };
}

function downloadText(text: string, filename: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立刻 revoke 会在大文件（如整份 Spine JSON）还没写完时把下载取消掉 —— e2e 实测踩到
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function blobToDataUrl(url: string): Promise<string | null> {
  return fetch(url)
    .then((response) => response.blob())
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }))
    .catch(() => null);
}

function downloadBinary(bytes: Uint8Array, filename: string) {
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }), filename);
}

/** 工作区保存结果：exists=同名、locked=agent 持锁、invalid=名字非法、unavailable=没有 dev server */
type WorkspaceSaveResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'exists' | 'locked' | 'invalid' | 'unavailable' | 'error'; detail?: string };

/** 保存失败的人话原因 */
function workspaceSaveReason(result: Extract<WorkspaceSaveResult, { ok: false }>): string {
  if (result.reason === 'exists') return '同名工程已存在';
  if (result.reason === 'locked') return `工程正被 ${result.detail ?? 'agent'} 编辑`;
  if (result.reason === 'invalid') return '工程名只能用英文、数字、下划线、点或连字符';
  if (result.reason === 'unavailable') return '本地 dev server 不可用';
  return result.detail ?? '未知错误';
}

/** 新建工程默认名去重：NewProject、NewProject-2、NewProject-3… */
function uniqueProjectName(base: string, existing: Array<{ name: string }>): string {
  const names = new Set(existing.map((entry) => entry.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!names.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立刻 revoke 会在大文件（如整份 Spine JSON）还没写完时把下载取消掉 —— e2e 实测踩到
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadJson(data: unknown, filename: string) {
  downloadText(JSON.stringify(data), filename);
}

/** 目录选择句柄的最小类型（`showDirectoryPicker` 不一定在 TS 的 lib.dom 里）。 */
interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
  }>;
}

/** Chrome 的 File System Access API；Safari/Firefox 上为 undefined。 */
function directoryPicker(): (() => Promise<DirectoryHandleLike>) | null {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/** 往选定的目录里写一个文件（用于 DragonBones 的导出目录约定）。 */
async function writeDirectoryFile(dir: DirectoryHandleLike, filename: string, data: Blob | string, type = 'application/json'): Promise<void> {
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(typeof data === 'string' ? new Blob([data], { type }) : data);
  await writable.close();
}

export function App() {
  const [player, setPlayer] = useState<Player | null>(null);
  /** P-19 选项卡管理（官方 `CloseTabButton.*`）：同时打开的文档，每个自带撤销栈 */
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  /** 欢迎页是固定页签。启动停在这里；打开文档后仍可点回来，不能关掉。 */
  const [welcomeActive, setWelcomeActive] = useState(true);
  const docSeq = useRef(0);
  const [version, setVersion] = useState(0);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const [textureData, setTextureData] = useState<DbTextureAtlasData | null>(null);
  const [samples, setSamples] = useState<SampleDef[]>([]);
  const [samplesReady, setSamplesReady] = useState(false);
  /** AI 工作区工程（`/aiprojects/manifest.json`）；null = 还没拉到 */
  const [aiProjects, setAiProjects] = useState<SampleDef[] | null>(null);
  const [aiState, setAiState] = useState<Record<string, AiProjectState>>({});
  const [aiLockPrompt, setAiLockPrompt] = useState<{ sample: SampleDef; holder: string; sessionId: string } | null>(null);
  /** 欢迎页卡片封面（`coverKey(kind, name)` → JPEG data URL） */
  const [covers, setCovers] = useState<Record<string, string>>(() => {
    try {
      // 旧版封面缓存（带骨骼线框），腾出配额
      window.localStorage.removeItem('bonestudio.covers');
      window.localStorage.removeItem('bonestudio.covers.v2');
    } catch { /* 存储不可用 */ }
    return readCovers(window.localStorage);
  });
  /** 刚打开的项目的封面键：工程载入后拍一张封面写到这里 */
  const coverTargetRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** what the `*_ske.dbbin` reader recovered (surface grids + families still pending) */
  const [decodeStats, setDecodeStats] = useState<{ surfaces: number; pending: string[] } | null>(null);
  const [tool, setTool] = useState<ToolId>('select');

  const [showBones, setShowBones] = useState(true);
  /** 舞台过滤器条（官方 StageFilterBar 的 6 个开关），落在 localStorage */
  const [stageFilter, setStageFilter] = useState<StageFilter>(() => readStageFilter(window.localStorage));
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);
  const [hiddenSlots, setHiddenSlots] = useState<Set<string>>(new Set());
  /** 官方右键菜单的「锁定」：锁定的骨骼在舞台上点不中，锁定的对象在场景树里也点不中 */
  const [lockedBones, setLockedBones] = useState<Set<string>>(new Set());
  /** 骨骼级「隐藏」（官方 MenuItem-hide）：不在舞台上画这根骨骼 */
  const [hiddenBones, setHiddenBones] = useState<Set<string>>(new Set());
  const [lockedSlots, setLockedSlots] = useState<Set<string>>(new Set());
  const [selectedBone, setSelectedBone] = useState<string | null>(null);
  /** "设置父级" (P): the next stage click picks the new parent bone */
  const [parentPick, setParentPick] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  /** 权重工具点中的网格顶点。属性栏进度条改的就是它。 */
  const [weightVertex, setWeightVertex] = useState<number | null>(null);
  /** 插槽多选（官方 MenuItem-selectChildSlots 等批量操作的基础）：主选中仍是 selectedSlot */
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  /**
   * 多选集合（官方 `Menu.Edit.SelectAll`「全选」+ Shift 点选 + 舞台框选）。
   * `selectedBone` 仍是**主选**（属性面板 / 时间轴都用它），这个集合只负责"哪些还选中着"。
   */
  const [selectedBones, setSelectedBones] = useState<Set<string>>(() => new Set());
  /** 舞台右键菜单（官方 `MenuItem-*`） */
  const [stageMenu, setStageMenu] = useState<{ x: number; y: number; bone: string | null; slot: string | null } | null>(null);
  /** 菜单壳（量自然尺寸用；键盘/鼠标命中的 `.stage-menu` 都是它） */
  const stageMenuRef = useRef<HTMLDivElement | null>(null);
  /** 菜单按 `.viewer` 夹取后的落位（spec §113）；`key` 不匹配说明是上一个菜单的旧值，不套用 */
  const [stageMenuFit, setStageMenuFit] = useState<{ key: string; left: number; top: number; maxHeight: number } | null>(null);
  /**
   * 舞台右键菜单落位（spec §113）：按舞台容器 `.viewer` 夹取 —— 下方放不下就整体上移贴底，
   * 仍放不下用 maxHeight 交给内层 `.stage-menu-scroll` 出滚动条，避免被视口 / 容器裁掉。
   * 量的是**自然尺寸**（此刻还没应用 maxHeight），`useLayoutEffect` 在 paint 前跑完，不会闪。
   */
  useLayoutEffect(() => {
    if (!stageMenu) { setStageMenuFit(null); return; }
    const menu = stageMenuRef.current;
    const viewer = document.querySelector('.viewer');
    if (!menu || !viewer) return;
    const fit = fitStageMenu(
      { x: stageMenu.x, y: stageMenu.y },
      { width: menu.offsetWidth, height: menu.offsetHeight },
      viewer.getBoundingClientRect(),
    );
    setStageMenuFit({
      key: `${stageMenu.x}:${stageMenu.y}:${stageMenu.bone ?? ''}:${stageMenu.slot ?? ''}`,
      ...fit,
    });
  }, [stageMenu]);
  /** 当前菜单可套用的落位（只在 key 匹配时生效，避免上一个菜单的尺寸残留） */
  const stageMenuFitNow = stageMenu && stageMenuFit
    && stageMenuFit.key === `${stageMenu.x}:${stageMenu.y}:${stageMenu.bone ?? ''}:${stageMenu.slot ?? ''}`
    ? stageMenuFit : null;
  const stageMenuStyle: CSSProperties = {
    left: stageMenuFitNow ? stageMenuFitNow.left : stageMenu?.x,
    top: stageMenuFitNow ? stageMenuFitNow.top : stageMenu?.y,
    maxHeight: stageMenuFitNow ? stageMenuFitNow.maxHeight : undefined,
  };
  /** 插槽属性剪贴板（官方 MenuItem-copySlotProperty / pasteSlotProperty） */
  const slotPropertyClipboardRef = useRef<{ color: ReturnType<typeof readSlotColor>; blendMode: number | string | undefined } | null>(null);
  /** 「转换为元件...」（官方 MenuItem-convertToSymbol）：先记住目标插槽，再弹元件列表 */
  const [symbolPicker, setSymbolPicker] = useState<{ slot: string; index: number } | null>(null);
  /** 显示对象剪贴板（官方 MenuItem-copyDisplay / pasteDisplay） */
  const displayClipboardRef = useRef<Parameters<typeof appendSlotDisplay>[2] | null>(null);
  /** 骨骼剪贴板（官方 MenuItem-copyBone / pasteBone）：子树快照 */
  const boneClipboardRef = useRef<BoneClipboard | null>(null);
  /** 「选择性粘贴」对话框（官方 SelectivePaste.selectPasteContents「选择粘贴内容」） */
  const [pasteDialog, setPasteDialog] = useState<{ parent: string; children: boolean; keyFrames: boolean } | null>(null);
  /**
   * 洋葱皮（官方 `Timeline.onion.tooltip`）：暂停时叠加前 / 后帧。
   * 序列帧面板有两个**独立**开关（官方 `Sheet.onion.prev` / `Sheet.onion.next`），
   * 时间轴只有一个总开关 —— 点它就把两个一起同开同关。
   */
  const [onionPrev, setOnionPrev] = useState(false);
  const [onionNext, setOnionNext] = useState(false);
  const onion = onionPrev || onionNext;
  const setOnion = useCallback((value: boolean) => { setOnionPrev(value); setOnionNext(value); }, []);
  /** 洋葱皮范围（播放头前 / 后各几帧，摄影表标尺上拖柄修改） */
  const [onionBefore, setOnionBefore] = useState(1);
  const [onionAfter, setOnionAfter] = useState(1);
  /** 摄影表左上「自动关键帧」「编辑多帧」（官方默认都关） */
  const [autoKey, setAutoKey] = useState(false);
  const [multiFrame, setMultiFrame] = useState(false);
  const autoKeyRef = useRef(autoKey);
  autoKeyRef.current = autoKey;
  const multiFrameRef = useRef(multiFrame);
  multiFrameRef.current = multiFrame;
  /** 序列帧面板的「显示边框」（官方 `Sheet.showframe`） */
  const [showFrameBorder, setShowFrameBorder] = useState(false);
  /**
   * 帧编辑条「绝对 / 相对」TabBar（官方 `_13221.as` 第 137 行 `selectedIndex = 0`，即默认「绝对」）：
   * 绝对 = 位置 X/Y + 舞台上自由拖图；相对 = 九宫格轴心 + 轴心 X/Y。
   */
  const [sheetPlace, setSheetPlace] = useState<'absolute' | 'relative'>('absolute');
  /**
   * 官方 StagePanel.ArmatureMode / StagePanel.AnimationMode：
   * 「骨架装配」改结构、「动画制作」改关键帧，Ctrl+Tab 切换（第 89 轮）。
   * 打开工程默认停在骨架装配。
   */
  const [editMode, setEditMode] = useState<'armature' | 'animation'>('armature');

  /**
   * 切换编辑模式（官方 `StagePanel.ArmatureMode` / `AnimationMode`）：
   * 装配模式下动画相关面板整体隐藏（见下方 JSX）。
   */
  const changeEditMode = useCallback((mode: 'armature' | 'animation') => {
    setEditMode(mode);
    setMeshEditMode(false);
    setMeshEditSlot(null);
    if (mode === 'animation') {
      setTool((current) => (STRUCTURE_MESH_TOOLS.includes(current) ? 'select' : current));
      setFfdMode(true);
    } else {
      setFfdMode(false);
    }
  }, []);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const [loop, setLoop] = useState(true);
  /** 时间轴「只显示选中时间轴」（官方 Timeline.filter，默认开） */
  const [timelineFilter, setTimelineFilter] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(1);
  const [fitToken, setFitToken] = useState(0);
  /** 官方布局：右上停靠区（场景树 / 层级） */
  const [rightTab, setRightTab] = useState('scene');
  /**
   * 「层级」面板的临时绘制顺序（只有动画制作模式会用到）：槽位名数组（升序 = 从下层到上层）。
   * 官方口径：动画模式改序**不写骨架**，只落在临时缓存里，等旗杆「添加层级关键帧」才落帧
   * （`_573/_574.as:376-392`）；装配模式改的是绑定顺序，走 `setBindOrder`。
   */
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  /**
   * 官方场景树标题栏的「智能过滤」（`ScenePanel.intelligentFilterButton`）：
   * 状态是**持久设置**（`bonestudio.sceneTreeFilter`），所以放在 App 里而不是面板内部 ——
   * 按钮在标题栏、树在面板体，两处要共用同一份状态。
   */
  const [sceneFilter, setSceneFilter] = useState<boolean>(() => readSceneTreeFilter(window.localStorage));
  /** 场景树标题栏「创建」下拉的展开态（官方 `ScenePanel.newDropList`） */
  const [createMenu, setCreateMenu] = useState(false);
  /** 资源树当前选中的节点 key（`arm:` / `lib:` / `atlas:` / `img:`），标题栏的删除按它决定目标 */
  const [libraryNode, setLibraryNode] = useState<string | null>(null);
  /** 「在资源库中显示」（官方 MenuItem-showInLibrary）：要高亮并滚到的切片名 */
  const [libraryHighlight, setLibraryHighlight] = useState<string | null>(null);
  const [tlTab, setTlTab] = useState('timeline');
  /** 官方布局：左下停靠区（曲线编辑器 / 统计），右上停靠区（场景树 / 资源） */
  const [leftBottomTab, setLeftBottomTab] = useState<'curve' | 'info'>('curve');
  const [curveClipboard, setCurveClipboard] = useState<CurveClipboard | null>(null);
  const [query, setQuery] = useState('');
  /**
   * 外部注入的舞台悬停高亮（官方 `StageNotification.ROLLOVER_BONE` / `ROLLOVER_SLOT` 的
   * 「面板 → 舞台」方向，§113）：由右侧场景树行 hover 写入，透传给 `Viewer` → `StageView`。
   * 舞台自身鼠标悬停走的是另一条路（StageView 内部 state），两者在舞台侧合并。
   */
  const [sceneHover, setSceneHover] = useState<{ kind: 'bone' | 'slot'; name: string } | null>(null);
  /**
   * 同值 bail：行 hover 会连续触发（冒泡 / 行间移动），避免同值反复 setState 引起重渲染。
   * **清空只清自己那一类**：hoverFromPoint 在同一个 handler 里会同时调用两者（命中骨骼时也传
   * `onHoverSlot(null)`），若无脑清空，后一次调用会把前一次刚设好的值抹掉。
   */
  const hoverSceneBone = useCallback((name: string | null) => {
    setSceneHover((prev) => {
      if (name === null) return prev?.kind === 'bone' ? null : prev;
      return prev?.kind === 'bone' && prev.name === name ? prev : { kind: 'bone', name };
    });
  }, []);
  const hoverSceneSlot = useCallback((name: string | null) => {
    setSceneHover((prev) => {
      if (name === null) return prev?.kind === 'slot' ? null : prev;
      return prev?.kind === 'slot' && prev.name === name ? prev : { kind: 'slot', name };
    });
  }, []);
  const [tlHeight, setTlHeight] = useState(260);
  // 官方编辑器每个区域都能拉伸；尺寸记在 localStorage 里，刷新后保持
  const [leftWidth, setLeftWidth] = useStoredSize('leftWidth', 286);
  const [rightWidth, setRightWidth] = useStoredSize('rightWidth', 300);
  const [leftTop, setLeftTop] = useStoredSize('leftTop', 330);
  const [rightTop, setRightTop] = useStoredSize('rightTop', 360);
  const [stats, setStats] = useState({ items: 0, fps: 0, ms: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  /** non-blocking status toast: DragonBones never blocks the stage after a completed action */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const flash = useCallback((message: string, duration = 2400) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), duration);
  }, []);
  useEffect(() => () => { if (toastTimer.current !== null) window.clearTimeout(toastTimer.current); }, []);
  /** 播放时触发的动作/事件帧：右上角非阻塞提示，自动消失 */
  const [eventToasts, setEventToasts] = useState<{ id: number; text: string }[]>([]);
  const eventToastSeq = useRef(0);
  const pushEventToast = useCallback((text: string) => {
    const id = ++eventToastSeq.current;
    setEventToasts((list) => [...list.slice(-3), { id, text }]);
    window.setTimeout(() => setEventToasts((list) => list.filter((t) => t.id !== id)), 1600);
  }, []);
  /**
   * Edge（桌面）的鼠标手势会抢走「右键拖 = 平移」：手势一旦被浏览器认走，`pointermove`
   * 就被节流、页面还会失焦，舞台拖拽会中途断掉。浏览器级手势不受页面默认行为支配
   * （判定与出处见 `src/core/browserEnv.ts`），所以退一步提示用户改用 `H` 抓手 / 中键。
   *
   * 只在**第一次有舞台**时提示一次：欢迎屏上没有舞台，提示也用不上；切页签不该重复打扰。
   * 推迟到本轮 effect 之后再 flash：开发模式 StrictMode 会立刻跑清理、清掉 toast 计时器，
   * 同步 flash 会被清掉且 ref 已置位、不再补弹。
   */
  const edgeNoticeShown = useRef(false);
  useEffect(() => {
    if (edgeNoticeShown.current || !player || !isDesktopEdge()) return;
    edgeNoticeShown.current = true;
    window.setTimeout(() => {
      flash('Edge 的鼠标手势会抢走右键拖动；舞台平移请按 H 切到抓手，或按住中键拖动', 7000);
    }, 0);
  }, [player, flash]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [modelVersion, setModelVersion] = useState(0);
  const [groupMemory, setGroupMemory] = useState<Array<string | null>>(() => new Array(10).fill(null));
  const [focusArea, setFocusArea] = useState<'stage' | 'timeline'>('stage');
  /** official dope sheet: box-selected keyframes (frame-addressed, so edits can't stale them) */
  const [keySelection, setKeySelection] = useState<KeySelectionEntry[]>([]);
  const keySelectionRef = useRef(keySelection);
  keySelectionRef.current = keySelection;
  /** 时间轴当前选中的「非骨骼轨道」（目前只有事件帧面板用到）：点事件行即切到事件面板 */
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [hasKeyClipboard, setHasKeyClipboard] = useState(false);
  /** 非骨骼轨道（插槽 / 事件 / 绘制顺序 / IK）的键选区，与骨骼选区并列 */
  const [trackSelection, setTrackSelection] = useState<TrackKeyRef[]>([]);
  const trackClipboard = useRef<TrackClipboard | null>(null);
  /** 最近一次复制的是骨骼键还是轨道键（粘贴时按它走） */
  const clipKind = useRef<'bone' | 'track'>('bone');
  const keyClipboard = useRef<KeyClipboard | null>(null);
  const [backgroundId, setBackgroundId] = useState<string>(() => {
    const saved = window.localStorage.getItem('bonestudio.background');
    const migrated = window.localStorage.getItem('bonestudio.background.dark');
    if (!migrated) {
      window.localStorage.setItem('bonestudio.background.dark', '1');
      if (!saved || saved === 'checker') return 'checkerDark';
    }
    return saved || 'checkerDark';
  });
  /** M-12：网格工具下的「FFD 变形」开关 —— 勾上后拖顶点写的是变形关键帧。骨架装配下默认关。 */
  const [ffdMode, setFfdMode] = useState(false);
  /** 官方 Mesh.tool.density：1~5（属性面板与网格编辑悬浮工具栏共用同一份） */
  const [meshDensity, setMeshDensity] = useState(3);
  /** 官方 StagePanel 的网格编辑器（`_11505._5188`）：进入后底部出现悬浮工具栏 */
  const [meshEditMode, setMeshEditMode] = useState(false);
  /** 进入编辑时锁定的网格槽位（选中变化即退出，对应官方 `_11678`） */
  const [meshEditSlot, setMeshEditSlot] = useState<string | null>(null);
  /** 替换图片（官方 SwapImageWindow）：目标槽位 + 显示对象序号 */
  const [swapTarget, setSwapTarget] = useState<{ slot: string; index: number } | null>(null);
  /** 场景树双击骨骼 / 插槽行弹出的「重新命名」输入窗；目标按双击那一行算，不看当前选中项 */
  const [renameTarget, setRenameTarget] = useState<{ kind: 'bone' | 'slot'; name: string } | null>(null);
  /** 边界框加/删点的舞台拾取模式（官方 BoundingBoxPanel.btn.create / btn.delete） */
  const [bboxMode, setBboxMode] = useState<'add' | 'delete' | null>(null);
  /** 权重列表「添加绑定骨骼」：下一次舞台点击把点中的骨骼绑进当前网格 */
  const [weightBonePick, setWeightBonePick] = useState(false);
  /** 「设置约束目标」：下一次舞台点击把点中的骨骼设成当前 IK 约束的目标（官方 Property.ik.pick） */
  const [ikTargetPick, setIkTargetPick] = useState(false);
  /** 换骨骼 / 换文档时退出约束目标拾取，避免模式在后台悬着 */
  useEffect(() => { setIkTargetPick(false); }, [selectedBone, activeDocId]);
  /** 「定位到骨骼」：官方点 IK「目标」= 把选择集切到目标骨骼；token 让重复点同一个目标也能再滚一次 */
  const [reveal, setReveal] = useState<{ name: string; token: number } | null>(null);
  const locateBone = useCallback((name: string) => {
    setRightTab('scene');
    setSelectedBones(new Set([name]));
    setSelectedBone(name);
    setReveal((prev) => ({ name, token: (prev?.token ?? 0) + 1 }));
  }, []);
  /** P-09 偏好设置（官方 Menu.File.Setting）：持久化在 localStorage */
  const [settings, setSettings] = useState<StudioSettings>(() => readSettings(window.localStorage));
  /** P-09 快捷键自定义（官方 `Setting.hotkey`）：只存覆盖表，默认键在 core/hotkeys.ts */
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => readHotkeys(window.localStorage));
  /** P-09 界面语言（官方 Setting 的「语言」）：中文原文当键，见 src/i18n */
  const [locale, setLocaleState] = useState<Locale>(() => readLocale(window.localStorage));
  setLocale(locale);
  const [showSettings, setShowSettings] = useState(false);
  /** 「文件 → 导出...」对话框（官方 Menu.File.Export） */
  const [showExport, setShowExport] = useState(false);
  /** P-02 帮助弹窗（官方 Menu.Help.*）：快捷键速查 / 学习入口 / 关于 */
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  /** AI → MCP 服务面板 */
  const [showAiPanel, setShowAiPanel] = useState(false);
  /** E-04 插件系统（官方 Menu.Help.Plugin「插件管理...」） */
  const [plugins, setPlugins] = useState<PluginManifest[]>(() => readPlugins(window.localStorage));
  const [showPlugins, setShowPlugins] = useState(false);
  /** 新建工程弹窗（先选工程类型） */
  const [showNewProject, setShowNewProject] = useState(false);
  /** P-10 新建元件弹窗；P-17 导入数据到项目的隐藏文件框 */
  const [showNewSymbol, setShowNewSymbol] = useState(false);
  /**
   * 删除类操作的二次确认（官方 `Setting.DeleteConfirmation`）。
   * 挂起的请求里带着完整业务逻辑，点「确定」才执行 —— 见 `src/ui/ConfirmDialog.tsx`。
   * 同一时刻只留一个（后开的替换先前的），避免两个弹框叠在一起。
   */
  const [confirmAsk, setConfirmAsk] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const projectImportRef = useRef<HTMLInputElement>(null);
  /**
   * 关闭当前项目（官方 `Menu.File.CloseProject` / 文档页签的 ×）：清空回空舞台。
   * 不做改动确认 —— 骨架数据只存在内存里，关掉不会动磁盘上的原文件。
   * 注：浏览器里 `Ctrl+W` 是标签页快捷键、页面拦不住，所以只给菜单与页签入口。
   */
  const closeProject = useCallback(() => {
    projectRef.current = null;
    projectNameRef.current = '';
    pending.current = {};
    setDocuments([]);
    setActiveDocId(null);
    setWelcomeActive(true);
    setPlayer(null);
    setAtlasUrl(null);
    setTextureData(null);
    setSelectedBone(null);
    setSelectedSlot(null);
    setHiddenSlots(new Set());
    setLockedBones(new Set());
    setLockedSlots(new Set());
    setGuides([]);
    setError(null);
    setNotice(null);
    history.current = { stack: [], index: -1 };
    setHistoryState({ canUndo: false, canRedo: false });
    flash('已关闭项目');
  }, [flash]);


  /** P-01 欢迎页的「最近打开」（官方 Welcome.project）：存 localStorage */
  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents(window.localStorage));

  /** P-11 变换坐标系：官方 TransformPanel 的世界 / 父 / 本地 —— 只影响拖动按哪个轴走 */
  const [transformSpace, setTransformSpace] = useState<'world' | 'parent' | 'local'>('world');
  /** P-13 舞台辅助线（官方「辅助标尺」/「清除所有辅助线」）：编辑器状态，存 localStorage */
  const [guides, setGuides] = useState<GuideLine[]>(() => readGuides(window.localStorage));
  const [showGuides, setShowGuides] = useState(true);
  const pending = useRef<PendingLoad>({});
  /** 当前工程的外壳（打开 .dbproj 时记下，保存时原样写回） */
  const projectRef = useRef<Record<string, unknown> | null>(null);
  const projectNameRef = useRef<string>('');
  /** 文档所属的工作区工程名（projects/<name>）；空串表示纯内存/本机文件，保存只下载 .dbproj */
  const workspaceRef = useRef<string>('');
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transformClipboard = useRef<BoneTransformValues | null>(null);
  const playerRef = useRef<Player | null>(null);
  playerRef.current = player;

  /** Bump the render version and snapshot the document (M6 crash recovery). */
  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
    const current = playerRef.current;
    if (!current || typeof window === 'undefined') return;
    if (isReadonly()) return;   // 只读观看别人的工程：绝不覆盖用户自己的自动保存
    writeAutosave(window.localStorage, {
      name: current.doc.name || 'untitled',
      savedAt: Date.now(),
      doc: current.doc.raw,
    });
  }, []);

  // 开发 / 无头测试钩子：只在 dev server 下挂
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __bonestudio?: unknown }).__bonestudio = {
      player: () => playerRef.current,
      slotOrder: () => playerRef.current?.skeleton.armature.slot.map((x) => x.name) ?? [],
      drawOrder: () => playerRef.current?.renderItems().map((x) => x.slot) ?? [],
    };
  }, []);

  /* ---------------- 只读观看 / 实时同步（?live=1&readonly=1&agent=<id>） ---------------- */
  const [liveParams, setLiveParams] = useState(() => {
    const q = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    const ai = q.get('aiproject');
    const p = {
      name: ai ?? q.get('sample'), root: ai ? AI_ROOT : '/dbsamples',
      live: q.get('live') === '1', readonly: q.get('readonly') === '1', agent: q.get('agent'),
    };
    setReadonly(p.readonly);
    return p;
  });
  const readonlyMode = liveParams.readonly;
  /**
   * 退出观看：观看页一般是从「实时预览」新开的标签 —— 直接关掉它，用户原来那个标签里的工程原封不动。
   * 关不掉（直接打开的链接 / 没有 opener）就原地退出：去掉 URL 里的 readonly/live/agent/工程参数（replaceState，不重载），
   * 关 SSE（LiveSync 卸载）、解除只读守卫、关掉观看的工程回到欢迎页（观看期间从不写自动保存 / 最近列表，用户自己的数据都在）。
   */
  const exitWatch = useCallback(() => {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try { opener.focus(); } catch { /* cross-origin / gone */ }
      window.close();
    }
    const q = new URLSearchParams(window.location.search);
    for (const k of ['readonly', 'live', 'agent', 'aiproject', 'sample', 'anim', 'frame', 'play']) q.delete(k);
    window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}`);
    setReadonly(false);
    window.__bonestudioLiveSse = false;
    setLiveParams({ name: null, root: '/dbsamples', live: false, readonly: false, agent: null });
    closeProject();
    flash('已退出观看');
  }, [closeProject, flash]);

  /** 只读基线：最后一次「合法」骨架快照（载入 / live 同步）。任何别的改动都会被还原 —— 只读的兜底网 */
  const roBaseline = useRef<string | null>(null);
  const roNotice = useRef(0);
  useEffect(() => {
    setReadonly(readonlyMode, () => {
      const now = Date.now();
      if (now - roNotice.current > 1200) { roNotice.current = now; flash('只读观看模式：不能编辑（正在观看 agent 编辑）'); }
    });
  }, [readonlyMode, flash]);
  useEffect(() => { roBaseline.current = readonlyMode ? snapshotArmature(player) : null; }, [player, readonlyMode]);
  const enforceReadonly = useCallback(() => {
    const current = playerRef.current;
    if (!isReadonly() || !current || roBaseline.current === null) return;
    if (snapshotArmature(current) === roBaseline.current) return;
    const anim = current.animation?.name;
    const pos = current.position;
    restoreArmature(current, roBaseline.current);
    if (anim && current.animationNames().includes(anim)) current.setAnimation(anim);
    current.seek(pos);
    assertWritable('integrity');
    setModelVersion((v) => v + 1);
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => { enforceReadonly(); }, [modelVersion, enforceReadonly]);
  useEffect(() => {
    if (!readonlyMode) return;
    const timer = window.setInterval(enforceReadonly, 1000);
    // 键盘白名单：捕获阶段先于 App 的快捷键处理
    const onKey = (event: KeyboardEvent) => {
      // Esc = 退出观看（菜单 / 弹窗开着时先让它们自己关）
      if (event.key === 'Escape' && !document.querySelector('.menu-pop, .stage-menu, [data-confirm-dialog], [data-ai-dialog], .modal-backdrop')) {
        event.preventDefault(); event.stopImmediatePropagation(); exitWatch(); return;
      }
      if (allowKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      assertWritable(`key:${event.key}`);
    };
    window.addEventListener('keydown', onKey, true);
    const root = document.querySelector('.app') as HTMLElement | null;
    const off = root ? installDomGuard(root, (a) => assertWritable(a)) : () => undefined;
    document.documentElement.classList.add('bs-readonly');
    // 自检钩子（无头验证用）：当前骨架快照
    (window as unknown as { __bonestudioSnapshot?: () => string | null }).__bonestudioSnapshot = () => snapshotArmature(playerRef.current);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', onKey, true); off(); document.documentElement.classList.remove('bs-readonly'); };
  }, [readonlyMode, enforceReadonly, exitWatch]);
  useEffect(() => { if (!allowTool(tool)) setTool('select'); }, [tool]);
  // 只读观看默认进「动画制作」：agent 写的是动画关键帧，装配模式只显示绑定姿态
  useEffect(() => { if (readonlyMode && player && !isSheetArmature(player.skeleton.armature)) changeEditMode('animation'); }, [readonlyMode, player, changeEditMode]);
  const onLiveApplied = useCallback((kind: 'data' | 'follow') => {
    const current = playerRef.current;
    if (kind === 'data' && readonlyMode) roBaseline.current = snapshotArmature(current);
    setModelVersion((v) => v + 1);
    setVersion((v) => v + 1);
  }, [readonlyMode]);

  /** P-19 切换页签：换 Player / 图集 URL / 撤销栈，并把当前文档的历史存回去 */
  const activateDocument = useCallback((id: string) => {
    setWelcomeActive(false);
    if (id === activeDocId) return;
    const doc = documents.find((entry) => entry.id === id);
    if (!doc) return;
    setDocuments((prev) => prev.map((entry) => (entry.id === activeDocId ? { ...entry, history: history.current } : entry)));
    history.current = doc.history;
    setHistoryState({ canUndo: doc.history.stack.length > 1, canRedo: false });
    playerRef.current = doc.player;
    // 保存元数据跟着页签走：否则多页签下 Ctrl+S 会保存到另一个文档的工程名/外壳
    projectRef.current = doc.project ?? null;
    projectNameRef.current = doc.projectName ?? '';
    workspaceRef.current = doc.workspaceName ?? '';
    setPlayer(doc.player);
    setActiveDocId(doc.id);
    setAtlasUrl(doc.atlasUrl);
    setTextureData(doc.texture);
    setSelectedBone(null);
    setSelectedSlot(null);
    setModelVersion((value) => value + 1);
    setFitToken((value) => value + 1);
    refresh();
  }, [activeDocId, documents, refresh]);

  /** P-19 关闭一个页签（官方 `CloseTabButton.Close`，中键也是这条） */
  const closeDocumentById = useCallback((id: string) => {
    const remaining = closeOne(documents, id);
    if (id !== activeDocId) {
      setDocuments(remaining);
      return;
    }
    if (remaining.length === 0) {
      closeProject();
      return;
    }
    const nextId = nextActiveAfterClose(documents, id);
    const target = remaining.find((entry) => entry.id === nextId) ?? remaining[0];
    history.current = target.history;
    setHistoryState({ canUndo: target.history.stack.length > 1, canRedo: false });
    playerRef.current = target.player;
    setPlayer(target.player);
    setActiveDocId(target.id);
    setAtlasUrl(target.atlasUrl);
    setTextureData(target.texture);
    setSelectedBone(null);
    setSelectedSlot(null);
    setDocuments(remaining);
    setModelVersion((value) => value + 1);
    setFitToken((value) => value + 1);
    refresh();
  }, [activeDocId, closeProject, documents, refresh]);

  /** P-19 关闭其他（官方 `CloseTabButton.CloseOther`） */
  const closeOtherDocuments = useCallback((id: string) => {
    if (id !== activeDocId) activateDocument(id);
    setDocuments((prev) => closeOthers(prev, id));
    flash('已关闭其他文档');
  }, [activateDocument, activeDocId, flash]);

  /** 页签右键：在资源管理器中打开项目所在目录（内置示例 / AI 工程都支持；本地文件浏览器不给路径） */
  const revealDocumentFolder = useCallback((id: string) => {
    const doc = documents.find((entry) => entry.id === id);
    if (!doc) return;
    const source = doc.dirSource === 'ai' ? 'ai' : 'samples';
    if (!doc.sampleDir && source !== 'ai') {
      flash('这份文档没有磁盘目录。从本机文件打开时，浏览器不提供路径');
      return;
    }
    void fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, dir: doc.sampleDir ?? '' }),
    }).then((response) => {
      if (response.ok) return;
      flash(response.status === 404 ? '找不到项目所在文件夹' : '打不开项目所在文件夹');
    }).catch(() => flash('打不开项目所在文件夹'));
  }, [documents, flash]);

  /** P-19 关闭全部（官方 `CloseTabButton.CloseAll`） */
  const closeAllDocuments = useCallback(() => {
    closeProject();
  }, [closeProject]);

  /** 点饼图只选中这个顶点，权重在属性栏的进度条里改。 */
  const weightSlotSync = useRef<string | null>(null);
  const paintWeight = useCallback((slot: string, vertex: number) => {
    if (!assertWritable('paintWeight')) return;
    const current = playerRef.current;
    if (!current) return;
    if (meshWeightBones(current.skeleton.armature, slot).length === 0) {
      flash('这个网格还没有绑定骨骼');
      return;
    }
    weightSlotSync.current = slot;
    setSelectedSlot(slot);
    setSelectedSlots(new Set([slot]));
    setWeightVertex(vertex);
  }, [flash]);
  useEffect(() => {
    if (weightSlotSync.current === selectedSlot) return;
    weightSlotSync.current = selectedSlot;
    setWeightVertex(null);
  }, [selectedSlot]);
  useEffect(() => {
    if (tool !== 'weight' || !selectedSlot) return;
    const current = playerRef.current;
    if (current && findMesh(current.skeleton.armature, selectedSlot)) return;
    setSelectedSlot(null);
    setSelectedSlots(new Set());
    setWeightVertex(null);
  }, [tool, selectedSlot]);
  useEffect(() => { setWeightBonePick(false); }, [selectedSlot]);
  useEffect(() => { if (editMode !== 'armature') setWeightBonePick(false); }, [editMode]);

  /**
   * 离开权重工具（按 B/V/Ctrl+Tab、点左侧工具条、退出网格编辑）就把「选中顶点」清掉：
   * 属性面板的权重骨骼列表因此还原成 图3 的只读形态（无滑块 / 无百分比）。
   */
  const clearWeightVertex = useCallback(() => setWeightVertex(null), []);
  useEffect(() => {
    if (tool !== 'weight') setWeightVertex(null);
  }, [tool]);


  /** 重新拉工作区工程清单（保存/新建后要让新卡片立刻出现；只在挂载时拉一次会漏） */
  const refreshAiProjects = useCallback(async () => {
    try {
      const response = await fetch(`${AI_ROOT}/manifest.json`, { cache: 'no-store' });
      const data = (response.ok ? await response.json() : { samples: [] }) as { samples?: SampleDef[] };
      setAiProjects((data.samples ?? []).map((entry) => ({ ...entry, root: AI_ROOT })));
    } catch {
      setAiProjects([]);
    }
  }, []);

  useEffect(() => {
    fetch('/dbsamples/manifest.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`manifest ${response.status}`))))
      .then((data) => setSamples(data.samples ?? []))
      .catch(() => setSamples([]))
      .finally(() => setSamplesReady(true));
    void refreshAiProjects();
  }, [refreshAiProjects]);

  useEffect(() => { writeSettings(window.localStorage, settings); }, [settings]);
  useEffect(() => { writeHotkeys(window.localStorage, hotkeys); }, [hotkeys]);

  /**
   * 序列帧元件只排帧，没有骨架可装配。停在装配模式时时间轴（序列帧面板）会被收起，
   * 所以一切到 sheet 就回到动画制作。
   */
  const sheetEditing = isSheetArmature(player?.skeleton.armature);
  useEffect(() => {
    if (sheetEditing && editMode === 'armature') changeEditMode('animation');
  }, [sheetEditing, editMode, changeEditMode]);

  /**
   * 骨架装配：停播、播放头归零，骨骼回到绑定姿态，插槽回到默认显示。
   * 动画数据留着，切回「动画制作」再套上。
   */
  useEffect(() => {
    const current = playerRef.current;
    if (!current) return;
    current.clearPoseOverrides();
    if (editMode === 'armature') {
      current.playing = false;
      current.setupPose = true;
      current.position = 0;
      current.applyPose();
    } else if (current.setupPose) {
      current.setupPose = false;
      // 序列帧没有绑定姿态可看：一切到动画制作就停在当前帧渲染（不自动播放，播放由播放键触发）。
      if (isSheetArmature(current.skeleton.armature)) current.playing = false;
      current.applyPose();
    } else {
      return;
    }
    setModelVersion((value) => value + 1);
    refresh();
  }, [editMode, player, refresh]);
  useEffect(() => { writeLocale(window.localStorage, locale); }, [locale]);
  useEffect(() => { writeGuides(window.localStorage, guides); }, [guides]);

  useEffect(() => {
    if (!player?.playing) return;
    const timer = window.setInterval(() => setVersion((value) => value + 1), 60);
    return () => window.clearInterval(timer);
  }, [player, player?.playing]);

  const revokeAtlas = useCallback(() => {
    setAtlasUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  const buildPlayer = useCallback((next: PendingLoad) => {
    if (!next.skeleton) return;
    try {
      const instance = new Player(next.skeleton, next.texture ?? null, {
        // action frames are authored markers: surface them instead of dropping them
        onAction: (action) => {
          const item = action as { name?: string; gotoAndPlay?: string };
          const label = item.name ?? item.gotoAndPlay ?? 'action';
          pushEventToast((item.gotoAndPlay ? '⚡ 跳转：' : '⚡ 事件：') + label);
        },
      });
      instance.speed = speed;
      instance.playing = false;
      instance.setupPose = true;
      instance.position = 0;
      instance.applyPose();
      changeEditMode('armature');
      setPlayer(instance);
      setAtlasUrl(next.imageUrl ?? null);
      setTextureData(next.texture ?? null);
      setSelectedBone(null);
      setSelectedSlot(null);
      setHiddenSlots(new Set());
      setLockedBones(new Set());
      setLockedSlots(new Set());
      setError(null);
      projectRef.current = next.project ?? null;
      projectNameRef.current = next.projectName ?? '';
      workspaceRef.current = next.workspaceName ?? '';
      // 工作区工程的封面临时缓存到「项目」卡片的键上（新建后马上能生成封面）
      if (next.workspaceName) coverTargetRef.current = coverKey('workspace', next.workspaceName);
      // Seed a baseline snapshot: an empty stack would silently swallow the first
      // undo (canUndo stays false because the stack has only one entry).
      const baseline = snapshotArmature(instance);
      history.current = baseline ? { stack: [baseline], index: 0 } : { stack: [], index: -1 };
      setHistoryState({ canUndo: false, canRedo: false });
      // P-19：每份打开的东西都是一个页签，自带自己的撤销栈与图集 URL
      const docId = `doc-${++docSeq.current}`;
      setDocuments((prev) => [
        ...prev,
        {
          id: docId,
          name: next.projectName || instance.doc.name || `未命名文档 ${docSeq.current}`,
          player: instance,
          atlasUrl: next.imageUrl ?? null,
          texture: next.texture ?? null,
          history: history.current,
          sampleDir: next.sampleDir,
          dirSource: next.dirSource,
          project: next.project,
          projectName: next.projectName,
          workspaceName: next.workspaceName,
        },
      ]);
      setActiveDocId(docId);
      setWelcomeActive(false);
      setFitToken((value) => value + 1);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [changeEditMode, refresh, speed, pushEventToast]);

  const restoreAutosave = useCallback(() => {
    if (typeof window === 'undefined') return;
    const record = readAutosave(window.localStorage);
    if (!record) {
      setNotice('没有可恢复的自动保存');
      return;
    }
    setNotice('恢复自动保存（' + describeAutosaveAge(record) + '）');
    buildPlayer({ skeleton: record.doc });
  }, [buildPlayer]);

  /**
   * Publish what the binary reader recovered: the info panel shows it, and DEV
   * builds also expose it on `window.__boneStudioDecode` so browser-driven checks
   * can assert on real decode output instead of a re-implemented parse.
   */
  const publishDecode = useCallback((decoded: ReturnType<typeof decodeDbbin>) => {
    setDecodeStats({ surfaces: decoded.stats.surfaces, pending: decoded.stats.pending });
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__boneStudioDecode = {
        surfaces: decoded.stats.surfaces,
        pending: decoded.stats.pending,
        surfaceBones: decodeSurfaceBones(decoded.json),
      };
    }
    return decoded.json;
  }, []);

  /**
   * 保存到工作区项目 `projects/<name>`（dev server 的 `/api/projects/save`）。
   * image 用 data URL 上传（服务端剥前缀）；没有图集时服务端写 4×4 透明占位。
   */
  const postWorkspaceSave = useCallback(async (
    name: string,
    skeleton: unknown,
    texture: DbTextureAtlasData | null,
    imageUrl: string | null,
    overwrite: boolean,
  ): Promise<WorkspaceSaveResult> => {
    const image = imageUrl ? await blobToDataUrl(imageUrl) : null;
    let response: Response;
    try {
      response = await fetch('/api/projects/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, skeleton, texture: texture ?? undefined, image: image ?? undefined, overwrite }),
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (response.status === 404) return { ok: false, reason: 'unavailable' };   // 生产静态托管没有 dev 接口
    if (response.ok) return { ok: true, name };
    const detail = await response.json().catch(() => null) as { error?: string; holder?: { displayName?: string } } | null;
    if (response.status === 409) {
      return detail?.error === 'exists'
        ? { ok: false, reason: 'exists' }
        : { ok: false, reason: 'locked', detail: detail?.holder?.displayName ?? 'agent' };
    }
    if (response.status === 400) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'error', detail: detail?.error ?? `HTTP ${response.status}` };
  }, []);

  const noticeSaveFailure = useCallback((result: Extract<WorkspaceSaveResult, { ok: false }>) => {
    if (result.reason === 'exists') setNotice('同名工程已存在，换一个名字再保存');
    else if (result.reason === 'locked') setNotice(`工程正被 ${result.detail ?? 'agent'} 编辑，等它结束再保存`);
    else if (result.reason === 'invalid') setNotice('工程名只能用英文、数字、下划线、点或连字符');
    else if (result.reason === 'unavailable') setNotice('保存到项目需要本地 dev server（npm run dev）；可用「项目另存为…」下载 .dbproj');
    else setNotice(`保存到项目失败：${result.detail ?? '未知错误'}`);
  }, []);

  /** 读取一个示例/AI 工程的三件套（骨架、图集、贴图 Blob） */
  const loadSamplePayload = useCallback(async (sample: SampleDef) => {
    const binary = sample.skeleton.toLowerCase().endsWith('.dbbin');
    const [skeleton, texture, image] = await Promise.all([
      binary
        ? fetch(`${rootOf(sample)}/${sample.skeleton}`, { cache: 'no-store' })
          .then((response) => response.arrayBuffer())
          .then((buffer) => publishDecode(decodeDbbin(buffer)))
        : fetch(`${rootOf(sample)}/${sample.skeleton}`).then((response) => response.json()),
      fetch(`${rootOf(sample)}/${sample.texture}`).then((response) => response.json()),
      fetch(`${rootOf(sample)}/${sample.image}`).then((response) => response.blob()),
    ]);
    return { skeleton, texture: texture as DbTextureAtlasData, image };
  }, [publishDecode]);

  const loadSample = useCallback(async (sample: SampleDef) => {
    try {
      const { skeleton, texture, image } = await loadSamplePayload(sample);
      if (!sample.root && !isReadonly()) setRecents(pushRecent(window.localStorage, { kind: 'sample', name: sample.name }));
      revokeAtlas();
      const url = URL.createObjectURL(image);
      const sampleDir = sample.skeleton.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const dirSource: 'samples' | 'ai' = sample.root === AI_ROOT ? 'ai' : 'samples';
      // 工作区工程的「项目」卡片与 AI 卡片分开缓存封面
      coverTargetRef.current = coverKey(dirSource === 'ai' ? 'workspace' : 'sample', sample.name);
      // 工作区工程记住名字：Ctrl+S 写回 projects/<name>，不把用户的编辑丢在下载目录
      const next: PendingLoad = { skeleton, texture, imageUrl: url, sampleDir, dirSource, workspaceName: dirSource === 'ai' ? sample.name : undefined };
      pending.current = next;
      buildPlayer(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [buildPlayer, revokeAtlas, loadSamplePayload]);

  /**
   * 打开项目（菜单 / 欢迎页 / 拖拽）：先把同批文件分类，再按优先级处理
   * `.dbproj`/`.dbbin` > DragonBones JSON > Spine JSON。Spine 需要同批的 .atlas + png。
   */
  const onOpenFiles = useCallback(async (files: FileList | null) => {
    if (!assertWritable('onOpenFiles')) return;
    if (!files) return;
    const next: PendingLoad = { ...pending.current, sampleDir: undefined, dirSource: undefined, workspaceName: undefined };
    const list = Array.from(files);
    let dbJson: unknown = null;
    let textureJson: DbTextureAtlasData | null = null;
    let spineFile: File | null = null;
    const images: File[] = [];
    let openedDirect = false;

    for (const file of list) {
      if (/.(png|jpg|jpeg|webp)$/i.test(file.name)) { images.push(file); continue; }
      if (/.(atlas|dbbin|dbproj|json)$/i.test(file.name) === false) continue;
      if (/.atlas$/i.test(file.name)) continue;
      if (/.dbbin$/i.test(file.name)) {
        next.skeleton = publishDecode(decodeDbbin(await file.arrayBuffer()));
        openedDirect = true;
        continue;
      }
      if (/.dbproj$/i.test(file.name)) {
        try {
          const result = parseDbproj(new Uint8Array(await file.arrayBuffer()));
          const project = result.data as Record<string, unknown> | undefined;
          const skeleton = project ? unwrapProjectSkeleton(project) : null;
          if (!project || !skeleton) {
            setError(`${file.name}: 工程里没有可用的骨架（dragonBones.armature 缺失）`);
            continue;
          }
          next.skeleton = skeleton;
          next.project = project;
          next.projectName = file.name.replace(/.dbproj$/i, '');
          openedDirect = true;
          if (result.format === 'amf3' && result.complete === false) {
            setNotice('警告：这个 AMF3 工程只解出一部分，请另存为新工程');
          }
        } catch (error) {
          setError(`${file.name}: .dbproj 解析失败（${error instanceof Error ? error.message : String(error)}）`);
        }
        continue;
      }
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        const kind = classifyJsonFile(json);
        if (kind === 'dragonbones') dbJson = json;
        else if (kind === 'texture') textureJson = json as DbTextureAtlasData;
        else if (kind === 'spine') spineFile = file;
      } catch {
        setError(`${file.name}: JSON 解析失败`);
      }
    }

    if (!openedDirect && dbJson) {
      next.skeleton = dbJson;
      if (textureJson) next.texture = textureJson;
      if (images.length) {
        if (next.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(next.imageUrl);
        next.imageUrl = URL.createObjectURL(images[images.length - 1]);
      }
    } else if (!openedDirect && spineFile) {
      setNotice(`正在导入 Spine 工程 ${spineFile.name}…`);
      try {
        const { importSpineFiles } = await import('./spineFileImport');
        const result = await importSpineFiles(spineFile, list, {
          name: spineFile.name.replace(/.json$/i, ''),
          onProgress: (done, total) => setNotice(`正在烘焙 Spine 动画 ${done}/${total}…`),
        });
        if (next.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(next.imageUrl);
        next.skeleton = result.skeleton;
        next.texture = result.texture;
        next.imageUrl = result.imageUrl;
        next.projectName = result.name;
        next.source = 'spine';
        setNotice(result.warnings.length
          ? `已导入 ${result.name}（${result.warnings.join('；')}）`
          : `已导入 Spine 工程 ${result.name}：${result.regions} 个切片 / ${result.animations} 条动画`);
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__boneStudioLastOpen = {
            kind: 'spine', name: result.name,
            bones: result.skeleton.armature?.[0]?.bone?.length ?? 0,
            animations: result.animations, frames: result.frames, regions: result.regions, warnings: result.warnings,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setError(`${spineFile.name}: Spine 导入失败（${message}）`);
        setNotice(`Spine 导入失败：${message}`);
        return;
      }
    } else if (!openedDirect && images.length) {
      if (next.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(next.imageUrl);
      next.imageUrl = URL.createObjectURL(images[images.length - 1]);
    }

    pending.current = next;
    const skeletonFile = list.find((file) => /.(dbproj|dbbin|json)$/i.test(file.name) && !/_tex.json$/i.test(file.name));
    const recentName = next.projectName || skeletonFile?.name.replace(/(_ske)?.(json|dbbin|dbproj)$/i, '');
    if (next.skeleton && recentName) {
      setRecents(pushRecent(window.localStorage, { kind: 'file', name: recentName }));
      coverTargetRef.current = coverKey('file', recentName);
    }
    buildPlayer(next);
  }, [buildPlayer, publishDecode]);

  /** Deep link: ?sample=<name|first> auto-loads a local DragonBones export. */
  /** Deep link: ?aiproject=<name> 打开 AI 工作区工程。旧链接 ?sample=<AI 工程名> 兼容：内置示例里没有时去 AI 工程里找并改写 URL。 */
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || playerRef.current || !samplesReady || aiProjects === null) return;
    deepLinkDone.current = true;
    const q = new URLSearchParams(window.location.search);
    const ai = q.get('aiproject');
    if (ai) {
      const entry = aiProjects.find((e) => e.name === ai);
      if (entry) void loadSample(entry); else setNotice(`找不到 AI 工程「${ai}」`);
      return;
    }
    const wanted = q.get('sample');
    if (!wanted) return;
    const needle = wanted.toLowerCase();
    const sample = wanted === 'first'
      ? samples[0]
      : samples.find((entry) => entry.name.toLowerCase() === needle)
        ?? samples.find((entry) => entry.name.toLowerCase().includes(needle));
    if (sample) { void loadSample(sample); return; }
    const legacy = aiProjects.find((e) => e.name === wanted);
    if (legacy) {
      q.delete('sample'); q.set('aiproject', legacy.name);
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
      setLiveParams((p) => ({ ...p, name: legacy.name, root: AI_ROOT }));
      void loadSample(legacy);
    }
  }, [samples, samplesReady, aiProjects, loadSample]);

  /** 欢迎页显示时轮询 AI 工程的锁 / 缩略图（/api/agents） */
  useEffect(() => {
    if (player) return;
    let alive = true;
    const pull = () => fetch('/api/agents', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { projects?: Array<{ name: string } & AiProjectState> } | null) => {
        if (!alive || !d?.projects) return;
        setAiState(Object.fromEntries(d.projects.map((p) => [p.name, { thumb: p.thumb, lockedBy: p.lockedBy }])));
      })
      .catch(() => undefined);
    void pull();
    const t = window.setInterval(pull, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [player]);

  /** 打开 AI 工程编辑：被活着的 agent 锁着时先提示，可改为只读观看 */
  const openAiProject = useCallback(async (name: string) => {
    const entry = aiProjects?.find((e) => e.name === name);
    if (!entry) { setNotice(`找不到 AI 工程「${name}」`); return; }
    const fresh = await fetch('/api/agents', { cache: 'no-store' }).then((r) => r.json()).catch(() => null) as { projects?: Array<{ name: string } & AiProjectState> } | null;
    const lock = fresh?.projects?.find((p) => p.name === name)?.lockedBy ?? null;
    if (lock) { setAiLockPrompt({ sample: entry, holder: lock.displayName, sessionId: lock.sessionId }); return; }
    void loadSample(entry);
  }, [aiProjects, loadSample]);

  /**
   * 基于 AI 工程新建：问名字后把快照写进工作区 `projects/<新名>/`（不动原工程、不拿原工程的锁），
   * 再把新工程作为可编辑文档打开；之后 Ctrl+S 直接写回这个新项目。
   */
  const newFromAiProject = useCallback((name: string) => {
    const entry = aiProjects?.find((e) => e.name === name);
    if (!entry) { setNotice(`找不到 AI 工程「${name}」`); return; }
    const input = window.prompt('新工程名称（保存到 projects/，仅英文/数字/_ . -）', `${name}-copy`);
    const copyName = input?.trim();
    if (!copyName) return;
    void (async () => {
      let payload: Awaited<ReturnType<typeof loadSamplePayload>>;
      try {
        payload = await loadSamplePayload(entry);
      } catch (error) {
        setNotice(`读取 AI 工程失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const skeleton = JSON.parse(JSON.stringify(payload.skeleton)) as Record<string, unknown>;
      const imageUrl = URL.createObjectURL(payload.image);
      const saved = await postWorkspaceSave(copyName, skeleton, payload.texture, imageUrl, false);
      revokeAtlas();
      const next: PendingLoad = {
        skeleton,
        texture: payload.texture,
        imageUrl,
        projectName: copyName,
        sampleDir: saved.ok ? copyName : undefined,
        dirSource: saved.ok ? 'ai' : undefined,
        workspaceName: saved.ok ? copyName : undefined,
      };
      pending.current = next;
      buildPlayer(next);
      if (!saved.ok) {
        setNotice(`已打开临时副本，但未能保存到项目：${workspaceSaveReason(saved)}`);
        return;
      }
      await refreshAiProjects();
      setRecents(pushRecent(window.localStorage, { kind: 'workspace', name: copyName }));
      flash(`已保存新工程「${copyName}」到项目`);
    })();
  }, [aiProjects, buildPlayer, flash, loadSamplePayload, postWorkspaceSave, refreshAiProjects, revokeAtlas, setNotice]);

  /**
   * 欢迎页「AI 工程」卡片删除：删磁盘工程目录 + manifest 条目（dev server `/api/projects/delete`）。
   * 被活着的 agent 持锁时先在前端拦一次（server 侧 409 兜底）；按 `Setting.DeleteConfirmation` 弹确认框。
   */
  const deleteAiProject = useCallback((name: string) => {
    if (isReadonly()) { setNotice('只读观看模式下不能删除工程'); return; }
    const entry = aiProjects?.find((item) => item.name === name);
    if (!entry) { setNotice(`找不到 AI 工程「${name}」`); return; }
    const holder = aiState[name]?.lockedBy;
    if (holder) { setNotice(`「${name}」正被 ${holder.displayName} 编辑，等它结束再删`); return; }
    const run = () => {
      void fetch('/api/projects/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(async (response) => {
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { error?: string; holder?: { displayName?: string } } | null;
          if (response.status === 409) setNotice(`「${name}」正被 ${detail?.holder?.displayName ?? 'agent'} 编辑，未删除`);
          else setNotice(`删除 AI 工程失败：${detail?.error ?? `HTTP ${response.status}`}`);
          return;
        }
        setAiProjects((prev) => (prev ? prev.filter((item) => item.name !== name) : prev));
        setAiState((prev) => {
          if (!(name in prev)) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
        flash(`已删除 AI 工程「${name}」`);
      }).catch(() => setNotice('删除 AI 工程失败：连不上本地服务'));
    };
    if (settings.deleteConfirmation) {
      setConfirmAsk({
        title: '删除 AI 工程',
        message: `删除工程「${name}」？磁盘上的工程目录会被永久删除，无法撤销。`,
        onConfirm: run,
      });
      return;
    }
    run();
  }, [aiProjects, aiState, flash, settings.deleteConfirmation]);

  /** 项目打开后（绑定姿态）拍一张封面，给欢迎页的项目卡片用 */
  useEffect(() => {
    const key = coverTargetRef.current;
    if (!player || !key) return;
    coverTargetRef.current = null;
    let cancelled = false;
    void renderCover(player, atlasUrl).then((url) => {
      if (!cancelled && url) setCovers(writeCover(window.localStorage, key, url));
    });
    return () => { cancelled = true; };
  }, [player, atlasUrl]);

  /** 还没有封面的本地示例：后台逐个离屏渲染（不影响当前工程） */
  useEffect(() => {
    const missing = samples.filter((sample) => !covers[coverKey('sample', sample.name)]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const sample of missing) {
        if (cancelled) return;
        let imageUrl: string | null = null;
        try {
          const source = await fetchSamplePreview(sample);
          imageUrl = source.imageUrl;
          const url = await renderCover(source.player, imageUrl);
          if (!cancelled && url) setCovers(writeCover(window.localStorage, coverKey('sample', sample.name), url));
        } catch {
          // 单个示例出错不影响其他封面
        } finally {
          if (imageUrl) URL.revokeObjectURL(imageUrl);
        }
      }
    })();
    return () => { cancelled = true; };
    // 只在示例列表变化时补齐；covers 每写一张都会变，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples]);

  /** 欢迎页卡片悬停：第一个动画的帧序列（按卡片缓存，同一张卡片只渲染一次） */
  const previewCache = useRef(new Map<string, Promise<CoverAnimation | null>>());
  const previewAnimation = useCallback((kind: 'sample' | 'file' | 'workspace', name: string): Promise<CoverAnimation | null> => {
    const key = coverKey(kind, name);
    const cached = previewCache.current.get(key);
    if (cached) return cached;
    const job = (async (): Promise<CoverAnimation | null> => {
      if (kind === 'sample') {
        const sample = samples.find((item) => item.name === name);
        if (!sample) return null;
        const source = await fetchSamplePreview(sample);
        try {
          return await renderCoverAnimation(source.player, source.imageUrl);
        } finally {
          URL.revokeObjectURL(source.imageUrl);
        }
      }
      // 本地文件读不回来：只有它还开着页签时，拿页签里的数据另建一个 Player 播
      const open = documents.find((doc) => doc.name === name);
      if (!open) return null;
      const copy = new Player(JSON.parse(serializeSkeletonData(open.player.doc)), open.texture);
      return renderCoverAnimation(copy, open.atlasUrl);
    })().catch(() => null);
    previewCache.current.set(key, job);
    // 本地项目没开着时结果是 null —— 不缓存，下次打开页签后再悬停还能出动画
    if (kind === 'file') void job.then((result) => { if (!result) previewCache.current.delete(key); });
    return job;
  }, [documents, samples]);

  /** Deep link helpers: ?frame=<n>&select=<bone|first-with-keys> (demos, screenshots). */
  useEffect(() => {
    if (!player) return;
    const params = new URLSearchParams(window.location.search);
    const frame = Number(params.get('frame'));
    // MCP 预览深链：?anim=<名字>&frame=<n>&play=1 → 切到动画制作模式并停在该帧 / 播放
    const wantedAnim = params.get('anim');
    if (wantedAnim && player.animationNames().includes(wantedAnim)) {
      player.setAnimation(wantedAnim);
      changeEditMode('animation');
      window.setTimeout(() => {
        player.setupPose = false;
        if (Number.isFinite(frame) && frame > 0) player.seek(Math.round(frame));
        else player.applyPose();
        if (params.get('play') === '1') player.play();
        refresh();
      }, 0);
    } else if (Number.isFinite(frame) && frame > 0) player.seek(Math.round(frame));
    const wanted = params.get('select');
    if (wanted) {
      const match = wanted === 'first-with-keys'
        ? player.boneTree().find((entry) => player.animation?.bone?.some((t) => t.name === entry.name))?.name ?? null
        : (player.skeleton.boneIndexByName.has(wanted) ? wanted : null);
      if (match) setSelectedBone(match);
    }
    setFitToken((value) => value + 1);
    refresh();
  }, [player, refresh, changeEditMode]);

  /**
   * MCP 实时同步：`?live=1` 时轮询 `/dbsamples/manifest.json`，当前示例的 `rev` 变了就带着原参数整页重载。
   * MCP server 每次写工程都会更新 rev（见 `src/mcp/workspace.ts`），所以 agent 的改动会自动出现在编辑器里。
   */
  useEffect(() => {
    const { name, root, live } = liveParams;
    if (!live || !name) return;
    let last: unknown;
    const timer = window.setInterval(() => {
      fetch(`${root}/manifest.json`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { samples?: Array<{ name: string; rev?: unknown }> } | null) => {
          const entry = data?.samples?.find((item) => item.name === name);
          if (!entry) return;
          if (last === undefined) { last = entry.rev ?? null; return; }
          if ((entry.rev ?? null) !== last) {
            // SSE 连着时 LiveSync 原地更新，这里只记下新 rev；SSE 断了才整页重载（老行为，兜底）
            if (window.__bonestudioLiveSse) { last = entry.rev ?? null; return; }
            window.location.reload();
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [liveParams]);

  useEffect(() => {
    window.localStorage.setItem('bonestudio.background', backgroundId);
  }, [backgroundId]);
  /* ---------------- editing / history ---------------- */

  /**
   * 压入一步撤销。`snapshotOverride` 给「先改数据、后补历史」的场景用 ——
   * 自动权重要先算完才知道会不会真的改动，所以调用方自己留改动前的快照再传进来。
   */
  const pushHistory = useCallback((snapshotOverride?: string | null) => {
    if (!assertWritable('pushHistory')) return;
    const current = playerRef.current;
    const snapshot = snapshotOverride ?? snapshotArmature(current);
    if (!snapshot) return;
    const stack = history.current.stack.slice(0, history.current.index + 1);
    if (stack[stack.length - 1] !== snapshot) stack.push(snapshot);   // 与栈顶相同（如载入基线）不重复压
    if (stack.length > 60) stack.shift();
    history.current = { stack, index: stack.length - 1 };
    setHistoryState({ canUndo: true, canRedo: false });   // 马上要改数据：撤销可用
  }, []);

  /** 属性栏进度条：改当前饼图顶点上某一根骨骼的权重，其余骨骼按比例让出。 */
  const setWeightShare = useCallback((bone: string, percent: number) => {
    if (!assertWritable('setWeightShare')) return;
    const current = playerRef.current;
    if (!current || !selectedSlot || weightVertex == null) return;
    const changed = setVertexWeight(current.skeleton.armature, {
      slot: selectedSlot, vertex: weightVertex, bone, weight: Math.max(0, Math.min(100, percent)) / 100,
    });
    if (changed === null) return;
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [refresh, selectedSlot, weightVertex]);

  /** M4 网格工具（B）：把一个顶点拖到槽位局部空间的绝对坐标。 */
  const dragMeshVertex = useCallback((slot: string, vertex: number, x: number, y: number) => {
    if (!assertWritable('dragMeshVertex')) return;
    // 指针移动会连着调用。这里只拒绝，不弹 toast，避免动画模式下拖轮廓时刷屏。
    if (editModeRef.current !== 'armature') return;
    const current = playerRef.current;
    if (!current) return;
    if (!findMesh(current.skeleton.armature, slot)) return;
    // dbbin 形态还要同步平移烘焙点，所以把绑定世界矩阵交给几何层（见 docs/DBPRO-SPEC.md §27.1）
    const ok = setMeshVertex(current.skeleton.armature, slot, vertex, x, y, {
      bindWorld: (index) => current.skeleton.bindWorld[index] ?? null,
    });
    if (!ok) return;
    refresh();
  }, [refresh]);

  /** M4 网格工具（M）：删除一个顶点，并删掉所有用到它的三角形。 */
  const dropMeshVertex = useCallback((slot: string, vertex: number) => {
    if (!assertWritable('dropMeshVertex')) return;
    if (!requireArmatureMode('删除网格点')) return;
    const current = playerRef.current;
    if (!current) return;
    if (!findMesh(current.skeleton.armature, slot)) return;
    pushHistory();
    if (!removeMeshVertex(current.skeleton.armature, slot, vertex)) {
      flash('删除失败：顶点越界，或网格只剩一个三角形');
      return;
    }
    refresh();
    flash('已删除网格顶点：' + slot + ' → 顶点 ' + vertex);
  }, [flash, pushHistory, refresh]);

  /** M4 网格工具（N）：在一条三角形边上插入顶点并细分用到它的三角形。 */
  const addMeshVertexAt = useCallback((slot: string, a: number, b: number, t: number) => {
    if (!assertWritable('addMeshVertexAt')) return;
    if (!requireArmatureMode('添加网格点')) return;
    const current = playerRef.current;
    if (!current) return;
    if (!findMesh(current.skeleton.armature, slot)) return;
    pushHistory();
    const index = addMeshVertexOnEdge(current.skeleton.armature, slot, a, b, t, {
      // dbbin 形态需要绑定世界矩阵才能算出新顶点的烘焙点
      bindWorld: (bone) => current.skeleton.bindWorld[bone] ?? null,
    });
    if (index === null) {
      flash('加点失败：这条边不属于任何三角形');
      return;
    }
    refresh();
    flash('已在 ' + slot + ' 的边 ' + a + '–' + b + ' 上插入顶点 ' + index);
  }, [flash, pushHistory, refresh]);

  /** M4 手动绘制边线：已存在则删除，否则新增（官方 Mesh.tool.outline）。 */
  const toggleMeshLine = useCallback((slot: string, a: number, b: number) => {
    if (!assertWritable('toggleMeshLine')) return;
    if (!requireArmatureMode('添加边线')) return;
    const current = playerRef.current;
    if (!current) return;
    const mesh = findMesh(current.skeleton.armature, slot);
    if (!mesh || isBakedMesh(mesh)) {
      flash('该网格是 dbbin 二进制形态，边线数据不在二进制里（官方写出器会清空），请用 JSON / .dbproj 保存');
      return;
    }
    const existing = findUserEdgeIndex(mesh, a, b);
    if (existing < 0) {
      const count = meshVertexCount(mesh);
      if (a < 0 || b < 0 || a >= count || b >= count || a === b) {
        flash('边线端点无效');
        return;
      }
    }
    pushHistory();
    const ok = existing >= 0
      ? removeUserEdge(current.skeleton.armature, slot, a, b)
      : addUserEdge(current.skeleton.armature, slot, a, b);
    if (!ok) {
      flash('边线操作失败');
      return;
    }
    refresh();
    flash(existing >= 0
      ? '已删除边线 ' + a + '–' + b
      : '已画边线 ' + a + '–' + b + '（随 JSON / .dbproj 保存；转 dbbin 时按官方语义丢弃）');
  }, [flash, pushHistory, refresh]);

  /**
   * 官方 `Mesh.property.edit` / `_11645`：进入网格编辑的入口条件是「骨架装配 + 只选中一个 mesh 显示对象」。
   * 进入后底部出现悬浮工具栏（`_11511`），B/N/M 生效，默认「变形」勾选（`_11505._11657 = true`）。
   */
  const openMeshEditor = useCallback(() => {
    if (!requireArmatureMode('编辑网格')) return;
    const current = playerRef.current;
    const target = selectedSlot;
    if (!current || !target) { flash('编辑网格：先选中一个网格插槽'); return; }
    const slot = current.skeleton.slots.find((entry) => entry.name === target);
    const display = current.skeleton.skinSlots.get(target)?.display?.[slot?.displayIndex ?? 0];
    if (!isMeshDisplay(display)) { flash('编辑网格：选中的显示对象不是网格（先「自动生成边线」转换成网格）'); return; }
    setMeshEditSlot(target);
    setMeshEditMode(true);
    setFfdMode(true);
    setTool('mesh');
  }, [flash, selectedSlot]);

  const closeMeshEditor = useCallback(() => {
    setMeshEditMode(false);
    setMeshEditSlot(null);
    // 退出网格编辑即离开顶点编辑：属性面板的权重列表要还原（不留滑块 / 百分比）。
    setWeightVertex(null);
  }, []);

  const toggleMeshEditor = useCallback(() => {
    if (meshEditMode) closeMeshEditor();
    else openMeshEditor();
  }, [closeMeshEditor, meshEditMode, openMeshEditor]);

  /**
   * 官方 `Mesh.property.reset` → `ResetMesh.content` 确认 → `RESET_ORIGIN` → `Mesh._3196()`：
   * 把网格重置成覆盖整张图片的 4 角点矩形（并清空权重 / 绑定 / 手绘边与该网格的 FFD 关键帧）。
   * 已是默认矩形时按官方 `_4326()` 直接跳过。
   */
  const resetMeshSelection = useCallback(() => {
    if (!assertWritable('resetMeshSelection')) return;
    if (!requireArmatureMode('重置网格')) return;
    const current = playerRef.current;
    const target = selectedSlot;
    if (!current || !target) { flash('重置网格：先选中一个网格插槽'); return; }
    const slot = current.skeleton.slots.find((entry) => entry.name === target);
    const display = current.skeleton.skinSlots.get(target)?.display?.[slot?.displayIndex ?? 0];
    if (!display || !isMeshDisplay(display)) { flash('重置网格：选中的显示对象不是网格'); return; }
    const regionName = display.path ?? display.name;
    const region = regionName ? current.atlas?.byName.get(regionName) : undefined;
    if (!region) { flash('重置网格：这个显示对象没有可用的图片区域'); return; }
    if (isDefaultRectMesh(display, region)) { flash('重置网格：已经是默认矩形'); return; }
    if (!window.confirm('重置网格会删除当前选中图片上所有已添加的网格点，您确定要重置吗？')) return;
    pushHistory();
    if (!resetMeshGeometry(current.skeleton.armature, target, region)) { flash('重置网格失败（dbbin 二进制形态不支持）'); return; }
    for (const animation of current.skeleton.armature.animation ?? []) {
      animation.ffd = (animation.ffd ?? []).filter((track) => track.slot !== target);
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash('已重置网格：' + target + ' → 4 个顶点 / 2 个三角形');
  }, [flash, pushHistory, refresh, selectedSlot]);

  /** 官方 `_11688` 的确认时机里要用到（`completeOutline` 里读，避免闭包过期） */
  const meshEditModeRef = useRef(meshEditMode);
  meshEditModeRef.current = meshEditMode;
  /** 手动绘制边线的「已确认并自动关变形」标记（官方 `_11681`） */
  const outlineRestoreDeformRef = useRef(false);

  // 官方 `_11678` / `_10861`：网格编辑绑定单次选中与当前工具，任一变化即退出。
  useEffect(() => {
    if (!meshEditMode) return;
    if (meshEditSlot && selectedSlot !== meshEditSlot) closeMeshEditor();
  }, [meshEditMode, meshEditSlot, selectedSlot, closeMeshEditor]);

  useEffect(() => {
    if (!meshEditMode) return;
    if (!MESH_EDIT_TOOLS.includes(tool)) closeMeshEditor();
  }, [meshEditMode, tool, closeMeshEditor]);

  // 官方 `_11688`：切到「手动绘制边线」先弹 OutlineMesh.content 确认，确认后自动关掉「变形」
  // （舞台只留本网格 —— 见下方 hiddenSlots 派生），切回其它工具时再恢复。
  const outlineArmedRef = useRef(false);
  useEffect(() => {
    if (!meshEditMode) { outlineArmedRef.current = false; return; }
    if (tool === 'meshOutline') {
      if (outlineArmedRef.current) return;
      outlineArmedRef.current = true;
      const ok = window.confirm('重绘网格边线会删除当前选中图片上所有已添加的网格点，删除所有绑定的骨骼权重，并删除相对应的时间轴关键帧，您确定要手动重绘网格边线吗？');
      if (!ok) { outlineArmedRef.current = false; setTool('mesh'); return; }
      if (ffdMode) { outlineRestoreDeformRef.current = true; setFfdMode(false); }
      return;
    }
    if (outlineArmedRef.current) {
      outlineArmedRef.current = false;
      if (outlineRestoreDeformRef.current) { outlineRestoreDeformRef.current = false; setFfdMode(true); }
    }
  }, [tool, meshEditMode, ffdMode]);

  /**
   * 官方 `_11505._11684`：`visibleFilter._11294 = !deform` —— 网格编辑里**不勾变形**（基础网格层）
   * 就隐藏其它显示对象，勾选（变形层）则显示全部。这里只改传给舞台的那一份，不动全局 hiddenSlots。
   */
  const stageHiddenSlots = useMemo(() => {
    if (!meshEditMode || ffdMode || !meshEditSlot || !player) return hiddenSlots;
    const next = new Set(hiddenSlots);
    for (const slot of player.skeleton.slots) {
      if (slot.name !== meshEditSlot) next.add(slot.name);
    }
    return next;
  }, [hiddenSlots, meshEditMode, ffdMode, meshEditSlot, player]);

  /**
   * 同一个「隐藏其他」口径也管骨骼：网格编辑里不勾变形时，舞台上连骨骼线框一起收起来，
   * 只剩被编辑的那块网格（对应用户验收「除了插槽，骨骼也要隐藏」）。
   */
  const stageShowBones = showBones && stageFilter.boneVisible && !(meshEditMode && !ffdMode);

  /** 官方 `Mesh.tool.info`「顶点数：{0}」：当前编辑网格的顶点数 */
  const meshEditVertexCount = useMemo(() => {
    if (!meshEditSlot || !player) return 0;
    const slot = player.skeleton.slots.find((entry) => entry.name === meshEditSlot);
    const display = player.skeleton.skinSlots.get(meshEditSlot)?.display?.[slot?.displayIndex ?? 0];
    return Math.floor((display?.vertices?.length ?? 0) / 2);
  }, [meshEditSlot, player, version]);

  /**
   * Single entry point for bone selection. While "设置父级" (P) is armed the next
   * selection re-parents the previously selected bone instead of changing the
   * selection — the official two-click flow, reachable from the stage, the outline
   * and the dope sheet.
   */
  const selectBone = useCallback((name: string | null, additive = false) => {
    setSelectedTrack(null);
    // 单选时重置多选；Shift 点选走 toggleBoneSelection
    if (!additive) setSelectedBones(name ? new Set([name]) : new Set());
    if (parentPick && player && name && selectedBone && name !== selectedBone) {
      pushHistory();
      const ok = setBoneParent(player, selectedBone, name);
      if (ok) player.rebuildSkeleton();
      setParentPick(false);
      if (ok) flash(`把 ${selectedBone} 的父级设为 ${name}`);
      else setNotice('设置父级失败（会形成环或骨骼不存在）');
      refresh();
      return;
    }
    setSelectedBone(name);
    if (tool === 'weight' && name) setWeightVertex(null);
    else setSelectedSlot(null);
  }, [parentPick, player, selectedBone, pushHistory, refresh, tool]);

  const applySnapshot = useCallback((index: number) => {
    if (!assertWritable('applySnapshot')) return;
    const current = playerRef.current;
    const snapshot = history.current.stack[index];
    if (!current || !snapshot) return;
    restoreArmature(current, snapshot);
    history.current = { ...history.current, index };
    setModelVersion((value) => value + 1);
    setHistoryState({
      canUndo: index > 0,
      canRedo: index < history.current.stack.length - 1,
    });
    refresh();
  }, [refresh]);

  /**
   * 一条时间线的关键帧位置（用于全选 / 重新推导选择）。
   *
   * **必须走 `keyFrames`**：它同时认 BoneAll 的 `frame[]` 和 5.x 组件帧（translateFrame / rotateFrame /
   * scaleFrame）。只看 `timeline.frame` 会让组件形式的工程「明明有关键帧却全选不到」——
   * 用户 192 轮点的那个骨架菱形弹「当前动画没有关键帧」就是这么来的。
   */
  const keyPositions = useCallback((current: Player, bone: string): number[] => (
    keyFrames(current, bone).map((ref) => ref.frame)
  ), []);
  /** 选区条目在编辑后是否还对应一个真实的键：通道条目看该通道自己的键位 */
  const entryExists = useCallback((current: Player, entry: KeySelectionEntry): boolean => {
    const frames = entry.channel
      ? boneChannelKeys(current, entry.bone)[entry.channel].map((key) => key.frame)
      : keyPositions(current, entry.bone);
    return frames.some((at) => Math.abs(at - entry.frame) < 1e-3);
  }, [keyPositions]);


  const runKeyEdit = useCallback((edit: (current: Player) => number): number => {
    if (!requireAnimationMode('关键帧编辑')) return 0;
    const current = playerRef.current;
    if (!current) return 0;
    pushHistory();
    const changed = edit(current);
    if (changed > 0) {
      // `keyMap`/the docks rows are memoised on `modelVersion`, so an in-place
      // timeline edit must bump it or the dope sheet keeps rendering stale keys.
      setModelVersion((value) => value + 1);
      refresh();
    }
    return changed;
  }, [pushHistory, refresh]);

  /** Slot edits (M2): every operation keeps skins, timelines and action refs in sync. */
  /** 结构编辑里，骨骼的增删改只在「骨架装配」模式可用。槽位编辑两种模式都能做。 */
  const requireArmatureMode = (what: string): boolean => {
    if (editModeRef.current === 'armature') return true;
    if (isSheetArmature(playerRef.current?.skeleton.armature)) {
      flash(`${what}：序列帧不使用骨架装配`);
      return false;
    }
    flash(`${what}：骨骼装配模式下才能操作（Ctrl+Tab 切换）`);
    return false;
  };
  /** 关键帧编辑只在「动画制作」模式可用。 */
  const requireAnimationMode = (what: string): boolean => {
    if (editModeRef.current === 'animation') return true;
    flash(`${what}：动画制作模式下才能操作（Ctrl+Tab 切换）`);
    return false;
  };
  const runSlotEdit = useCallback((edit: (current: Player) => boolean): boolean => {
    const current = playerRef.current;
    if (!current) return false;
    pushHistory();
    const changed = edit(current);
    if (changed) {
      // structural: bones / slots / skins changed shape, so rebuild the runtime
      current.rebuildSkeleton();
      setModelVersion((value) => value + 1);
      refresh();
    }
    return changed;
  }, [pushHistory, refresh]);

  const renameSlotSelection = useCallback((next: string) => {
    const target = selectedSlot;
    if (!target) return;
    if (!runSlotEdit((player) => renameSlot(player, target, next))) {
      setNotice('重命名失败：名称为空、与既有槽位重名或对象不存在。');
      return;
    }
    setSelectedSlot(next.trim());
    flash(`槽位 ${target} → ${next.trim()}`);
  }, [runSlotEdit, selectedSlot]);

  /**
   * 场景树双击行后的「确定」：改的是**双击那一行**，不是当前选中项。
   * 骨骼 → `core/editing.ts#renameBone`（连带子骨骼 / slot.parent / 时间轴 / IK 引用）；
   * 插槽 → `core/slotEdit.ts#renameSlot`（连带 skin / 时间轴 / 动作帧引用）。
   * 两条路都会连带重建 runtime 并进撤销栈。
   */
  const commitRename = useCallback((next: string) => {
    const target = renameTarget;
    const current = playerRef.current;
    setRenameTarget(null);
    if (!target || !current) return;
    if (target.kind === 'bone') {
      pushHistory();
      if (!renameBone(current, target.name, next)) {
        setNotice('重命名失败：名称为空、与既有骨骼重名或对象不存在。');
        return;
      }
      current.rebuildSkeleton();
      setSelectedBone(next.trim());
      setSelectedSlot(null);
      setModelVersion((value) => value + 1);
      refresh();
      flash(`骨骼 ${target.name} → ${next.trim()}`);
      return;
    }
    if (!runSlotEdit((player) => renameSlot(player, target.name, next))) {
      setNotice('重命名失败：名称为空、与既有槽位重名或对象不存在。');
      return;
    }
    setSelectedSlot(next.trim());
    flash(`槽位 ${target.name} → ${next.trim()}`);
  }, [pushHistory, refresh, renameTarget, runSlotEdit]);

  const changeSlotBlend = useCallback((mode: number) => {
    const target = selectedSlot;
    if (!target) return;
    if (!runSlotEdit((player) => setSlotBlendMode(player, target, mode))) return;
    flash(`槽位 ${target} 混合模式 → ${blendModeLabel(mode)}`);
  }, [runSlotEdit, selectedSlot]);

  const changeSlotDisplay = useCallback((index: number) => {
    const target = selectedSlot;
    if (!target) return;
    if (!runSlotEdit((player) => setSlotDisplayIndex(player, target, index))) return;
    flash(`槽位 ${target} 显示资源 → ${index < 0 ? '无' : index}`);
  }, [runSlotEdit, selectedSlot]);

  /**
   * 颜色和不透明改的是正在画的那张图。
   * 动画制作里没有颜色键时，采样会盖住绑定色，所以这里直接把当前颜色写到播放头（没有键就补一帧）。
   * 骨架装配写绑定姿态。不走整表重建，只重新套姿态，滑条才能跟手。
   */
  const changeSlotColor = useCallback((color: Parameters<typeof setSlotColor>[2]) => {
    const target = selectedSlot;
    const current = playerRef.current;
    if (!target || !current) return;
    if (current.playing) current.playing = false;
    const ok = editModeRef.current === 'animation'
      ? setSlotColorKeyframe(current, target, current.position, color, true)
      : setSlotColor(current, target, color);
    if (!ok) return;
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [refresh, selectedSlot]);

  const beginSlotColor = useCallback(() => { pushHistory(); }, [pushHistory]);

  /** 颜色选择器打开前的颜色。预览直接改图，取消按这份还原，确定才进撤销栈。 */
  const colorPreviewRef = useRef<{
    slot: string;
    frame: number;
    mode: 'animation' | 'armature';
    keyed: boolean;
    color: DbColorTransform;
  } | null>(null);

  const beginColorPreview = useCallback(() => {
    const target = selectedSlot;
    const current = playerRef.current;
    if (!target || !current) return;
    const mode = editModeRef.current === 'animation' ? 'animation' : 'armature';
    const color = mode === 'animation'
      ? slotColorAt(current, target, current.position)
      : readSlotColor(current, target);
    if (!color) return;
    colorPreviewRef.current = {
      slot: target,
      frame: current.position,
      mode,
      keyed: mode === 'animation' && colorKeyAt(current, target, current.position),
      color: { ...color },
    };
  }, [selectedSlot]);

  const cancelColorPreview = useCallback(() => {
    const baseline = colorPreviewRef.current;
    colorPreviewRef.current = null;
    const current = playerRef.current;
    if (!baseline || !current) return;
    if (baseline.mode === 'animation') {
      if (baseline.keyed) setSlotColorKeyframe(current, baseline.slot, baseline.frame, baseline.color, true);
      else if (colorKeyAt(current, baseline.slot, baseline.frame)) removeSlotColorKeyframe(current, baseline.slot, baseline.frame);
    } else {
      setSlotColor(current, baseline.slot, baseline.color);
    }
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [refresh]);

  const commitColorPreview = useCallback((changed: boolean) => {
    if (!colorPreviewRef.current) return;
    if (!changed) {
      cancelColorPreview();
      return;
    }
    colorPreviewRef.current = null;
    pushHistory();
  }, [cancelColorPreview, pushHistory]);

  /**
   * 时间轴**轨道 / 通道行上的旗杆**：在当前帧打 / 删这条轨道的键。
   * 与属性面板的旗杆走同一套数据层，只是把入口搬到时间轴上（用户 204 轮）。
   */
  const toggleTrackKey = useCallback((trackId: string, channelId?: string) => {
    if (!assertWritable('toggleTrackKey')) return;
    const current = playerRef.current;
    if (!current?.animation) return;
    if (!requireAnimationMode('打关键帧')) return;
    const at = Math.round(current.position);
    pushHistory();
    let changed = false;
    if (trackId.startsWith('slot-')) {
      const slot = trackId.slice('slot-'.length);
      if (channelId?.endsWith('-color')) {
        changed = colorKeyAt(current, slot, at)
          ? removeSlotColorKeyframe(current, slot, at)
          : (() => { const color = slotColorAt(current, slot, at); return color ? setSlotColorKeyframe(current, slot, at, color, true) : false; })();
      } else if (channelId?.endsWith('-display')) {
        changed = displayKeyAt(current, slot, at)
          ? removeSlotDisplayKeyframe(current, slot, at)
          : setSlotDisplayKeyframe(current, slot, at, current.skeleton.slots.find((entry) => entry.name === slot)?.displayIndex ?? 0);
      }
    } else if (trackId.startsWith('ik-')) {
      const name = trackId.slice('ik-'.length);
      const constraint = current.skeleton.armature.ik?.find((entry) => entry.name === name);
      if (constraint) {
        changed = ikKeyAt(current.animation, name, at)
          ? removeIkKeyframe(current.animation, name, at)
          : setIkKeyframe(current.animation, name, at, readIkKey(current.animation, name, at) ?? ikBindValues(constraint));
      }
    } else if (trackId === 'zorder') {
      changed = zOrderKeyed(current, at)
        ? removeZOrderKeyframe(current, at)
        : setZOrderKeyframe(current, namesToOrder(bindOrder(current), drawOrder(current)));
    }
    if (!changed) { flash('这一帧没有可打 / 可删的键'); return; }
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已切换第 ${at} 帧这条轨道的键`);
  }, [flash, pushHistory, refresh]);

  /**
   * 删掉「非骨骼轨道」在当前帧的键（时间轴轨道行选中后按 Delete）。
   * 插槽行同时管**颜色 + 显示资源**两个通道；事件行删掉该帧上的**全部**事件。
   */
  const deleteTrackKeyAt = useCallback((trackId: string, frame: number) => {
    const current = playerRef.current;
    if (!current?.animation) return 0;
    const at = Math.round(frame);
    pushHistory();
    let removed = 0;
    if (trackId.startsWith('slot-')) {
      const slot = trackId.slice('slot-'.length);
      if (colorKeyAt(current, slot, at) && removeSlotColorKeyframe(current, slot, at)) removed += 1;
      if (displayKeyAt(current, slot, at) && removeSlotDisplayKeyframe(current, slot, at)) removed += 1;
    } else if (trackId.startsWith('ik-')) {
      const name = trackId.slice('ik-'.length);
      if (removeIkKeyframe(current.animation, name, at)) removed += 1;
    } else if (trackId === 'events') {
      let guard = 0;
      while (eventsAt(current, at).length > 0 && guard < 50) {
        if (!removeEventFrame(current, at, 0)) break;
        removed += 1;
        guard += 1;
      }
    } else if (trackId === 'zorder') {
      if (removeZOrderKeyframe(current, at)) removed += 1;
    }
    if (removed === 0) {
      setNotice(`这一帧上没有可删的键（${trackId}）`);
      return 0;
    }
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已删除该轨道第 ${at} 帧的 ${removed} 个键`);
    return removed;
  }, [flash, pushHistory, refresh]);

  /** 事件帧的增删（官方 `EventPanel`）：与其它编辑一样进撤销栈。 */
  const runEventEdit = useCallback((edit: (player: Player) => boolean) => {
    if (!requireAnimationMode('编辑事件帧')) return;
    const current = playerRef.current;
    if (!current?.animation) return;
    pushHistory();
    if (!edit(current)) return;
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh]);

  const toggleSlotColorKey = useCallback(() => {
    const target = selectedSlot;
    if (!target || !requireAnimationMode('打颜色关键帧')) return;
    const current = playerRef.current;
    if (!current || current.playing) return;
    runSlotEdit((player) => {
      const at = player.position;
      if (colorKeyAt(player, target, at)) return removeSlotColorKeyframe(player, target, at);
      const sampled = slotColorAt(player, target, at);
      return sampled ? setSlotColorKeyframe(player, target, at, sampled, true) : false;
    });
  }, [runSlotEdit, selectedSlot]);

  /**
   * 插槽「显示资源」的旗杆（官方 `Property.display.changeAsset` 右侧那个旗杆）：
   * 当前帧没键就按当前显示对象打一帧，有键就删掉这一帧。
   */
  const toggleDisplayKey = useCallback(() => {
    const target = selectedSlot;
    if (!target || !requireAnimationMode('打显示资源关键帧')) return;
    const current = playerRef.current;
    if (!current || current.playing) return;
    runSlotEdit((player) => {
      const at = player.position;
      if (displayKeyAt(player, target, at)) return removeSlotDisplayKeyframe(player, target, at);
      const index = current.skeleton.slots.find((entry) => entry.name === target)?.displayIndex ?? 0;
      return setSlotDisplayKeyframe(player, target, at, index);
    });
  }, [runSlotEdit, selectedSlot]);

  /** 旗杆：当前帧没有 FFD 键就按采样偏移打一帧，有键就把这一帧删掉（时长并进相邻帧）。 */
  const toggleFfdKey = useCallback(() => {
    const target = selectedSlot;
    if (!target || !requireAnimationMode('打 FFD 关键帧')) return;
    const current = playerRef.current;
    if (!current?.animation || current.playing) return;
    const mesh = findMesh(current.skeleton.armature, target);
    if (!mesh) return;
    const count = meshVertexCount(mesh);
    if (count < 1) return;
    pushHistory();
    const at = current.position;
    const changed = ffdKeyAt(current.animation, target, at)
      ? removeFfdKeyframe(current.animation, target, at)
      : setFfdVertex(current.animation, target, at, 0, 0, 0, count);
    if (!changed) return;
    setModelVersion((value) => value + 1);
    refresh();
    flash(ffdKeyAt(current.animation, target, at) ? '已打 FFD 关键帧' : '已删除 FFD 关键帧');
  }, [flash, pushHistory, refresh, selectedSlot]);

  /** Official 「添加绑定骨骼」: registers the bind reference; the new bone starts at weight 0. */
  const addWeightBone = useCallback((bone: string) => {
    if (!assertWritable('addWeightBone')) return;
    const target = selectedSlot;
    const current = playerRef.current;
    if (!target || !current) return;
    if (!requireArmatureMode('添加绑定骨骼')) return;
    if (meshWeightBones(current.skeleton.armature, target).includes(bone)) {
      flash(`${bone} 已在权重列表里`);
      return;
    }
    if (!runSlotEdit((player) => addMeshWeightBone(player.skeleton.armature, target, bone))) {
      setNotice(`${bone} 无法绑定（当前槽位不是网格，或找不到这根骨骼）。`);
      return;
    }
    flash(`已绑定 ${bone}（权重 0）`);
  }, [flash, runSlotEdit, selectedSlot]);

  /**
   * Official 「解绑」: 丢掉绑定引用，并把存活影响重新归一化。
   *
   * 两道门禁：① 只在骨架装配模式可做（`requireArmatureMode`，与「添加绑定骨骼」同一口径）；
   * ② 跟随官方 `Setting.DeleteConfirmation` 先弹确认框 —— 解绑会连带清掉该骨骼在**所有顶点**
   * 上的权重，属于破坏性操作，不该一键即毁。
   */
  const removeWeightBone = useCallback((bone: string) => {
    const target = selectedSlot;
    if (!target) return;
    if (!requireArmatureMode('解绑骨骼')) return;
    const run = () => {
      if (!runSlotEdit((player) => removeMeshWeightBone(player.skeleton.armature, target, bone))) {
        setNotice(`${bone} 不在这个网格的权重骨骼列表里。`);
        return;
      }
      flash(`已解绑 ${bone}，其余权重已重新归一化`);
    };
    if (settings.deleteConfirmation) {
      setConfirmAsk({
        title: '解绑骨骼',
        message: `解绑「${bone}」？它在 ${target} 上的顶点权重会被清掉，其余骨骼重新归一化。`,
        onConfirm: run,
      });
      return;
    }
    run();
  }, [runSlotEdit, selectedSlot, settings.deleteConfirmation]);

  const deleteSlotSelection = useCallback(() => {
    if (!assertWritable('deleteSlotSelection')) return;
    const target = selectedSlot;
    if (!target) { setNotice('没有可删除的槽位（先选中一个槽位）'); return; }
    // 官方 Setting.DeleteConfirmation：删除前弹出确认对话框
    if (settings.deleteConfirmation && !window.confirm(`删除槽位 ${target}？`)) return;
    if (!runSlotEdit((player) => removeSlot(player, target))) {
      setNotice('删除槽位失败：槽位不存在。');
      return;
    }
    setSelectedSlot(null);
    flash(`删除槽位 ${target}`);
  }, [runSlotEdit, selectedSlot, settings.deleteConfirmation]);

  /**
   * 官方「创建插槽」（`ScenePanel.newSlotBtn`，`_555/_571.as:1364-1378`）：
   * 在选中骨骼下加一个空插槽。可用性 = 选中骨骼 且 处于骨架装配（同文件 `2495`）。
   */
  const createSlotSelection = useCallback(() => {
    const bone = selectedBone;
    if (!bone) { setNotice('先在场景树中选择一根骨骼，再创建插槽。'); return; }
    if (!requireArmatureMode('创建插槽')) return;
    let created: string | null = null;
    runSlotEdit((player) => { created = addSlot(player, bone, `${bone}_slot`); return created !== null; });
    if (created) {
      setSelectedBone(null);
      setSelectedSlot(created);
      flash(`创建槽位 ${created}（挂点 ${bone}）`);
    }
  }, [runSlotEdit, selectedBone]);

  /**
   * 官方「创建骨骼」（`ScenePanel.newBoneBtn`，`_555/_571.as:1349-1362`）：
   * 在**选中骨骼**下加一根空子骨骼（名字走 `bone` 前缀唯一化；不是交互式绘制）。
   */
  const createBoneSelection = useCallback(() => {
    const bone = selectedBone;
    if (!bone) { setNotice('先在场景树中选择一根骨骼，再创建骨骼。'); return; }
    if (!requireArmatureMode('创建骨骼')) return;
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    const created = addBone(current, { parent: bone, name: 'bone' });
    if (!created) { setNotice('创建骨骼失败：父级骨骼不存在。'); return; }
    current.rebuildSkeleton();
    setSelectedBone(created);
    setSelectedBones(new Set([created]));
    setSelectedSlot(null);
    setModelVersion((value) => value + 1);
    refresh();
    flash(`创建骨骼 ${created}（父级 ${bone}）`);
  }, [flash, pushHistory, refresh, selectedBone]);

  /**
   * 官方场景树标题栏「删除」（`ScenePanel.removeBtn`，可用性见 `_555/_571.as:2495-2515`）：
   * 有骨骼选中就删骨骼、否则删选中的插槽；多选整批删（与舞台右键菜单同口径）。
   */
  const deleteSceneSelection = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    const boneTargets = selectedBones.size > 0 ? [...selectedBones] : (selectedBone ? [selectedBone] : []);
    const slotTargets = selectedSlots.size > 0 ? [...selectedSlots] : (selectedSlot ? [selectedSlot] : []);
    if (boneTargets.length === 0 && slotTargets.length === 0) {
      setNotice('没有可删除的对象（先在场景树中选择骨骼或插槽）');
      return;
    }
    if (boneTargets.length > 0 && !requireArmatureMode('删除骨骼')) return;
    if (settings.deleteConfirmation) {
      const what = boneTargets.length > 0 ? `骨骼 ${boneTargets.join('、')}` : `插槽 ${slotTargets.join('、')}`;
      if (!window.confirm(`删除${what}？`)) return;
    }
    pushHistory();
    let removed = 0;
    if (boneTargets.length > 0) {
      for (const target of boneTargets) if (removeBone(current, target)) removed++;
      if (removed > 0) { current.rebuildSkeleton(); setSelectedBone(null); setSelectedBones(new Set()); }
    } else {
      for (const target of slotTargets) if (removeSlot(current, target)) removed++;
      if (removed > 0) { current.rebuildSkeleton(); setSelectedSlot(null); setSelectedSlots(new Set()); }
    }
    if (removed > 0) {
      setModelVersion((value) => value + 1);
      refresh();
      flash(boneTargets.length > 1 || slotTargets.length > 1 ? `已删除 ${removed} 个对象` : `已删除 ${boneTargets[0] ?? slotTargets[0]}`);
    } else {
      setNotice('删除失败：对象不存在，或骨架至少要保留一根骨骼。');
    }
  }, [flash, pushHistory, refresh, selectedBone, selectedBones, selectedSlot, selectedSlots, settings.deleteConfirmation]);

  const moveSelectedKeys = useCallback((delta: number) => {
    if (!assertWritable('moveSelectedKeys')) return;
    const current = playerRef.current;
    if (!current || keySelection.length === 0 || delta === 0) return;
    const before = keySelection;
    if (runKeyEdit((player) => moveKeys(player, before, delta)) === 0) return;
    // keys that merged into an unselected key are no longer selectable
    // the core op snaps to whole frames; mirror it exactly or the re-derived selection misses
    const shifted = before.map((entry) => ({ ...entry, frame: Math.round(entry.frame + delta) }));
    setKeySelection(shifted.filter((entry) => entryExists(current, entry)));
  }, [entryExists, keySelection, runKeyEdit]);

  const scaleSelectedKeys = useCallback((factor: number) => {
    if (!assertWritable('scaleSelectedKeys')) return;
    const current = playerRef.current;
    if (!current || keySelection.length === 0) return;
    const before = keySelection;
    const anchor = Math.min(...before.map((entry) => entry.frame));
    if (runKeyEdit((player) => scaleKeys(player, before, factor)) === 0) return;
    setKeySelection(before.map((entry) => ({
      ...entry,
      frame: Math.round(anchor + (entry.frame - anchor) * factor),
    })).filter((entry) => entryExists(current, entry)));
  }, [entryExists, keySelection, runKeyEdit]);

  const deleteSelectedKeys = useCallback(() => {
    if (keySelection.length === 0) return 0;
    const removed = runKeyEdit((player) => deleteKeys(player, keySelection));
    if (removed > 0) setKeySelection([]);
    return removed;
  }, [keySelection, runKeyEdit]);

  /** 官方 `MenuItem-distributeToFrames`「分布到关键帧」：首尾不动，中间等间隔铺开。 */
  const distributeSelectedKeys = useCallback(() => {
    if (!assertWritable('distributeSelectedKeys')) return;
    if (keySelection.length < 3) return 0;
    return runKeyEdit((player) => distributeKeys(player, keySelection));
  }, [keySelection, runKeyEdit]);

  const copySelectedKeys = useCallback(() => {
    const current = playerRef.current;
    if (!current || keySelection.length === 0) return;
    const clip = copyKeys(current, keySelection);
    if (!clip) return;
    keyClipboard.current = clip;
    clipKind.current = 'bone';
    setHasKeyClipboard(true);
    flash(`已复制 ${keySelection.length} 个关键帧（跨度 ${clip.span} 帧）`);
  }, [keySelection]);

  const cutSelectedKeys = useCallback(() => {
    copySelectedKeys();
    deleteSelectedKeys();
  }, [copySelectedKeys, deleteSelectedKeys]);

  const pasteCopiedKeys = useCallback(() => {
    const current = playerRef.current;
    const clip = keyClipboard.current;
    if (!current || !clip) return;
    const at = current.position;
    if (runKeyEdit((player) => pasteKeys(player, clip, at)) === 0) return;
    setKeySelection(clip.tracks.flatMap((track) => track.keys.map((key): KeySelectionEntry => ({
      bone: track.bone,
      frame: Math.round((at + key.offset) * 1000) / 1000,
      ...(track.channel ? { channel: track.channel } : {}),
    }))));
    flash(`已粘贴 ${clip.tracks.reduce((sum, track) => sum + track.keys.length, 0)} 个关键帧到第 ${Math.round(at)} 帧`);
  }, [runKeyEdit]);

  /** 轨道键（插槽颜色 / 显示资源 / 事件）的删除 / 复制 / 粘贴：与骨骼键共用撤销栈与刷新。 */
  const deleteTrackSelection = useCallback(() => {
    if (trackSelection.length === 0) return 0;
    const removed = runKeyEdit((player) => deleteTrackKeys(player, trackSelection));
    if (removed > 0) setTrackSelection([]);
    return removed;
  }, [runKeyEdit, trackSelection]);

  const copyTrackSelection = useCallback(() => {
    const current = playerRef.current;
    if (!current || trackSelection.length === 0) return;
    const clip = copyTrackKeys(current, trackSelection);
    if (!clip || clip.items.length === 0) {
      setNotice('选中的轨道键没有可复制的内容（IK 与绘制顺序暂不支持复制）');
      return;
    }
    trackClipboard.current = clip;
    clipKind.current = 'track';
    setHasKeyClipboard(true);
    flash(`已复制 ${clip.items.length} 个轨道键${clip.skipped ? `（${clip.skipped} 个暂不支持复制，已跳过）` : ''}`);
  }, [flash, trackSelection]);

  const pasteTrackClipboard = useCallback(() => {
    const current = playerRef.current;
    const clip = trackClipboard.current;
    if (!current || !clip) return;
    const at = current.position;
    if (runKeyEdit((player) => pasteTrackKeys(player, clip, at)) === 0) return;
    flash(`已粘贴 ${clip.items.length} 个轨道键到第 ${Math.round(at)} 帧`);
  }, [flash, runKeyEdit]);

  /** 统一入口：骨骼键或轨道键谁有选区就处理谁（帧区右键菜单与快捷键共用） */
  const copyAnyKeys = useCallback(() => {
    if (keySelection.length > 0) copySelectedKeys();
    else copyTrackSelection();
  }, [copySelectedKeys, copyTrackSelection, keySelection.length]);
  const deleteAnyKeys = useCallback(() => {
    if (!assertWritable('deleteAnyKeys')) return;
    if (keySelection.length > 0) return deleteSelectedKeys();
    return deleteTrackSelection();
  }, [deleteSelectedKeys, deleteTrackSelection, keySelection.length]);
  const cutAnyKeys = useCallback(() => { copyAnyKeys(); deleteAnyKeys(); }, [copyAnyKeys, deleteAnyKeys]);
  const pasteAnyKeys = useCallback(() => {
    if (!assertWritable('pasteAnyKeys')) return;
    if (clipKind.current === 'track' && trackClipboard.current) pasteTrackClipboard();
    else pasteCopiedKeys();
  }, [pasteCopiedKeys, pasteTrackClipboard]);

  const trackSelect = useCallback((refs: TrackKeyRef[], additive: boolean) => {
    setTrackSelection((current) => (additive ? mergeTrackRefs(current, refs) : refs));
  }, []);
  /**
   * IK 轨道：按约束名定位骨骼。同名骨骼且它正是这条约束的角色 → 用它；否则用约束的链末端骨骼
   * （属性面板的 IK 区块只对链上骨骼 / 目标骨骼开放，选它才有 K 帧入口）。选中走 locateBone，场景树会一起定位。
   */
  const selectIkTrack = useCallback((constraintName: string) => {
    const current = playerRef.current;
    const armature = current?.skeleton.armature;
    const constraint = (armature?.ik ?? []).find((entry) => entry.name === constraintName);
    if (!current || !armature || !constraint) return;
    const named = current.skeleton.boneIndexByName.has(constraintName)
      && ikRoleOf(armature, constraintName)?.constraint.name === constraintName;
    setSelectedTrack(null);
    setSelectedSlot(null);
    locateBone(named ? constraintName : constraint.bone);
  }, [locateBone]);

  /** 点轨道名：插槽行切到插槽面板，IK 行定位到骨骼（官方点树行即选中对象） */
  const selectTrackRow = useCallback((id: string | null) => {
    if (id?.startsWith('ik-')) { selectIkTrack(id.slice('ik-'.length)); return; }
    setSelectedTrack(id);
    if (id?.startsWith('slot-')) setSelectedSlot(id.slice('slot-'.length));
  }, [selectIkTrack]);

  /** 官方 `Menu.Edit.SelectAll`「全选」：把骨架里所有骨骼设为多选。 */
  const selectAllBones = useCallback(() => {
    const current = playerRef.current;
    if (!current) return 0;
    const names = current.skeleton.bones.map((bone) => bone.name);
    if (names.length === 0) return 0;
    setSelectedBones(new Set(names));
    setSelectedBone(names[0]);
    setSelectedSlot(null);
    return names.length;
  }, []);

  /** Shift 点选：切换某根骨骼的多选状态（主选跟着走）。 */
  const toggleBoneSelection = useCallback((name: string) => {
    const next = new Set(selectedBones);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelectedBones(next);
    setSelectedBone(name);
  }, [selectedBones]);

  /** 舞台框选：把矩形内的骨骼批量设为多选。 */
  /** 舞台右键：空白处取消选择；骨骼上先选中它再弹骨骼菜单；图片（插槽）上弹插槽菜单 */
  const handleStageContextMenu = useCallback((info: { x: number; y: number; bone: string | null; slot: string | null }) => {
    if (!assertWritable('handleStageContextMenu')) return;
    if (!info.bone && !info.slot) {
      setStageMenu(null);
      setSelectedBone(null);
      setSelectedBones(new Set());
      setSelectedSlot(null);
      return;
    }
    if (info.slot) {
      setSelectedBone(null);
      setSelectedBones(new Set());
      setSelectedSlot(info.slot);
      setStageMenu(info);
      return;
    }
    const name = info.bone as string;
    setSelectedBone(name);
    setSelectedBones((current) => (current.has(name) ? current : new Set([name])));
    setSelectedSlot(null);
    setStageMenu(info);
  }, []);

  const selectBonesInRect = useCallback((names: string[]) => {
    setSelectedBones(new Set(names));
    setSelectedBone(names[0] ?? null);
    setSelectedSlot(null);
    flash(names.length > 0 ? `框选 ${names.length} 根骨骼` : '已清空选择');
  }, [flash]);

  const selectAllKeys = useCallback(() => {
    const current = playerRef.current;
    if (!current) return 0;
    const all: KeySelectionEntry[] = [];
    for (const timeline of current.animation?.bone ?? []) {
      for (const at of keyPositions(current, timeline.name)) all.push({ bone: timeline.name, frame: at });
    }
    setKeySelection(all);
    return all.length;
  }, [keyPositions]);

  /** 时间轴行上的「眼睛」：与场景树同一套显隐逻辑（多选时一起切）。 */
  const toggleRowVisible = useCallback((name: string) => {
    const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
    const shouldHide = !hiddenBones.has(name);
    setHiddenBones((current) => {
      const next = new Set(current);
      for (const target of targets) {
        if (shouldHide) next.add(target); else next.delete(target);
      }
      return next;
    });
  }, [hiddenBones, selectedBones]);

  /** 时间轴行上的「指针」：锁定 / 解锁（锁定后在舞台上点不中）。 */
  const toggleRowLock = useCallback((name: string) => {
    const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
    const shouldLock = !lockedBones.has(name);
    setLockedBones((current) => {
      const next = new Set(current);
      for (const target of targets) {
        if (shouldLock) next.add(target); else next.delete(target);
      }
      return next;
    });
  }, [lockedBones, selectedBones]);

  /**
   * 骨架行（master）的眼睛 / 指针：与场景树同语义 —— 单击全部显示 / 全部可选，Shift+单击反选；
   * 骨骼与插槽一起切（官方的「骨架行」管下面每一行）。
   */
  const armatureFlag = useCallback((mode: 'all' | 'invert', apply: (flip: (prev: Set<string>) => Set<string>) => void) => {
    const current = playerRef.current;
    const names = [
      ...(current?.skeleton.bones.map((bone) => bone.name) ?? []),
      ...(current?.skeleton.slots.map((slot) => slot.name) ?? []),
    ];
    apply(mode === 'all'
      ? () => new Set<string>()
      : (prev: Set<string>) => new Set(names.filter((name) => !prev.has(name))));
  }, []);

  const armatureVisible = useCallback((mode: 'all' | 'invert') => {
    armatureFlag(mode, (flip) => { setHiddenBones(flip); setHiddenSlots(flip); });
  }, [armatureFlag]);

  const armatureSelectable = useCallback((mode: 'all' | 'invert') => {
    armatureFlag(mode, (flip) => { setLockedBones(flip); setLockedSlots(flip); });
  }, [armatureFlag]);

  /**
   * 时间轴整体左移 / 右移一帧（官方 `Timeline.delFrame` / `addFrame` = Move Left / Move Right）：
   * 在当前帧处**删 / 插一帧** —— 这一帧之后的所有帧整体前移 / 后移 1 帧，动画时长跟着 ∓1；
   * 已选中的关键帧一起挪，选择集不丢（用户 194 轮）。
   */
  const shiftFrames = useCallback((direction: -1 | 1) => {
    if (!assertWritable('shiftFrames')) return;
    const current = playerRef.current;
    if (!current || !current.animation) return;
    if (!requireAnimationMode('插入 / 删除帧')) return;
    pushHistory();
    const at = Math.round(current.position);
    if (direction > 0) insertFrameAt(current, at); else removeFrameAt(current, at);
    setKeySelection((selection) => selection
      .map((entry) => {
        const frame = Math.round(entry.frame);
        const next = direction > 0 ? (frame >= at ? frame + 1 : frame) : (frame > at ? frame - 1 : frame);
        return { ...entry, frame: Math.max(0, next) };
      })
      .filter((entry) => entryExists(current, entry)));
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
    flash(direction > 0
      ? `已在第 ${at} 帧插入一帧：后面的帧整体后移`
      : `已删除第 ${at} 帧：后面的帧整体前移`);
  }, [entryExists, flash, pushHistory, refresh]);

  /**
   * 时间轴上**某一列**的选择：该帧上所有骨骼的关键帧（用户 198 轮 —— 动画行那排菱形点一个就选这一列，
   * 不是整行）。再点同一列取消。
   */
  const selectColumnKeys = useCallback((frame: number) => {
    const current = playerRef.current;
    if (!current || !current.animation) return;
    const at = Math.max(0, Math.round(frame));
    const column: KeySelectionEntry[] = [];
    for (const timeline of current.animation.bone ?? []) {
      if (keyPositions(current, timeline.name).some((value) => Math.abs(value - at) < 1e-3)) {
        column.push({ bone: timeline.name, frame: at });
      }
    }
    const picked = column.length > 0 && keySelection.length === column.length
      && keySelection.every((entry) => Math.abs(Math.round(entry.frame) - at) < 1e-3);
    if (picked) {
      setKeySelection([]);
      flash(`已取消第 ${at} 帧的整列选择`);
      return;
    }
    setKeySelection(column);
    flash(column.length > 0 ? `已选中第 ${at} 帧这一列的 ${column.length} 个关键帧` : `第 ${at} 帧没有关键帧`);
  }, [flash, keyPositions, keySelection]);


  const undo = useCallback(() => {
    // 编辑入口都是「改之前」压快照（pushHistory），所以栈顶是最后一次编辑**之前**的状态。
    // 撤销时若当前数据和栈顶不同，先把当前（编辑之后）的状态补进栈，再退到上一格 ——
    // 否则连着两次编辑后 Ctrl+Z 会一次退两步、Redo 也回不到最新状态。
    const current = playerRef.current;
    const now = snapshotArmature(current);
    let { index, stack } = history.current;
    if (now && index === stack.length - 1 && stack[index] !== now) {
      stack = [...stack, now];
      if (stack.length > 61) stack = stack.slice(stack.length - 61);
      index = stack.length - 1;
      history.current = { stack, index };
    }
    if (index <= 0) return;
    applySnapshot(index - 1);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const { index, stack } = history.current;
    if (index >= stack.length - 1) return;
    applySnapshot(index + 1);
  }, [applySnapshot]);

  const commitTransform = useCallback((patch: Partial<BoneTransformValues>, withHistory = true) => {
    if (!assertWritable('commitTransform')) return;
    const current = playerRef.current;
    const bone = selectedBone;
    if (!current || !bone || !current.animation || current.playing) return;
    // 与舞台拖动同一落点规则（见 `applyPoseEdit`）：当前帧已有关键帧 → 改那一帧；
    // 否则 → 写编辑期临时姿态。原来这里直接传 `insert=false`，于是「当前帧没有该骨骼关键帧时，
    // 属性面板 / 变换栏输入的数值完全没反应」（第 181 轮用户报告：有些骨骼旋转不动、数值也改不了）。
    if (!applyPoseEdit(bone, patch)) return;
    if (withHistory) pushHistory();
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh, selectedBone]);

  /**
   * 舞台拖动开始：决定这一步要不要进撤销栈。
   *
   * 只写**编辑期临时姿态**的拖动（动画模式 + 当前帧没有该骨骼的关键帧）不碰数据，
   * 进栈只会多出一格「按 Ctrl+Z 看不出变化」的空步 —— 所以跳过；真正落帧的拖动照旧入栈。
   */
  const beginStageDrag = useCallback((bone?: string) => {
    if (!assertWritable('beginStageDrag')) return;
    const current = playerRef.current;
    if (bone && current && !current.setupPose && editModeRef.current === 'animation'
      && !keyFrames(current, bone).some((ref) => Math.abs(ref.frame - current.position) < 0.5)) return;
    pushHistory();
  }, [pushHistory]);

  /**
   * 一次骨骼编辑落到哪里 —— 官方 `_416/_418.as:57-85` 的 `autoKey` 两条分支：
   *
   * - 当前帧**已经有关键帧** → 直接改那一帧（`_3403` 更新现有帧）；
   * - 当前帧没有关键帧 → 写**编辑期临时姿态**（`_3402` → `bone._2002`），画面动、关键帧数据不动，
   *   等手动 K / 变换栏旗杆才落帧。
   *
   * 官方 `_639/_12462.as:8` 的 `propertyList` 里 `autoKey` 默认 **false**，所以这就是官方默认口径。
   * 返回 false 表示这一笔没产生任何变化。
   */
  const applyPoseEdit = useCallback((bone: string, patch: Partial<BoneTransformValues>): boolean => {
    const current = playerRef.current;
    if (!current || !current.animation) return false;
    // IK 链内的骨骼：local 会被 IK 求解覆盖（拖动 / 改数值都看不到变化），拒绝写入。
    // 要么改 IK 的「目标」骨骼，要么先删掉这条约束。
    if (ikRoleOf(current.skeleton.armature, bone)?.role === 'chain') return false;
    // 骨架装配编的就是绑定姿态本身（数据），没有「当前帧」可言，也不该有临时姿态。
    if (current.setupPose) return applyBoneTransform(bone, patch, false);
    const onKey = keyFrames(current, bone).some((ref) => Math.abs(ref.frame - current.position) < 0.5);
    const base = effectiveTransform(current, bone, current.position);
    let ok: boolean;
    if (onKey) ok = applyBoneTransform(bone, patch, false);
    else if (autoKeyRef.current) {
      ok = autoKeyEdit(current, bone, base, patch);
      if (ok) current.setPoseOverride(bone, null);
    } else {
      current.setPoseOverride(bone, {
        x: patch.x ?? base.x,
        y: patch.y ?? base.y,
        skX: patch.skX ?? base.skX,
        skY: patch.skY ?? base.skY,
        scX: patch.scX ?? base.scX,
        scY: patch.scY ?? base.scY,
      });
      ok = true;
    }
    if (ok && multiFrameRef.current) applyMultiFrameDelta(current, bone, base, patch, keySelectionRef.current);
    return ok;
  }, []);

  /** 舞台上的骨骼拖动（Z/X/C/V 与选择工具）：走 `applyPoseEdit` 的落点选择。 */
  const commitDrag = useCallback((bone: string, patch: Partial<BoneTransformValues>) => {
    if (!assertWritable('commitDrag')) return;
    const current = playerRef.current;
    if (!current || !current.animation) return;
    // 播放中只放行适应窗口；任何工具拖拽都不写时间轴
    if (current.playing) return;
    if (!applyPoseEdit(bone, patch)) return;
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [applyPoseEdit, refresh]);

  const commitSlotDrag = useCallback((slot: string, patch: Partial<BoneTransformValues>) => {
    if (!assertWritable('commitSlotDrag')) return;
    const current = playerRef.current;
    if (!current || current.playing || editModeRef.current !== 'armature') return;
    if (!setSlotDisplayTransform(current, slot, patch)) return;
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [refresh]);

  /* ---------------- 吸附拼接：参考垫图吸附 / 关节吸附 ---------------- */
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(() => readSnapSettings(window.localStorage));
  const snapSettingsRef = useRef(snapSettings);
  snapSettingsRef.current = snapSettings;
  const patchSnapSettings = useCallback((patch: Partial<SnapSettings>) => {
    setSnapSettings((prev) => { const next = { ...prev, ...patch }; writeSnapSettings(window.localStorage, next); return next; });
  }, []);
  const [snapReference, setSnapReference] = useState<{ name: string; url: string; width: number; height: number; ref: SnapReference } | null>(null);
  const snapReferenceRef = useRef(snapReference);
  snapReferenceRef.current = snapReference;
  const [snapBusy, setSnapBusy] = useState(false);
  const atlasRasterRef = useRef<{ url: string; raster: RasterImage } | null>(null);
  const atlasRaster = useCallback(async (): Promise<RasterImage | null> => {
    if (!atlasUrl) return null;
    if (atlasRasterRef.current?.url === atlasUrl) return atlasRasterRef.current.raster;
    const raster = await rasterFromUrl(atlasUrl);
    if (raster) atlasRasterRef.current = { url: atlasUrl, raster };
    return raster;
  }, [atlasUrl]);
  const loadSnapReference = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    const raster = await rasterFromUrl(url);
    if (!raster) { flash('垫图读不出来'); URL.revokeObjectURL(url); return; }
    setSnapReference((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { name: file.name, url, width: raster.width, height: raster.height, ref: prepareReference(raster) }; });
    // 第一次载入：默认把垫图底边中点放在世界原点（与流水线角色的原点约定一致）
    if (!snapSettingsRef.current.originX && !snapSettingsRef.current.originY) patchSnapSettings({ originX: Math.round(raster.width / 2), originY: raster.height, showReference: true });
    flash(`已载入垫图 ${file.name}（${raster.width}×${raster.height}）`);
  }, [flash, patchSnapSettings]);
  const clearSnapReference = useCallback(() => {
    setSnapReference((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  }, []);
  const refFrame = (): RefFrame => ({ origin: [snapSettingsRef.current.originX, snapSettingsRef.current.originY], scale: snapSettingsRef.current.pxPerUnit || 1 });
  /** 对若干部件做吸附；pushUndo=false 时并入当前这一笔拖动（拖动开始已经入过撤销栈） */
  const runSnap = useCallback(async (slots: string[], opts: { pushUndo: boolean; reference: boolean; joint: boolean }) => {
    const current = playerRef.current;
    if (!current || current.playing || editModeRef.current !== 'armature' || !slots.length) return;
    const page = await atlasRaster();
    if (!page) return;
    const before = opts.pushUndo ? snapshotArmature(current) : null;
    const s = snapSettingsRef.current;
    const ref = snapReferenceRef.current;
    let moved = 0;
    const notes: string[] = [];
    const iou0 = ref && opts.reference ? referenceIoU(current, page, ref.ref, refFrame()) : null;
    for (const name of snapOrder(current.skeleton.armature, slots)) {
      if (opts.reference && ref) {
        const r = snapSlot(current, page, ref.ref, refFrame(), name, { radius: s.radius, strength: s.strength, joints: s.jointSnap });
        if (r.applied) { moved++; current.rebuildSkeleton(); } else if (r.skipped && slots.length === 1) notes.push(r.skipped);
      }
      if (opts.joint) {
        const j = jointCoverSnap(current, page, name, { radius: Math.max(12, s.radius), overlap: 4 });
        if (j.moved) { moved++; current.rebuildSkeleton(); notes.push(`${name} 关节接上`); }
      }
    }
    if (!moved) { if (notes.length) flash(notes.join('；')); return; }
    if (before) pushHistory(before);
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
    const iou1 = ref && opts.reference ? referenceIoU(current, page, ref.ref, refFrame()) : null;
    flash(`吸附 ${moved} 处${iou0 !== null && iou1 !== null ? `，重合度 IoU ${iou0.toFixed(3)} → ${iou1.toFixed(3)}` : ''}${notes.length ? `（${notes.slice(0, 3).join('；')}）` : ''}`);
  }, [atlasRaster, flash, pushHistory, refresh]);
  const onSlotDragEnd = useCallback((slot: string) => {
    const s = snapSettingsRef.current;
    const useRef_ = s.refSnap && !!snapReferenceRef.current;
    if (!useRef_ && !s.jointSnap) return;
    setSnapBusy(true);
    void runSnap([slot], { pushUndo: false, reference: useRef_, joint: s.jointSnap }).finally(() => setSnapBusy(false));
  }, [runSnap]);
  const onBoneDragEnd = useCallback((bone: string) => {
    const current = playerRef.current;
    if (!snapSettingsRef.current.jointSnap || !current || !current.setupPose || editModeRef.current !== 'armature') return;
    const tip = boneTipSnap(current.skeleton.armature, bone, Math.max(6, snapSettingsRef.current.radius / 2));
    if (!tip) return;
    const values = effectiveTransform(current, bone, current.position);
    if (Math.abs(values.x - tip.x) < 1e-3 && Math.abs(values.y - tip.y) < 1e-3) return;
    if (applyPoseEdit(bone, tip)) { current.applyPose(); setModelVersion((value) => value + 1); refresh(); flash(`${bone} 已吸到父骨骼末端`); }
  }, [applyPoseEdit, flash, refresh]);
  const snapSelectedParts = useCallback(() => {
    if (!assertWritable('snapSelected')) return;
    if (!requireArmatureMode('吸附')) return;
    const list = selectedSlots && selectedSlots.size ? [...selectedSlots] : selectedSlot ? [selectedSlot] : [];
    if (!list.length) { flash('先选中要吸附的部件'); return; }
    setSnapBusy(true);
    void runSnap(list, { pushUndo: true, reference: true, joint: snapSettingsRef.current.jointSnap }).finally(() => setSnapBusy(false));
  }, [flash, runSnap, selectedSlot, selectedSlots]);
  const snapAllParts = useCallback(() => {
    if (!assertWritable('snapAll')) return;
    if (!requireArmatureMode('全部吸附')) return;
    const current = playerRef.current;
    if (!current) return;
    setSnapBusy(true);
    void runSnap(current.skeleton.armature.slot.map((x) => x.name), { pushUndo: true, reference: true, joint: false }).finally(() => setSnapBusy(false));
  }, [runSnap]);
  const fitContourParts = useCallback(() => {
    if (!assertWritable('fitContour')) return;
    if (!requireArmatureMode('轮廓贴合')) return;
    const current = playerRef.current;
    const ref = snapReferenceRef.current;
    if (!current || !ref) return;
    const picked = selectedSlots && selectedSlots.size ? [...selectedSlots] : selectedSlot ? [selectedSlot] : current.skeleton.armature.slot.map((x) => x.name);
    setSnapBusy(true);
    void (async () => {
      const page = await atlasRaster();
      if (!page) return;
      const before = snapshotArmature(current);
      const iou0 = referenceIoU(current, page, ref.ref, refFrame());
      let moved = 0;
      for (let it = 0; it < 2; it++) for (const name of picked) {
        const r = fitMeshContour(current, page, ref.ref, refFrame(), name, { maxShift: 12, jointKeep: 22 });
        if (r.vertices) { moved += r.vertices; current.rebuildSkeleton(); }
      }
      if (!moved) { flash('轮廓贴合：没有需要调整的网格边界（只处理网格部件，先建网格）'); return; }
      pushHistory(before);
      current.applyPose();
      setModelVersion((value) => value + 1);
      refresh();
      flash(`轮廓贴合：移动 ${moved} 个顶点，IoU ${iou0.toFixed(3)} → ${referenceIoU(current, page, ref.ref, refFrame()).toFixed(3)}`);
    })().finally(() => setSnapBusy(false));
  }, [atlasRaster, flash, pushHistory, refresh, selectedSlot, selectedSlots]);
  const weldAllJoints = useCallback(() => {
    if (!assertWritable('weldJoints')) return;
    if (!requireArmatureMode('焊接关节')) return;
    const current = playerRef.current;
    if (!current) return;
    const before = snapshotArmature(current);
    const out = weldAllWeights(current.skeleton.armature, { band: 16, lateral: 60 });
    const n = Object.values(out).reduce((a, b) => a + b, 0);
    if (!n) { flash('焊接关节：没有找到跨关节的加权网格（先给关节两侧的部件建网格并自动权重）'); return; }
    pushHistory(before);
    current.rebuildSkeleton();
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`焊接关节：${Object.keys(out).length} 个网格 / ${n} 个顶点改成关节平滑权重`);
  }, [flash, pushHistory, refresh]);

  const commitSlotPose = useCallback((patch: Partial<BoneTransformValues>) => {
    if (!assertWritable('commitSlotPose')) return;
    const current = playerRef.current;
    const slot = selectedSlot;
    if (!current || !slot || current.playing || editModeRef.current !== 'armature') return;
    if (!setSlotDisplayTransform(current, slot, patch)) return;
    pushHistory();
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh, selectedSlot]);

  /** 自动权重（官方 `Property.weight.autoWeight`）：按顶点到骨骼线段的距离重新分配当前网格的权重。 */
  const autoWeightSelection = useCallback(() => {
    if (!requireArmatureMode('自动权重')) return;
    const current = playerRef.current;
    if (!current || !selectedSlot) return;
    const before = snapshotArmature(current);
    const result = autoWeightMesh(current, selectedSlot);
    if (result.vertices === 0) {
      flash(`自动权重：${result.skipped ?? '没有可重算的顶点'}`);
      return;                       // 数据没动，不留空的撤销步
    }
    pushHistory(before);            // 改动已经发生，补的是「改动前」那一格
    setModelVersion((value) => value + 1);
    refresh();
    flash(`自动权重：${result.vertices} 个顶点 / ${result.bones} 根内部骨骼`);
  }, [pushHistory, refresh, selectedSlot]);

  /**
   * 自动生成网格边线（官方 `AutoMesh.title` / `Mesh.tool.autoOutline`）。
   *
   * 链路：图集里裁出该显示对象的区域 → alpha 二值化 + 轮廓追踪（`_654.outline`）→ 按密度重采样
   * → 三角化（`_653._5674`）→ 写回 `vertices/uvs/triangles/edges`。
   * 官方确认框（`AutoMesh.content`）说过会**清空已有点 / 权重 / FFD 关键帧**，这里照做。
   */
  const autoOutlineSelection = useCallback(async (density: number, options: { slot?: string } = {}) => {
    if (!assertWritable('autoOutlineSelection')) return;
    if (!requireArmatureMode('自动生成边线')) return;
    const current = playerRef.current;
    const target = options.slot ?? selectedSlot;
    if (!current || !target || !atlasUrl) return;
    const slot = current.skeleton.slots.find((entry) => entry.name === target);
    const displayIndex = slot?.displayIndex ?? 0;
    const display = current.skeleton.skinSlots.get(target)?.display?.[displayIndex];
    const regionName = display?.path ?? display?.name;
    const region = regionName ? current.atlas?.byName.get(regionName) : undefined;
    if (!display || !region) { flash('自动生成边线：这个显示对象没有可用的图片区域'); return; }
    if (!window.confirm(`自动生成网格边线会删除当前选中图片上所有已添加的网格点，删除所有绑定的骨骼权重，并删除相对应的时间轴关键帧，您确定要开始自动生成网格边线吗？`)) return;

    const image = new Image();
    image.src = atlasUrl;
    try { await image.decode(); } catch { flash('自动生成边线：图集图片读不出来'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = region.width;
    canvas.height = region.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { flash('自动生成边线：拿不到画布上下文'); return; }
    ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    const rgba = ctx.getImageData(0, 0, region.width, region.height).data;
    const alpha = new Uint8Array(region.width * region.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];

    const points = outlineFromAlpha(alpha, region.width, region.height, DENSITY_THRESHOLDS[density - 1] ?? 0.5);
    if (points.length < 3) { flash('自动生成边线：没有从图片里找到轮廓'); return; }
    const built = buildMeshFromOutline(points, region);
    if (built.triangles.length < 3) { flash('自动生成边线：三角化失败'); return; }

    pushHistory();
    display.type = 'mesh';
    display.vertices = built.vertices;
    display.uvs = built.uvs;
    display.triangles = built.triangles;
    display.edges = built.edges;
    display.userEdges = [];
    delete display.weights;
    delete display.bonePose;
    for (const animation of current.skeleton.armature.animation ?? []) {
      animation.ffd = (animation.ffd ?? []).filter((track) => track.slot !== target);
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`自动生成边线：${points.length} 个顶点 / ${built.triangles.length / 3} 个三角形（密度 ${density}）`);
  }, [atlasUrl, flash, pushHistory, refresh, selectedSlot]);

  /**
   * 官方 TOOL_OUTLINE(3) / `OutlineMesh.title`：用户手绘的轮廓（armature 空间）→ slot 局部 → 区域像素
   * → 三角化 → 替换网格。与自动生成边线一样会清空原有点 / 权重 / FFD 关键帧。
   */
  const completeOutline = useCallback((points: Array<{ x: number; y: number }>) => {
    if (!assertWritable('completeOutline')) return;
    if (!requireArmatureMode('重绘网格边线')) return;
    const current = playerRef.current;
    if (!current || !selectedSlot || points.length < 3) return;
    const slot = current.skeleton.slots.find((entry) => entry.name === selectedSlot);
    const displayIndex = slot?.displayIndex ?? 0;
    const display = current.skeleton.skinSlots.get(selectedSlot)?.display?.[displayIndex];
    if (!display) { flash('重绘：这个槽位没有显示对象'); return; }

    // armature 空间 → slot 局部：用 slot 挂点骨骼的当前世界矩阵求逆
    const m = slot && slot.parentBone >= 0 ? current.skeleton.bones[slot.parentBone].world : [1, 0, 0, 1, 0, 0];
    const det = m[0] * m[3] - m[1] * m[2] || 1;
    const local: Array<[number, number]> = points.map((p) => [
      (m[3] * (p.x - m[4]) - m[2] * (p.y - m[5])) / det,
      (m[0] * (p.y - m[5]) - m[1] * (p.x - m[4])) / det,
    ]);

    // 边界框（官方 BoundingBoxPanel.btn.new）：不做三角化，直接把点写进 vertices（本身就是 slot 局部）
    if (display.type === 'boundingBox' || display.type === 3) {
      if (!window.confirm('重绘网格边线会删除当前选中图片上所有已添加的网格点，删除所有绑定的骨骼权重，并删除相对应的时间轴关键帧，您确定要手动重绘网格边线吗？')) return;
      pushHistory();
      writeBoundingBox(current.skeleton.armature, selectedSlot, local.flat());
      current.rebuildSkeleton();
      setModelVersion((value) => value + 1);
      refresh();
      flash(`边界框重新画：${local.length} 个顶点`);
      return;
    }

    // 网格：顶点要落到图片区域内，所以换算成区域像素坐标再交给三角化
    const regionName = display.path ?? display.name;
    const region = regionName ? current.atlas?.byName.get(regionName) : undefined;
    if (!region) { flash('重绘网格边线：这个显示对象没有可用的图片区域'); return; }
    // 网格编辑模式下已在「进入手动绘制边线工具」时弹过同一条确认（官方 `_11688`），不再重复
    if (!meshEditModeRef.current && !window.confirm('重绘网格边线会删除当前选中图片上所有已添加的网格点，删除所有绑定的骨骼权重，并删除相对应的时间轴关键帧，您确定要手动重绘网格边线吗？')) return;

    const pixels: Array<[number, number]> = local.map(([lx, ly]) => [lx + region.width / 2, ly + region.height / 2]);
    const built = buildMeshFromOutline(pixels, region);
    if (built.triangles.length < 3) { flash('重绘网格边线：三角化失败（点太密或共线）'); return; }

    pushHistory();
    display.type = 'mesh';
    display.vertices = built.vertices;
    display.uvs = built.uvs;
    display.triangles = built.triangles;
    display.edges = built.edges;
    display.userEdges = [];
    delete display.weights;
    delete display.bonePose;
    for (const animation of current.skeleton.armature.animation ?? []) {
      animation.ffd = (animation.ffd ?? []).filter((track) => track.slot !== selectedSlot);
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`重绘网格边线：${pixels.length} 个顶点 / ${built.triangles.length / 3} 个三角形`);
  }, [flash, pushHistory, refresh, selectedSlot]);

  /**
   * 官方 `ScenePanel.newBBoxBtn`「创建边界框」（`_555/_571.as:1379-1410`）：
   * 选中骨骼 → 挂在它下面；选中插槽 / 显示对象 → 挂到该插槽的父骨骼下；都没有则提示。
   */
  const createBoundingBoxSelection = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    if (!requireArmatureMode('创建边界框')) return;
    let bone = selectedBone ?? '';
    if (!bone && selectedSlot) {
      const slot = current.skeleton.slots.find((entry) => entry.name === selectedSlot);
      bone = (slot ? current.skeleton.bones[slot.parentBone]?.name : '') ?? '';
    }
    if (!bone) { flash('创建边界框：先选中一根骨骼或一个插槽'); return; }
    let created: string | null = null;
    runSlotEdit((player) => { created = addBoundingBoxSlot(player, bone, 'bbox'); return created !== null; });
    if (created) {
      setSelectedSlot(created);
      setSelectedBone(null);
      flash(`创建边界框 ${created}（挂在 ${bone}）`);
    }
  }, [flash, runSlotEdit, selectedBone, selectedSlot]);

  /** 官方 `BoundingBoxPanel.btn.new`「重新画」：切到重绘工具，闭合后写边界框顶点。 */
  const redrawBoundingBox = useCallback(() => {
    if (!requireArmatureMode('重新画')) return;
    setTool('meshOutline');
    setFocusArea('stage');
    flash('边界框重新画：在舞台上依次点顶点，点回起点闭合');
  }, [flash]);

  /** 官方 `BoundingBoxPanel.btn.create` / `btn.delete`：进入加/删点的舞台拾取模式。 */
  const bboxPickMode = useCallback((mode: 'add' | 'delete' | null) => {
    setBboxMode(mode);
    if (mode) flash(mode === 'add' ? '添加点：点击一条边，会在中点插入' : '删除点：点击一个顶点');
  }, [flash]);

  const onBBoxAddEdge = useCallback((a: number, b: number) => {
    if (!assertWritable('onBBoxAddEdge')) return;
    const current = playerRef.current;
    if (!current || !selectedSlot) return;
    let ok = false;
    runSlotEdit((player) => { ok = addBoundingBoxPointOnEdge(player.skeleton.armature, selectedSlot, a, b); return ok; });
    if (ok) flash('已在边的中点插入一个点');
  }, [flash, runSlotEdit, selectedSlot]);

  const onBBoxDeletePoint = useCallback((index: number) => {
    if (!assertWritable('onBBoxDeletePoint')) return;
    const current = playerRef.current;
    if (!current || !selectedSlot) return;
    let ok = false;
    runSlotEdit((player) => { ok = removeBoundingBoxPoint(player.skeleton.armature, selectedSlot, index); return ok; });
    flash(ok ? '已删除该顶点' : '删除失败：至少保留 3 个顶点');
  }, [flash, runSlotEdit, selectedSlot]);

  /** 插件运行期状态：能力 id（卸载时要摘掉）+ 单文件插件的 blob URL */
  const pluginRuntime = useRef(new Map<string, PluginActivation>());

  const unloadPlugin = useCallback((id: string) => {
    deactivatePlugin(pluginRuntime.current.get(id));
    pluginRuntime.current.delete(id);
  }, []);

  const idFromName = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

  /**
   * 安装插件（官方 `Plugin.pluginButton`「选择插件...」）。
   * `.json` 走清单（新架构：`id` + `name` + `entry|source`），`.js` / `.mjs` 当作单文件插件保存源码。
   */
  const installPluginFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      let manifest: PluginManifest | null;
      if (/\.json$/i.test(file.name)) {
        manifest = parseManifest(JSON.parse(text));
        if (!manifest) { setNotice('插件清单无效：需要 id、name，以及 entry 或 source'); return; }
      } else {
        manifest = parseManifest({ id: idFromName(file.name), name: idFromName(file.name), source: text });
        if (!manifest) { setNotice('插件源码无效：文件是空的'); return; }
      }
      unloadPlugin(manifest.id);
      setPlugins(installPlugin(window.localStorage, manifest));
      flash(`已安装插件「${manifest.name}」`);
    } catch {
      setNotice('插件清单无效：不是合法的 JSON');
    }
  }, [flash, unloadPlugin]);

  const installPluginFromUrl = useCallback((url: string) => {
    const name = idFromName(url.split('/').filter(Boolean).pop() ?? 'plugin');
    const manifest = parseManifest({ id: name, name, entry: url });
    if (!manifest) { setNotice('插件 URL 无效'); return; }
    unloadPlugin(manifest.id);
    setPlugins(installPlugin(window.localStorage, manifest));
    flash(`已安装插件「${manifest.name}」`);
  }, [flash, unloadPlugin]);

  const togglePlugin = useCallback((id: string, enabled: boolean) => {
    if (!enabled) unloadPlugin(id);
    setPlugins(setPluginEnabled(window.localStorage, id, enabled));
    flash(enabled ? `已启用插件「${id}」` : `已禁用插件「${id}」`);
  }, [flash, unloadPlugin]);

  const dropPlugin = useCallback((id: string) => {
    unloadPlugin(id);
    setPlugins(removePlugin(window.localStorage, id));
    flash(`已卸载插件「${id}」`);
  }, [flash, unloadPlugin]);

  /**
   * 运行插件：动态加载模块 → `activate(api)` 注册能力 → 能力 plan → 审阅后 apply。
   * 插件与编辑器同源运行（**不是沙箱**），加载失败如实弹原因，不假装成功。
   */
  const runPlugin = useCallback(async (plugin: PluginManifest) => {
    const current = playerRef.current;
    if (!current) { flash('运行插件：先打开一个工程'); return; }
    registerBuiltinCapabilities();
    let activation = pluginRuntime.current.get(plugin.id);
    if (!activation) {
      try {
        activation = await activatePlugin(plugin, (message) => flash(`插件「${plugin.name}」：${message}`));
      } catch (error) {
        setNotice(`插件「${plugin.name}」加载失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      pluginRuntime.current.set(plugin.id, activation);
    }
    const prompt = plugin.description ?? plugin.name;
    let applied = 0;
    let planned = 0;
    for (const capabilityId of activation.capabilityIds) {
      const commands = await planAiCommands(current, prompt, capabilityId);
      if (commands.length === 0) continue;
      planned += commands.length;
      const before = snapshotArmature(current);
      applied += applyAiCommands(current, commands);
      pushHistory(before);
    }
    if (applied > 0) {
      current.rebuildSkeleton();
      setModelVersion((value) => value + 1);
      refresh();
    }
    flash(applied > 0 ? `插件「${plugin.name}」：应用 ${applied} 条命令` : `插件「${plugin.name}」：规划出 ${planned} 条但没有可应用的命令`);
  }, [flash, pushHistory, refresh]);

  const toggleKey = useCallback((channel?: BoneChannel) => {
    if (!assertWritable('toggleKey')) return;
    const current = playerRef.current;
    const bone = selectedBone;
    if (!current || !bone || !current.animation) return;
    if (!requireAnimationMode('打关键帧')) return;
    pushHistory();
    if (channel) {
      // 只 K 这一个属性：有帧就删这一个通道的帧，没帧就只写这一个通道（官方时间轴每行单独打帧）。
      if (boneChannelKeyAt(current, bone, channel, current.position)) {
        removeBoneChannelKey(current, bone, channel, current.position);
      } else {
        setBoneChannelTransform(current, bone, channel, current.position, effectiveTransform(current, bone, current.position));
      }
      current.setPoseOverride(bone, null);
      current.applyPose();
      setModelVersion((value) => value + 1);
      refresh();
      return;
    }
    const at = keyFrames(current, bone).find((ref) => Math.abs(ref.frame - current.position) < 0.5);
    // 值取「当前显示」的那个（含编辑期临时姿态），所以拖动出来的姿态一点旗杆 / 按 K 就落成关键帧。
    if (at) removeKeyFrame(current, bone, at.frame);
    else applyBoneTransform(bone, effectiveTransform(current, bone, current.position));
    // 已经落进关键帧（或关键帧被删），临时姿态不该再压在上面
    current.setPoseOverride(bone, null);
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh, selectedBone]);

  const resetBone = useCallback(() => {
    if (!assertWritable('resetBone')) return;
    const current = playerRef.current;
    const bone = selectedBone;
    if (!current || !bone || !current.animation) return;
    // IK 链内的骨骼姿态由约束求解决定，重置绑定同样看不到变化
    if (ikRoleOf(current.skeleton.armature, bone)?.role === 'chain') {
      flash('该骨骼在 IK 约束链内：姿态由约束求解决定，重置不会生效');
      return;
    }
    const binding = current.skeleton.armature.bone.find((entry) => entry.name === bone)?.transform ?? {};
    pushHistory();
    applyBoneTransform(bone, {
      x: binding.x ?? 0,
      y: binding.y ?? 0,
      skX: binding.skX ?? 0,
      skY: binding.skY ?? 0,
      scX: binding.scX ?? 1,
      scY: binding.scY ?? 1,
    });
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [flash, pushHistory, refresh, selectedBone]);

  /**
   * 定位播放头。**最小单位是帧**（官方标尺的刻度就是帧号）：所有入口 —— 标尺点击 / 拖动、
   * 帧号输入框、开始 / 结束、上下帧按钮、序列帧面板 —— 都收敛到这一个函数，统一取整，
   * 这样播放头永远停在整数帧上，属性面板 / 变换栏旗杆的命中判断才准（用户 185 轮）。
   */
  const seek = useCallback((frame: number) => {
    const current = playerRef.current;
    if (!current) return;
    current.seek(Math.max(0, Math.round(frame)));
    refresh();
  }, [refresh]);

  const stepFrames = useCallback((delta: number) => {
    const current = playerRef.current;
    if (!current) return;
    current.seek(Math.round(current.position) + Math.round(delta));
    refresh();
  }, [refresh]);

  const jumpKey = useCallback((direction: -1 | 1) => {
    const current = playerRef.current;
    if (!current) return;
    const next = neighbourKeyFrame(current, selectedBone, current.position, direction);
    if (next !== null) {
      current.seek(next);
      refresh();
    }
  }, [refresh, selectedBone]);

  const togglePlay = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    current.toggle();
    refresh();
  }, [refresh]);

  useEffect(() => {
    const current = playerRef.current;
    if (!current) return;
    current.speed = speed;
  }, [speed]);

  useEffect(() => {
    const current = playerRef.current;
    if (!current?.animation) return;
    const animation = current.animation;
    const playTimes = animation.playTimes ?? 0;
    if (loop && playTimes !== 0) animation.playTimes = 0;
    if (!loop && playTimes === 0) animation.playTimes = 1;
  }, [loop, player, tlTab, showTimeline]);

  /* ---------------- derived ---------------- */

  const animations = useMemo(() => player?.animationNames() ?? [], [player, modelVersion]);
  const currentAnimation = player?.currentAnimationName() ?? '';

  /** the keyframe selection belongs to one animation; drop it when the animation changes */
  useEffect(() => {
    setKeySelection([]);
  }, [currentAnimation, player]);
  const duration = player?.duration ?? 0;
  const position = player?.position ?? 0;

  /** 序列帧工程（`armature.type === "sheet"`）的帧数据；不是 sheet 工程时为 null */
  const sheetFrames = useMemo(
    () => readSheetFrames(player?.skeleton.armature ?? null, currentAnimation),
    [player, currentAnimation, modelVersion],
  );

  /** 序列帧的帧操作都要写历史（改顺序 / 删帧时 displayIndex 会一起重映射） */
  const editSheet = useCallback((run: (armature: DbArmatureData) => boolean) => {
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    if (!run(current.skeleton.armature)) return;
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh]);

  /** 官方 `RESET_SHEET_ORDER`：按名字重排整个帧列表（只动 display 数组，不动 displayIndex） */
  const sortSheetFrames = useCallback((asc: boolean) => {
    if (!assertWritable('sortSheetFrames')) return;
    const slot = sheetFrames?.slot;
    if (!slot) return;
    editSheet((armature) => sortFramesByName(armature, slot, asc));
  }, [editSheet, sheetFrames]);

  const removeSheetFrame = useCallback((index: number) => {
    if (!assertWritable('removeSheetFrame')) return;
    const slot = sheetFrames?.slot;
    if (!slot) return;
    editSheet((armature) => removeFrame(armature, slot, index));
  }, [editSheet, sheetFrames]);

  const setSheetFrameRate = useCallback((value: number) => {
    if (!assertWritable('setSheetFrameRate')) return;
    editSheet((armature) => setFrameRate(armature, value));
  }, [editSheet]);

  const setSheetLoop = useCallback((loop: boolean) => {
    editSheet((armature) => applySheetLoop(armature.animation?.[0] ?? null, loop));
  }, [editSheet]);

  const setSheetPlayTimes = useCallback((times: number) => {
    if (!assertWritable('setSheetPlayTimes')) return;
    editSheet((armature) => setPlayTimes(armature.animation?.[0] ?? null, times));
  }, [editSheet]);

  /** 当前帧下标（序列帧的"当前帧"就是播放头所在帧） */
  const sheetIndex = useCallback(() => {
    const total = sheetFrames?.frames.length ?? 0;
    if (total === 0) return 0;
    return Math.max(0, Math.min(total - 1, Math.round(playerRef.current?.position ?? 0)));
  }, [sheetFrames]);

  /** 帧编辑条：位置 / 轴心（官方 `_953/_13221.as`）；`applyAll` 对应官方 `Sheet.apply.all` */
  const patchSheetFrame = useCallback((patch: { x?: number; y?: number; pivotX?: number; pivotY?: number }, applyAll = false) => {
    if (!assertWritable('patchSheetFrame')) return;
    if (!sheetFrames) return;
    const index = sheetIndex();
    editSheet((armature) => {
      const current = readSheetFrames(armature, currentAnimation);
      const frame = current?.frames[index];
      if (!frame) return false;
      let changed = false;
      if (patch.x !== undefined) changed = setFramePosition(frame, 'x', patch.x) || changed;
      if (patch.y !== undefined) changed = setFramePosition(frame, 'y', patch.y) || changed;
      if (patch.pivotX !== undefined || patch.pivotY !== undefined) {
        const values = readFrameValues(frame);
        changed = setFramePivot(frame, patch.pivotX ?? values.pivotX, patch.pivotY ?? values.pivotY) || changed;
      }
      if (applyAll && current) {
        const which = patch.pivotX !== undefined || patch.pivotY !== undefined ? 'pivot' : 'transform';
        changed = applyFrameToAll(current.frames, index, which) > 0 || changed;
      }
      return changed;
    });
  }, [currentAnimation, editSheet, sheetFrames, sheetIndex]);

  /** 水平 / 垂直翻转；官方 tooltip：按住 Shift 翻转所有帧 */
  const flipSheetFrame = useCallback((axis: 'x' | 'y', applyAll: boolean) => {
    if (!assertWritable('flipSheetFrame')) return;
    if (!sheetFrames) return;
    const index = sheetIndex();
    editSheet((armature) => {
      const current = readSheetFrames(armature, currentAnimation);
      const frame = current?.frames[index];
      if (!current || !frame) return false;
      if (applyAll) {
        for (const item of current.frames) flipFrame(item, axis);
        return true;
      }
      return flipFrame(frame, axis);
    });
  }, [currentAnimation, editSheet, sheetFrames, sheetIndex]);

  const applySheetFrameToAll = useCallback(() => {
    if (!assertWritable('applySheetFrameToAll')) return;
    if (!sheetFrames) return;
    const index = sheetIndex();
    editSheet((armature) => {
      const current = readSheetFrames(armature, currentAnimation);
      if (!current) return false;
      return applyFrameToAll(current.frames, index) > 0;
    });
  }, [currentAnimation, editSheet, sheetFrames, sheetIndex]);

  /** 帧编辑条显示用的当前帧变换（官方 `readFrameValues`：位置 / 轴心 / 翻转） */
  const sheetFrameValues = useMemo(
    () => readFrameValues(sheetFrames?.frames[sheetIndex()]),
    [sheetFrames, position, modelVersion, sheetIndex],
  );

  /**
   * 相对模式写轴心：编辑条上的输入框是**官方 UI 值**（-0.5..0.5、0 = 图片中心），
   * 数据里的 `pivot` 是 0..1（`pivotFromUi` 换算，见 `DBPRO-SPEC.md` §51.1）。
   */
  const setSheetPivotUi = useCallback((x: number, y: number) => {
    if (!assertWritable('setSheetPivotUi')) return;
    patchSheetFrame({ pivotX: pivotFromUi(x), pivotY: pivotFromUi(y) });
  }, [patchSheetFrame]);

  /** 绝对模式拖图：历史在按下时记一笔，移动只改锚点的世界位置。 */
  const dragSheetBy = useCallback((dx: number, dy: number) => {
    if (!assertWritable('dragSheetBy')) return;
    const current = playerRef.current;
    if (!current) return;
    const sheet = readSheetFrames(current.skeleton.armature, current.currentAnimationName());
    const index = Math.max(0, Math.min(Math.max(0, (sheet?.frames.length ?? 1) - 1), Math.round(current.position)));
    const frame = sheet?.frames[index];
    if (!sheet || !frame) return;
    const slot = current.skeleton.slots.find((entry) => entry.name === sheet.slot);
    const bone = slot && slot.parentBone >= 0 ? current.skeleton.bones[slot.parentBone]?.world ?? IDENTITY : IDENTITY;
    const world = frameAnchorWorld(bone, frame);
    if (!setFrameAnchorWorld(frame, bone, world.x + dx, world.y + dy)) return;
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [refresh]);

  const addSheetImage = useCallback((armatureName: string, image: string) => {
    const current = playerRef.current;
    if (!current) return;
    const target = current.doc.armatures.find((entry) => entry.name === armatureName);
    if (!target || !isSheetArmature(target)) {
      setLibraryHighlight(image);
      return;
    }
    if (current.skeleton.armature.name !== armatureName) current.setArmature(armatureName);
    let added = -1;
    editSheet((armature) => {
      const index = appendSheetFrame(armature, image);
      if (index === null) return false;
      added = index;
      return true;
    });
    const live = playerRef.current;
    if (added >= 0 && live) {
      live.position = added;
      live.applyPose();
      setModelVersion((value) => value + 1);
      refresh();
    }
  }, [editSheet, refresh]);

  /**
   * §109 资源树把切片拖到舞台。口径照官方 Pro 格式验证（`docs/DBPRO-SPEC.md §109.1`）：
   *   - **序列帧元件**：追加到帧列表尾部（官方 `ADD_SHEET_FRAMES`，忽略鼠标位置）；
   *   - **骨骼元件**：父骨骼固定取**元件的第一根骨骼**（官方 `_50._1779[0]`），新建插槽并挂上图片，
   *     落点 `world` 只用来摆位置：`local = 落点经父骨骼全局矩阵求逆`，`rotation = -父骨骼全局旋转`。
   */
  const dropRegionOnStage = useCallback((name: string, world: { x: number; y: number }) => {
    if (!assertWritable('dropRegionOnStage')) return;
    const current = playerRef.current;
    if (!current || !name) return;
    const armature = current.skeleton.armature;
    // 序列帧元件：同一套尾部追加逻辑（与「+ / 双击切片」共用 `addSheetImage`）
    if (isSheetArmature(armature)) {
      addSheetImage(armature.name, name);
      return;
    }
    const rootBone = armature.bone[0];
    if (!rootBone) { flash('这个工程没有骨骼，无法新建插槽'); return; }
    if (!current.atlas?.byName.has(name)) { flash(`切片 ${name} 不在当前图集里`); return; }

    pushHistory();
    const slotName = addSlot(current, rootBone.name, name);
    if (!slotName) { flash('新建插槽失败'); return; }
    const bone = current.skeleton.bones.find((entry) => entry.name === rootBone.name);
    const toLocal = bone ? invert(bone.world) : IDENTITY;
    const [lx, ly] = apply(toLocal, world.x, world.y);
    const rotation = bone ? -Math.atan2(bone.world[1], bone.world[0]) * 180 / Math.PI : 0;
    const skinSlot = current.skeleton.armature.skin?.[0]?.slot.find((entry) => entry.name === slotName);
    if (skinSlot) {
      skinSlot.display.push({
        name, path: name, type: 'image',
        transform: { x: lx, y: ly, skX: rotation, skY: rotation },
      });
    }
    const slot = slotData(armature, slotName);
    if (slot) slot.displayIndex = 0;      // 新建即显示，留一个空槽位没意义
    current.rebuildSkeleton();
    // 与 `selectSlot` 同口径：新插槽选中，骨骼选择清空（不走 `selectSlot` 的「图片可选」开关闸门）
    setSelectedSlot(slotName);
    setSelectedSlots(new Set([slotName]));
    setSelectedBone(null);
    setSelectedBones(new Set());
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已把「${name}」加到 ${rootBone.name} 下的新插槽 ${slotName}`);
  }, [addSheetImage, flash, pushHistory, refresh]);

  const libraryArmatures = useMemo(
    () => (player?.doc.armatures ?? []).map((arm) => ({ name: arm.name, sheet: isSheetArmature(arm) })),
    [player, modelVersion],
  );
  const atlasLabel = useMemo(() => {
    const path = player?.atlas?.imagePath ?? '';
    if (!path) return null;
    const base = path.split(/[/\\]/).pop() ?? path;
    return base.replace(/\.(png|jpg|jpeg|webp)$/i, '') || base;
  }, [player]);
  const atlasRegionNames = useMemo(
    () => player?.atlas?.regions.map((region) => region.name) ?? [],
    [player, modelVersion],
  );
  /** 资源树悬停预览需要的切片像素矩形（§109） */
  const atlasRegionRects = useMemo(() => {
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const region of player?.atlas?.regions ?? []) {
      out[region.name] = { x: region.x, y: region.y, width: region.width, height: region.height };
    }
    return out;
  }, [player, modelVersion]);
  /** 已被显示对象引用的切片名（官方 `imageUsed.png` 那一档） */
  const usedRegions = useMemo(
    () => new Set(slotDisplayUsage(player?.skeleton.currentSkin()?.slot ?? []).keys()),
    [player, modelVersion],
  );

  /* ------------------------------------------------------------------ 「层级」面板 */

  /** 绑定顺序 = `armature.slot[]` 的槽位名（升序 = 从最下层到最上层）。 */
  const bindNames = useMemo(() => bindOrder(player), [player, modelVersion]);
  /**
   * 当前生效的绘制顺序（名字，升序）。动画制作模式改过序时是那份**临时顺序**；
   * 临时顺序与当前元件的槽位对不上（换过元件 / 换过动画）就作废，退回绑定顺序或时间轴采样。
   */
  const effectiveOrder = useMemo(() => {
    if (orderDraft && orderDraft.length === bindNames.length && bindNames.every((name) => orderDraft.includes(name))) {
      return orderDraft;
    }
    return drawOrder(player);
  }, [orderDraft, bindNames, player, modelVersion, position, editMode]);
  /** 行首位移箭头：相对绑定顺序的前后位移（LIS 挑出没动过的那些）。 */
  const orderMarkMap = useMemo(
    () => orderMarks(bindNames, namesToOrder(bindNames, effectiveOrder)),
    [bindNames, effectiveOrder],
  );
  /** 有未落帧的改动（官方 `_10748` 的第 2 档 —— 旗杆变黄）。 */
  const orderPending = Boolean(orderDraft);
  const orderKeyed = useMemo(() => zOrderKeyed(player, position), [player, position, modelVersion]);
  const orderKeyState = zOrderKeyStatus(orderPending, orderKeyed);
  /** 临时顺序同步进运行时：改完立刻在舞台上可见，不重建骨架、不写盘。 */
  useEffect(() => {
    const current = playerRef.current;
    if (!current) return;
    current.zOrderOverride = orderDraft ? namesToOrder(bindNames, orderDraft) : null;
    setVersion((value) => value + 1);
  }, [orderDraft, bindNames]);

  /**
   * 新的绘制顺序落到当前模式该落的地方：官方 `_558.as:515-536` 的两条分支 ——
   * 骨架装配改**绑定顺序**（写 `armature.slot[]`），动画制作只改**临时顺序**等旗杆落帧。
   */
  const applyDrawOrder = useCallback((name: string, names: string[]) => {
    const current = playerRef.current;
    if (!current) return;
    if (editModeRef.current === 'armature') {
      pushHistory();
      if (!setBindOrder(current, names)) { setNotice('层级：改动没生效（槽位列表异常）'); return; }
      setModelVersion((value) => value + 1);
      refresh();
      flash(`层级：${name} 已改绑定顺序`);
      return;
    }
    setOrderDraft(names);
    flash(`层级：${name} 已改（还没落帧，点旗杆打层级关键帧）`);
  }, [flash, pushHistory, refresh]);

  /** 「层级」面板的上移 / 下移按钮（`delta` = +1 前移、-1 后移）。 */
  const moveDrawOrder = useCallback((name: string, delta: number) => {
    const current = playerRef.current;
    if (!current) return;
    const bind = bindOrder(current);
    const next = moveSlotOrder(bind, namesToOrder(bind, effectiveOrder), name, delta > 0 ? 'forward' : 'backward');
    if (!next) return;
    applyDrawOrder(name, next.map((index) => bind[index]));
  }, [applyDrawOrder, effectiveOrder]);

  /**
   * 旗杆「添加层级关键帧」：把当前顺序写成当前帧的 `ZOrder(1)` 关键帧；顺序没改过且这一帧
   * 已经有键时就删掉（与属性行旗杆同一个 toggle 语义）。
   */
  const toggleOrderKey = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    if (!requireAnimationMode('层级关键帧')) return;
    const keyed = zOrderKeyed(current, current.position);
    pushHistory();
    if (!orderPending && keyed) {
      if (!removeZOrderKeyframe(current, current.position)) { setNotice('层级：这一帧没有关键帧'); return; }
      flash('已删除层级关键帧');
    } else {
      const bind = bindOrder(current);
      if (!setZOrderKeyframe(current, namesToOrder(bind, effectiveOrder))) {
        setNotice('层级：打关键帧失败（没有可以写的顺序）');
        return;
      }
      flash('已打层级关键帧');
    }
    setOrderDraft(null);
    setModelVersion((value) => value + 1);
    refresh();
  }, [effectiveOrder, flash, orderPending, pushHistory, refresh]);

  /** 曲线编辑器：目标关键帧 = 选中的摄影表关键帧，否则是当前播放头下的骨骼关键帧 */
  const curveTarget = useMemo(() => {
    if (keySelection.length > 0) return { bone: keySelection[0].bone, frame: keySelection[0].frame };
    if (selectedBone) return { bone: selectedBone, frame: Math.round(position) };
    return null;
  }, [keySelection, position, selectedBone]);

  const curveState = useMemo(
    () => readKeyCurve(player, curveTarget?.bone ?? null, curveTarget?.frame ?? 0),
    // modelVersion/position are the invalidation signals for in-place timeline edits
    [player, curveTarget, modelVersion, position],
  );

  const applyCurvePreset = useCallback((preset: CurvePresetName) => {
    const current = playerRef.current;
    if (!current || !curveTarget) return;
    if (runKeyEdit((entry) => (applyPreset(entry, curveTarget.bone, curveTarget.frame, preset) ? 1 : 0)) === 0) return;
    flash(`曲线 preset：${preset}`);
  }, [curveTarget, runKeyEdit]);

  const editCurve = useCallback((points: number[]) => {
    const current = playerRef.current;
    if (!current || !curveTarget) return;
    runKeyEdit((entry) => (setKeyCurve(entry, curveTarget.bone, curveTarget.frame, { kind: 'curve', points }) ? 1 : 0));
  }, [curveTarget, runKeyEdit]);

  const copyCurrentCurve = useCallback(() => {
    if (!curveState) return;
    setCurveClipboard(copyCurve(curveState));
    flash('已复制曲线');
  }, [curveState]);

  const pasteCopiedCurve = useCallback(() => {
    const current = playerRef.current;
    if (!current || !curveTarget || !curveClipboard) return;
    if (runKeyEdit((entry) => (pasteCurve(entry, curveTarget.bone, curveTarget.frame, curveClipboard) ? 1 : 0)) === 0) return;
    flash('已粘贴曲线');
  }, [curveClipboard, curveTarget, runKeyEdit]);

  /** 动画面板：添加 / 克隆 / 删除 */
  const createAnimation = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    const name = addAnimation(current, 'new_animation');
    if (!name) return;
    current.setAnimation(name);
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已添加动画 ${name}`);
  }, [pushHistory, refresh]);

  const duplicateAnimation = useCallback(() => {
    const current = playerRef.current;
    if (!current || !currentAnimation) return;
    pushHistory();
    const name = cloneAnimation(current, currentAnimation);
    if (!name) return;
    current.setAnimation(name);
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已克隆动画 ${name}`);
  }, [currentAnimation, pushHistory, refresh]);

  const dropAnimation = useCallback((name: string) => {
    const current = playerRef.current;
    if (!current) return;
    // 真正的删除动作：确认后才跑（`playerRef` 在弹框期间可能被换掉，进函数时重取一次）
    const run = () => {
      const target = playerRef.current;
      if (!target) return;
      pushHistory();
      if (!removeAnimation(target, name)) {
        setNotice('至少保留一个动画');
        return;
      }
      if (currentAnimation === name) {
        const next = animationNames(target)[0];
        if (next) target.setAnimation(next);
      }
      setModelVersion((value) => value + 1);
      refresh();
    };
    // 官方 Setting.DeleteConfirmation：删除前弹确认框（自定义面板，见 ConfirmDialog）
    if (settings.deleteConfirmation) {
      setConfirmAsk({ title: '删除动画', message: `删除动画「${name}」？`, onConfirm: run });
      return;
    }
    run();
  }, [currentAnimation, pushHistory, refresh, settings.deleteConfirmation]);

  /** 动画面板：按住一行拖到新位置，改的是骨架里动画数组的顺序。 */
  const reorderAnimations = useCallback((name: string, toIndex: number) => {
    const current = playerRef.current;
    if (!current) return;
    const list = current.skeleton.armature.animation ?? [];
    const from = list.findIndex((entry) => entry.name === name);
    const to = Math.max(0, Math.min(list.length - 1, toIndex));
    if (from < 0 || from === to) return;
    pushHistory();
    reorderAnimation(current, name, to);
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh]);

  const boneTree = player?.boneTree() ?? [];
  const keyMap = useMemo(() => keyFrameMap(player), [player, position, modelVersion]);
  const rows: BoneRow[] = useMemo(() => boneTree.map((bone) => ({
    name: bone.name,
    depth: bone.depth,
    index: bone.index,
    parent: player?.skeleton.bones[player.skeleton.bones[bone.index].parent]?.name ?? '',
    keys: keyMap.get(bone.name) ?? [],
    channels: boneChannelKeys(player, bone.name),
  })), [boneTree, keyMap, player]);
  /**
   * 时间轴按**选中骨骼**过滤（官方 `Timeline.filter.tooltip`「Filter timeline, show the selected bones
   * only.」；`Timeline.filter.lock`「Prevent timeline items from changing to selected bones」说明默认本来就
   * 跟着选中走）：选中骨骼 → 只留它这一条时间线；取消选中（点空白 / Esc / 选中插槽）→ 恢复全部（用户 188 轮）。
   */
  /**
   * 时间轴上「骨骼之外」的轨道：插槽（颜色 / 显示资源）、IK（权重 / 弯曲）、事件帧、绘制顺序。
   * 官方时间轴就是把这些和骨骼列在同一个列表里（用户 200 轮）。
   */
  const extraTrackRows = useMemo(() => extraTracks(player, Math.round(position)), [player, position, modelVersion]);

  /** 整条动画的关键帧并集（动画行的菱形用）；放在 `keyMap` 之后避免 TDZ。 */
  const animationKeyFrames = useMemo(() => {
    if (!player) return [];
    const frames = new Set<number>();
    for (const timeline of player.animation?.bone ?? []) {
      for (const ref of keyMap.get(timeline.name) ?? []) frames.add(Math.round(ref.frame));
    }
    return [...frames].sort((a, b) => a - b);
  }, [player, keyMap, modelVersion]);

  /** 过滤组「锁定」：锁定那一刻显示的骨骼名单；之后选中别的骨骼，时间轴也不跟着变 */
  const [filterLock, setFilterLock] = useState<Set<string> | null>(null);
  const unlockedRows = useMemo(() => {
    if (!selectedBone || !timelineFilter) return rows;
    // 过滤时保留的是**一整段骨架**：选中骨骼 + 它的所有后代（子骨骼、孙骨骼……），
    // 这样选中一根就能顺着看整条链的关键帧（用户 189 轮）。rows 本身就是骨架父先序遍历，直接筛即可。
    const keep = new Set<string>([selectedBone]);
    for (const row of rows) {
      if (row.parent && keep.has(row.parent)) keep.add(row.name);
    }
    return rows.filter((row) => keep.has(row.name));
  }, [rows, selectedBone, timelineFilter]);
  const timelineRows = useMemo(() => (filterLock ? rows.filter((row) => filterLock.has(row.name)) : unlockedRows), [filterLock, rows, unlockedRows]);
  const filterLockTools = {
    filterLocked: !!filterLock,
    onFilterLock: (value: boolean) => setFilterLock(value ? new Set(unlockedRows.map((row) => row.name)) : null),
    onFilterRefresh: () => setFilterLock(new Set(unlockedRows.map((row) => row.name))),
    onFilterSelect: () => {
      const names = timelineRows.map((row) => row.name);
      if (names.length === 0) return;
      selectBone(names[0]);
      setSelectedBones(new Set(names));
      flash(`已选中时间轴内的 ${names.length} 根骨骼`);
    },
  };
  const values = useMemo(() => readBoneTransform(player, selectedBone), [player, selectedBone, position, modelVersion, keyMap]);
  const slotPose = useMemo(() => (
    editMode === 'armature' && selectedSlot && slotPoseEditable(player, selectedSlot)
      ? readSlotDisplayTransform(player, selectedSlot)
      : null
  ), [editMode, player, selectedSlot, modelVersion]);
  const weightShares = useMemo(() => (
    player && selectedSlot && weightVertex != null
      ? vertexWeightByBone(player.skeleton.armature, selectedSlot, weightVertex)
      : null
  ), [player, selectedSlot, weightVertex, modelVersion]);
  const selectedKeys = useMemo(() => keyFrames(player, selectedBone ?? ''), [player, selectedBone, modelVersion, keyMap]);
  const keyAtFrame = selectedKeys.some((ref) => Math.abs(ref.frame - position) < 0.5);
  /** IK 旗杆的点亮条件：当前帧正好落在选中骨骼所属约束的某个 IK 帧上。 */
  const ikEntry = useMemo(() => (
    player && selectedBone ? ikRoleOf(player.skeleton.armature, selectedBone) : null
  ), [player, selectedBone, modelVersion]);
  /**
   * IK 链内的骨骼姿态由 IK 求解覆盖（实测：改 local 后骨骼与目标位置都不动），
   * 让它可改只会把数据写脏 —— 所以属性面板 / 变换栏的变换输入对它锁死。
   */
  const ikChainLocked = ikEntry?.role === 'chain';
  /**
   * 三通道各自的「当前帧已有关键帧」状态 —— 属性面板 / 变换栏的旗杆按它显示红（已有）/ 白（可以 K）。
   * 官方口径：旗杆只看**这个属性**在当前帧有没有帧，不再是一个布尔管全部。
   */
  const channelKeyed = useMemo(() => {
    if (!player || !selectedBone) return null;
    return {
      translate: boneChannelKeyAt(player, selectedBone, 'translate', position),
      rotate: boneChannelKeyAt(player, selectedBone, 'rotate', position),
      scale: boneChannelKeyAt(player, selectedBone, 'scale', position),
    };
  }, [player, selectedBone, position, modelVersion]);
  const ikKeyed = useMemo(() => {
    if (!player || !ikEntry) return false;
    return ikKeyAt(player.animation, ikEntry.constraint.name, position);
  }, [player, ikEntry, position, modelVersion]);
  /**
   * IK 行的显示值。动画制作里给的是**当前帧的采样值**（与颜色行同一个语义），
   * 否则受控滑动条会被绑定值拉回去 —— 拖动后立刻弹回 100%（实测）。
   * `role` 区分选中的是链内骨骼还是目标骨骼 —— 官方对两者给不同标题、并在选目标时省略「目标」行。
   */
  const ikView = useMemo(() => {
    if (!player || !ikEntry) return null;
    const { constraint, role } = ikEntry;
    const sampled = editMode === 'animation' ? readIkKey(player.animation, constraint.name, position) : null;
    return {
      name: constraint.name,
      target: constraint.target,
      chain: constraint.chain,
      role,
      weight: sampled?.weight ?? constraint.weight ?? 1,
      bendPositive: sampled ? sampled.bendPositive : parseBoolean(constraint.bendPositive, true),
    };
  }, [player, ikEntry, position, modelVersion, editMode]);
  const boneCount = player?.skeleton.bones.length ?? 0;
  const docName = player ? `${player.skeleton.armature.name || 'armature'} · ${currentAnimation || 'static'}` : '未命名文档';

  /** Resolved CSS backdrop: preset, or the document's own canvas colour. */
  const stageBackground = useMemo(() => {
    // 官方 Setting.BGSize：棋盘预设里的格子尺寸跟着偏好设置走
    const withGrid = (css: string) => css.replace(/100px/g, `${settings.backgroundGridSize}px`);
    if (backgroundId !== 'doc') {
      return withGrid(STAGE_BACKGROUNDS.find((entry) => entry.id === backgroundId)?.css ?? STAGE_BACKGROUNDS[0].css);
    }
    const canvas = (player?.skeleton.armature as { canvas?: { hasBackground?: boolean; color?: number } } | undefined)?.canvas;
    const color = typeof canvas?.color === 'number' && canvas.color >= 0 ? canvas.color : 0x808080;
    return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  }, [backgroundId, player, settings.backgroundGridSize]);
  /** P-18：导入资源（官方 `Menu.File.ImportAssets` / `ImportAssetsToLib`）—— 目标舞台还是资源库 */
  const assetInputRef = useRef<HTMLInputElement>(null);
  const assetTargetRef = useRef<'stage' | 'library'>('library');

  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);

  const openAssetDialog = useCallback((target: 'stage' | 'library') => {
    assetTargetRef.current = target;
    assetInputRef.current?.click();
  }, []);

  /**
   * 把选中的 PNG 并进图集：重打包（旧切片像素照搬）→ 换掉 Player 的图集与图片 URL。
   * 目标是「舞台」时再建一个槽位显示它。
   */
  const importAssetFiles = useCallback(async (files: FileList | null) => {
    if (!assertWritable('importAssetFiles')) return;
    const current = playerRef.current;
    const file = files?.[0];
    if (!current || !file) return;
    try {
      const target = assetTargetRef.current;
      const incoming = await decodePngInBrowser(new Uint8Array(await file.arrayBuffer()));
      let atlas = current.atlas;
      let baseRaster = null;
      if (atlas && atlasUrl) {
        baseRaster = await decodePngInBrowser(new Uint8Array(await (await fetch(atlasUrl)).arrayBuffer()));
      } else {
        atlas = null;
      }
      const result = importImageIntoAtlas({ atlas, baseRaster, raster: incoming, name: file.name });
      pushHistory();
      current.atlases[0] = result.atlas;
      setTextureData(result.json);
      const pngBlob = await encodePngInBrowser(result.page);
      setAtlasUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(pngBlob);
      });
      if (target === 'stage') {
        const bone = current.skeleton.bones[0]?.name ?? 'root';
        const slotName = addSlot(current, bone, result.name);
        if (slotName) {
          const armature = current.skeleton.armature;
          const slotData = armature.skin?.[0]?.slot.find((entry) => entry.name === slotName);
          slotData?.display.push({ name: result.name, path: result.name, type: 'image' });
          const slot = armature.slot.find((entry) => entry.name === slotName);
          if (slot) slot.displayIndex = 0;                 // 立刻显示，而不是空槽位
          current.rebuildSkeleton();
        }
        flash(`已导入「${result.name}」到舞台（新建槽位 ${slotName ?? '-'}）`);
      } else {
        current.rebuildSkeleton();
        flash(`已导入「${result.name}」到资源库（图集切片 ${result.atlas.regions.length} 个）`);
      }
      setModelVersion((value) => value + 1);
      refresh();
    } catch (error) {
      setNotice(`导入资源失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [atlasUrl, flash, pushHistory, refresh]);


  /**
   * 「文件 → 导出...」：按官方命名约定生成文件清单，再统一下载 / 写入所选文件夹 / 打成 zip。
   * DragonBones：`<名>_ske.json|dbbin` + `<名>_tex.json` + `<名>_tex.png`（P-16 目录约定）；
   * Spine（P-06，官方工具链 `toSpine` 的等价物，版本串 3.6.52）：`<名>.json` + `<名>.atlas` + `<名>.png`。
   */
  const runExport = useCallback(async (request: ExportRequest): Promise<boolean> => {
    if (!assertWritable('runExport')) return false;
    const current = playerRef.current;
    if (!current) return false;
    const { name, type } = request;
    const atlas = current.atlas;
    const files: Array<{ name: string; blob: Blob }> = [];
    const json = (text: string) => new Blob([text], { type: 'application/json' });
    try {
      const png = request.texture && atlasUrl ? await fetch(atlasUrl).then((response) => response.blob()) : null;
      if (type === 'spine' && (request.version ?? '4.2') !== '3.6.52') {
        // Spine 4.2 / 4.1：新写出器（skins 数组、bezier 曲线、加权网格、libGDX 新格式 .atlas）
        const doc = JSON.parse(serializeSkeletonData(current.doc));
        let tex = textureData ? { ...textureData, imagePath: `${name}.png` } : null;
        if (tex && png && !(tex.width && tex.height)) {
          const bitmap = await createImageBitmap(png);
          tex = { ...tex, width: bitmap.width, height: bitmap.height };
        }
        const result = exportSpine4(doc, {
          armature: current.skeleton.armature.name, version: request.version === '4.1' ? '4.1' : '4.2', texture: tex, images: './',
        });
        if (request.data) files.push({ name: `${name}.json`, blob: json(JSON.stringify(result.json)) });
        if (png && tex) {
          files.push({ name: `${name}.atlas`, blob: new Blob([result.atlas], { type: 'text/plain' }) });
          files.push({ name: `${name}.png`, blob: png });
        }
      } else if (type === 'spine') {
        if (request.data) {
          const armature = current.skeleton.armature;
          const spine = serializeSpineSkeleton({ armature: [armature] } as never, {
            regionOf: (path) => {
              const region = atlas?.byName.get(path) ?? atlas?.regions.find((entry) => entry.name === path);
              return region ? { width: region.width, height: region.height } : null;
            },
          });
          files.push({ name: `${name}.json`, blob: json(JSON.stringify(spine.spines[0])) });
        }
        if (png && atlas) {
          // `*_tex.json` 的 width/height 可缺省（解析为 0），`.atlas` 的 size 行要用图片真实尺寸
          const bitmap = atlas.width > 0 && atlas.height > 0 ? null : await createImageBitmap(png);
          const packed = {
            width: bitmap?.width ?? atlas.width,
            height: bitmap?.height ?? atlas.height,
            placements: atlas.regions.map((region) => ({
              name: region.name, x: region.x, y: region.y, width: region.width, height: region.height,
              frameWidth: region.frameWidth, frameHeight: region.frameHeight, frameX: region.frameX, frameY: region.frameY,
            })),
          };
          files.push({ name: `${name}.atlas`, blob: new Blob([serializeSpineAtlas(packed, `${name}.png`)], { type: 'text/plain' }) });
          files.push({ name: `${name}.png`, blob: png });
        }
      } else {
        if (request.data) {
          const text = serializeSkeletonData(current.doc);
          if (type === 'dbbin') {
            const bytes = encodeDbbin(JSON.parse(text));
            files.push({ name: `${name}_ske.dbbin`, blob: new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }) });
          } else {
            files.push({ name: `${name}_ske.json`, blob: json(text) });
          }
        }
        if (png) {
          const tex = textureData ? { ...textureData, imagePath: `${name}_tex.png` } : null;
          if (tex) files.push({ name: `${name}_tex.json`, blob: json(JSON.stringify(tex, null, 1)) });
          files.push({ name: `${name}_tex.png`, blob: png });
        }
      }
    } catch (error) {
      setNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (files.length === 0) {
      setNotice('导出失败：没有可生成的文件');
      return false;
    }
    let output = files;
    if (request.zip) {
      const entries = await Promise.all(files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) })));
      output = [{ name: `${name}.zip`, blob: new Blob([buildZip(entries) as unknown as BlobPart], { type: 'application/zip' }) }];
    }
    if (request.toDirectory) {
      const pick = directoryPicker();
      if (!pick) {
        setNotice('当前浏览器不支持选择导出目录（需要 Chrome 的 File System Access API）；请改用「浏览器下载」。');
        return false;
      }
      try {
        const dir = await pick();
        for (const file of output) await writeDirectoryFile(dir, file.name, file.blob);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return false;   // 用户取消
        setNotice(`导出到目录失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    } else {
      for (const file of output) downloadBlob(file.blob, file.name);
    }
    flash(`已导出：${output.map((file) => file.name).join(' / ')}`);
    return true;
  }, [atlasUrl, flash, textureData]);

  /**
   * 保存 .dbproj。官方程序写 AMF3，但它的解码器同样接受 JSON 分支，所以本工程写出
   * JSON 形态（可回读、可被 DragonBones 打开）；打开过的工程会原样保留 stage /
   * library / timeline 外壳，只替换里面的 skeleton。
   */
  const saveProject = useCallback((asNew = false) => {
    if (!assertWritable('saveProject')) return;
    const current = playerRef.current;
    if (!current) {
      setNotice('保存失败：当前没有打开的工程');
      return;
    }
    // 工作区工程（基于 AI 工程新建 / 普通新建 / 打开的项目）：Ctrl+S 写回 projects/<name>/，不下载
    const workspace = workspaceRef.current;
    if (workspace && !asNew) {
      void (async () => {
        try {
          const skeleton = JSON.parse(serializeSkeletonData(current.doc)) as Record<string, unknown>;
          const saved = await postWorkspaceSave(workspace, skeleton, textureData, atlasUrl, true);
          if (!saved.ok) { noticeSaveFailure(saved); return; }
          flash(`已保存到项目 ${workspace}`);
        } catch (error) {
          setNotice(`保存到项目失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      return;
    }
    try {
      const doc = JSON.parse(serializeSkeletonData(current.doc)) as Record<string, unknown>;
      const existing = projectRef.current;
      const project = existing && !asNew
        ? { ...existing, dragonBones: { ...doc, armature: doc.armature } }
        : (wrapSkeletonAsProject(doc) as unknown as Record<string, unknown>);
      const bytes = serializeDbproj(project, true);
      const armatures = (doc.armature ?? []) as Array<{ name?: string }>;
      const base = (asNew ? '' : projectNameRef.current) || armatures[0]?.name || 'project';
      downloadBinary(bytes, `${base}.dbproj`);
      projectRef.current = project;
      if (!asNew) projectNameRef.current = base;
      flash(`已保存 ${base}.dbproj（${Math.max(1, Math.round(bytes.length / 1024))} KB，JSON 形态；DragonBones 可直接打开）`);
    } catch (error) {
      setNotice(`保存 .dbproj 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [flash, noticeSaveFailure, postWorkspaceSave, textureData, atlasUrl]);
  /** P-16「项目另存为...」：工作区工程另建一个新项目；普通文档改名后下载（与官方一致）。 */
  const saveProjectAs = useCallback(() => {
    const current = playerRef.current;
    if (!current) {
      setNotice('另存为失败：当前没有打开的工程');
      return;
    }
    const workspace = workspaceRef.current;
    const suggested = workspace || projectNameRef.current || current.skeleton.armature.name || 'project';
    const input = window.prompt(workspace ? '另存为新项目（工程名，保存到 projects/）' : '项目另存为（文件名，不含扩展名）', suggested);
    if (!input || !input.trim()) return;               // 取消或空名 = 不动作
    const name = input.trim();
    if (workspace) {
      void (async () => {
        try {
          const skeleton = JSON.parse(serializeSkeletonData(current.doc)) as Record<string, unknown>;
          const saved = await postWorkspaceSave(name, skeleton, textureData, atlasUrl, false);
          if (!saved.ok) { noticeSaveFailure(saved); return; }
          workspaceRef.current = name;
          projectNameRef.current = name;
          setDocuments((prev) => prev.map((doc) => (doc.id === activeDocId ? { ...doc, workspaceName: name, projectName: name, name } : doc)));
          await refreshAiProjects();
          setRecents(pushRecent(window.localStorage, { kind: 'workspace', name }));
          flash(`已另存为项目 ${name}`);
        } catch (error) {
          setNotice(`另存为项目失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      return;
    }
    projectNameRef.current = name;
    saveProject(false);
  }, [activeDocId, flash, noticeSaveFailure, postWorkspaceSave, refreshAiProjects, saveProject, textureData, atlasUrl]);

  /**
   * 新建工程。骨架结构与官方「新建后保存」的 `.dbproj` 逐字段一致
   * （`tests/newProject.test.ts` 对官方产物做 deep equal），所以新建出来的工程
   * 与官方新建的工程在数据上等价。
   */
  /** 打开「新建工程」弹窗 —— 用户要求先选工程类型，再建工程 */
  const toggleStageFilterKey = useCallback((key: keyof StageFilter) => {
    setStageFilter((prev) => {
      const next = toggleStageFilter(prev, key);
      writeStageFilter(window.localStorage, next);
      return next;
    });
  }, []);

  /**
   * 骨骼变换的统一入口（写当前帧关键帧）。
   *
   * 舞台过滤器把「子骨骼可控」关掉时（官方 `_1844._2969` 取假），先把直属子骨骼的世界矩阵钉住：
   * 改完父级后按 `inverse(newParentWorld) × oldChildWorld` 反算，并把结果写回**同一帧**。
   */
  // 开关通过 ref 读取：`commitTransform` / `commitDrag` 等 7 个回调的依赖数组里没有它，
  // 若直接闭包捕获 stageFilter，关掉开关后它们还会用旧值（e2e 实测踩到）。
  const stageFilterRef = useRef(stageFilter);
  stageFilterRef.current = stageFilter;
  const selectSlot = useCallback((name: string) => {
    if (!stageFilterRef.current.imageSelectable) return;
    setSelectedTrack(null);
    setSelectedSlot(name);
    setSelectedSlots(new Set([name]));
    setSelectedBone(null);
    setSelectedBones(new Set());
  }, []);

  const applyBoneTransform = useCallback((name: string, patch: Partial<BoneTransformValues>, insert = true) => {
    const current = playerRef.current;
    if (!current || !current.animation) return false;
    const snapshot = shouldFreezeChildren(stageFilterRef.current.boneInherit) ? snapshotChildWorlds(current, name) : [];
    // 「子图片可控」关掉时，挂在这根骨骼下的图片要保持原世界位置（官方 `_1844._2968`）
    const slotSnapshot = shouldFreezeChildren(stageFilterRef.current.imageInherit) ? snapshotSlotWorlds(current, name) : [];
    const ok = setBoneTransform(current, name, current.position, patch, insert);
    if (!ok) return false;
    if (snapshot.length > 0 || slotSnapshot.length > 0) {
      current.rebuildSkeleton();
      for (const child of childLocalValues(current, snapshot)) {
        setBoneTransform(current, child.name, current.position, child.values, insert);
      }
      if (snapshot.length > 0) current.rebuildSkeleton();
      // 补偿矩阵要用「改后」的骨骼世界矩阵算，所以放在最后一次 rebuild 之后
      for (const entry of displayOverridesFor(current, slotSnapshot)) {
        current.skeleton.setDisplayOverride(entry.slot, entry.matrix);
      }
    }
    // 运行时 `skeleton.bones[].world` 只有 update/rebuild 后才是新的：
    // 舞台覆盖层（骨骼拨杆等）在 React 渲染期读它，不 update 就会停留在旧位置。
    if (ok) current.applyPose();
    return ok;
  }, []);

  /** P-10 新建元件（官方 `NewSymbolWindow`）：加一个空元件并切过去。 */
  const createSymbol = useCallback((kind: SymbolKind, name: string) => {
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    const created = addArmature(current.doc, kind, name);
    current.setArmature(created);
    setShowNewSymbol(false);
    setSelectedBone(null);
    setSelectedSlot(null);
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已新建元件「${created}」（${kind === 'sheet' ? '序列帧' : '骨架'}）`);
  }, [flash, pushHistory, refresh]);

  /**
   * P-17 导入数据到项目（官方 `Menu.File.Import`「导入数据到项目...」）：
   * 读一份外部骨架（`*_ske.json` 或 `*_ske.dbbin`），把它的元件并进来（重名加后缀），并切到第一个。
   */
  const importDataIntoProject = useCallback(async (files: FileList | null) => {
    if (!assertWritable('importDataIntoProject')) return;
    const current = playerRef.current;
    const file = files?.[0];
    if (!current || !file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = /\.dbbin$/i.test(file.name)
        ? decodeDbbin(bytes).json
        : JSON.parse(new TextDecoder().decode(bytes));
      pushHistory();
      const added = mergeSkeletonDoc(current.doc, parsed);
      if (added.length === 0) {
        setNotice('导入数据到项目：这份文件里没有元件');
        return;
      }
      current.setArmature(added[0]);
      setSelectedBone(null);
      setSelectedSlot(null);
      setModelVersion((value) => value + 1);
      refresh();
      flash(`已导入 ${added.length} 个元件：${added.slice(0, 3).join('、')}${added.length > 3 ? '…' : ''}`);
    } catch (error) {
      setNotice(`导入数据到项目失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [flash, pushHistory, refresh]);

  const openNewProject = useCallback(() => { if (assertWritable('openNewProject')) setShowNewProject(true); }, []);

  /**
   * 按类型建工程：骨骼模板逐字段对齐官方空工程（`tests/newProject.test.ts` 对拍），
   * 序列帧模板见 `emptySheetSkeleton`（`armature.type = "sheet"` + 空的帧槽位）。
   */
  const createProject = useCallback((kind: NewProjectKind) => {
    const sheet = kind === 'sheet';
    const skeleton = sheet ? emptySheetSkeleton() : emptySkeleton();
    const hint = sheet
      ? '已新建序列帧工程：底部「序列帧」面板可排帧'
      : '已新建工程：1 根 root 骨骼，可直接创建骨骼 / 插槽';
    setShowNewProject(false);
    // 新建即保存到项目（同名自动 NewProject-2、-3…）；失败仍打开内存工程，用另存为导出
    void (async () => {
      const name = uniqueProjectName('NewProject', aiProjects ?? []);
      const saved = await postWorkspaceSave(name, skeleton, null, null, false);
      projectRef.current = null;
      const next: PendingLoad = {
        skeleton,
        projectName: saved.ok ? name : 'NewProject',
        sampleDir: saved.ok ? name : undefined,
        dirSource: saved.ok ? 'ai' : undefined,
        workspaceName: saved.ok ? name : undefined,
      };
      pending.current = next;
      buildPlayer(next);
      if (!saved.ok) {
        flash(`${hint}；未能保存到项目：${workspaceSaveReason(saved)}`);
        return;
      }
      await refreshAiProjects();
      setRecents(pushRecent(window.localStorage, { kind: 'workspace', name }));
      flash(`${hint}；已保存到项目 ${name}`);
    })();
  }, [aiProjects, buildPlayer, flash, postWorkspaceSave, refreshAiProjects]);

  /** P-12：改骨骼显示长度（官方属性面板的「长度」）。 */
  const changeBoneLength = useCallback((value: number) => {
    if (!assertWritable('changeBoneLength')) return;
    const current = playerRef.current;
    if (!current || !selectedBone || current.playing) return;
    pushHistory();
    if (!setBoneLength(current.skeleton.armature, selectedBone, value)) {
      flash('长度无效：必须是非负数');
      return;
    }
    // length 不参与世界矩阵，但 IK 与骨骼 overlay 读的是构造时的快照
    current.rebuildSkeleton();
    refresh();
  }, [flash, pushHistory, refresh, selectedBone]);

  /** M-12：FFD 模式下拖动网格顶点写的是当前帧的变形关键帧。 */
  const moveFfdVertex = useCallback((slot: string, vertex: number, dx: number, dy: number) => {
    if (!assertWritable('moveFfdVertex')) return;
    const current = playerRef.current;
    if (!current || !current.animation) {
      flash('FFD 需要先选中一个动画');
      return;
    }
    const mesh = findMesh(current.skeleton.armature, slot);
    if (!mesh) return;
    if (!setFfdVertex(current.animation, slot, current.position, vertex, dx, dy, meshVertexCount(mesh))) return;
    refresh();
  }, [flash, refresh]);

  /** S-09：在选中骨骼的末端生成约束目标并建立 IK（官方 Property.ik.endPick）。 */
  const addIk = useCallback((chain = 1) => {
    const current = playerRef.current;
    if (!current || !selectedBone) {
      flash('先选中一根骨骼，再添加 IK 约束');
      return;
    }
    if (!requireArmatureMode('在骨骼末端生成约束目标')) return;
    pushHistory();
    const made = addIkConstraintWithTarget(current.skeleton, selectedBone, chain);
    if ('error' in made) {
      flash('无法创建 IK 约束：' + made.error);
      return;
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已创建 IK 约束 ${made.name}：骨骼 ${selectedBone} → 目标 ${made.target}`);
  }, [flash, pushHistory, refresh, selectedBone]);

  /**
   * 改 IK 约束的值（官方 Property.ik.weight / bendDirection）。
   *
   * 模式语义与颜色行一致（`changeSlotColor`）：动画制作里改的写当前帧的 IK 时间轴
   * （`animation.ik[]`，官方 `IKConstraint(30)`）；骨架装配里改的是绑定数据（`armature.ik[]`）。
   * `withHistory = false` 表示这是拖动过程中的连续改动，撤销点在 `beginIk` 里记。
   */
  const patchIk = useCallback((
    patch: { weight?: number; bendPositive?: boolean }, withHistory = true,
  ) => {
    const current = playerRef.current;
    if (!current || !selectedBone) return;
    const constraint = ikRoleOf(current.skeleton.armature, selectedBone)?.constraint;
    if (!constraint) return;
    if (withHistory) pushHistory();
    if (editModeRef.current === 'animation' && current.animation) {
      const base = ikBindValues(constraint);
      const sampled = readIkKey(current.animation, constraint.name, current.position) ?? base;
      if (!setIkKeyframe(current.animation, constraint.name, current.position, { ...sampled, ...patch })) return;
    } else if (!setIkConstraint(current.skeleton.armature, constraint.name, patch)) {
      flash('IK 约束更新未通过校验');
      return;
    }
    // memo（ikView / ikKeyed）按 modelVersion 失效：绑定数据被改也要刷新面板与旗杆
    setModelVersion((value) => value + 1);
    current.rebuildSkeleton();
    refresh();
  }, [flash, pushHistory, refresh, selectedBone]);

  /** 拖 IK 权重进度条之前先记一笔撤销（拖动中的 onChange 不再各记一次）。 */
  const beginIk = useCallback(() => { pushHistory(); }, [pushHistory]);

  /** 旗杆：当前帧有 IK 键就删掉，没有就按采样值打一帧（与颜色 / FFD 旗杆同语义）。 */
  const toggleIkKey = useCallback(() => {
    const current = playerRef.current;
    if (!selectedBone || !requireAnimationMode('打 IK 关键帧')) return;
    if (!current?.animation || current.playing) return;
    const constraint = ikRoleOf(current.skeleton.armature, selectedBone)?.constraint;
    if (!constraint) return;
    pushHistory();
    const at = current.position;
    const base = ikBindValues(constraint);
    const changed = ikKeyAt(current.animation, constraint.name, at)
      ? removeIkKeyframe(current.animation, constraint.name, at)
      : setIkKeyframe(
        current.animation, constraint.name, at,
        readIkKey(current.animation, constraint.name, at) ?? base,
      );
    if (!changed) return;
    setModelVersion((value) => value + 1);
    refresh();
    flash(ikKeyAt(current.animation, constraint.name, at)
      ? `已打 IK 关键帧（${constraint.name}）`
      : `已删除 IK 关键帧（${constraint.name}）`);
  }, [flash, pushHistory, refresh, selectedBone]);

  /**
   * 「设置约束目标」（官方 `Property.ik.pick`，英文串是 "Create IK by Pick"）：
   *  - 选中骨骼**已有**约束 → 把舞台上点中的骨骼设为这条约束的目标；
   *  - 选中骨骼**还没有**约束 → 就用点中的骨骼当目标，直接建一条约束（这才是它作为创建入口的语义）。
   */
  const pickIkTarget = useCallback((boneName: string) => {
    if (!assertWritable('pickIkTarget')) return;
    const current = playerRef.current;
    setIkTargetPick(false);
    if (!current || !selectedBone) return;
    const armature = current.skeleton.armature;
    const existing = ikRoleOf(armature, selectedBone)?.constraint ?? null;
    if (!existing) {
      if (!requireArmatureMode('设置约束目标')) return;
      const check = validateIkConstraint(armature, { bone: selectedBone, target: boneName, chain: 0 });
      if (!check.ok) { flash(`不能设为约束目标：${check.reason}`); return; }
      pushHistory();
      const name = addIkConstraint(armature, { bone: selectedBone, target: boneName, chain: 0 });
      if (!name) { flash('IK 约束创建未通过校验'); return; }
      current.rebuildSkeleton();
      setModelVersion((value) => value + 1);
      refresh();
      flash(`已创建 IK 约束 ${name}：骨骼 ${selectedBone} → 目标 ${boneName}`);
      return;
    }
    const check = validateIkConstraint(armature, {
      bone: existing.bone, target: boneName, chain: existing.chain ?? 0,
    }, existing.name);
    if (!check.ok) { flash(`不能设为约束目标：${check.reason}`); return; }
    pushHistory();
    if (!setIkConstraint(armature, existing.name, { target: boneName })) {
      flash('IK 约束更新未通过校验');
      return;
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash(`已把 ${existing.name} 的目标设为 ${boneName}`);
  }, [flash, pushHistory, refresh, selectedBone]);

  /** 删除一条 IK 约束。 */
  const dropIk = useCallback((name: string) => {
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    if (!removeIkConstraint(current.skeleton.armature, name)) {
      flash('删除 IK 约束失败：' + name + ' 不存在');
      return;
    }
    current.rebuildSkeleton();
    setModelVersion((value) => value + 1);
    refresh();
    flash('已删除 IK 约束 ' + name);
  }, [flash, pushHistory, refresh]);

  const exportProject = useCallback(async () => {
    if (!assertWritable('exportProject')) return;
    const current = playerRef.current;
    if (!current) return;
    const imagePath = textureData?.imagePath ?? current.atlas?.imagePath ?? 'atlas.png';
    const images: Record<string, string> = {};
    if (atlasUrl) {
      const dataUrl = await blobToDataUrl(atlasUrl);
      if (dataUrl) images[imagePath] = dataUrl;
    }
    downloadJson({
      format: 'bone-studio-project',
      formatVersion: 1,
      skeleton: current.doc.raw,
      textures: textureData ? [textureData] : [],
      images,
    }, `${current.skeleton.armature.name || 'project'}.bonestudio.json`);
    flash('已导出 BoneStudio 工程文件（含骨架、图集与贴图）');
  }, [atlasUrl, textureData]);

  const shortcuts = [
    '工程   Ctrl+N 新建 · Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+E 导出 · F12 首选项 · 关闭项目走「文件」菜单或页签的 ×',
    '舞台   Ctrl+Tab 搭建/动画模式 · Ctrl+Z/Y 撤销重做 · Ctrl+A 全选 · ESC 取消选择 · H 拖动舞台',
    '       Ctrl+X/C/V 剪切复制粘贴 · Ctrl+D 副本 · Delete 删除 · 方向键移动（Shift 快 / Ctrl 细）',
    '       = / - 前后层级 · Ctrl+= / Ctrl+- 置顶置底 · Ctrl+1..0 存组 · 1..0 选组',
    '       P 设置父级 · B 选父级 · N 选子级 · M 选兄弟',
    '工具   Q 选择 · W 姿态 · E 创建骨骼 · R 权重',
    '       Z 平移 · X 旋转 · C 缩放 · V 自由变换',
    '       B 网格编辑 · N 加点 · M 删点 · D 编辑网格（属性区）',
    '显示   Ctrl+B 显示骨骼 · Ctrl+I 显示图片',
    '时间轴 Enter/空格 播放 · K 关键帧 · T/G 上一帧/下一帧 · J 添加补间 · Y/H 上一个/下一个关键帧',
    '其他   F2 重命名 · Ctrl+Shift+C/V 复制/粘贴变换 · Alt+= / Alt+- 缩放舞台 · Ctrl+; 参考线',
    'BoneStudio 额外：F 适应窗口 · ? 本帮助 · 滚轮以光标为中心缩放',
  ].join('\n');

  const selectRelative = useCallback((kind: 'parent' | 'child' | 'brother') => {
    const next = relatedBone(playerRef.current, selectedBone, kind);
    if (next) {
      setSelectedBone(next);
      setSelectedSlot(null);
      return;
    }
    setNotice(kind === 'parent' ? '该骨骼没有父级' : kind === 'child' ? '该骨骼没有子级' : '该骨骼没有兄弟骨骼');
  }, [selectedBone]);

  /** 官方 `MenuItem-selectInverse`「反选」：多选集合取补集。 */
  const invertBoneSelection = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    const all = current.skeleton.bones.map((entry) => entry.name);
    const next = new Set(all.filter((name) => !selectedBones.has(name)));
    setSelectedBones(next);
    setSelectedBone(next.size > 0 ? [...next][0] : null);
    setSelectedSlot(null);
    flash(next.size > 0 ? `反选 ${next.size} 根骨骼` : '反选后没有骨骼被选中');
  }, [selectedBones]);

  const moveSelection = useCallback((dx: number, dy: number) => {
    const current = playerRef.current;
    const bone = selectedBone;
    // 只选中部件（图片 / 网格插槽）：装配模式下按屏幕方向平移显示对象，一次一格撤销
    if (current && !bone && selectedSlot && !current.playing && editModeRef.current === 'armature' && slotPoseEditable(current, selectedSlot)) {
      if (!assertWritable('nudgeSlot')) return;
      const prev = readSlotDisplayTransform(current, selectedSlot);
      if (!prev) return;
      const m = slotParentWorld(current, selectedSlot);
      const det = m[0] * m[3] - m[1] * m[2] || 1;
      // 世界增量 → 父骨骼局部增量（逆线性部分）
      const lx = (m[3] * dx - m[2] * dy) / det, ly = (-m[1] * dx + m[0] * dy) / det;
      const before = snapshotArmature(current);
      if (!setSlotDisplayTransform(current, selectedSlot, { x: prev.x + lx, y: prev.y + ly })) return;
      pushHistory(before);
      current.applyPose();
      setModelVersion((value) => value + 1);
      refresh();
      return;
    }
    if (!current || !bone || !current.animation || current.playing) return;
    // 与拖动 / 数值输入同一落点规则：有关键帧 → 改帧，否则 → 编辑期临时姿态。
    const values = effectiveTransform(current, bone, current.position);
    const before = snapshotArmature(current);
    if (!applyPoseEdit(bone, { x: values.x + dx, y: values.y + dy })) return;
    pushHistory(before);
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh, selectedBone, selectedSlot]);

  /** 舞台右键「移到上一层 / 下一层 / 最上层 / 最下层」：改绑定（setup）顺序，可撤销；动画里的层级关键帧自动改写下标 */
  const reorderFromMenu = useCallback((slot: string, mode: SlotOrderMode) => {
    if (!assertWritable('reorderSlot')) return;
    const current = playerRef.current;
    if (!current) return;
    const changed = runSlotEdit((p) => reorderSlot(p, slot, mode));
    setSelectedSlot(slot);
    if (!changed) { flash(mode === 'front' || mode === 'forward' ? '已经在最上层' : '已经在最下层'); return; }
    const keyed = (current.animation?.zOrder?.frame?.length ?? 0) > 0 && editModeRef.current === 'animation';
    flash(keyed ? '已调整绑定层级；当前动画有层级关键帧，关键帧处仍按关键帧顺序显示' : '已调整层级');
  }, [runSlotEdit, flash]);

  const changeSlotOrder = useCallback((mode: SlotOrderMode) => {
    const current = playerRef.current;
    if (!current) return;
    const slot = selectedSlot ?? current.skeleton.slots[0]?.name ?? null;
    if (!slot) return;
    pushHistory();
    if (reorderSlot(current, slot, mode)) {
      setSelectedSlot(slot);
      setSelectedBone(null);
      setModelVersion((value) => value + 1);
      refresh();
    }
  }, [pushHistory, refresh, selectedSlot]);

  const addTween = useCallback((stepped: boolean) => {
    if (!assertWritable('addTween')) return;
    const current = playerRef.current;
    const bone = selectedBone;
    if (!current || !bone || !current.animation) return;
    pushHistory();
    applyBoneTransform(bone, sampleTransform(current, bone, current.position));
    const ok = setTweenEasing(current, bone, current.position, stepped ? Number.NaN : 0);
    setModelVersion((value) => value + 1);
    refresh();
    if (!ok) setNotice('当前帧没有关键帧：已先打上关键帧，再按一次 J 即可设置补间。');
  }, [pushHistory, refresh, selectedBone]);

  /** 轨道行上点键：单击 = 单选并跳帧；Ctrl 加选。插槽行同时选中这根插槽（属性区切到插槽面板）。 */
  const trackKeyClick = useCallback((track: ExtraTrack, channel: string | null, frame: number, additive: boolean) => {
    const refs = expandTrackRef(track, channel, frame);
    setTrackSelection((current) => (additive ? mergeTrackRefs(current, refs) : refs));
    if (!additive) setKeySelection([]);
    setSelectedTrack(track.id);
    if (track.kind === 'slot') setSelectedSlot(track.name);
    // IK 键：同时定位骨骼（放在 setSelectedTrack 之后，否则会被它盖掉）；轨道键选区保留，Delete 仍可用
    if (track.kind === 'ik') selectIkTrack(track.name);
    seek(frame);
  }, [seek, selectIkTrack]);
  /** 删除非必要帧：有选中的骨骼只清这几根，否则清整个动画 */
  const pruneKeys = useCallback(() => {
    const current = playerRef.current;
    if (!current?.animation) return;
    const bones = selectedBones.size > 0 ? [...selectedBones] : selectedBone ? [selectedBone] : (current.animation.bone ?? []).map((entry) => entry.name);
    pushHistory();
    const removed = pruneRedundantKeys(current, bones);
    setKeySelection([]);
    setModelVersion((value) => value + 1);
    refresh();
    flash(removed > 0 ? `已删除 ${removed} 个非必要关键帧` : '没有可删除的非必要帧');
  }, [flash, pushHistory, refresh, selectedBone, selectedBones]);
  /** 补间线右键：只改这段补间所属的键，不新打关键帧 */
  const spanTween = useCallback((bone: string, channel: BoneChannelName | undefined, frame: number, on: boolean) => {
    if (!assertWritable('spanTween')) return;
    const current = playerRef.current;
    if (!current) return;
    pushHistory();
    if (!setSpanTween(current, bone, channel, frame, on)) return;
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh]);
  /** 当前骨骼在播放头的补间状态（右键菜单与「骨骼关键帧」面板共用） */
  const boneTween = readKeyTween(player, selectedBone, player?.position ?? 0);

  const toggleImages = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    setHiddenSlots((hidden) => (hidden.size > 0
      ? new Set<string>()
      : new Set(current.skeleton.slots.map((slot) => slot.name))));
  }, []);

  /**
   * 官方 `MenuItem-hideOthers` / `hideIrrelevant` / `hideRelated`（以及 lock 那一组）：
   * 「其他」= 除选中骨骼以外的全部；「无关」= 与它无关的；「相关」= 它 + 祖先链 + 子树。
   *
   * 隐藏要**跨类对齐场景树**：以场景树的条目为参照，插槽跟着一起熄 —— 「其他」把**全部插槽**
   * （含它自己名下的）也隐藏，「相关 / 无关」按插槽的**挂点骨骼**是否落在相关集里归属。
   * 锁定族不动（锁定是逐条目的，没有跨类语义）。
   */
  const applyBonePattern = useCallback((name: string, mode: 'others' | 'irrelevant' | 'related', kind: 'hide' | 'lock') => {
    const current = playerRef.current;
    if (!current) return;
    const all = current.skeleton.armature.bone.map((entry) => entry.name);
    const related = new Set(relatedBoneNames(current.skeleton.armature, name));
    const target = mode === 'related'
      ? related
      : mode === 'others'
        ? new Set(all.filter((entry) => entry !== name))
        : new Set(all.filter((entry) => !related.has(entry)));
    if (kind === 'lock') { setLockedBones(target); return; }
    const slots = current.skeleton.slots;
    const slotTarget = mode === 'others'
      ? new Set(slots.map((entry) => entry.name))
      : new Set(slots.filter((entry) => {
        const parent = current.skeleton.bones[entry.parentBone]?.name;
        const inRelated = !!parent && related.has(parent);
        return mode === 'related' ? inRelated : !inRelated;
      }).map((entry) => entry.name));
    setHiddenBones(target);
    setHiddenSlots(slotTarget);
  }, []);

  /**
   * 插槽侧的同族（官方 `MenuItem-hideOthersLayer` / `lockOthersLayer`）。
   * 隐藏同样跨类：除它以外的插槽 + **全部骨骼**都隐藏 —— 舞台上只剩这一张图。
   */
  const applySlotPattern = useCallback((slotName: string, kind: 'hide' | 'lock') => {
    const current = playerRef.current;
    if (!current) return;
    const rest = new Set(current.skeleton.slots.map((entry) => entry.name).filter((entry) => entry !== slotName));
    if (kind === 'lock') { setLockedSlots(rest); return; }
    setHiddenSlots(rest);
    setHiddenBones(new Set(current.skeleton.bones.map((entry) => entry.name)));
  }, []);

  const copyTransform = useCallback(() => {
    const current = playerRef.current;
    if (!current || !selectedBone) return;
    transformClipboard.current = sampleTransform(current, selectedBone, current.position);
    flash(`已复制 ${selectedBone} 的变换（Ctrl+Shift+V 粘贴到其它骨骼）`);
  }, [selectedBone]);

  const pasteTransform = useCallback(() => {
    const current = playerRef.current;
    const values = transformClipboard.current;
    if (!current || !selectedBone || !values || !current.animation) return;
    pushHistory();
    applyBoneTransform(selectedBone, values);
    current.applyPose();
    setModelVersion((value) => value + 1);
    refresh();
  }, [pushHistory, refresh, selectedBone]);

  const renameSelection = useCallback(() => {
    const current = playerRef.current;
    if (!current || !selectedBone) return;
    const next = window.prompt('重命名骨骼', selectedBone);
    if (!next || next === selectedBone) return;
    pushHistory();
    if (renameBone(current, selectedBone, next)) {
      current.rebuildSkeleton();
      setSelectedBone(next.trim());
      setModelVersion((value) => value + 1);
      refresh();
    } else {
      setNotice('重命名失败：名称为空、与既有骨骼重名或对象不存在。');
    }
  }, [pushHistory, refresh, selectedBone]);

  const storeGroup = useCallback((index: number) => {
    setGroupMemory((memory) => {
      const next = memory.slice();
      next[index] = selectedBone;
      return next;
    });
    flash(`${selectedBone ?? '（空）'} → 组 ${index === 9 ? 0 : index + 1}`);
  }, [selectedBone]);

  const recallGroup = useCallback((index: number) => {
    const name = groupMemory[index];
    if (!name) return;
    setSelectedBone(name);
    setSelectedSlot(null);
  }, [groupMemory]);
  const menus: MenuDef[] = [
    {
      label: '文件',
      items: [
        { label: '新建项目…', accel: 'Ctrl+N', onSelect: openNewProject },
        { label: '打开项目…', accel: 'Ctrl+O', onSelect: openFileDialog },
        { label: '保存项目', accel: 'Ctrl+S', onSelect: () => saveProject(), disabled: !player },
        { label: '项目另存为…', onSelect: saveProjectAs, disabled: !player },
        { label: '关闭项目', onSelect: closeProject, disabled: !player },
        { kind: 'sep' },
        { label: '导入资源到舞台…', onSelect: () => openAssetDialog('stage'), disabled: !player },
        { label: '导入资源到资源库…', onSelect: () => openAssetDialog('library'), disabled: !player },
        { label: '导入数据到项目…', onSelect: () => projectImportRef.current?.click(), disabled: !player },
        { label: '新建元件…', onSelect: () => setShowNewSymbol(true), disabled: !player },
        { kind: 'sep' },
        { label: '导出…', accel: 'Ctrl+E', onSelect: () => setShowExport(true), disabled: !player },
        { label: '导出 BoneStudio 工程（含贴图）', onSelect: () => { void exportProject(); }, disabled: !player },
        { label: '恢复自动保存…', onSelect: restoreAutosave },
        { kind: 'sep' },
        { label: '偏好设置…', accel: 'Ctrl+,', onSelect: () => setShowSettings(true) },
      ],
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', accel: 'Ctrl+Z', onSelect: undo, disabled: !historyState.canUndo },
        { label: '清除所有辅助线', onSelect: () => { setGuides([]); flash('已清除所有辅助线'); }, disabled: guides.length === 0 },
        { label: '重做', accel: 'Ctrl+Shift+Z', onSelect: redo, disabled: !historyState.canRedo },
        { kind: 'sep' },
        { label: '在当前帧打 / 删关键帧', accel: 'K', onSelect: toggleKey, disabled: !selectedBone },
        { label: '重置为绑定姿态', onSelect: resetBone, disabled: !selectedBone },
      ],
    },
    {
      label: '动画',
      items: [
        { label: player?.playing ? '暂停' : '播放', accel: '空格', onSelect: togglePlay, disabled: !player },
        { label: '回到起点', accel: 'Home', onSelect: () => seek(0), disabled: !player },
        { kind: 'sep' },
        { label: '上一个关键帧', accel: 'Shift+←', onSelect: () => jumpKey(-1), disabled: !player },
        { label: '下一个关键帧', accel: 'Shift+→', onSelect: () => jumpKey(1), disabled: !player },
        { kind: 'sep' },
        { label: '循环播放', checked: loop, onSelect: () => setLoop(!loop) },
        { kind: 'sep' },
        ...(animations.length
          ? animations.map((name) => ({
            label: name,
            checked: name === currentAnimation,
            onSelect: () => { player?.setAnimation(name); refresh(); },
          }))
          : [{ label: '无动画', disabled: true }]),
      ],
    },
    {
      label: '视图',
      items: [
        { label: '显示骨骼', checked: showBones, onSelect: () => setShowBones(!showBones) },
        { label: '显示图片', checked: stageFilter.imageVisible, onSelect: () => toggleStageFilterKey('imageVisible') },
        { label: '辅助标尺', accel: 'Ctrl+;', checked: showGuides, onSelect: () => setShowGuides(!showGuides) },
        { kind: 'sep' },
        { label: '适应窗口', accel: 'F', onSelect: () => setFitToken((value) => value + 1), disabled: !player },
        { label: '实际大小 100%', onSelect: () => setScale(1), disabled: !player },
      ],
    },
    {
      label: '窗口',
      items: [
        { label: '左侧面板', checked: showLeft, onSelect: () => setShowLeft(!showLeft) },
        { label: '右侧面板', checked: showRight, onSelect: () => setShowRight(!showRight) },
        { label: '时间轴', checked: showTimeline, onSelect: () => setShowTimeline(!showTimeline) },
      ],
    },
    {
      label: 'AI',
      items: [
        { label: 'MCP 服务…', onSelect: () => setShowAiPanel(true) },
      ],
    },
    {
      label: '帮助',
      items: [
        { label: '快捷键速查…', accel: '?', onSelect: () => setHelpTopic('shortcuts') },
        { label: '学习 DragonBones', onSelect: () => setHelpTopic('learn') },
        { label: '插件管理...', onSelect: () => setShowPlugins(true) },

        { kind: 'sep' },
        { label: '关于 BoneStudio', onSelect: () => setHelpTopic('about') },
      ],
    },
  ];

  /** 某个动作是否还绑在这个默认键上（用来让被改掉的旧键彻底失效） */
  const bound = useCallback((id: string, keys: string) => bindingOf(id, hotkeys) === keys, [hotkeys]);

  /** 执行一个（可自定义的）快捷键动作；返回 false = 这次不接管，交回下面按上下文定的分支 */
  const runHotkeyAction = useCallback((id: string, shift: boolean): boolean => {
    switch (id) {
      case 'tool.select':
      case 'tool.pose':
      case 'tool.bone':
      case 'tool.weight':
      case 'tool.move':
      case 'tool.rotate':
      case 'tool.scale':
      case 'tool.free':
        if (playerRef.current?.playing) return true;
        setTool(id === 'tool.select' ? 'select'
          : id === 'tool.pose' ? 'pose'
          : id === 'tool.bone' ? 'bone'
          : id === 'tool.weight' ? 'weight'
          : id === 'tool.move' ? 'move'
          : id === 'tool.rotate' ? 'rotate'
          : id === 'tool.scale' ? 'scale'
          : 'free');
        return true;
      case 'view.fit': setFitToken((value) => value + 1); return true;
      case 'play.toggle': togglePlay(); return true;
      case 'frame.prev': stepFrames(-1); return true;
      case 'frame.next': stepFrames(1); return true;
      case 'key.prev': jumpKey(-1); return true;
      case 'key.toggle': toggleKey(); return true;
      case 'key.tween': addTween(shift); return true;
      case 'layer.forward': changeSlotOrder('forward'); return true;
      case 'layer.backward': changeSlotOrder('backward'); return true;
      default: return false;
    }
  }, [addTween, changeSlotOrder, jumpKey, stepFrames, toggleKey, togglePlay]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) {
        if (event.key === 'Escape') target.blur();
        return;
      }
      // 官方工作区模式机：Ctrl+Tab 在「骨架装配」与「动画制作」之间来回切。
      // 序列帧没有骨架装配，这个快捷键不把界面切走。
    if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
      event.preventDefault();
      if (!isSheetArmature(playerRef.current?.skeleton.armature)) {
        changeEditMode(editMode === 'armature' ? 'animation' : 'armature');
      }
      return;
    }
    const key = event.key.toLowerCase();
      const meta = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;
      const alt = event.altKey;
      const timelineFocus = focusArea === 'timeline';
      const meshMode = tool === 'mesh' || tool === 'meshAdd' || tool === 'meshDelete' || tool === 'weight';

      // ---- 工程 ----
      if (meta && !shift && key === 'o') { event.preventDefault(); openFileDialog(); return; }
      if (meta && !shift && key === 'e') { event.preventDefault(); if (playerRef.current) setShowExport(true); return; }
      if (meta && !shift && key === 's') { event.preventDefault(); saveProject(); return; }
      if (meta && shift && key === 's') { event.preventDefault(); saveProject(true); return; }
      if (meta && !shift && key === 'n') { event.preventDefault(); openNewProject(); return; }
      if (meta && !shift && key === ',') { event.preventDefault(); setShowSettings(true); return; }
      // 官方 hotkeys.txt：Ctrl+; 隐藏参考线，Ctrl+Alt+; 启用参考线
      if (meta && !alt && !shift && key === ';') { event.preventDefault(); setShowGuides((value) => !value); return; }
      if (meta && alt && !shift && key === ';') { event.preventDefault(); setShowGuides(true); return; }
      // ---- 编辑 ----
      // dope-sheet keyframe clipboard / deletion (official 摄影表)
      const anyKeySelected = keySelection.length > 0 || trackSelection.length > 0;
      if ((key === 'delete' || key === 'backspace') && anyKeySelected) {
        event.preventDefault();
        deleteAnyKeys();
        return;
      }
      if (meta && !shift && key === 'c' && anyKeySelected) {
        event.preventDefault();
        copyAnyKeys();
        return;
      }
      if (meta && !shift && key === 'x' && anyKeySelected) {
        event.preventDefault();
        cutAnyKeys();
        return;
      }
      if (meta && !shift && key === 'v' && hasKeyClipboard) {
        event.preventDefault();
        pasteAnyKeys();
        return;
      }
      if (meta && key === 'z') { event.preventDefault(); if (shift) redo(); else undo(); return; }
      if (meta && !shift && key === 'y') { event.preventDefault(); redo(); return; }
      if (meta && !shift && key === 'b') { event.preventDefault(); setShowBones((value) => !value); return; }
      if (meta && !shift && key === 'i') { event.preventDefault(); toggleImages(); return; }
      if (meta && shift && key === 'c') { event.preventDefault(); copyTransform(); return; }
      if (meta && shift && key === 'v') { event.preventDefault(); pasteTransform(); return; }
      if (meta && !shift && key === 'a') {
        event.preventDefault();
        // official dope sheet: Ctrl+A selects every key of the current animation
                // 官方把两条命令分开：时间轴聚焦 → MenuItem-selectAllKeyFrames；否则 → Menu.Edit.SelectAll（全选骨骼）
          if (timelineFocus) {
            const count = selectAllKeys();
            flash(count > 0 ? `已全选 ${count} 个关键帧` : '当前动画没有关键帧');
          } else {
            const count = selectAllBones();
            flash(count > 0 ? `已全选 ${count} 根骨骼` : '没有可选中的骨骼');
          }
                // （提示已并入上面的分支）
        return;
      }
      if (meta && !shift && key === 'd') {
        event.preventDefault();
        setTlTab('timeline');
        setNotice('时间轴跟随选中骨骼过滤：选中时只显示这条时间线，取消选中（Esc / 点舞台空白）恢复全部。');
        return;
      }
      if (meta && (key === '=' || key === '+')) { event.preventDefault(); changeSlotOrder('front'); return; }
      if (meta && (key === '-' || key === '_')) { event.preventDefault(); changeSlotOrder('bottom'); return; }
      if (meta && /^[0-9]$/.test(key)) { event.preventDefault(); storeGroup(key === '0' ? 9 : Number(key) - 1); return; }
      if (meta && key === 'tab') { event.preventDefault(); setNotice('搭建 / 动画模式切换（Ctrl+Tab）随 M2 实现。'); return; }
      if (meta && key === ';') { event.preventDefault(); setNotice('参考线（Ctrl+;）随 M2 舞台辅助实现。'); return; }
      if (alt && (key === '=' || key === '+')) { event.preventDefault(); setScale((value) => Math.min(24, value * 1.25)); return; }
      if (alt && (key === '-' || key === '_')) { event.preventDefault(); setScale((value) => Math.max(0.03, value / 1.25)); return; }
      if (event.key === 'F2') { event.preventDefault(); renameSelection(); return; }
      if (event.key === 'Escape') {
      // cancel a pending "设置父级" pick before clearing the selection
      if (parentPick) { setParentPick(false); return; }
      setSelectedBone(null);
      setSelectedSlot(null);
      return;
    }
      if (event.key === '?') { event.preventDefault(); setHelpTopic('shortcuts'); return; }

      // ---- 可自定义快捷键（官方 Setting.hotkey*）：先查表；没命中再走按上下文定的分支 ----
      if (!meta && !alt) {
        const hotkeyAction = matchHotkey(event, hotkeys);
        if (hotkeyAction && runHotkeyAction(hotkeyAction, shift)) { event.preventDefault(); return; }
      }

      // ---- 播放与时间轴 ----
      if (event.key === ' ' && bound('play.toggle', 'space')) { event.preventDefault(); togglePlay(); return; }
      if (event.key === 'Enter') { event.preventDefault(); togglePlay(); return; }
      if (!meta && key === 'k' && bound('key.toggle', 'k')) { toggleKey(); return; }
      if (!meta && key === 'j' && bound('key.tween', 'j')) { addTween(shift); return; }
      if (!meta && key === 't' && bound('frame.prev', 't')) { event.preventDefault(); stepFrames(-1); return; }
      if (!meta && key === 'g' && bound('frame.next', 'g')) { event.preventDefault(); stepFrames(1); return; }
      if (!meta && key === 'y' && bound('key.prev', 'y')) { event.preventDefault(); jumpKey(-1); return; }
      if (!meta && key === 'h' && timelineFocus) { event.preventDefault(); jumpKey(1); return; }

      // ---- 层级 / 组 ----
      if (!meta && (key === '=' || key === '+') && bound('layer.forward', '=')) { event.preventDefault(); changeSlotOrder('forward'); return; }
      if (!meta && (key === '-' || key === '_') && bound('layer.backward', '-')) { event.preventDefault(); changeSlotOrder('backward'); return; }
      if (!meta && /^[0-9]$/.test(key)) { event.preventDefault(); recallGroup(key === '0' ? 9 : Number(key) - 1); return; }

      // ---- 选择关系（B/N/M；网格工具激活时让位给加点/删点） ----
      if (!meta && !meshMode && (key === 'b' || key === 'n' || key === 'm')) {
        event.preventDefault();
        selectRelative(key === 'b' ? 'parent' : key === 'n' ? 'child' : 'brother');
        return;
      }

      // ---- 方向键移动选中对象（Shift 快速 / Ctrl 精细） ----
      if (event.key.indexOf('Arrow') === 0) {
        event.preventDefault();
        const step = shift ? 10 : meta ? 0.1 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        moveSelection(dx, dy);
        return;
      }

      // ---- 工具（可自定义那 8 个走 HOTKEY_TOOL_KEYS，只有仍然绑定到这个键才生效） ----
      if (!meta && !alt) {
        const toolKey = HOTKEY_TOOL_KEYS[key];
        if (toolKey && bound(toolKey[0], key)) {
          if (playerRef.current?.playing) return;
          setTool(toolKey[1]);
          return;
        }
      }
      switch (key) {
        case 'b':
          if (playerRef.current?.playing) break;
          if (editModeRef.current === 'animation') setFfdMode(true);
          setTool('mesh');
          break;
        case 'n':
          if (playerRef.current?.playing) break;
          if (!requireArmatureMode('添加网格点')) break;
          setTool('meshAdd');
          break;
        case 'm':
          if (playerRef.current?.playing) break;
          if (!requireArmatureMode('删除网格点')) break;
          setTool('meshDelete');
          break;
        case 'h': if (!playerRef.current?.playing) setTool('pan'); break;
        case 'f': if (bound('view.fit', 'f')) setFitToken((value) => value + 1); break;
        case 'p':
          if (!selectedBone) { setNotice('先选中一根骨骼，再按 P 设置父级'); break; }
          // non-blocking: the next stage/outline click picks the new parent
          setParentPick(true);
          setNotice(null);
          break;
        case 'delete':
        case 'backspace':
          // 时间轴选中了「非骨骼轨道」时：删掉这一帧上该轨道的键（插槽颜色 / 显示资源 / IK / 事件 / 绘制顺序）
          if (selectedTrack) { deleteTrackKeyAt(selectedTrack, playerRef.current?.position ?? 0); break; }
          if (!selectedBone && selectedSlot) { deleteSlotSelection(); break; }
          if (selectedBone && keyAtFrame) toggleKey();
          else if (selectedBone && player) {
            const target = selectedBone;
            if (settings.deleteConfirmation && !window.confirm(`删除骨骼 ${target}？（子级会上移到它的父级）`)) break;
            pushHistory();
            const removed = removeBone(player, target);
            if (removed) {
              player.rebuildSkeleton();
              setSelectedBone(null);
              setSelectedSlot(null);
              flash(`删除骨骼 ${target}（子级上移到其父级）`);
            } else {
              setNotice('删除失败：骨架至少要保留一根骨骼');
            }
            refresh();
          } else {
            setNotice('没有可删除的骨骼（先选中一根骨骼）');
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addTween, changeSlotOrder, copyAnyKeys, copyTransform, cutAnyKeys, deleteAnyKeys, deleteTrackKeyAt, selectedTrack, focusArea, hasKeyClipboard, jumpKey, keyAtFrame, keySelection.length, trackSelection.length, moveSelection, openFileDialog, pasteAnyKeys, pasteTransform, redo, recallGroup, openNewProject, renameSelection, saveProject, selectAllKeys, selectRelative, settings.deleteConfirmation, shortcuts, storeGroup, toggleImages, toggleKey, togglePlay, tool, undo]);

  const toolDef = TOOLS.find((entry) => entry.id === tool) ?? TOOLS[0];
  const showWelcome = welcomeActive || !player;
  const selectLibraryArmature = (name: string) => {
    const current = playerRef.current;
    if (!current) return;
    const target = current.doc.armatures.find((entry) => entry.name === name);
    if (current.skeleton.armature.name !== name) {
      current.setArmature(name);
      // 切换元件不自动播放：停掉上一个元件留下的播放态（`setArmature` 不重置 `playing`），
      // 播放只由播放键（空格）触发。
      current.playing = false;
      setSelectedBone(null);
      setSelectedSlot(null);
    }
    // 序列帧元件就是一段动画：套上时间轴，让舞台按帧渲染当前帧（不播放）。
    if (target && isSheetArmature(target)) {
      current.setupPose = false;
      current.applyPose();
      if (editModeRef.current !== 'animation') changeEditMode('animation');
      setFitToken((value) => value + 1);
    }
    setModelVersion((value) => value + 1);
    refresh();
  };
  /**
   * 官方资源面板标题栏「刷新所有资源」（`LibraryPanelController._4188`，
   * `_555/LibraryPanelController.as:2363-2387`：重扫工程资源目录后广播 `UPDATE_LIBRARY`）。
   *
   * 本仓库没有磁盘资源目录，等价物是「回到工程原始资源数据」：按 `textureData` 重建图集切片
   * 与引用统计（把运行时的资源增删抹掉），再用 `cache: 'reload'` 绕浏览器缓存重取贴图。
   */
  const refreshLibrary = useCallback(async () => {
    const current = playerRef.current;
    if (!current) { setNotice('刷新：先打开一个工程'); return; }
    if (textureData) current.atlases = [parseTextureAtlas(textureData)];
    setModelVersion((value) => value + 1);
    refresh();
    if (!atlasUrl) {
      flash(textureData ? '已刷新资源（这个工程没有贴图文件）' : '刷新：这个工程没有图集');
      return;
    }
    try {
      const response = await fetch(atlasUrl, { cache: 'reload' });
      if (!response.ok) throw new Error(`贴图 ${response.status}`);
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setAtlasUrl(nextUrl);
      // 当前页签的记录也要跟着换，否则切走再切回来会拿到已释放的旧 URL
      setDocuments((prev) => prev.map((entry) => (entry.id === activeDocId ? { ...entry, atlasUrl: nextUrl } : entry)));
      setModelVersion((value) => value + 1);
      refresh();
      flash('已刷新所有资源');
    } catch (error) {
      setNotice(`刷新失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeDocId, atlasUrl, flash, refresh, textureData]);

  /**
   * 官方资源面板标题栏「删除」（`LibraryPanelController.onDeleteArmature`，
   * `_555/LibraryPanelController.as:1040-1072` 确认框 → `removeSelectArmatureVO` / `removeAssets`，
   * 同文件 `1271-1339`）：选中元件 → 删元件（工程至少留一个）；否则删资源。
   * 本仓库的「资源」= 图集切片，等价物是删掉图集里那条 `SubTexture`。
   */
  const deleteLibrarySelection = useCallback(() => {
    const current = playerRef.current;
    if (!current || !libraryNode) { setNotice('先在资源树中选择一个元件或切片'); return; }
    if (libraryNode.startsWith('arm:')) {
      const name = libraryNode.slice(4);
      if (current.doc.armatures.length <= 1) { setNotice('删除失败：工程至少要保留一个元件'); return; }
      if (settings.deleteConfirmation && !window.confirm(`删除元件「${name}」？它的骨骼、插槽与动画会一起消失。`)) return;
      pushHistory();
      if (!removeArmature(current.doc, name)) { setNotice('删除元件失败：元件不存在'); return; }
      if (current.skeleton.armature.name === name) {
        current.setArmature(current.doc.armatures[0].name);
        setSelectedBone(null);
        setSelectedSlot(null);
      }
      setLibraryNode(null);
      setLibraryHighlight(null);
      setModelVersion((value) => value + 1);
      refresh();
      flash(`已删除元件「${name}」`);
      return;
    }
    if (libraryNode.startsWith('img:')) {
      // key 形如 `img:<元件>:<切片>`：只取最后一个冒号之后的部分当切片名
      const rest = libraryNode.slice(4);
      const sep = rest.lastIndexOf(':');
      const slice = sep >= 0 ? rest.slice(sep + 1) : rest;
      const atlas = current.atlas;
      if (!atlas || !textureData) { setNotice('删除失败：这个工程没有图集'); return; }
      const cited = usedRegions.has(slice);
      if (settings.deleteConfirmation && !window.confirm(
        cited
          ? `切片「${slice}」仍被显示对象引用，删除后这些引用会变成缺失。继续？`
          : `删除切片「${slice}」？`,
      )) return;
      // 图集不在撤销快照里（`snapshotArmature` 只存骨架），所以这类删除不进撤销栈
      removeSubTexture(textureData, slice);
      removeRegion(atlas, slice);
      setLibraryNode(null);
      if (libraryHighlight === slice) setLibraryHighlight(null);
      setModelVersion((value) => value + 1);
      refresh();
      flash(`已删除切片「${slice}」${cited ? '（引用处变缺失）' : ''}`);
      return;
    }
    setNotice('这个节点不能删除（元件或切片才可删）');
  }, [flash, libraryHighlight, libraryNode, pushHistory, refresh, settings.deleteConfirmation, textureData, usedRegions]);

  /**
   * 右上停靠区的标题栏工具条 —— 官方两组面板各三个按钮（`_929/ScenePanel.as:155-163`
   * 与 `_859/LibraryPanel.as:61-78`，见 `docs/DBPRO-SPEC.md §111`）：
   *   资源   = 新建元件 / 刷新所有资源 / 删除
   *   场景树 = 智能过滤 / 创建（下拉：骨骼 · 插槽 · 边界框）/ 删除
   * 可用性照官方 `_555/_571.as:2495-2515`：创建需骨架装配模式 + 选中骨骼。
   */
  const canCreateUnderBone = editMode === 'armature' && !sheetEditing && !!selectedBone;
  const sceneDeleteEnabled = !sheetEditing && (
    selectedBones.size > 0 || selectedSlots.size > 0
    || (!!selectedBone && editMode === 'armature') || !!selectedSlot
  );
  const libraryTools = (
    <>
      <HeadButton dataHook="library-newSymbol" icon="newSymbol" title="新建元件..." onClick={() => setShowNewSymbol(true)} />
      <HeadButton dataHook="library-refresh" icon="refresh" title="刷新所有资源" onClick={() => { void refreshLibrary(); }} />
      <HeadButton dataHook="library-delete" icon="trash" title="删除" onClick={deleteLibrarySelection} />
    </>
  );
  const rightTools = rightTab === 'library' ? libraryTools : (
    <>
      <HeadButton
        dataHook="scene-filter"
        icon={sceneFilter ? 'filterOpen' : 'filterClose'}
        title="智能过滤"
        pressed={sceneFilter}
        onClick={() => {
          const next = !sceneFilter;
          setSceneFilter(next);
          writeSceneTreeFilter(window.localStorage, next);
        }}
      />
      <div className="tab-menu-host">
        <HeadButton dataHook="scene-create" icon="plus" title="新建元素" active={createMenu} onClick={() => setCreateMenu((open) => !open)} />
        {createMenu && (
          <>
            <div className="stage-menu-backdrop" onClick={() => setCreateMenu(false)} />
            <div className="stage-menu tab-menu" data-create-menu="">
              <button data-create="bone" disabled={!canCreateUnderBone} onClick={() => { setCreateMenu(false); createBoneSelection(); }}>新建骨骼</button>
              <button data-create="slot" disabled={!canCreateUnderBone} onClick={() => { setCreateMenu(false); createSlotSelection(); }}>新建插槽</button>
              <button data-create="bbox" disabled={!canCreateUnderBone} onClick={() => { setCreateMenu(false); createBoundingBoxSelection(); }}>新建边界框</button>
            </div>
          </>
        )}
      </div>
      <HeadButton dataHook="scene-delete" icon="trash" title="删除" disabled={!sceneDeleteEnabled} onClick={deleteSceneSelection} />
    </>
  );

  const libraryTree = (
    <SymbolLibraryTree
      armatures={libraryArmatures}
      current={player?.skeleton.armature.name ?? ''}
      atlasName={atlasLabel}
      regions={atlasRegionNames}
      highlight={libraryHighlight}
      onSelect={selectLibraryArmature}
      onAddFrame={addSheetImage}
      onHighlight={setLibraryHighlight}
      atlasUrl={atlasUrl}
      regionRects={atlasRegionRects}
      usedRegions={usedRegions}
      selectedNode={libraryNode}
      onSelectNode={setLibraryNode}
    />
  );

  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const files = event.dataTransfer.files;
        // 资源树拖切片（§109）走舞台自己的 onDrop，别在这里当成「打开文件」（空列表会把工程清空）
        if (!files || files.length === 0) return;
        event.preventDefault();
        void onOpenFiles(files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".json,.dbbin,.png,.jpg,.jpeg,.webp,.atlas"
        style={{ display: 'none' }}
        onChange={(event) => { void onOpenFiles(event.target.files); event.target.value = ''; }}
      />
      <input
        ref={assetInputRef}
        type="file"
        accept="image/png"
        data-asset-input=""
        style={{ display: 'none' }}
        onChange={(event) => { void importAssetFiles(event.target.files); event.target.value = ''; }}
      />
      <input
        ref={projectImportRef}
        type="file"
        accept=".json,.dbbin"
        data-project-import-input=""
        style={{ display: 'none' }}
        onChange={(event) => { void importDataIntoProject(event.target.files); event.target.value = ''; }}
      />
      <MenuBar
        title="BoneStudio"
        menus={readonlyMode ? readonlyMenus(menus) : menus}
        editMode={editMode}
        onEditMode={changeEditMode}
        showEditMode={!showWelcome}
        allowArmatureMode={!sheetEditing}
        right={(
          <>
            {/* P-10/P-17：多元件工程的元件切换（Player 早就有 setArmature） */}
            {player && player.armatureNames().length > 1 && (
              <select
                className="chip"
                data-armature-select=""
                title="当前元件（官方多元件工程）"
                value={player.skeleton.armature.name}
                onChange={(event) => selectLibraryArmature(event.target.value)}
              >
                {player.armatureNames().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
            {player && player.skeleton.skins().length > 1 && (
              <select
                data-skin-select=""
                title="皮肤（官方 Armature.skin[]）"
                value={player.skeleton.skinName ?? ''}
                onChange={(event) => {
                  if (player.setSkin(event.target.value)) {
                    setModelVersion((value) => value + 1);
                    refresh();
                    flash(`切换皮肤 → ${event.target.value || '默认'}`);
                  }
                }}
                style={{ marginRight: 6 }}
              >
                {player.skeleton.skins().map((skin) => (
                  <option key={skin.name || '__default'} value={skin.name}>{skin.name || '（默认皮肤）'}</option>
                ))}
              </select>
            )}
            {/* 骨骼数只在骨架工程有意义；序列帧元件没有可装配的骨架，不显示 */}
            {player && !sheetEditing && (
              <span className="muted" style={{ padding: '0 6px' }}>{`${boneCount} 骨骼`}</span>
            )}
          </>
        )}
      />
      {liveParams.live && liveParams.name && (
        <LiveSync
          key={`${liveParams.root}/${liveParams.name}`}
          sample={liveParams.name}
          root={liveParams.root}
          onExit={exitWatch}
          readonly={readonlyMode}
          agentId={liveParams.agent}
          getPlayer={() => playerRef.current}
          onApplied={onLiveApplied}
          flash={flash}
        />
      )}

      <div
        className={`workspace${showWelcome ? ' welcome' : ''}${sheetEditing && !showWelcome ? ' mode-sheet' : ''}${showLeft ? '' : ' no-left'}${showRight ? '' : ' no-right'}`}
        style={{
          '--left-w': `${leftWidth}px`,
          '--right-w': `${rightWidth}px`,
          '--left-top': `${leftTop}px`,
          '--right-top': `${rightTop}px`,
        } as CSSProperties}
      >
        {!sheetEditing && (
        <ToolRail
          tool={tool}
          onTool={(id) => {
            if (editMode === 'animation' && id === 'mesh') setFfdMode(true);
            setTool(id);
          }}
          onFit={() => setFitToken((value) => value + 1)}
          locks={[
            ...(readonlyMode ? [{ ids: TOOLS.map((t) => t.id).filter((id) => !allowTool(id)), reason: '只读观看模式' }] : []),
            ...(player?.playing ? [{ ids: PLAYBACK_LOCKED_TOOLS, reason: '播放中已禁用' }] : []),
            ...(editMode === 'animation' ? [{ ids: STRUCTURE_MESH_TOOLS, reason: '骨架装配模式下才能使用（Ctrl+Tab 切换）' }] : []),
          ]}
        />
        )}

        {/* 左列：属性（官方左上）＋ 曲线编辑器 / 统计（官方左下） */}
        <div data-ro-block={readonlyMode ? '' : undefined} className={`dock left${editMode === 'armature' ? ' mode-armature' : ''}${sheetEditing ? ' mode-sheet' : ''}`}>
          <Panel
            title="属性"
            icon="layers"
            actions={selectedSlot
              ? <HeadButton icon="x" title="删除槽位（Delete）" onClick={deleteSlotSelection} />
              : <HeadButton icon="reset" title="重置为绑定姿态" onClick={resetBone} />}
            bodyClassName="dock-body"
            className="h-0"
          >
            {sheetEditing ? (
              <SheetProperties
                name={player?.skeleton.armature.name ?? ''}
                frameRate={sheetFrames?.frameRate ?? 24}
                animations={player?.skeleton.animationNames() ?? []}
                current={player?.animation?.name ?? ''}
                onFrameRate={setSheetFrameRate}
                onAnimation={(name) => { player?.setAnimation(name); refresh(); }}
              />
            ) : selectedTrack === 'events' ? (
              <EventPanel
                frame={player?.position ?? 0}
                events={eventsAt(player, player?.position ?? 0)}
                defaultAnimation={player?.animation?.name ?? ''}
                onAdd={(kind, name) => runEventEdit((current) => addEventFrame(current, current.position, kind, name))}
                onRemove={(position) => runEventEdit((current) => removeEventFrame(current, current.position, position))}
                bones={player?.skeleton.bones.map((bone) => bone.name) ?? []}
                onPatch={(position, patch) => runEventEdit((current) => updateEventParams(current, current.position, position, patch))}
              />
            ) : selectedSlot ? (
              <SlotPanel
                player={player}
                slotName={selectedSlot}
                onRename={renameSlotSelection}
                onBlendMode={changeSlotBlend}
                onDisplayIndex={changeSlotDisplay}
                onColor={changeSlotColor}
                onBeginColor={beginSlotColor}
                onBeginColorPreview={beginColorPreview}
                onCommitColorPreview={commitColorPreview}
                onCancelColorPreview={cancelColorPreview}
                animationMode={editMode === 'animation'}
                frame={player?.position ?? 0}
                onToggleColorKey={toggleSlotColorKey}
                onToggleDisplayKey={toggleDisplayKey}
                displayKeyed={player && selectedSlot ? displayKeyAt(player, selectedSlot, player.position) : false}
                onDelete={deleteSlotSelection}
                onAddWeightBone={addWeightBone}
                onRemoveWeightBone={removeWeightBone}
                weightBonePick={weightBonePick}
                armatureMode={editMode === 'armature'}
                sheetMode={sheetEditing}
                onWeightBonePick={(active) => {
                  if (active && !requireArmatureMode('添加绑定骨骼')) return;
                  setWeightBonePick(active);
                  if (active) flash('在舞台上点一根骨骼，把它加入权重列表');
                }}
                   onSwapImage={(index) => {
                     if (!requireArmatureMode('替换图片')) return;
                     if (selectedSlot) setSwapTarget({ slot: selectedSlot, index });
                   }}
                   onAutoWeight={autoWeightSelection}
                   onMeshEdit={toggleMeshEditor}
                   onMeshReset={resetMeshSelection}
                   meshEditing={meshEditMode && meshEditSlot === selectedSlot}
                   onBBoxRedraw={redrawBoundingBox}
                   onBBoxMode={bboxPickMode}
                weightVertex={weightVertex}
                weightShares={weightShares}
                activeBone={selectedBone}
                weightMode={tool === 'weight'}
                onBeginWeight={pushHistory}
                onWeightShare={setWeightShare}
                ffdKeyed={Boolean(player?.animation && selectedSlot && ffdKeyAt(player.animation, selectedSlot, player.position))}
                onToggleFfdKey={toggleFfdKey}
              />
            ) : (
            <>
            {selectedBone && boneTween?.exact && (
              <BoneFramePanel
                bone={selectedBone}
                tween={boneTween.tween}
                rotate={boneTween.rotate}
                onTween={(mode) => addTween(mode === 'none')}
                onRotate={(value) => runKeyEdit((current) => (setTweenRotate(current, selectedBone, current.position, value) ? 1 : 0))}
              />
            )}
            <PropertiesPanel
              player={player}
              boneName={selectedBone}
              values={values}
              keyAtFrame={keyAtFrame}
              keyed={channelKeyed}
              onChange={(key, value) => commitTransform({ [key]: value })}
              onToggleKey={toggleKey}
              onReset={resetBone}
              ik={ikView}
              onAddIk={addIk}
              onRemoveIk={dropIk}
              onIkPatch={patchIk}
              onBeginIk={beginIk}
              animationMode={editMode === 'animation'}
              ikKeyed={ikKeyed}
              onToggleIkKey={toggleIkKey}
              ikTargetPick={ikTargetPick}
              onIkTargetPick={setIkTargetPick}
              armatureMode={editMode === 'armature'}
              onLocateBone={locateBone}
              boneLength={player && selectedBone
                ? player.skeleton.bones[player.skeleton.boneIndexByName.get(selectedBone) ?? -1]?.length
                : undefined}
              onBoneLength={changeBoneLength}
              locked={player?.playing ?? false}
              transformLocked={ikChainLocked}
              transformSpace={transformSpace}
              onTransformSpace={setTransformSpace}
            />
            </>
            )}
          </Panel>
          {editMode === 'animation' && !sheetEditing && (
            <>
          <Sash
            axis="y"
            value={leftTop}
            min={96}
            max={860}
            onChange={setLeftTop}
            title="拖动调整「属性」与「曲线编辑器」的高度"
          />
          <div className="dock left-bottom">
            <Tabs
              tabs={[{ id: 'curve', name: '曲线编辑器' }, { id: 'info', name: '统计' }]}
              active={leftBottomTab}
              onChange={(id) => setLeftBottomTab(id === 'info' ? 'info' : 'curve')}
              tools={(
                <HeadButton
                  icon="menu"
                  title="面板菜单"
                  onClick={() => setNotice('曲线编辑器：选中关键帧后在此编辑它之后的动画曲线（台阶 / 线性 / 渐入 / 渐出 / 渐入渐出）。')}
                />
              )}
            />
            <div className="dock-body">
              {leftBottomTab === 'curve' ? (
                <CurvePanel
                  target={curveTarget}
                  state={curveState}
                  onPreset={applyCurvePreset}
                  onEdit={editCurve}
                  onCopy={copyCurrentCurve}
                  onPaste={pasteCopiedCurve}
                  hasClipboard={curveClipboard !== null}
                />
              ) : (
                <InfoPanel
                  player={player}
                  currentAnimation={currentAnimation}
                  stats={stats}
                  atlasRegions={player?.atlas?.regions.length ?? 0}
                  decode={decodeStats}
                />
              )}
            </div>
          </div>
            </>
          )}
        </div>

        <Sash
          className="sash-left"
          axis="x"
          value={leftWidth}
          min={200}
          max={640}
          onChange={setLeftWidth}
          title="拖动调整左栏宽度"
        />

        <Viewer
          meshEditorBar={meshEditMode && meshEditSlot ? (
            <MeshEditorBar
              slot={meshEditSlot}
              vertexCount={meshEditVertexCount}
              tool={tool}
              onTool={setTool}
              deform={ffdMode}
              onDeform={setFfdMode}
              density={meshDensity}
              onDensity={setMeshDensity}
              onAutoOutline={() => { void autoOutlineSelection(meshDensity, { slot: meshEditSlot }); }}
              onReset={resetMeshSelection}
              onClose={closeMeshEditor}
            />
          ) : null}
          player={player}
          atlasUrl={atlasUrl}
          showBones={stageShowBones}
          anatomyMode={editMode !== 'animation'}
          stageFilter={stageFilter}
          onStageFilterToggle={toggleStageFilterKey}
          sheetMode={sheetEditing}
          transformBar={sheetEditing ? (
            <SheetFrameBar
              values={sheetFrameValues}
              placeMode={sheetPlace}
              onPlaceMode={setSheetPlace}
              onPosition={(x, y) => patchSheetFrame({ x, y })}
              onPivot={setSheetPivotUi}
              onFlip={flipSheetFrame}
              onApplyAll={applySheetFrameToAll}
            />
          ) : (
            <TransformBar
              label={selectedBone ?? (slotPose ? selectedSlot : null)}
              values={selectedBone ? values : slotPose}
              length={player && selectedBone
                ? player.skeleton.bones[player.skeleton.boneIndexByName.get(selectedBone) ?? -1]?.length
                : undefined}
              keyAtFrame={keyAtFrame}
              keyed={channelKeyed}
              animationMode={editMode === 'animation'}
              tool={tool}
              onTool={setTool}
              onChange={(patch) => { if (selectedBone) commitTransform(patch); else commitSlotPose(patch); }}
              onLength={changeBoneLength}
              onKey={toggleKey}
              playbackLock={player?.playing ?? false}
              transformLocked={!!ikChainLocked}
            />
          )}
        onion={onion}
          onionPrev={onionPrev}
          onionNext={onionNext}
          onionBefore={onionBefore}
          onionAfter={onionAfter}
          showFrameBorder={showFrameBorder}
          background={stageBackground}
          settings={settings}
          guides={guides}
          onGuidesChange={setGuides}
          showGuides={showGuides}
          transformSpace={transformSpace}
          onCloseDocument={closeProject}
          welcome={showWelcome}
          documents={documents.map(({ id, name }) => ({ id, name }))}
          activeDocId={activeDocId}
          onActivateDoc={(id) => {
            if (id === '__welcome') {
              setWelcomeActive(true);
              return;
            }
            activateDocument(id);
          }}
          onCloseDoc={closeDocumentById}
          onCloseOtherDocs={closeOtherDocuments}
          onCloseAllDocs={closeAllDocuments}
          onRevealDoc={revealDocumentFolder}
          backgroundId={backgroundId}
          backgrounds={STAGE_BACKGROUNDS.map((entry) => ({ id: entry.id, name: entry.name }))}
          onBackground={setBackgroundId}
          hiddenSlots={stageHiddenSlots}
          lockedBones={lockedBones}
          hiddenBones={hiddenBones}
          lockedSlots={lockedSlots}
          selectedSlots={selectedSlots}
          selectedBone={selectedBone}
          onSelectBone={selectBone}
          onSelectSlot={selectSlot}
          scale={scale}
          onScaleChange={setScale}
          fitToken={fitToken}
          tool={tool}
          onBeginEdit={beginStageDrag}
          onEditBone={commitDrag}
          onEditSlot={commitSlotDrag}
          onSlotDragEnd={onSlotDragEnd}
          onBoneDragEnd={onBoneDragEnd}
          referenceOverlay={snapReference && snapSettings.showReference ? { url: snapReference.url, width: snapReference.width, height: snapReference.height, originX: snapSettings.originX, originY: snapSettings.originY, pxPerUnit: snapSettings.pxPerUnit || 1, opacity: snapSettings.opacity } : null}
          snapBar={player && editMode !== 'animation' && !sheetEditing ? (
            <SnapBar
              settings={snapSettings}
              onChange={patchSnapSettings}
              referenceName={snapReference?.name ?? null}
              onLoadReference={(file) => { void loadSnapReference(file); }}
              onClearReference={clearSnapReference}
              onSnapAll={snapAllParts}
              onSnapSelected={snapSelectedParts}
              onWeld={weldAllJoints}
              onFitContour={fitContourParts}
              busy={snapBusy}
              canEdit={!isReadonly()}
            />
          ) : null}
          stageOverlay={eventToasts.length > 0 ? (
            <div className="event-toasts" data-event-toasts="" role="status" aria-live="polite">
              {eventToasts.map((t) => <div key={t.id} className="event-toast" data-event-toast={t.text}>{t.text}</div>)}
            </div>
          ) : null}
          onPaintWeight={paintWeight}
          weightVertex={weightVertex}
          onClearWeightVertex={clearWeightVertex}
          onMeshVertexMove={dragMeshVertex}
          onMeshVertexRemove={dropMeshVertex}
          onMeshEdgeAdd={addMeshVertexAt}
          onMeshLineToggle={toggleMeshLine}
          onOutlineComplete={completeOutline}
          selectedSlot={selectedSlot}
          bboxMode={bboxMode}
          weightBonePick={weightBonePick}
          onAddWeightBone={addWeightBone}
          ikTargetPick={ikTargetPick}
          onPickIkTarget={pickIkTarget}
          onBBoxAddEdge={onBBoxAddEdge}
          onBBoxDeletePoint={onBBoxDeletePoint}
          selectedBones={selectedBones}
          onToggleBone={toggleBoneSelection}
          onSelectBonesRect={selectBonesInRect}
          onStageContextMenu={handleStageContextMenu}
          onRegionDrop={dropRegionOnStage}
          sheetDrag={sheetEditing && sheetPlace === 'absolute'}
          sheetSlot={sheetFrames?.slot ?? null}
          onSheetDrag={dragSheetBy}
          ffdMode={ffdMode}
          onFfdModeChange={setFfdMode}
          onFfdVertexMove={moveFfdVertex}
          version={version}
          onCreateBone={(from, to) => {
            if (!assertWritable('createBone')) return;
            if (!requireArmatureMode('创建骨骼')) return;
            if (!player) return;
            pushHistory();
            const created = addBoneBetween(player, from, to, selectedBone);
            if (created) {
              player.rebuildSkeleton();
              setSelectedBone(created);
              setSelectedSlot(null);
              flash(`创建骨骼 ${created}${selectedBone ? `（父级 ${selectedBone}）` : ''}`);
            } else {
              setNotice('创建骨骼失败：拖动距离太短');
            }
            refresh();
          }}
          onFocusArea={setFocusArea}
          onStats={setStats}
          stats={stats}
          externalHover={sceneHover}
          duration={duration}
          position={position}
          frameRate={player?.frameRate ?? 24}
          docName={docName}
          animationName={currentAnimation}
          armatureName={player?.skeleton.armature.name ?? ''}
          error={error}
          onFit={() => setFitToken((value) => value + 1)}
          onOpenFiles={openFileDialog}
          samples={samples}
          recents={recents}
          onNewProject={openNewProject}
          aiProjects={(aiProjects ?? []).map((entry) => ({ name: entry.name, thumb: aiState[entry.name]?.thumb ?? `/api/thumb/${encodeURIComponent(entry.name)}.png`, lockedBy: aiState[entry.name]?.lockedBy?.displayName ?? null }))}
          onOpenAiProject={(name) => { void openAiProject(name); }}
          onNewFromAiProject={newFromAiProject}
          onDeleteAiProject={deleteAiProject}
          onLoadSample={(sample?: WelcomeSample) => {
            const target = sample ? samples.find((item) => item.name === sample.name) : samples[0];
            if (target) void loadSample(target);
          }}
          onLoadRecent={(entry) => {
            if (entry.kind === 'workspace') {
              const project = aiProjects?.find((item) => item.name === entry.name);
              if (project) void loadSample(project);
              else {
                setNotice(`找不到项目「${entry.name}」（可能已被删除）`);
                const next = recents.filter((item) => !(item.kind === entry.kind && item.name === entry.name));
                try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* 存储不可用 */ }
                setRecents(next);
              }
            } else if (entry.kind === 'sample') {
              const sample = samples.find((item) => item.name === entry.name);
              if (sample) void loadSample(sample);
              else setNotice(`找不到示例「${entry.name}」`);
            } else {
              // 浏览器不给我们按路径重开本地文件的权限 —— 直接弹出选择框让用户重新选
              setNotice(`「${entry.name}」是本地文件：浏览器无法按路径重新打开，请在弹出的对话框里重新选择`);
              openFileDialog();
            }
          }}
          onRemoveRecent={(entry) => {
            const next = recents.filter((item) => !(item.kind === entry.kind && item.name === entry.name));
            try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* 存储不可用 */ }
            setRecents(next);
          }}
          covers={covers}
          onPreviewAnimation={previewAnimation}
          sampleName={samples[0]?.name}
        />

        <Sash
          className="sash-right"
          axis="x"
          value={rightWidth}
          min={200}
          max={640}
          onChange={setRightWidth}
          title="拖动调整右栏宽度"
        />

        {/* 右列：场景树 / 层级（官方两套 LayoutTemplate 都常驻右上）＋ 资源（仅装配）/ 动画（仅动画） */}
        <div className={`dock right${sheetEditing ? ' mode-sheet' : ''}`}>
          {sheetEditing ? (
            <Panel title="资源" icon="image" bodyClassName="dock-body" className="h-0" actions={libraryTools}>
              {libraryTree}
            </Panel>
          ) : (
          <div className="dock" data-ro-block={readonlyMode ? '' : undefined}>
            <Tabs
              tabs={[{ id: 'scene', name: '场景树' }, { id: 'drawOrder', name: '层级' }]}
              active={rightTab}
              onChange={(id) => {
                // 切页会把整棵树换掉（行卸载不触发 mouseleave），先清掉外部悬停
                setSceneHover(null);
                setRightTab(id === 'drawOrder' ? 'drawOrder' : 'scene');
              }}
              tools={rightTab === 'drawOrder' ? undefined : rightTools}
            />
            <div className="dock-body">
              {rightTab === 'drawOrder' ? (
                <DrawOrderPanel
                  player={player}
                  order={effectiveOrder}
                  marks={orderMarkMap}
                  selectedSlot={selectedSlot}
                  selectedSlots={selectedSlots}
                  onSelectSlot={selectSlot}
                  onToggleSlotSelection={(name) => {
                    // React 的 updater 必须是纯的：先按当前集合算好，再分别 set
                    const next = new Set(selectedSlots);
                    if (next.has(name)) next.delete(name); else next.add(name);
                    setSelectedSlots(next);
                    setSelectedSlot(next.has(name) ? name : (next.size > 0 ? [...next][0] : null));
                  }}
                  onHoverSlot={hoverSceneSlot}
                  onMove={moveDrawOrder}
                  animationMode={editMode === 'animation'}
                  keyStatus={orderKeyState}
                  onToggleKey={toggleOrderKey}
                  atlasUrl={atlasUrl}
                  regionRects={atlasRegionRects}
                />
              ) : (
                <ProjectBrowser
                  player={player}
                  query={query}
                  onQuery={(value) => {
                    // 搜索会过滤掉行，鼠标停在行上时不会触发 mouseleave —— 先收口，免得舞台残留高亮
                    setSceneHover(null);
                    setQuery(value);
                  }}
                  onHoverBone={hoverSceneBone}
                  onHoverSlot={hoverSceneSlot}
                  selectedBone={selectedBone}
                  onSelectBone={selectBone}
                  onToggleBoneSelection={toggleBoneSelection}
                  revealBone={reveal?.name ?? null}
                  revealToken={reveal?.token ?? 0}
                  selectedBones={selectedBones}
                  rows={rows}
                  selectedSlot={selectedSlot}
                  onSelectSlot={selectSlot}
                  selectedSlots={selectedSlots}
                  onToggleSlotSelection={(name) => {
                    // React 的 updater 必须是纯的：先按当前集合算好，再分别 set
                    const next = new Set(selectedSlots);
                    if (next.has(name)) next.delete(name); else next.add(name);
                    setSelectedSlots(next);
                    setSelectedSlot(next.has(name) ? name : (next.size > 0 ? [...next][0] : null));
                  }}
                  hiddenSlots={hiddenSlots}
                  onToggleSlot={(name) => {
                    // 和「删除插槽」一样尊重插槽多选：选中的整批切到同一个目标状态
                    const targets = selectedSlots.has(name) && selectedSlots.size > 1 ? [...selectedSlots] : [name];
                    const shouldHide = !hiddenSlots.has(name);
                    setHiddenSlots((current) => {
                      const next = new Set(current);
                      for (const target of targets) {
                        if (shouldHide) next.add(target); else next.delete(target);
                      }
                      return next;
                    });
                  }}
                  hiddenBones={hiddenBones}
                  onToggleBoneVisible={(name) => {
                    const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
                    const shouldHide = !hiddenBones.has(name);
                    setHiddenBones((current) => {
                      const next = new Set(current);
                      for (const target of targets) {
                        if (shouldHide) next.add(target); else next.delete(target);
                      }
                      return next;
                    });
                  }}
                  lockedBones={lockedBones}
                  lockedSlots={lockedSlots}
                  onToggleLockBone={(name) => {
                    const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
                    const shouldLock = !lockedBones.has(name);
                    setLockedBones((current) => {
                      const next = new Set(current);
                      for (const target of targets) {
                        if (shouldLock) next.add(target); else next.delete(target);
                      }
                      return next;
                    });
                  }}
                  onToggleLockSlot={(name) => {
                    const targets = selectedSlots.has(name) && selectedSlots.size > 1 ? [...selectedSlots] : [name];
                    const shouldLock = !lockedSlots.has(name);
                    setLockedSlots((current) => {
                      const next = new Set(current);
                      for (const target of targets) {
                        if (shouldLock) next.add(target); else next.delete(target);
                      }
                      return next;
                    });
                  }}
                  onRenameBone={(name) => setRenameTarget({ kind: 'bone', name })}
                  onRenameSlot={(name) => setRenameTarget({ kind: 'slot', name })}
                  onArmatureVisible={armatureVisible}
                  onArmatureSelectable={armatureSelectable}
                  smartFilter={sceneFilter}
                  onToggleSmartFilter={() => {
                    const next = !sceneFilter;
                    setSceneFilter(next);
                    writeSceneTreeFilter(window.localStorage, next);
                  }}
                />
              )}
            </div>
          </div>
          )}
          {!sheetEditing && (
          <Sash
            axis="y"
            value={rightTop}
            min={96}
            max={860}
            onChange={setRightTop}
            title="拖动调整「场景树 / 层级」与下方面板的高度"
          />
          )}
          {/*
            右下停靠区（官方 `LayoutTemplate` 的差异所在）：资源库只出现在**骨架装配**布局，
            动画制作布局换成动画面板 —— 也就是动画制作模式下资源窗口收起（见 §117）。
          */}
          {editMode === 'armature' && !sheetEditing && (
          <Panel title="资源" icon="image" bodyClassName="dock-body" className="h-0" actions={libraryTools}>
            <div className="library-bar">
              <button className="chip" data-library-import="" title="把 PNG 并进当前图集" onClick={() => openAssetDialog('library')}>导入到库</button>
            </div>
            {libraryTree}
          </Panel>
          )}
          {editMode === 'animation' && !sheetEditing && (
          <Panel title="动画" icon="play" bodyClassName="dock-body" className="h-0">
            <AnimationPanel
              names={animations}
              current={currentAnimation}
              onSelect={(name) => { player?.setAnimation(name); refresh(); }}
              onAdd={createAnimation}
              onClone={duplicateAnimation}
              onDelete={dropAnimation}
              onReorder={reorderAnimations}
            />
          </Panel>
          )}
        </div>
      </div>

      {!showWelcome && showTimeline && editMode === 'animation' && (
        <TimelineDock
          player={player}
          height={tlHeight}
          onHeight={setTlHeight}
          sheetTools={sheetFrames ? (
            <SheetToolbar
              total={sheetFrames.frames.length}
              current={sheetIndex()}
              playing={player?.playing ?? false}
              frameRate={sheetFrames.frameRate}
              playTimes={sheetFrames.animation?.playTimes && sheetFrames.animation.playTimes > 0 ? sheetFrames.animation.playTimes : 1}
              loop={isLooping(sheetFrames.animation)}
              showBorder={showFrameBorder}
              onionPrev={onionPrev}
              onionNext={onionNext}
              onSeek={seek}
              onStep={stepFrames}
              onTogglePlay={togglePlay}
              onSort={sortSheetFrames}
              onRemove={removeSheetFrame}
              onOnionPrev={setOnionPrev}
              onOnionNext={setOnionNext}
              onFrameRate={setSheetFrameRate}
              onPlayTimes={setSheetPlayTimes}
              onLoop={setSheetLoop}
              onShowBorder={setShowFrameBorder}
            />
          ) : undefined}
          sheetPanel={sheetFrames ? (
            <SheetPanel
              player={player}
              sheet={sheetFrames}
              frame={Math.round(position)}
              atlasUrl={atlasUrl}
              onSeek={seek}
              onRemove={removeSheetFrame}
            />
          ) : undefined}
          rows={timelineRows}
          filterOn={timelineFilter}
          onFilter={setTimelineFilter}
          filterLock={filterLockTools}
          headerTools={{
            autoKey,
            onAutoKey: (value) => { setAutoKey(value); flash(value ? '自动关键帧：开（属性变化时在播放头处落键）' : '自动关键帧：关'); },
            multiFrame,
            onMultiFrame: (value) => { setMultiFrame(value); flash(value ? '编辑多帧：开（改一个选中的关键帧，其余选中的一起加同样的增量）' : '编辑多帧：关'); },
            onPrune: pruneKeys,
            onCurveEditor: () => { setLeftBottomTab('curve'); flash('曲线编辑器在左下：选中关键帧后编辑它之后的曲线'); },
            onionBefore,
            onionAfter,
            onOnionRange: (before, after) => { setOnionBefore(before); setOnionAfter(after); },
          }}
          hiddenBones={hiddenBones}
          lockedBones={lockedBones}
          onArmatureVisible={armatureVisible}
          onArmatureSelectable={armatureSelectable}
          onToggleRowVisible={toggleRowVisible}
          onToggleRowLock={toggleRowLock}
          allKeyFrames={animationKeyFrames}
          extraTracks={extraTrackRows}
          selectedTrack={selectedTrack}
          onSelectTrack={selectTrackRow}
          onTrackKeyClick={trackKeyClick}
          trackSelection={trackSelection}
          onTrackSelection={trackSelect}
          boneTween={boneTween}
          onTween={(remove) => addTween(remove)}
          onSpanTween={spanTween}
          onSelectAllKeys={() => {
            selectAllKeys();
            setTrackSelection(allTrackRefs(extraTrackRows));
          }}
          onIsolate={(name, kind) => applyBonePattern(name, 'others', kind)}
          onToggleTrackKey={toggleTrackKey}
          onSelectColumn={selectColumnKeys}
          onShiftFrames={shiftFrames}
          selectedBone={selectedBone}
          onSelectBone={selectBone}
          onSeek={seek}
          loop={loop}
          onLoop={setLoop}
          onion={onion}
          onOnion={setOnion}
          onTogglePlay={togglePlay}
          onToggleKey={toggleKey}
          tab={tlTab}
          onTab={setTlTab}
          onFocusArea={setFocusArea}
          keySelection={keySelection}
          onKeySelection={setKeySelection}
          onKeysMove={moveSelectedKeys}
          onKeysScale={scaleSelectedKeys}
          onDeleteKeys={() => { deleteAnyKeys(); }}
          onCopyKeys={copyAnyKeys}
          onDistributeKeys={() => { distributeSelectedKeys(); }}
          onCutKeys={cutAnyKeys}
          onPasteKeys={pasteAnyKeys}
          hasClipboard={hasKeyClipboard}
          speed={speed}
          onSpeed={setSpeed}
        />
      )}

      {stageMenu?.bone && (
        <>
          <div className="stage-menu-backdrop" onClick={() => setStageMenu(null)} onContextMenu={() => setStageMenu(null)} />
          <div className="stage-menu" data-stage-menu={stageMenu.bone} ref={stageMenuRef} style={stageMenuStyle}>
            <div className="stage-menu-sub">
              <button type="button" data-stage-action="insert">插入</button>
              <div className="stage-submenu">
                <button data-stage-action="insertBone" onClick={() => {
                  const name = stageMenu.bone as string;
                  setStageMenu(null);
                  const current = playerRef.current;
                  if (!current || !requireArmatureMode('插入骨骼')) return;
                  pushHistory();
                  const created = addBone(current, { parent: name, name: `${name}_bone`, length: 30 });
                  if (created) {
                    current.rebuildSkeleton();
                    setSelectedBone(created);
                    setSelectedSlot(null);
                    setModelVersion((value) => value + 1);
                    refresh();
                    flash(`已插入骨骼 ${created}（父级 ${name}）`);
                  } else setNotice('插入骨骼失败');
                }}>骨骼</button>
                <button data-stage-action="insertSlot" onClick={() => {
                  const name = stageMenu.bone as string;
                  setStageMenu(null);
                  runSlotEdit((current) => addSlot(current, name, `${name}_slot`) !== null);
                }}>插槽</button>
                <button data-stage-action="insertBBox" onClick={() => {
                  const name = stageMenu.bone as string;
                  setStageMenu(null);
                  runSlotEdit((current) => addBoundingBoxSlot(current, name, 'bbox') !== null);
                }}>边界框</button>
              </div>
            </div>
            <div className="stage-menu-scroll">
            <hr />
            <button data-stage-action="duplicate" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current || !requireArmatureMode('克隆骨骼')) return;
              pushHistory();
              const created = cloneBone(current, name);
              if (created) {
                current.rebuildSkeleton();
                setSelectedBone(created);
                setSelectedSlot(null);
                setModelVersion((value) => value + 1);
                refresh();
                flash(`已克隆骨骼 ${name} → ${created}`);
              } else setNotice('克隆失败：骨骼不存在');
            }}>克隆</button>
            <button data-stage-action="copyBone" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const clip = copyBoneSubtree(playerRef.current, name);
              if (clip) {
                boneClipboardRef.current = clip;
                flash(`已复制骨骼 ${name}（含子树 ${clip.bones.length} 根）`);
              } else setNotice('复制失败：骨骼不存在');
            }}>复制</button>
            <button data-stage-action="pasteBone" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current || !requireArmatureMode('粘贴骨骼')) return;
              const clip = boneClipboardRef.current;
              if (!clip) { setNotice('剪贴板里还没有骨骼（先「复制」）'); return; }
              pushHistory();
              const created = pasteBoneSubtree(current, name, clip);
              if (created) {
                current.rebuildSkeleton();
                setSelectedBone(created);
                setSelectedSlot(null);
                setModelVersion((value) => value + 1);
                refresh();
                flash(`已粘贴骨骼到 ${name} 下`);
              } else setNotice('粘贴失败');
            }}>粘贴</button>
            <button data-stage-action="selectivePaste" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              if (!boneClipboardRef.current) { setNotice('剪贴板里还没有骨骼（先「复制」）'); return; }
              setPasteDialog({ parent: name, children: true, keyFrames: true });
            }}>选择性粘贴</button>
            <button data-stage-action="setParent" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); setSelectedBone(name); setParentPick(true); }}>设置父级</button>
            <button data-stage-action="copyTransform" onClick={() => { setStageMenu(null); copyTransform(); }}>复制变换</button>
            <button data-stage-action="pasteTransform" onClick={() => { setStageMenu(null); pasteTransform(); }}>粘贴变换</button>
            <hr />
            <button data-stage-action="rename" onClick={() => { setStageMenu(null); renameSelection(); }}>重命名...</button>
            <button data-stage-action="delete" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              // 和插槽那边一致：命中的骨骼在多选里就整批删（单选时还是删它自己）
              const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
              pushHistory();
              let removed = 0;
              for (const target of targets) if (removeBone(current, target)) removed++;
              if (removed > 0) {
                current.rebuildSkeleton();
                setSelectedBone(null);
                setSelectedBones(new Set());
                setModelVersion((value) => value + 1);
                refresh();
                flash(targets.length > 1 ? `已删除 ${removed} 根骨骼` : `已删除骨骼 ${name}`);
              } else {
                setNotice('删除失败：骨骼不存在，或它是根骨骼');
              }
            }}>删除</button>
            <hr />
            <button data-stage-action="lock" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
              const shouldLock = !lockedBones.has(name);
              setLockedBones((current) => {
                const next = new Set(current);
                for (const target of targets) {
                  if (shouldLock) next.add(target); else next.delete(target);
                }
                return next;
              });
            }}>{lockedBones.has(stageMenu.bone) ? '解锁' : '锁定'}</button>
            <button data-stage-action="hideBone" onClick={() => {
              const name = stageMenu.bone as string;
              setStageMenu(null);
              const targets = selectedBones.has(name) && selectedBones.size > 1 ? [...selectedBones] : [name];
              const shouldHide = !hiddenBones.has(name);
              setHiddenBones((current) => {
                const next = new Set(current);
                for (const target of targets) {
                  if (shouldHide) next.add(target); else next.delete(target);
                }
                return next;
              });
            }}>{hiddenBones.has(stageMenu.bone) ? '显示' : '隐藏'}</button>
            <button data-stage-action="hideOthers" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'others', 'hide'); }}>隐藏其他</button>
            <button data-stage-action="hideIrrelevant" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'irrelevant', 'hide'); }}>隐藏无关</button>
            <button data-stage-action="hideRelated" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'related', 'hide'); }}>隐藏相关</button>
            <button data-stage-action="lockOthers" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'others', 'lock'); }}>锁定其他</button>
            <button data-stage-action="lockIrrelevant" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'irrelevant', 'lock'); }}>锁定无关</button>
            <button data-stage-action="lockRelated" onClick={() => { const name = stageMenu.bone as string; setStageMenu(null); applyBonePattern(name, 'related', 'lock'); }}>锁定相关</button>
            <button data-stage-action="showAll" onClick={() => { setStageMenu(null); setLockedBones(new Set()); setLockedSlots(new Set()); setHiddenSlots(new Set()); setHiddenBones(new Set()); }}>显示并解锁全部</button>
            <hr />
            <button data-stage-action="selectParent" onClick={() => { setStageMenu(null); selectRelative('parent'); }}>选择父级</button>
            <button data-stage-action="selectChildBones" onClick={() => { setStageMenu(null); selectRelative('child'); }}>选择子骨骼</button>
            <button data-stage-action="selectChildSlots" onClick={() => {
              const bone = stageMenu.bone as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const index = current.skeleton.boneIndexByName.get(bone) ?? -1;
              const names = current.skeleton.slots.filter((slot) => slot.parentBone === index).map((slot) => slot.name);
              if (names.length === 0) { setNotice('这根骨骼上没有插槽'); return; }
              setSelectedSlots(new Set(names));
              setSelectedSlot(names[0]);
              setSelectedBone(null);
              flash(`已选中 ${names.length} 个插槽`);
            }}>选择子插槽</button>
            <button data-stage-action="selectInverse" onClick={() => { setStageMenu(null); invertBoneSelection(); }}>反选</button>
            </div>
          </div>
        </>
      )}

      {stageMenu?.slot && !stageMenu.bone && (
        <>
          <div className="stage-menu-backdrop" onClick={() => setStageMenu(null)} onContextMenu={() => setStageMenu(null)} />
          <div className="stage-menu" data-stage-slot-menu={stageMenu.slot} ref={stageMenuRef} style={stageMenuStyle}>
            <div className="stage-menu-scroll">
            <button data-stage-action="deleteSlot" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              // 插槽多选里包含右键的这一项时，一次删掉整个选区（单选时就是删它自己）
              const targets = selectedSlots.has(slot) && selectedSlots.size > 1 ? [...selectedSlots] : [slot];
              setSelectedSlot(slot);
              runSlotEdit((current) => {
                let ok = false;
                for (const name of targets) ok = removeSlot(current, name) || ok;
                return ok;
              });
              setSelectedSlots(new Set());
              if (targets.length > 1) flash(`已删除 ${targets.length} 个插槽`);
            }}>删除插槽</button>
            <hr />
            <button data-stage-action="bringForward" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              reorderFromMenu(slot, 'forward');
            }}>移到上一层</button>
            <button data-stage-action="sendBackward" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              reorderFromMenu(slot, 'backward');
            }}>移到下一层</button>
            <button data-stage-action="bringToFront" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              reorderFromMenu(slot, 'front');
            }}>移到最上层</button>
            <button data-stage-action="sendToBottom" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              reorderFromMenu(slot, 'bottom');
            }}>移到最下层</button>
            <hr />
            <button data-stage-action="copySlotProperty" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              slotPropertyClipboardRef.current = {
                color: readSlotColor(current, slot),
                blendMode: slotData(current.skeleton.armature, slot)?.blendMode,
              };
              flash(`已复制插槽属性：${slot}`);
            }}>复制插槽属性</button>
            <button data-stage-action="pasteSlotProperty" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const clip = slotPropertyClipboardRef.current;
              if (!clip) { setNotice('剪贴板里还没有插槽属性（先「复制插槽属性」）'); return; }
              runSlotEdit((current) => {
                let ok = false;
                if (clip.color) ok = setSlotColor(current, slot, clip.color) || ok;
                if (clip.blendMode !== undefined) ok = setSlotBlendMode(current, slot, clip.blendMode) || ok;
                return ok;
              });
            }}>粘贴插槽属性</button>
            <hr />
            <button data-stage-action="swapImage" disabled={editMode !== 'armature'} title={editMode === 'armature' ? '替换图片' : sheetEditing ? '序列帧不使用骨架装配' : '替换图片只在骨架装配模式下可用（Ctrl+Tab 切换）'} onClick={() => {
              if (!requireArmatureMode('替换图片')) return;
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              setSwapTarget({ slot, index: slotData(current.skeleton.armature, slot)?.displayIndex ?? 0 });
            }}>替换图片...</button>
            <button data-stage-action="hideOthersLayer" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              applySlotPattern(slot, 'hide');
            }}>隐藏其他</button>
            <button data-stage-action="lockOthersLayer" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              applySlotPattern(slot, 'lock');
            }}>锁定其他</button>
            <button data-stage-action="showInLibrary" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const skinSlot = current.skeleton.currentSkin()?.slot.find((entry) => entry.name === slot);
              const index = slotData(current.skeleton.armature, slot)?.displayIndex ?? 0;
              const display = skinSlot?.display?.[index];
              const name = display?.path ?? display?.name ?? null;
              if (!name) { setNotice('这个插槽没有可显示的图片'); return; }
              setLibraryHighlight(name);
              setLibraryNode(`img:${current.skeleton.armature.name}:${name}`);
              setSceneHover(null);
              // 资源窗口只挂在「骨架装配」布局里（官方两套 LayoutTemplate），动画制作模式如实说明
              flash(editMode === 'armature'
                ? `在资源库中显示：${name}`
                : `在资源库中显示：${name}（资源窗口只在「骨架装配」显示）`);
            }}>在资源库中显示</button>
            <hr />
            <button data-stage-action="convertToMesh" disabled={editMode !== 'armature'} title={editMode === 'armature' ? '转换为网格' : sheetEditing ? '序列帧不使用骨架装配' : '转换为网格只在骨架装配模式下可用（Ctrl+Tab 切换）'} onClick={() => {
              if (!requireArmatureMode('转换为网格')) return;
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              setSelectedSlot(slot);
              void autoOutlineSelection(3, { slot });
            }}>转换为网格</button>
            <button data-stage-action="convertToImage" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              setSelectedSlot(slot);
              runSlotEdit((current) => {
                const skinSlot = current.skeleton.currentSkin()?.slot.find((entry) => entry.name === slot);
                const index = slotData(current.skeleton.armature, slot)?.displayIndex ?? 0;
                const display = skinSlot?.display?.[index];
                if (!display) return false;
                const ok = convertMeshToImage(display);
                if (ok) flash(`已转换为图片：${slot}`); else flash('转换为图片：这个显示对象不是网格');
                return ok;
              });
            }}>转换为图片</button>
            <button data-stage-action="convertToSymbol" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              setSymbolPicker({ slot, index: slotData(current.skeleton.armature, slot)?.displayIndex ?? 0 });
            }}>转换为元件...</button>
            <hr />
            <button data-stage-action="copyDisplay" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const index = slotData(current.skeleton.armature, slot)?.displayIndex ?? 0;
              const display = current.skeleton.currentSkin()?.slot.find((entry) => entry.name === slot)?.display?.[index];
              if (!display) { setNotice('这个插槽没有显示对象'); return; }
              displayClipboardRef.current = JSON.parse(JSON.stringify(display));
              flash(`已复制显示对象：${display.path ?? display.name ?? slot}`);
            }}>复制显示对象</button>
            <button data-stage-action="pasteDisplay" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const clip = displayClipboardRef.current;
              if (!clip) { setNotice('剪贴板里还没有显示对象（先「复制显示对象」）'); return; }
              setSelectedSlot(slot);
              runSlotEdit((player) => appendSlotDisplay(player, slot, clip));
            }}>粘贴显示对象</button>
            <button data-stage-action="switchDisplay" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const list = current.skeleton.currentSkin()?.slot.find((entry) => entry.name === slot)?.display ?? [];
              if (list.length < 2) { setNotice('这个插槽只有一个显示对象'); return; }
              const index = slotData(current.skeleton.armature, slot)?.displayIndex ?? 0;
              runSlotEdit((player) => setSlotDisplayIndex(player, slot, (index + 1) % list.length));
            }}>切换显示对象</button>
            <button data-stage-action="deleteDisplay" onClick={() => {
              const slot = stageMenu.slot as string;
              setStageMenu(null);
              setSelectedSlot(slot);
              runSlotEdit((player) => removeSlotDisplay(player, slot));
            }}>删除显示对象</button>
            <hr />
            <button data-stage-action="selectAllSlots" onClick={() => {
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const names = current.skeleton.slots.map((entry) => entry.name);
              if (names.length === 0) { setNotice('当前骨架没有插槽'); return; }
              setSelectedSlots(new Set(names));
              setSelectedSlot(names[0]);
              setSelectedBone(null);
              flash(`已选中全部 ${names.length} 个插槽`);
            }}>选择全部插槽</button>
            <button data-stage-action="invertSlotSelection" onClick={() => {
              setStageMenu(null);
              const current = playerRef.current;
              if (!current) return;
              const names = current.skeleton.slots.map((entry) => entry.name);
              const next = new Set(names.filter((name) => !selectedSlots.has(name)));
              setSelectedSlots(next);
              setSelectedSlot(next.size > 0 ? [...next][0] : null);
              setSelectedBone(null);
              flash(next.size > 0 ? `反选后选中 ${next.size} 个插槽` : '反选后没有插槽被选中');
            }}>反选插槽</button>
            </div>
          </div>
        </>
      )}
      {symbolPicker && (
        <>
          <div className="stage-menu-backdrop" onClick={() => setSymbolPicker(null)} />
          <div className="paste-dialog" data-symbol-picker>
            <h3>转换为元件</h3>
            <div className="symbol-list">
              {(player?.armatureNames() ?? []).filter((name) => name !== player?.skeleton.armature.name).map((name) => (
                <button key={name} data-symbol-option={name} onClick={() => {
                  const picker = symbolPicker;
                  setSymbolPicker(null);
                  const current = playerRef.current;
                  if (!current || !picker) return;
                  setSelectedSlot(picker.slot);
                  runSlotEdit((target) => {
                    const list = target.skeleton.currentSkin()?.slot.find((entry) => entry.name === picker.slot)?.display;
                    const display = list?.[picker.index];
                    if (!display) return false;
                    const ok = convertDisplayToArmature(display, name);
                    if (ok) flash(`已把 ${picker.slot} 转换为元件 ${name}`);
                    return ok;
                  });
                }}>{name}</button>
              ))}
            </div>
            <div className="row">
              <button data-symbol-action="cancel" onClick={() => setSymbolPicker(null)}>取消</button>
            </div>
          </div>
        </>
      )}

      {pasteDialog && (
        <>
          <div className="stage-menu-backdrop" onClick={() => setPasteDialog(null)} />
          <div className="paste-dialog" data-paste-dialog>
            <h3>选择粘贴内容</h3>
            <label>
              <input type="checkbox" data-paste-option="children" checked={pasteDialog.children}
                onChange={(event) => setPasteDialog({ ...pasteDialog, children: event.target.checked })} />
              子骨骼
            </label>
            <label>
              <input type="checkbox" data-paste-option="keyFrames" checked={pasteDialog.keyFrames}
                onChange={(event) => setPasteDialog({ ...pasteDialog, keyFrames: event.target.checked })} />
              动画关键帧
            </label>
            <div className="row">
              <button data-paste-action="cancel" onClick={() => setPasteDialog(null)}>取消</button>
              <button data-paste-action="ok" onClick={() => {
                const current = playerRef.current;
                const clip = boneClipboardRef.current;
                const parent = pasteDialog.parent;
                const options = { children: pasteDialog.children, keyFrames: pasteDialog.keyFrames };
                setPasteDialog(null);
                if (!current || !clip || !requireArmatureMode('粘贴骨骼')) return;
                pushHistory();
                const created = pasteBoneSubtree(current, parent, clip, options);
                if (created) {
                  current.rebuildSkeleton();
                  setSelectedBone(created);
                  setSelectedSlot(null);
                  setModelVersion((value) => value + 1);
                  refresh();
                  flash(`已选择性粘贴到 ${parent} 下（子骨骼 ${options.children ? "开" : "关"} · 关键帧 ${options.keyFrames ? "开" : "关"}）`);
                } else setNotice('选择性粘贴失败');
              }}>确定</button>
            </div>
          </div>
        </>
      )}
      {!showWelcome && (
      <StatusBar>
        <span className="dot" />
        {parentPick ? (
          <>
            <span>设置父级</span>
            <span className="muted">点击新父级骨骼（舞台 / 工程面板 / 时间轴均可，Esc 取消）</span>
          </>
        ) : (
          <>
            <span>{toolDef.name}</span>
            <span className="muted">{toolDef.hint}</span>
          </>
        )}
        <span className="spacer" />
        {selectedBone && values && (
          <span className="metric">
            {selectedBone} · X {values.x.toFixed(1)} · Y {values.y.toFixed(1)} · 旋转 {values.skX.toFixed(1)}°
          </span>
        )}
        <span className="metric">缩放 {(scale * 100).toFixed(0)}%</span>
        <span className="metric">{stats.items} 对象</span>
        <span className="metric">{stats.ms.toFixed(1)} ms</span>
        <span className="metric">{stats.fps.toFixed(0)} fps</span>
        <span className="metric">{Math.round(position)} / {duration} 帧</span>
      </StatusBar>
      )}

      {swapTarget && player?.atlas && (
        <SwapImageDialog
          regions={player.atlas.regions.map((region) => region.name)}
          current={(() => {
            const skinSlot = player.skeleton.currentSkin()?.slot.find((entry) => entry.name === swapTarget.slot);
            const display = skinSlot?.display?.[swapTarget.index];
            return display ? (display.path ?? display.name ?? null) : null;
          })()}
          onPick={(name) => {
            if (!player || !swapTarget) return;
            pushHistory();
            if (swapDisplayImage(player, swapTarget.slot, swapTarget.index, name)) {
              setModelVersion((value) => value + 1);
              refresh();
              flash(`替换图片 → ${name}`);
            } else {
              flash('替换图片：当前已经引用这张图片');
            }
            setSwapTarget(null);
          }}
          onClose={() => setSwapTarget(null)}
        />
      )}
      {showNewSymbol && (
        <NewSymbolDialog
          existing={player?.armatureNames() ?? []}
          onCreate={createSymbol}
          onClose={() => setShowNewSymbol(false)}
        />
      )}

      {renameTarget && player && (
        <RenameDialog
          kind={renameTarget.kind}
          current={renameTarget.name}
          taken={renameTarget.kind === 'bone'
            ? (player.skeleton.armature.bone ?? []).map((entry) => entry.name)
            : (player.skeleton.armature.slot ?? []).map((entry) => entry.name)}
          onSubmit={commitRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {confirmAsk && (
        <ConfirmDialog
          title={confirmAsk.title}
          message={confirmAsk.message}
          onConfirm={() => { const run = confirmAsk.onConfirm; setConfirmAsk(null); run(); }}
          onClose={() => setConfirmAsk(null)}
        />
      )}

      {showNewProject && (
        <NewProjectDialog onPick={createProject} onClose={() => setShowNewProject(false)} />
      )}

      {showPlugins && (
        <PluginDialog
          plugins={plugins}
          onInstallFile={(file) => { void installPluginFile(file); }}
          onInstallUrl={installPluginFromUrl}
          onToggle={togglePlugin}
          onRemove={dropPlugin}
          onRun={(plugin) => { void runPlugin(plugin); }}
          onClose={() => setShowPlugins(false)}
        />
      )}

      {helpTopic && (
        <HelpDialog topic={helpTopic} onTopic={setHelpTopic} onClose={() => setHelpTopic(null)} />
      )}

      {aiLockPrompt && (
        <div className="confirm-dialog" data-ai-lock-prompt="" onClick={() => setAiLockPrompt(null)}>
          <div className="panel ailock-panel" role="dialog" aria-labelledby="ailock-title" onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === 'Escape') setAiLockPrompt(null); }}>
            <div className="ailock-head">
              <span className="ailock-icon" aria-hidden="true">🔒</span>
              <div className="ailock-headtext">
                <span id="ailock-title" className="ailock-title">工程正被 agent 编辑</span>
                <span className="ailock-sub">为避免和 agent 的写入冲突，请选择打开方式</span>
              </div>
            </div>
            <div className="ailock-info confirm-message">
              <div className="ailock-kv"><span className="ailock-k">工程</span><span className="ailock-v" title={aiLockPrompt.sample.name}>{aiLockPrompt.sample.name}</span></div>
              <div className="ailock-kv"><span className="ailock-k">持锁 agent</span><span className="ailock-v" title={aiLockPrompt.holder}><span className="ailock-dot" />{aiLockPrompt.holder}</span></div>
            </div>
            <div className="ailock-actions">
              <button className="ailock-opt primary" data-ai-lock-watch="" autoFocus onClick={() => {
                const { sample: entry, sessionId } = aiLockPrompt;
                setAiLockPrompt(null);
                window.open(`/?aiproject=${encodeURIComponent(entry.name)}&live=1&readonly=1&agent=${encodeURIComponent(sessionId)}`, '_blank');
              }}>
                <span className="ailock-opt-icon">👁</span>
                <span className="ailock-opt-text"><span className="ailock-opt-label">只读观看（新标签页）</span><span className="ailock-opt-desc">实时看 agent 的编辑，不会影响它（推荐）</span></span>
              </button>
              <button className="ailock-opt" data-ai-lock-new="" onClick={() => { const name = aiLockPrompt.sample.name; setAiLockPrompt(null); newFromAiProject(name); }}>
                <span className="ailock-opt-icon">＋</span>
                <span className="ailock-opt-text"><span className="ailock-opt-label">基于它新建</span><span className="ailock-opt-desc">复制当前已保存的版本，保存为 projects/ 里的独立新工程</span></span>
              </button>
              <button className="ailock-opt warn" data-ai-lock-open="" onClick={() => { const entry = aiLockPrompt.sample; setAiLockPrompt(null); void loadSample(entry); }}>
                <span className="ailock-opt-icon">⚠</span>
                <span className="ailock-opt-text"><span className="ailock-opt-label">仍然打开编辑</span><span className="ailock-opt-desc">只是本地副本，不写回工作区，可能很快与 agent 不一致</span></span>
              </button>
            </div>
            <div className="ailock-foot">
              <button className="ailock-cancel" data-ai-lock-cancel="" onClick={() => setAiLockPrompt(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {showAiPanel && (
        <AiMcpDialog onClose={() => setShowAiPanel(false)} sampleName={liveParams.name}
          onOpenProject={readonlyMode ? undefined : (name) => { setShowAiPanel(false); void openAiProject(name); }} />
      )}

      {showExport && player && (
        <ExportDialog
          armatureName={player.skeleton.armature.name || 'armature'}
          projectName={projectNameRef.current || player.doc.name || player.skeleton.armature.name || 'project'}
          atlasUrl={atlasUrl}
          canPickDirectory={directoryPicker() !== null}
          onExport={runExport}
          onClose={() => setShowExport(false)}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
          locale={locale}
          onLocaleChange={(next) => {
            setLocaleState(next);
            setLocale(next);
            flash(next === 'en_US' ? 'Language: English' : '界面语言：简体中文');
          }}
          hotkeys={hotkeys}
          onHotkeyChange={(id, keys) => {
            const conflict = findConflict(id, keys, hotkeys);
            setHotkeys((current) => ({ ...current, [id]: keys }));
            if (conflict) setNotice(`快捷键冲突：「${keys}」已经用在「${labelOf(conflict)}」上`);
            else flash(`快捷键：${labelOf(id)} → ${keys}`);
          }}
          onHotkeyReset={(id) => setHotkeys((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          })}
          onHotkeyResetAll={() => {
            setHotkeys({});
            flash('已恢复默认快捷键设置');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {toast && (
        <div className="toast" data-toast={toast} role="status">{toast}</div>
      )}

      {notice && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 60 }}
          onClick={() => setNotice(null)}
        >
          <div
            style={{ width: 460, background: 'var(--bg-panel)', border: '1px solid var(--line-strong)', borderRadius: 4, boxShadow: '0 22px 60px rgba(0,0,0,.6)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-head">
              <span className="panel-title">提示</span>
              <span className="spacer" />
              <HeadButton icon="x" title="关闭" onClick={() => setNotice(null)} />
            </div>
            <div data-notice="" style={{ padding: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text-dim)' }}>{notice}</div>
          </div>
        </div>
      )}
    </div>
  );
}

