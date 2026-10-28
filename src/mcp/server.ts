/**
 * BoneStudio MCP server — exposes the editor kernel to agents over stdio.
 *
 * Transport is newline-delimited JSON-RPC 2.0 (the MCP stdio framing): one JSON object per
 * line, no embedded newlines. Zero dependencies on purpose — the whole surface is
 * `initialize` / `tools/list` / `tools/call`, and every tool lands in `core/editing`, so an
 * agent drives the *same* command path the UI does (undoable, verifiable).
 *
 * Build + run:
 *   npm run build:mcp      # vite build --ssr -> dist-mcp/server.js
 *   npm run mcp            # node dist-mcp/server.js
 *
 * Wire into an MCP client as a stdio server whose command is `npm run --silent mcp`.
 */

import { createInterface } from 'node:readline';
import {
aiApply, aiPlan,
  animationDetail, animationsList, boneCreate, boneDelete, boneKeyframeSet, boneTransformGet, boneUpdate,
  bonesList, bonesTree, historyRedo, historyStatus, historyUndo, meshDetail, openProject, skeletonExport,
  slotsList, summaryOf, type EditorState,
} from './tools';
import * as studio from './studio';
import { Session } from './session';
import { projectsDir, safeName, setWriteGuard } from './workspace';
import type { StudioState } from './studio';
import { readFileSync as readFile, existsSync as exists } from 'node:fs';
import { dirname as dirOf, join as joinPath } from 'node:path';
import { decodePng as decode } from '../tools/png';

const PROTOCOL_VERSION = '2024-11-05';
/** 客户端声明的版本若在此列表里就照回（MCP 版本协商），否则回我们的默认版本 */
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const SERVER_INFO = { name: 'bone-studio', version: '0.2.0' };

const state: StudioState = { player: null, path: '' };

/* ---------- 会话登记 + 写锁 ---------- */
const session = new Session({ projectsDir: projectsDir() });
setWriteGuard((project) => session.acquire(project));
session.start();
const shutdown = () => { session.close(); };
process.on('exit', shutdown);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { shutdown(); process.exit(0); });
process.stdin.on('end', () => { shutdown(); process.exit(0); });

/** 会改工程的工具：当前工程是工作区工程时，先抢写锁（被别的活会话锁住 → 报错，不改内存） */
const WRITE_TOOLS = new Set(['project_new', 'project_import', 'project_save', 'image_add', 'layers_add', 'slot_create', 'slot_update', 'mesh_create', 'weights_auto', 'weights_set', 'animation_create', 'animation_update', 'bone_key', 'bone_keys', 'slot_key', 'event_key', 'bone_keyframe_set', 'ai_apply', 'history_undo', 'history_redo', 'bone_create', 'bone_delete', 'bone_update', 'ik_set', 'snap_to_reference', 'weld_joints', 'fit_contour', 'mesh_stretch', 'region_erase', 'draw_order_key']);
const RENDER_TOOLS = new Set(['render_frame', 'render_animation', 'editor_url', 'editor_screenshot']);
const workspaceProject = (): string | null => (state.name && state.autoSync ? safeName(state.name) : null);

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties, required, additionalProperties: false,
});

