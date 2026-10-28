/**
 * 「新建工程」的骨架模板。
 *
 * 结构**逐字段取自官方 `.dbproj` 的空工程产物**：在 DragonBones 里新建后原样保存，
 * 再用本仓库的 AMF3 解码器读出 `dragonBones` 段（见 格式规范）。
 * 这样"新建"出来的工程在数据上与官方新建的工程一致 —— 差异会被测试直接抓出来。
 */
import { wrapSkeletonAsProject, type DbprojDocument } from './dbproj';

export interface NewProjectOptions {
  /** 骨架名，官方的默认值是 `Armature` */
  name?: string;
  frameRate?: number;
}

/** 官方空工程的骨架：1 根 `root` 骨骼、0 槽位、0 动画、无 skin。 */
export function emptySkeleton(options: NewProjectOptions = {}): Record<string, unknown> {
  const name = options.name ?? 'Armature';
  const frameRate = options.frameRate ?? 24;
  return {
    version: '5.5',
    frameRate,
    armature: [
      {
        defaultActions: [{ gotoAndPlay: '' }],
        type: 'Armature',
        frameRate,
        skin: [],
        animation: [],
        ik: [],
        bone: [
          {
            inheritRotation: true,
            inheritScale: true,
            transform: { skX: 0, y: 0, skY: 0, scX: 1, scY: 1, x: 0 },
            name: 'root',
            // 官方给新建骨骼的默认标记色（ARGB 白）
            boneSymbolColor: 4294967295,
            id: 2,
          },
        ],
        name,
        slot: [],
        id: 1,
      },
    ],
  };
}

/** 直接产出一个可保存的 `.dbproj` 文档。 */
export function newProjectDocument(options?: NewProjectOptions): DbprojDocument {
  return wrapSkeletonAsProject(emptySkeleton(options));
}

/**
 * 官方**序列帧（Sheet）**工程的骨架：`armature.type = "sheet"` + 一个承载帧的槽位。
 *
 * **格式验证边界**：仓库里没有「官方新建序列帧工程后保存」的 `.dbproj` 样本可以做逐字段对拍，
 * 所以字段集是照**已验证的官方导出**（`samples/FramesAnimation/FramesAnimation_ske.json`）构造的：
 * 它同样是 `type: "sheet"`、1 个槽位、skin 里放 display 列表（帧）、1 条动画。
 * 初始帧列表为空 —— 对应官方面板空态「拖拽图片到这里」（`Sheet.first.tip`）。
 */
export function emptySheetSkeleton(options: NewProjectOptions = {}): Record<string, unknown> {
  const name = options.name ?? 'Armature';
  const frameRate = options.frameRate ?? 24;
  return {
    version: '5.5',
    frameRate,
    armature: [
      {
        defaultActions: [{ gotoAndPlay: '' }],
        type: 'sheet',
        frameRate,
        skin: [{ slot: [{ name: 'sheetSlot', display: [] }] }],
        animation: [{ duration: 0, name: 'Animation1', slot: [], ffd: [] }],
        ik: [],
        bone: [
          {
            inheritRotation: true,
            inheritScale: true,
            transform: { skX: 0, y: 0, skY: 0, scX: 1, scY: 1, x: 0 },
            name: 'root',
            boneSymbolColor: 4294967295,
            id: 2,
          },
        ],
        name,
        slot: [{ name: 'sheetSlot', parent: 'root' }],
        id: 1,
      },
    ],
  };
}