const TOOLS: ToolDef[] = [
  {
    name: 'open_project',
    description: '打开 BoneStudio 工程或任一 *_ske.json / *_ske.dbbin（可选纹理图集），返回骨架摘要。',
    inputSchema: obj({
      file: str('骨架文件路径（*_ske.json 或 *_ske.dbbin）'),
      texture: str('可选的 *_tex.json 路径'),
      armature: str('可选：要切到的骨架名'),
      animation: str('可选：要切到的动画名'),
    }, ['file']),
    run: (args) => {
      const out = openProject(state, args as never);
      // 有纹理就把图集页也载进来，渲染 / 导出 / 同步才能用
      const a = args as { texture?: string };
      state.tex = null; state.page = null; state.autoSync = false; state.name = String(state.player?.doc.name ?? 'project');
      if (a.texture && exists(a.texture)) {
        state.tex = JSON.parse(readFile(a.texture, 'utf8'));
        const png = joinPath(dirOf(a.texture), String(state.tex?.imagePath ?? ''));
        if (exists(png)) state.page = decode(readFile(png));
      }
      return out;
    },
  },
  {
    name: 'skeleton_summary',
    description: '当前工程的摘要：骨骼/槽位/皮肤/显示对象/IK 数量、动画列表、帧率。',
    inputSchema: obj({}, []),
    run: () => summaryOf(state),
  },
  {
    name: 'bones_list',
    description: '列出所有骨骼：索引、名称、父级、长度、绑定姿态。',
    inputSchema: obj({}, []),
    run: () => bonesList(state),
  },
  {
    name: 'animations_list',
    description: '列出动画名、当前动画、时长与帧率。',
    inputSchema: obj({}, []),
    run: () => animationsList(state),
  },
  {
    name: 'bone_transform_get',
    description: '读取某骨骼在指定帧的绝对变换（x/y/skX/skY/scX/scY）、关键帧位置与当前世界矩阵。',
    inputSchema: obj({ bone: str('骨骼名'), frame: num('帧号，缺省用当前播放头') }, ['bone']),
    run: (args) => boneTransformGet(state, args as never),
  },
  {
    name: 'bone_keyframe_set',
    description: '在指定帧给骨骼打关键帧（transform 是绝对姿态，只需给出要改的字段）；remove=true 则删除该帧关键帧。',
    inputSchema: obj({
      bone: str('骨骼名'),
      frame: num('帧号'),
      remove: { type: 'boolean', description: '删除该帧的关键帧' },
      transform: {
        type: 'object',
        description: '绝对姿态补丁：x / y / skX / skY / scX / scY（只写给出的字段）',
        properties: { x: { type: 'number' }, y: { type: 'number' }, skX: { type: 'number' }, skY: { type: 'number' }, scX: { type: 'number' }, scY: { type: 'number' } },
        additionalProperties: false,
      },
    }, ['bone', 'frame']),
    run: (args) => boneKeyframeSet(state, args as never),
  },
{
    name: 'ai_plan',
    description: '自然语言 → 命令清单（**不落盘**）：先看 AI 打算改什么。capability 可选（lip-sync / motion-transfer）。',
    inputSchema: obj({
      prompt: str('自然语言指令，例如「口型 slot=beak_lower: 你好」或「动作迁移 from=rooster_walk_anim to=walk-copy」'),
      capability: str('可选：只跑某个 capability'),
    }, ['prompt']),
    run: (args) => aiPlan(state, args as never),
  },
  {
    name: 'ai_apply',
    description: '自然语言 → 直接应用（进撤销栈，可 history_undo 回退）：返回应用条数与每步说明。',
    inputSchema: obj({
      prompt: str('自然语言指令'),
      capability: str('可选：只跑某个 capability'),
    }, ['prompt']),
    run: (args) => aiApply(state, args as never),
  },
  {
    name: 'skeleton_export',
    description: '把当前文档导出到文件：type=json 写 *_ske.json，type=binary（默认）写 *_ske.dbbin。',
    inputSchema: obj({ out: str('输出文件路径'), type: { type: 'string', enum: ['json', 'binary'] } }, ['out']),
    run: (args) => skeletonExport(state, args as never),
  },
  {
    name: 'bones_tree',
    description: '骨骼层级树（按绘制顺序缩进）：名称、深度、索引、父级、长度、当前动画是否有关键帧。',
    inputSchema: obj({}, []),
    run: () => bonesTree(state),
  },
  {
    name: 'slots_list',
    description: '列出槽位：索引、名称、父骨骼、当前显示索引、显示对象数、z 序、混合模式、颜色变换。',
    inputSchema: obj({}, []),
    run: () => slotsList(state),
  },
  {
    name: 'animation_detail',
    description: '某条动画的完整关键帧表（逐骨骼：帧号 + 时长 + 变换 + 缓动），另附槽位/FFD/IK 时间轴计数。',
    inputSchema: obj({ animation: str('动画名，缺省用当前动画') }, []),
    run: (args) => animationDetail(state, args as never),
  },
  {
    name: 'mesh_detail',
    description: '某槽位网格的顶点、三角形、轮廓边与绑定骨骼列表（只读）。',
    inputSchema: obj({ slot: str('槽位名') }, ['slot']),
    run: (args) => meshDetail(state, args as never),
  },
  {
    name: 'history_status',
    description: '当前会话的撤销 / 重做栈深度。',
    inputSchema: obj({}, []),
    run: () => historyStatus(state),
  },
  {
    name: 'history_undo',
    description: '撤销最近一次写操作（回到上一个 armature 快照）。',
    inputSchema: obj({}, []),
    run: () => historyUndo(state),
  },
  {
    name: 'history_redo',
    description: '重做刚才被撤销的那一步。',
    inputSchema: obj({}, []),
    run: () => historyRedo(state),
  },
  {
    name: 'bone_create',
    description: '新建骨骼（可指定父级、绑定变换、长度）；名字冲突时自动加后缀。返回实际使用的名字与撤销栈深度。',
    inputSchema: obj({
      name: str('期望的骨骼名，缺省 bone'),
      parent: str('父骨骼名；省略或空串表示挂在骨架根下'),
      transform: {
        type: 'object',
        description: '相对父级的绑定变换',
        properties: { x: { type: 'number' }, y: { type: 'number' }, skX: { type: 'number' }, skY: { type: 'number' }, scX: { type: 'number' }, scY: { type: 'number' } },
        additionalProperties: false,
      },
      length: num('骨骼长度（参与双骨 IK 与骨骼 overlay 绘制）'),
    }, []),
    run: (args) => boneCreate(state, args as never),
  },
  {
    name: 'bone_delete',
    description: '删除骨骼：它的子骨骼与挂在它下面的槽位会上提一级，并做世界坐标补偿（位置不跳）。可撤销。',
    inputSchema: obj({ bone: str('骨骼名') }, ['bone']),
    run: (args) => boneDelete(state, args as never),
  },
  {
    name: 'bone_update',
    description: '修改骨骼：重命名 / 改父级 / 改长度 / 改绑定变换 transform{x,y,rotation,skX,skY,scX,scY}（keepChildren:true 时子骨骼与槽位世界位置不变），可同时给出。可撤销。',
    inputSchema: obj({
      bone: str('要改的骨骼名'),
      rename: str('新名字'),
      parent: str('新父级；空串表示改成根骨骼'),
      length: num('新长度'),
      transform: {
        type: 'object',
        description: '新的绑定变换（相对父级，只改给出的分量）：x/y 像素、rotation 度（顺时针，同时设 skX/skY 并保留原斜切）、或直接 skX/skY/scX/scY',
        properties: { x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' }, skX: { type: 'number' }, skY: { type: 'number' }, scX: { type: 'number' }, scY: { type: 'number' } },
        additionalProperties: false,
      },
      inherit: { type: 'object', description: '继承开关：{rotation,scale,translation,reflection: boolean}（false=不继承父级该分量）', properties: { rotation: { type: 'boolean' }, scale: { type: 'boolean' }, translation: { type: 'boolean' }, reflection: { type: 'boolean' } }, additionalProperties: false },
      keepChildren: { type: 'boolean', description: 'true=子骨骼和挂在本骨骼上的槽位保持世界位置不变（只移动这根骨骼本身）；默认 false 子级跟着动' },
    }, ['bone']),
    run: (args) => boneUpdate(state, args as never),
  },
];

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
function replyError(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

async function handle(message: Record<string, unknown>): Promise<void> {
  const { id, method, params } = message as { id?: unknown; method?: string; params?: Record<string, unknown> };
  if (method === 'initialize') {
    const wanted = String((params as { protocolVersion?: string } | undefined)?.protocolVersion ?? '');
    session.setClient((params as { clientInfo?: { name?: string; version?: string } } | undefined)?.clientInfo);
    reply(id, { protocolVersion: SUPPORTED_PROTOCOLS.includes(wanted) ? wanted : PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;      // notifications carry no id
  if (method === 'ping') { reply(id, {}); return; }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    return;
  }
  if (method === 'tools/call') {
    const name = String(params?.name ?? '');
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    const tool = TOOLS.find((entry) => entry.name === name);
    if (!tool) { replyError(id, -32602, `unknown tool: ${name}`); return; }
    session.noteTool(name, args);
    try {
      const current = workspaceProject();
      // project_new / project_import / project_save{name} 写的是新目标，由 saveToWorkspace 的写守卫检查
      if (WRITE_TOOLS.has(name) && current && !['project_new', 'project_import'].includes(name) && !(name === 'project_save' && args.name)) session.acquire(current);
      const payload = await tool.run(args);
      if (RENDER_TOOLS.has(name)) {
        const anim = typeof args.animation === 'string' ? args.animation : state.player?.animation?.name ?? null;
        session.noteRender(anim, typeof args.frame === 'number' ? args.frame : null);
      }
      reply(id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
    } catch (error) {
      const message2 = error instanceof Error ? error.message : String(error);
      reply(id, { content: [{ type: 'text', text: message2 }], isError: true });
    } finally {
      session.setProject(state.name ? safeName(state.name) : null);
      session.flush();
    }
    return;
  }
  if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
}

const arr = (description: string, items: Record<string, unknown> = { type: 'string' }) => ({ type: 'array', items, description });
const bool = (description: string) => ({ type: 'boolean', description });
const any = (description: string) => ({ description });
const loose = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });

const STUDIO_TOOLS: ToolDef[] = [
  { name: 'project_new', description: '新建空工程（root 骨骼 + idle 动画），放进工作区并开启自动同步。', inputSchema: obj({ name: str('工程名'), frameRate: num('帧率，默认 24') }, ['name']), run: (a) => studio.projectNew(state, a as never) },
  { name: 'project_import', description: '导入 asset-canvas 流水线产物：角色目录 chars/<id>（自动挑 out/*_dragonbones → out/*_spine → layers.json）、DragonBones 目录、Spine 4.x 目录（skeleton.json+images/）或 layers.json；写入工作区，编辑器可直接打开。', inputSchema: obj({ path: str('路径'), name: str('工程名（默认目录名）'), prefer: { type: 'string', enum: ['dragonbones', 'spine', 'layers'], description: '角色目录下优先用哪种来源' }, sync: bool('写入工作区并自动同步（默认 true）') }, ['path']), run: (a) => studio.projectImport(state, a as never) },
  { name: 'project_open', description: '打开工作区工程（name）或任意 *_ske.json(+ *_tex.json)。', inputSchema: obj({ name: str('工作区工程名'), file: str('*_ske.json'), texture: str('*_tex.json'), image: str('图集 png（默认按 imagePath 找）') }, []), run: (a) => studio.projectOpen(state, a as never) },
  { name: 'project_save', description: '保存到工作区 projects/<name>/ 并开启自动同步（编辑器 ?live=1 页面会自动重载）。', inputSchema: obj({ name: str('另存为的名字') }, []), run: (a) => studio.projectSave(state, a as never) },
  { name: 'project_list', description: '列出工作区里的工程。', inputSchema: obj({}, []), run: () => studio.projectList() },
  { name: 'image_add', description: '把一张 PNG 加入图集（自动重排），挂到插槽上（插槽不存在就在 bone 下新建）。x/y 是相对骨骼的位置（y 向下），scale/scaleX/scaleY 写入显示变换。', inputSchema: obj({ file: str('PNG 路径'), slot: str('插槽名（默认=文件名）'), bone: str('父骨骼（默认根骨骼）'), x: num('x'), y: num('y'), rotation: num('角度（顺时针）'), region: str('区域名（默认=文件名）'), scale: num('等比缩放（写入显示变换 scX/scY，默认 1）'), scaleX: num('x 缩放（覆盖 scale）'), scaleY: num('y 缩放（覆盖 scale）') }, ['file']), run: (a) => studio.imageAdd(state, a as never) },
  { name: 'layers_add', description: '批量导入分层 PNG（layers.json 风格），原点=画布底边中点。', inputSchema: obj({ layers: arr('[{file,name,bone,left,top}]', { type: 'object' }), canvasWidth: num('画布宽'), canvasHeight: num('画布高') }, ['layers', 'canvasWidth', 'canvasHeight']), run: (a) => studio.layersAdd(state, a as never) },
  { name: 'slot_create', description: '在骨骼下新建空插槽。', inputSchema: obj({ name: str('插槽名'), bone: str('父骨骼') }, ['name', 'bone']), run: (a) => studio.slotCreate(state, a as never) },
  { name: 'slot_update', description: '改插槽：换父骨骼（保持世界位置）、当前附件/显示索引、颜色 {rM,gM,bM,aM 0-100}、混合模式、绘制顺序 zIndex、显示对象变换 transform{x,y,rotation,scaleX,scaleY,…}（display 选哪个，mode set/offset；未加权网格顶点同步变换）。', inputSchema: loose({ slot: str('插槽'), bone: str('新父骨骼'), attachment: str('附件名（空串=隐藏）'), displayIndex: num('显示索引'), color: { type: 'object' }, blendMode: str('normal/add/multiply/screen'), zIndex: num('绘制顺序位置（0=最底）'), transform: { type: 'object', description: '显示对象变换（相对父骨骼）：x,y,rotation(度),skX,skY,scaleX,scaleY,scale,pivotX,pivotY', properties: { x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' }, skX: { type: 'number' }, skY: { type: 'number' }, scaleX: { type: 'number' }, scaleY: { type: 'number' }, scale: { type: 'number' }, pivotX: { type: 'number' }, pivotY: { type: 'number' } } }, display: { description: '要改哪个显示对象：索引或名字（默认当前显示）' }, mode: { type: 'string', enum: ['set', 'offset'], description: 'set=覆盖（默认）；offset=x/y/rotation 增量、scale 倍率' } }, ['slot']), run: (a) => studio.slotUpdate(state, a as never) },
  { name: 'mesh_create', description: '把插槽的图片显示对象转成 cols×rows 网格（轮廓顶点在前）。', inputSchema: obj({ slot: str('插槽'), cols: num('列数，默认 2'), rows: num('行数，默认 2'), display: num('显示索引（默认当前）') }, ['slot']), run: (a) => studio.meshCreate(state, a as never) },
  { name: 'weights_auto', description: '按顶点到骨骼线段的距离给网格自动蒙皮（每顶点最多 maxInfluences 根）。', inputSchema: obj({ slot: str('网格插槽'), bones: arr('参与蒙皮的骨骼'), maxInfluences: num('默认 2'), falloff: num('距离衰减指数，默认 2') }, ['slot', 'bones']), run: (a) => studio.weightsAuto(state, a as never) },
  { name: 'ik_set', description: 'IK 约束：新建/修改/删除。bone=链末端骨骼（如前臂/小腿），chain 1=双骨（含父骨骼）0=单骨，target=目标骨骼（不能在链子树里），bendPositive 弯曲方向（DB y 向下坐标，true=顺时针侧），weight 0-1。同名已存在则修改；remove:true 删除。导出 Spine 4.2 为 ik 约束(mix=weight)，DragonBones 原样保留。', inputSchema: loose({ name: str('约束名'), bone: str('链末端骨骼'), target: str('目标骨骼'), chain: num('1=双骨(默认) 0=单骨'), bendPositive: bool('弯曲方向'), weight: num('0-1'), remove: bool('删除') }, []), run: (a) => studio.ikSet(state, a as never) },
  { name: 'snap_to_reference', description: '参考垫图吸附：把部件（插槽当前显示对象，图片或网格）在附近小范围内搜索平移/旋转/少量缩放，按轮廓与边缘（倒角距离+剪影越界）而不是颜色和参考图对齐；父骨骼先、子部件后，并约束部件继续盖住本来盖住的关节点（不拉断）。reference=参考 PNG（白底或透明底），origin=世界原点在参考图里的像素坐标（默认底边中点），scale=参考图像素/世界单位。radius 搜索半径(px，默认24)、strength 吸附强度 0-1(默认1)、rotRange ±度(默认8)、scaleRange ±比例(默认0.06)；apply:false 只评估返回 IoU。返回 iouBefore/iouAfter 与每个部件的位移。', inputSchema: loose({ reference: str('参考图 PNG 路径'), origin: { type: 'array', items: { type: 'number' } }, scale: num('像素/世界单位'), slots: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } }, radius: num('搜索半径 px'), strength: num('0-1'), rotRange: num('±度'), scaleRange: num('±比例'), joints: bool('关节约束(默认 true)'), apply: bool('false=只评估'), passes: num('迭代轮数'), minVisible: num('可见轮廓比例下限(默认0.35)，低于则不动'), prior: num('位移先验权重(默认0.15)'), overlayOut: str('apply:false 时输出叠图 PNG（红=缺、青=多）') }, ['reference']), run: (a) => studio.snapToReference(state, a as never) },
  { name: 'fit_contour', description: '轮廓双向贴合（网格变形）：网格部件的剪影边界逐点沿法线找参考图轮廓，青色（部件多盖、原图是背景）向内收，红色（原图有、没有任何部件盖住）向外拉，修正量用高斯核摊到网格顶点。被上层部件挡住的位置不算青色；关节 jointKeep 半径内（切口重叠/延伸）不动。建议在 snap_to_reference + weld_joints(texture) + 较密 mesh_create 之后、weights_auto 之前做（加权网格也支持）。maxShift 最大修正 px(默认12)、sigma 摊开半径(默认10)、iterations(默认2)。', inputSchema: loose({ reference: str('参考图 PNG'), origin: { type: 'array', items: { type: 'number' } }, scale: num('像素/世界单位'), slots: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } }, maxShift: num('最大修正 px'), jointKeep: num('关节保留半径 px(默认22)'), sigma: num('摊开半径'), iterations: num('迭代') }, ['reference']), run: (a) => studio.fitContour(state, a as never) },
  { name: 'mesh_stretch', description: '网格单边拉伸：把网格靠 edge(top/bottom/left/right，世界坐标) 那一边的顶点推 amount 像素，向对边线性衰减（span=衰减距离，默认整块高/宽）。用于脖子下端伸进领口补洞、切口做重叠。', inputSchema: loose({ slot: str('网格插槽'), edge: str('top|bottom|left|right'), amount: num('像素'), span: num('衰减距离'), from: str('另一条边的就近权重 top|bottom|left|right（如 edge=left from=bottom：只撑开下端）'), fromSpan: num('from 方向衰减距离') }, ['slot', 'edge', 'amount']), run: (a) => studio.meshStretch(state, a as never) },
  { name: 'region_erase', description: '擦掉部件贴图里的一块椭圆（区域像素坐标 [cx,cy,rx,ry]，feather 羽化 px）：如把衣服领口里面的深色洞挖空，让下层脖子露出来、伸进领口重叠。', inputSchema: loose({ slot: str('插槽'), ellipse: { type: 'array', items: { type: 'number' } }, feather: num('羽化 px') }, ['slot', 'ellipse']), run: (a) => studio.regionErase(state, a as never) },
  { name: 'weld_joints', description: '关节缝隙闭合：自动找出父子骨骼关节两侧的部件。mode texture=把图片部件在关节附近的切口向外延伸 overlap 像素（最近色填充，做出重叠，要在 mesh_create 之前做）；weights=加权网格在关节带(±band px)内统一用父→子平滑权重，两侧网格同步变形像焊在一起；both(默认)两者都做。radius 关节影响半径、lateral 横向范围、exclude 排除配件插槽。', inputSchema: loose({ mode: str('texture|weights|both'), overlap: num('延伸像素'), radius: num('关节半径'), band: num('权重过渡带'), lateral: num('横向范围'), slots: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } } }, []), run: (a) => studio.weldJoints(state, a as never) },
  { name: 'ik_list', description: '列出 IK 约束。', inputSchema: obj({}, []), run: () => studio.ikList(state) },
  { name: 'weights_set', description: '精确设置某个顶点的权重 {骨骼名: 权重}（自动归一化）。', inputSchema: loose({ slot: str('网格插槽'), vertex: num('顶点下标'), weights: { type: 'object' } }, ['slot', 'vertex', 'weights']), run: (a) => studio.weightsSet(state, a as never) },
  { name: 'animation_create', description: '新建动画（或从 from 复制），设置时长（帧）与循环次数（0=无限）。', inputSchema: obj({ name: str('动画名'), duration: num('帧数'), playTimes: num('0=循环'), from: str('复制自') }, ['name']), run: (a) => studio.animationCreate(state, a as never) },
  { name: 'animation_update', description: '改动画：时长 / 循环次数 / 重命名 / 删除。', inputSchema: obj({ animation: str('动画名'), duration: num('帧数'), playTimes: num('循环'), rename: str('新名字'), remove: bool('删除') }, ['animation']), run: (a) => studio.animationUpdate(state, a as never) },
  { name: 'bone_key', description: '通道关键帧（相对绑定姿态的增量）：rotate（度，顺时针为正）/ shear（斜切度）/ x,y（像素，y 向下）/ scaleX,scaleY。easing: "linear"|"stepped"|数字|[x1,y1,x2,y2]。remove:true 删该帧。', inputSchema: loose({ bone: str('骨骼'), frame: num('帧'), animation: str('动画（默认当前）'), rotate: num('旋转增量'), shear: num('斜切增量（度，只加到 skX，导出 Spine shear）'), x: num('x 增量'), y: num('y 增量'), scaleX: num('x 缩放'), scaleY: num('y 缩放'), easing: any('补间'), remove: bool('删除该帧') }, ['bone', 'frame']), run: (a) => studio.boneKey(state, a as never) },
  { name: 'bone_keys', description: '批量写通道关键帧：keys=[{bone, frame, rotate?, x?, y?, scaleX?, scaleY?, easing?}]（只同步一次）。', inputSchema: loose({ animation: str('动画'), keys: arr('关键帧列表', { type: 'object' }) }, ['keys']), run: (a) => studio.boneKeys(state, a as never) },
  { name: 'slot_key', description: '插槽关键帧：颜色 {rM,gM,bM,aM 0-100}（受击闪红、淡出）或附件切换（眨眼换图，attachment 空串=隐藏）。', inputSchema: loose({ slot: str('插槽'), frame: num('帧'), animation: str('动画'), color: { type: 'object' }, attachment: str('附件名'), displayIndex: num('显示索引') }, ['slot', 'frame']), run: (a) => studio.slotKey(state, a as never) },
  { name: 'draw_order_key', description: '绘制顺序关键帧（§10.3-10）：在某帧把插槽顺序设为 order（插槽名，底→顶，可只给需要改的子集：其余插槽保持相对顺序并排在原位置）；remove:true 删除该帧的绘制顺序键。', inputSchema: loose({ frame: num('帧'), animation: str('动画（默认当前）'), order: arr('插槽名，底→顶'), remove: bool('删除该帧') }, ['frame']), run: (a) => studio.drawOrderKey(state, a as never) },
  { name: 'event_key', description: '在某帧加事件（导出到 Spine events）。', inputSchema: obj({ frame: num('帧'), name: str('事件名'), animation: str('动画'), kind: { type: 'string', enum: ['event', 'sound', 'action'], description: '类型' } }, ['frame', 'name']), run: (a) => studio.eventKey(state, a as never) },
  { name: 'render_frame', description: '无头渲染一帧为 PNG（软件光栅，和编辑器同一套姿态计算）。setup:true 渲染绑定姿态；bones:on/only 输出骨骼叠加层；fit:content 或 bounds 固定取景（返回 bounds）。', inputSchema: obj({ out: str('PNG 路径'), animation: str('动画'), frame: num('帧'), width: num('宽'), height: num('高'), background: { type: 'string', enum: ['light', 'dark', 'white', 'transparent'], description: '背景' }, setup: bool('绑定姿态'), fit: { type: 'string', enum: ['geometry', 'content'], description: '取景：geometry=四边形几何（默认，旧行为）；content=按不透明像素（图集重排/焊接后的透明边不改变取景，可复现）' }, bounds: { type: 'array', items: { type: 'number' }, description: '显式取景 [minX,minY,maxX,maxY]（世界坐标；返回值里有上次用的 bounds，传回即可同取景）' }, bones: { type: 'string', enum: ['off', 'on', 'only'], description: '骨骼叠加层：off=只画部件（默认）/ on=部件+骨骼 / only=只画骨骼（同取景，可配 transparent）' }, trim: num('按内容裁剪（§10.3-12）：>=0 时把输出裁到 alpha>0 包围盒外扩 trim 像素；返回 crop=[x,y,w,h]') }, ['out']), run: (a) => studio.renderFrame(state, a as never) },
  { name: 'render_animation', description: '渲染整段动画：sheet（联系表 PNG，默认）/ frames（PNG 序列目录）/ gif / mp4（需要 ffmpeg）。', inputSchema: obj({ out: str('输出路径'), animation: str('动画'), format: { type: 'string', enum: ['sheet', 'frames', 'gif', 'mp4'], description: '格式' }, width: num('单帧宽'), height: num('单帧高'), step: num('帧步长'), columns: num('联系表列数'), background: { type: 'string', enum: ['light', 'dark', 'white', 'transparent'], description: '背景' }, fit: { type: 'string', enum: ['geometry', 'content'], description: '取景：geometry=四边形几何（默认，旧行为）；content=按不透明像素（图集重排/焊接后的透明边不改变取景，可复现）' }, bounds: { type: 'array', items: { type: 'number' }, description: '显式取景 [minX,minY,maxX,maxY]（世界坐标；返回值里有上次用的 bounds，传回即可同取景）' }, bones: { type: 'string', enum: ['off', 'on', 'only'], description: '骨骼叠加层：off=只画部件（默认）/ on=部件+骨骼 / only=只画骨骼（同取景，可配 transparent）' }, trim: num('按内容裁剪（§10.3-12）：>=0 时把输出裁到 alpha>0 包围盒外扩 trim 像素；返回 crop=[x,y,w,h]') }, ['out']), run: (a) => studio.renderAnimation(state, a as never) },
  { name: 'spine_export', description: '导出 Spine JSON + .atlas + png。version 4.2（默认）/ 4.1 / 3.6(legacy)。默认用官方 spine-core 4.2 运行时加载并逐帧对拍。', inputSchema: obj({ outDir: str('输出目录'), version: { type: 'string', enum: ['4.2', '4.1', '3.6'], description: '目标版本' }, validate: bool('用 spine-core 校验（默认 true）'), name: str('文件名'), curves: { type: 'string', enum: ['auto', 'bezier', 'bake'], description: "补间曲线：auto(默认)=能精确表达就写 bezier，否则逐帧烘焙（多段曲线/余弦缓动/陡峭曲线），与编辑器预览一致；bezier=旧行为；bake=全部烘焙" } }, ['outDir']), run: (a) => studio.spineExport(state, a as never) },
  { name: 'dragonbones_export', description: '导出 DragonBones 5.5 包（*_ske.json + *_tex.json + *_tex.png）。', inputSchema: obj({ outDir: str('输出目录'), name: str('文件名') }, ['outDir']), run: (a) => studio.dragonbonesExport(state, a as never) },
  { name: 'editor_url', description: '返回在编辑器里打开当前 AI 工程的 URL（?aiproject=&live=1&anim=&frame=&play=1）；live 页面随 MCP 写入原地更新（SSE）。', inputSchema: obj({ animation: str('动画'), frame: num('帧'), play: bool('自动播放') }, []), run: (a) => studio.editorUrl(state, a as never) },
  { name: 'editor_screenshot', description: '用无头 Chrome 打开编辑器（dev server）里的当前工程并截图，验证编辑器预览。', inputSchema: obj({ out: str('PNG 路径'), animation: str('动画'), frame: num('帧'), width: num('视口宽'), height: num('视口高'), waitMs: num('等待渲染毫秒') }, ['out']), run: (a) => studio.editorScreenshot(state, a as never) },
];
STUDIO_TOOLS.push({
  name: 'session_set',
  description: '先调用它：设置本会话在编辑器「AI → 实时预览」里显示的 agent 名字和当前任务（优先级高于 clientInfo.name / BONESTUDIO_AGENT_NAME）。返回会话 id 与持有的写锁。',
  inputSchema: obj({ name: str('agent 显示名，如 "Cursor·吕布攻击"'), task: str('一句话任务描述') }, []),
  run: (a) => {
    const { name, task } = a as { name?: string; task?: string };
    session.setAgent(name, task);
    return { sessionId: session.id, displayName: session.rec.displayName, nameSource: session.rec.nameSource, task: session.rec.task ?? null, file: session.file, project: session.rec.project ?? null };
  },
});
TOOLS.push(...STUDIO_TOOLS);

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handle(JSON.parse(trimmed) as Record<string, unknown>).catch((error) => {
      replyError(null, -32603, error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    replyError(null, -32700, `parse error: ${message}`);
  }
});