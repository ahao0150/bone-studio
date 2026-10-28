import { syncChildOrder } from './childOrder';
import { Application, Container, Graphics, Mesh, MeshGeometry, Texture, type Buffer } from 'pixi.js';
import type { RenderItem } from '../core/runtime/skeleton';
import { BONE_SHAPE, type BoneShapeCommand, type BoneShapePath } from './boneShape.generated';

/** 一根骨骼在舞台上的绘制参数（骨片：关节 + 方向 + 长度） */
export interface BoneSegment {
  x: number;
  y: number;
  /** 世界方向（弧度） */
  angle: number;
  /** 世界长度 */
  length: number;
  selected: boolean;
  /** 鼠标悬停在这一根骨片上（官方 `ROLLOVER_BONE` → `Stage._5366:_827` 的白色高亮） */
  hovered?: boolean;
  /** 骨骼级「隐藏」（官方 MenuItem-hide）：不画骨片 / 骨钉，也不参与拾取 */
  hidden?: boolean;
  /** 当前工具给选中骨上的颜色：X 缩放把骨片涂红，C 宽高把骨钉涂青 */
  accent?: 'red' | 'cyan';
}

/**
 * 骨片造型直接取自 `主体.svg`：环 + 连接杆 + 肩部帽 + 可伸缩锥形下段。
 * 几何数字由 `work/jioz-gen-bone-shape.mjs` 从源文件生成到 `boneShape.generated.ts`（不手抄、不推导）。
 * 这里只放渲染口径的常量。
 */
const BONE_RING_R = BONE_SHAPE.ring.r;
/** 设计轴（环心 → 锥尖）弧度，由生成脚本从源文件算出 */
const BONE_AXIS = (BONE_SHAPE.axisDeg * Math.PI) / 180;
/** body 组 rotate 弧度 */
const BONE_BODY_RAD = (BONE_SHAPE.body.deg * Math.PI) / 180;
/** 骨钉在屏幕上的目标半径（像素）：沿用改造前 7.2px 的骨钉口径 */
const BONE_PIN_PX = 7.2;

export interface MeshOverlayOptions {
  /** posed triangle edges as [x0, y0, x1, y1] */
  edges?: Array<[number, number, number, number]>;
  /** posed user-drawn edges (\`display.userEdges\`) */
  userEdges?: Array<[number, number, number, number]>;
  joints?: Array<[number, number]>;
  highlightEdge?: number;
  highlightUserEdge?: [number, number, number, number];
  pendingVertex?: [number, number];
  /** 权重工具：顶点饼图（世界坐标）。扇区 weight 相加后按比例铺满一圈。 */
  pies?: Array<{ x: number; y: number; slices: Array<{ color: number; weight: number }> }>;
  /** 屏幕 1 像素对应的世界长度，饼图半径按它保持屏幕大小 */
  piePx?: number;
  /** 饼图在屏幕上的半径（像素）。权重工具用它把顶点画大，方便点中。 */
  pieScreen?: number;
  /** 点中的顶点：白环 + 外圈蓝环，并略放大 */
  selectedPie?: number;
  /** 鼠标下的顶点：亮青环，并略放大 */
  hoverPie?: number;
}

interface SlotMesh {
  mesh: Mesh;
  geometry: MeshGeometry;
  positionBuffer: Buffer | null;
  uvBuffer: Buffer | null;
  vertexCount: number;
}

/**
 * WebGL stage renderer. Every drawable (image quad or deformed mesh) is emitted as a
 * triangle mesh, so bone skew/scale and weighted skinning are represented exactly.
 */
export class StageRenderer {
  readonly app = new Application();
  readonly world = new Container();
  readonly overlay = new Graphics();
  /** Grid-tool edges for the current mesh; kept on its own layer so the bone wireframe
   *  and the mesh wireframe can be drawn in the same frame without clearing each other. */
  readonly meshOverlay = new Graphics();
  /** 选中槽位的轮廓（有网格画网格轮廓、没有网格画矩形），单独一层：在贴图之上、骨骼之下 */
  readonly slotOverlay = new Graphics();
  /**
   * 显示边框（官方 `Sheet.showframe` → `_948/_951.as` 第 159-168 行）：勾选后给舞台上的每个
   * 显示对象描一圈边框。单独一层，画在贴图之上、骨骼线框之下。
   */
  readonly frameOverlay = new Graphics();
  /** 洋葱皮（官方 `Timeline.onion.tooltip`）：前一帧 / 后一帧的淡色副本，画在主体之下 */
  readonly ghostWorld = new Container();
  private ghostMeshes = new Map<string, SlotMesh>();
  /**
   * 鼠标悬停的插槽轮廓（官方 `StageNotification.ROLLOVER_SLOT`）：只画一圈**轮廓线**，移出即隐藏。
   * 单独一层、与世界同相机变换（`setCamera` 里必须一起设，否则会画在原点）。
   * 悬停对象**已经选中**时不再画（选中轮廓已经占了这个位置，两者重叠没有信息量）。
   */
  readonly hoverOutline = new Graphics();
  /** 最近一次 `drawHoverOutline` 真正描出的轮廓段数（headless 判据的渲染侧证据） */
  private hoverOutlinePrimitives = 0;
  /** 骨架装配模式：骨片更醒目，图片保持不透明 */
  private anatomy = false;
  /** 短连线的箭头朝向：距离太短时方向会来回翻，沿用上一次稳定的角度 */
  private linkHeading = new Map<number, number>();
  private meshes = new Map<string, SlotMesh>();
  private texture: Texture | null = null;
  private atlasWidth = 1;
  private atlasHeight = 1;
  private initialized = false;
  private destroyed = false;
  /** 偏好设置：骨骼线框颜色（官方 Setting.BOColor） */
  private boneColor = 0x6cc7ff;
  /** 偏好设置：图片平滑（官方 Setting.ImageSmooth）—— 记住偏好，换纹理时沿用 */
  private smoothTexture = true;
  /** 世界原点十字线；离屏封面渲染时关掉 */
  showOriginCross = true;

  /** Stage backdrop is painted by CSS (`.stage`), never by Pixi: the canvas
   *  stays transparent so nothing can revert to a dark fill that swallows
   *  dark artwork. See docs/UX-DESIGN.md "画布背景". */
  async init(host: HTMLElement, background = 0x000000, backgroundAlpha = 0): Promise<void> {
    if (this.initialized || this.destroyed) return;
    await this.app.init({
      resizeTo: host,
      background,
      backgroundAlpha,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    } as never);
    if (this.destroyed) {
      try { this.app.destroy(false, { children: true }); } catch { /* ignore */ }
      return;
    }
    host.appendChild(this.app.canvas as HTMLCanvasElement);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.ghostWorld);
    this.app.stage.addChild(this.frameOverlay);
    this.app.stage.addChild(this.meshOverlay);
    this.app.stage.addChild(this.overlay);
    // 槽位轮廓放最上层：骨片是实心的，轮廓画在下面会被盖住（官方截图里轮廓也始终可见）
    this.app.stage.addChild(this.slotOverlay);
    // 悬停轮廓比选中轮廓更晚画（暂态反馈要压在最上面）
    this.app.stage.addChild(this.hoverOutline);
    // the editor owns the frame loop, so the Pixi ticker stays stopped
    this.app.ticker.stop();
    this.initialized = true;
  }

  /**
   * 选中槽位的轮廓（官方截图的青色轮廓）：
   *  - 有网格：传 `edges`（网格外轮廓，世界坐标）与 `points`（轮廓顶点，画成白点）
   *  - 没有网格：传 `rect`（渲染项的包围盒，世界坐标）
   * 内部顶点不在这里画 —— 那些只在网格编辑工具下出现（meshOverlay 负责）。
   */
  drawSlotOverlay(options: {
    edges?: Array<[number, number, number, number]>;
    points?: Array<[number, number]>;
    rect?: [number, number, number, number];
  } = {}): void {
    this.slotOverlay.clear();
    const { edges = [], points = [], rect } = options;
    const px = 1 / (Math.abs(this.slotOverlay.scale.x) || 1);
    if (rect) {
      const [x0, y0, x1, y1] = rect;
      this.slotOverlay.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      this.slotOverlay.stroke({ width: 1.2 * px, color: 0x6b7280, alpha: 0.95 });
    }
    if (edges.length > 0) {
      for (const [ax, ay, bx, by] of edges) this.slotOverlay.moveTo(ax, ay).lineTo(bx, by);
      this.slotOverlay.stroke({ width: 1.4 * px, color: 0x67e8f9, alpha: 0.95 });
    }
    if (points.length > 0) {
      for (const [px0, py0] of points) this.slotOverlay.circle(px0, py0, 2.6 * px).fill({ color: 0xffffff, alpha: 0.95 });
      for (const [px0, py0] of points) this.slotOverlay.circle(px0, py0, 2.6 * px).stroke({ width: 0.8 * px, color: 0x0f172a, alpha: 0.7 });
    }
  }

  /**
   * 显示边框（官方 `Sheet.showframe` → `_948/_951.as` 第 159-168 行）：
   * 官方在每个显示对象的 SlotDisplay 里 `lineStyle(0, _100._2257)` + `drawRect(-w/2, -h/2, w, h)`，
   * 颜色 `_100._2257` = `4282842367` = `0xFF46FCFF`，线宽 0 = 发丝线。
   * 这里由调用方把每个显示对象的边框算成世界坐标的四条边（[x0,y0,x1,y1]），逐条描边；
   * 传入空数组即清空（取消勾选）。
   */
  drawFrameOverlay(edges: Array<[number, number, number, number]> = []): void {
    this.frameOverlay.clear();
    if (edges.length === 0) return;
    const px = 1 / (Math.abs(this.frameOverlay.scale.x) || 1);
    this.frameOverlay.setStrokeStyle({ width: px, color: 0x46fcff, alpha: 0.95 });
    for (const [x0, y0, x1, y1] of edges) this.frameOverlay.moveTo(x0, y0).lineTo(x1, y1);
    this.frameOverlay.stroke();
  }

  /**
   * 骨架装配模式：骨片画得更粗。图片保持不透明。
   * 画布尺寸另由 `resizeToHost` 跟着舞台盒子走。
   */
  setAnatomyMode(enabled: boolean): void {
    this.anatomy = enabled;
    this.world.alpha = 1;
  }

  /** 舞台盒子变了（装配模式收起时间轴之后）把画布缓冲撑到同样大。ticker 是停着的，不会自己跟上。 */
  resizeToHost(): void {
    if (!this.initialized) return;
    const canvas = this.app.canvas as HTMLCanvasElement | undefined;
    const host = canvas?.parentElement;
    if (!host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) return;
    this.app.renderer.resize(width, height);
  }

  /** 官方 Setting.BOColor：骨骼线框颜色。 */
  setBoneColor(color: number): void {
    this.boneColor = color;
  }

  /** 官方 Setting.ImageSmooth：线性过滤（可能发糊）vs 最近邻（锐利）。 */
  setTextureSmoothing(smooth: boolean): void {
    this.smoothTexture = smooth;
    if (this.texture?.source) this.texture.source.scaleMode = smooth ? 'linear' : 'nearest';
  }

  setTexture(texture: Texture | null, width = 1, height = 1): void {
    this.texture = texture;
    this.atlasWidth = Math.max(1, width);
    this.atlasHeight = Math.max(1, height);
    for (const entry of this.meshes.values()) {
      if (texture) entry.mesh.texture = texture;
    }
    for (const entry of this.ghostMeshes.values()) {
      if (texture) entry.mesh.texture = texture;
    }
    // 新纹理进来时沿用已记住的平滑偏好
    if (texture) this.setTextureSmoothing(this.smoothTexture);
  }

  setCamera(scale: number, x: number, y: number): void {
    this.ghostWorld.scale.set(scale);
    this.ghostWorld.position.set(x, y);
    this.world.scale.set(scale);
    this.world.position.set(x, y);
    // 悬停高亮层与世界同变换 —— 漏掉它高亮就会画在原点、缩放也不对（§112 位置 bug 的根因）
    this.hoverOutline.scale.set(scale);
    this.hoverOutline.position.set(x, y);
    this.overlay.scale.set(scale);
    this.overlay.position.set(x, y);
    this.meshOverlay.scale.set(scale);
    this.meshOverlay.position.set(x, y);
    this.slotOverlay.scale.set(scale);
    this.slotOverlay.position.set(x, y);
    this.frameOverlay.scale.set(scale);
    this.frameOverlay.position.set(x, y);
  }

  clearOverlay(): void {
    this.overlay.clear();
  }

  /**
   * 世界原点参考：棋盘上穿过 (0, 0) 的十字线，线宽保持 1 屏幕像素。
   */
  private drawOriginCross(): void {
    const px = 1 / (Math.abs(this.overlay.scale.x) || 1);
    const span = 1e6;
    this.overlay.setStrokeStyle({ width: px, color: 0x8d8d8d, alpha: 0.9 });
    this.overlay.moveTo(-span, 0).lineTo(span, 0);
    this.overlay.moveTo(0, -span).lineTo(0, span);
    this.overlay.stroke();
  }

  /**
   * Bone wireframe overlay. highlight marks the selected bone so the editor
   * can show selection even while the wireframe is hidden.
   */
  drawBoneOverlay(
    /** 每根骨骼的骨片：关节（骨钉）位置 + 世界方向角 + 长度（官方画面是"由粗到细的锥形"） */
    segments: BoneSegment[],
    joints: Array<[number, number]>,
    /** 要画出的父子连线（选中时是整条链路，悬停时是这一段） */
    links?: Array<{ joint: number; parent: number }>,
    /** 多选（官方 Menu.Edit.SelectAll / Shift 点选 / 框选）里的关节下标，画成金色圆环 */
    selected?: number[],
    /** 框选矩形（世界坐标 x0,y0,x1,y1），拖拽时实时画出来 */
    marquee?: [number, number, number, number],
  ): void {
    this.overlay.clear();
    if (this.showOriginCross) this.drawOriginCross();
    const px = 1 / (Math.abs(this.overlay.scale.x) || 1);
    if (marquee) {
      const [x0, y0, x1, y1] = marquee;
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);
      this.overlay.rect(rx, ry, rw, rh).fill({ color: 0x7ab8ff, alpha: 0.12 });
      this.overlay.setStrokeStyle({ width: px, color: 0x7ab8ff, alpha: 0.9 });
      this.overlay.rect(rx, ry, rw, rh).stroke();
    }
    if (selected && selected.length > 0) {
      this.overlay.setStrokeStyle({ width: 1.6, color: 0xffd166, alpha: 0.95 });
      for (const index of selected) {
        const point = joints[index];
        if (point) this.overlay.circle(point[0], point[1], 3).stroke();
      }
    }
    // 父子连线先画（在骨片下层）：从父骨片末端连到子关节。离得近时箭头钉在中点，避免贴着关节被甩动。
    for (const link of links ?? []) {
      const child = segments[link.joint];
      const parent = link.parent >= 0 ? segments[link.parent] : undefined;
      if (!child || child.hidden || !parent || parent.hidden || !joints[link.joint]) continue;
      const fromX = parent.x + Math.cos(parent.angle) * parent.length;
      const fromY = parent.y + Math.sin(parent.angle) * parent.length;
      const dx = child.x - fromX;
      const dy = child.y - fromY;
      const dist = Math.hypot(dx, dy);
      const size = 7 * px;
      const near = dist < 36 * px;
      let angle = Math.atan2(dy, dx);
      if (dist >= 10 * px) this.linkHeading.set(link.joint, angle);
      else angle = this.linkHeading.get(link.joint) ?? parent.angle;
      const tipX = near ? fromX + dx * 0.5 : child.x - Math.cos(angle) * Math.min(size, dist);
      const tipY = near ? fromY + dy * 0.5 : child.y - Math.sin(angle) * Math.min(size, dist);
      const head = near ? Math.min(size, Math.max(4 * px, dist * 0.4)) : size;
      this.overlay.moveTo(fromX, fromY).lineTo(child.x, child.y).stroke({ width: 1.2 * px, color: 0xff6a3d, alpha: 0.9 });
      this.overlay.poly([
        tipX, tipY,
        tipX - Math.cos(angle - 0.45) * head, tipY - Math.sin(angle - 0.45) * head,
        tipX - Math.cos(angle + 0.45) * head, tipY - Math.sin(angle + 0.45) * head,
      ]).fill({ color: 0xff6a3d, alpha: 0.95 });
    }

    // 骨钉 + 骨片：造型直接来自 主体.svg（几何见 boneShape.generated.ts，由脚本从源文件生成，非手抄）。
    // 绘制顺序照抄 SVG 文档顺序：环 → 连接杆 → 肩部帽 → 锥形下段 —— 连接杆上端插进环内，
    // 肩部被下段压住只露出一顶小帽，锥面顶边线可见（这就是源文件的观感）。
    // 环/连接杆/肩部固定屏幕尺寸（系数 s）；只有锥形下段按 ratio 沿自身轴伸缩（即示例的 scale(1 ratio)）。
    for (const bone of segments) {
      if (bone.hidden) continue;
      const hovered = !!bone.hovered;
      const lit = bone.selected;
      // 悬停（官方 ROLLOVER_BONE 的白色高亮）与选中都提亮；工具强调色（红/青）仍然盖在最上面
      const bright = hovered || lit;
      const s = (BONE_PIN_PX / BONE_RING_R) * px * (this.anatomy ? 1.25 : 1) * (hovered ? 1.25 : 1);
      const cosR = Math.cos(bone.angle - BONE_AXIS);
      const sinR = Math.sin(bone.angle - BONE_AXIS);
      const cos26 = Math.cos(BONE_BODY_RAD);
      const sin26 = Math.sin(BONE_BODY_RAD);
      // SVG 根坐标 → 世界坐标：环心为枢轴，先转到骨骼方向再各向同性缩放
      const place = (ox: number, oy: number): [number, number] => {
        const dx = ox - BONE_SHAPE.ring.cx;
        const dy = oy - BONE_SHAPE.ring.cy;
        return [bone.x + (dx * cosR - dy * sinR) * s, bone.y + (dx * sinR + dy * cosR) * s];
      };
      // body 组（translate + rotate）局部坐标 → SVG 根坐标
      const bodyRoot = (bx: number, by: number): [number, number] => [
        BONE_SHAPE.body.tx + bx * cos26 - by * sin26,
        BONE_SHAPE.body.ty + bx * sin26 + by * cos26,
      ];
      const xfBody = (x: number, y: number): [number, number] => { const r = bodyRoot(x, y); return place(r[0], r[1]); };
      const style = {
        fill: bone.accent === 'red' ? 0xe23b3b : hovered ? 0xffffff : lit ? 0xf2f2f2 : 0xd4d4d4,
        fillAlpha: bone.accent === 'red' || bright ? 1 : 0.72,
        dark: bone.accent === 'cyan' ? 0x3ec6d4 : 0x383838,
        light: bright ? 0xffffff : 0xe4e4e4,
        lightAlpha: bright ? 1 : 0.82,
      };

      // 环（SVG #ring）：外深内浅两圈描边，画在最下层 —— 连接杆上端会插进环里
      const ringR = BONE_RING_R * s;
      this.overlay.circle(bone.x, bone.y, ringR).stroke({ width: BONE_SHAPE.ring.outerWidth * s, color: style.dark, alpha: 0.9 });
      this.overlay.circle(bone.x, bone.y, ringR).stroke({ width: BONE_SHAPE.ring.innerWidth * s, color: style.light, alpha: style.lightAlpha });

      if (bone.length > 0) {
        // 连接杆（SVG #connector）：上端插进环内，下端由肩部压住
        this.paintShape(BONE_SHAPE.connector, place, s, style);
        // 肩部帽（SVG #shoulder）：固定尺寸，不随长度伸缩
        this.paintShape(BONE_SHAPE.shoulder, xfBody, s, style);
        // 锥形下段（SVG #lower-length）：沿自身轴伸缩，锥尖够到骨骼末端（线性映射误差 < 0.1 单位）
        const ratio = (bone.length / s - BONE_SHAPE.anchorDistance) / BONE_SHAPE.lowerLength;
        if (ratio > 0) {
          const xfLower = (x: number, y: number): [number, number] => xfBody(
            x * BONE_SHAPE.lowerScale.x + BONE_SHAPE.anchor.tx,
            y * BONE_SHAPE.lowerScale.y * ratio + BONE_SHAPE.anchor.ty,
          );
          this.paintShape(BONE_SHAPE.lower, xfLower, s, style);
        }
      }
    }
  }

  /** 把 SVG 命令数组描到叠加层上（xf：SVG 根坐标 → 世界坐标） */
  private traceShape(commands: readonly BoneShapeCommand[], xf: (x: number, y: number) => [number, number]): void {
    for (const c of commands) {
      if (c[0] === 'M') {
        const p = xf(c[1], c[2]);
        this.overlay.moveTo(p[0], p[1]);
      } else if (c[0] === 'L') {
        const p = xf(c[1], c[2]);
        this.overlay.lineTo(p[0], p[1]);
      } else if (c[0] === 'Q') {
        const q = xf(c[1], c[2]);
        const p = xf(c[3], c[4]);
        this.overlay.quadraticCurveTo(q[0], q[1], p[0], p[1]);
      } else {
        this.overlay.closePath();
      }
    }
  }

  /**
   * 画一段 SVG 造型：源文件里的 `#aeaeae` 换成状态色（fill/浅描边），`#383838` 换成深描边色，
   * 线宽按 s 缩放；源文件的圆角线帽/线接照抄。
   */
  private paintShape(
    paths: readonly BoneShapePath[],
    xf: (x: number, y: number) => [number, number],
    s: number,
    style: { fill: number; fillAlpha: number; dark: number; light: number; lightAlpha: number },
  ): void {
    for (const path of paths) {
      if (!path.fill && !path.stroke) continue;
      this.traceShape(path.commands, xf);
      if (path.fill) {
        this.overlay.fill({ color: path.fill === '#aeaeae' ? style.fill : hexToNum(path.fill), alpha: style.fillAlpha });
      }
      if (path.stroke) {
        const light = path.stroke === '#aeaeae';
        this.overlay.stroke({
          width: (path.strokeWidth ?? 2.5) * s,
          color: light ? style.light : style.dark,
          alpha: light ? style.lightAlpha : 0.9,
          cap: 'round',
          join: 'round',
        });
      }
    }
  }

  /**
   * Mesh wireframe for the grid tools. Triangle edges are drawn thin/green, user-drawn edges
   * (\`Mesh.tool.outline\`) thicker/orange, the hovered edge highlighted, and the first vertex of a
   * pending line marked. World space, same convention as the bone overlay.
   */
  drawMeshOverlay(options: MeshOverlayOptions = {}): void {
    const edges = options.edges ?? [];
    const userEdges = options.userEdges ?? [];
    const joints = options.joints ?? [];
    const pies = options.pies ?? [];
    this.meshOverlay.clear();
    if (edges.length === 0 && userEdges.length === 0 && joints.length === 0 && !options.pendingVertex && pies.length === 0) return;
    if (edges.length > 0) {
      const width = pies.length > 0 ? 1.3 * (options.piePx ?? 1) : 1;
      this.meshOverlay.setStrokeStyle({ width, color: pies.length > 0 ? 0x8fd4ff : 0x5fd7b0, alpha: pies.length > 0 ? 0.9 : 0.5 });
      for (const [x0, y0, x1, y1] of edges) this.meshOverlay.moveTo(x0, y0).lineTo(x1, y1);
      this.meshOverlay.stroke();
    }
    if (userEdges.length > 0) {
      this.meshOverlay.setStrokeStyle({ width: 1.8, color: 0xff9f43, alpha: 0.9 });
      for (const [x0, y0, x1, y1] of userEdges) this.meshOverlay.moveTo(x0, y0).lineTo(x1, y1);
      this.meshOverlay.stroke();
    }
    for (const [x, y] of joints) this.meshOverlay.circle(x, y, 1.2).fill({ color: 0xa8f0da, alpha: 0.7 });
    if (options.highlightEdge !== undefined && edges[options.highlightEdge]) {
      const [x0, y0, x1, y1] = edges[options.highlightEdge];
      this.meshOverlay.setStrokeStyle({ width: 2.4, color: 0xffc857, alpha: 0.95 });
      this.meshOverlay.moveTo(x0, y0).lineTo(x1, y1).stroke();
    }
    if (options.highlightUserEdge) {
      const [x0, y0, x1, y1] = options.highlightUserEdge;
      this.meshOverlay.setStrokeStyle({ width: 2.8, color: 0xffd7a8, alpha: 1 });
      this.meshOverlay.moveTo(x0, y0).lineTo(x1, y1).stroke();
    }
    if (options.pendingVertex) {
      const [px, py] = options.pendingVertex;
      this.meshOverlay.circle(px, py, 4.2).stroke({ width: 2, color: 0xff9f43, alpha: 1 });
      this.meshOverlay.circle(px, py, 1.6).fill({ color: 0xffd7a8, alpha: 1 });
    }
    if (pies.length > 0) {
      const px = options.piePx ?? 1;
      const screen = options.pieScreen ?? 9;
      const paintPie = (pie: (typeof pies)[number], kind: 'plain' | 'hover' | 'selected') => {
        const grow = kind === 'selected' ? 1.35 : kind === 'hover' ? 1.18 : 1;
        const radius = screen * grow * px;
        const total = pie.slices.reduce((sum, slice) => sum + Math.max(0, slice.weight), 0);
        if (total <= 0 || pie.slices.length <= 1) {
          this.meshOverlay.circle(pie.x, pie.y, radius).fill({ color: pie.slices[0]?.color ?? 0x9aa4b2, alpha: 1 });
        } else {
          let angle = -Math.PI / 2;
          for (const slice of pie.slices) {
            const sweep = (Math.max(0, slice.weight) / total) * Math.PI * 2;
            if (sweep <= 0) continue;
            const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 8)));
            const points: number[] = [pie.x, pie.y];
            for (let step = 0; step <= steps; step++) {
              const at = angle + sweep * (step / steps);
              points.push(pie.x + Math.cos(at) * radius, pie.y + Math.sin(at) * radius);
            }
            this.meshOverlay.poly(points).fill({ color: slice.color, alpha: 1 });
            angle += sweep;
          }
        }
        if (kind === 'selected') {
          this.meshOverlay.circle(pie.x, pie.y, radius + 2.6 * px).stroke({ width: 1.7 * px, color: 0x3d8bfd, alpha: 1 });
          this.meshOverlay.circle(pie.x, pie.y, radius).stroke({ width: 2.2 * px, color: 0xffffff, alpha: 1 });
        } else if (kind === 'hover') {
          this.meshOverlay.circle(pie.x, pie.y, radius + 1.8 * px).stroke({ width: 1.6 * px, color: 0x8fd4ff, alpha: 1 });
          this.meshOverlay.circle(pie.x, pie.y, radius).stroke({ width: 1.6 * px, color: 0xf4f8ff, alpha: 1 });
        } else {
          this.meshOverlay.circle(pie.x, pie.y, radius).stroke({ width: 1.15 * px, color: 0x1c2430, alpha: 1 });
        }
      };
      const selected = options.selectedPie;
      const hovered = options.hoverPie;
      pies.forEach((pie, index) => {
        if (index === selected || index === hovered) return;
        paintPie(pie, 'plain');
      });
      if (hovered != null && hovered !== selected && pies[hovered]) paintPie(pies[hovered], 'hover');
      if (selected != null && pies[selected]) paintPie(pies[selected], 'selected');
    }
  }

  private obtainMesh(
    key: string,
    vertexCount: number,
    indices: Uint16Array,
    target: Map<string, SlotMesh> = this.meshes,
    layer: Container = this.world,
  ): SlotMesh {
    let entry = target.get(key);
    if (!entry || entry.vertexCount !== vertexCount) {
      if (entry) {
        entry.mesh.destroy();
        target.delete(key);
      }
      const geometry = new MeshGeometry({
        positions: new Float32Array(vertexCount * 2),
        uvs: new Float32Array(vertexCount * 2),
        indices: Uint32Array.from(indices),
      });
      const mesh = new Mesh({ geometry, texture: this.texture ?? Texture.WHITE });
      mesh.label = key;
      entry = {
        mesh,
        geometry,
        positionBuffer: geometry.getBuffer('aPosition') as Buffer | null,
        uvBuffer: geometry.getBuffer('aUV') as Buffer | null,
        vertexCount,
      };
      layer.addChild(mesh);
      target.set(key, entry);
    }
    return entry;
  }

  /** 舞台上实际的绘制顺序（可见网格的槽位名，自下而上；headless 判据用） */
  stageOrder(): string[] {
    return this.world.children.filter((child) => child.visible).map((child) => child.label);
  }

  draw(items: RenderItem[]): void {
    const order: Mesh[] = [];
    this.paint(items, this.meshes, this.world, '', undefined, true, order);
    syncChildOrder(this.world, order);
  }

  /** 洋葱皮（官方 `Timeline.onion.tooltip`）：前 / 后帧的淡色副本；alpha 与 tint 由调用方写好。 */
  drawGhosts(groups: Array<{ key: string; items: RenderItem[] }>): void {
    const seen = new Set<string>();
    const order: Mesh[] = [];
    for (const group of groups) {
      this.paint(group.items, this.ghostMeshes, this.ghostWorld, `ghost:${group.key}:`, seen, false, order);
    }
    syncChildOrder(this.ghostWorld, order);
    for (const [key, entry] of this.ghostMeshes) {
      if (!seen.has(key)) entry.mesh.visible = false;
    }
  }

  /** 当前可见的 ghost 网格数（headless 测试用来确认洋葱皮真的画到了画布上）。 */
  ghostVisibleCount(): number {
    let count = 0;
    for (const entry of this.ghostMeshes.values()) if (entry.mesh.visible) count++;
    return count;
  }

  /**
   * 鼠标悬停的插槽**轮廓**（官方 `StageNotification.ROLLOVER_SLOT`）。
   * 与 `drawSlotOverlay` 同一套入参（有网格给 `edges` / `points`，没有网格给 `rect`），
   * 但只描一圈亮白轮廓、不画顶点白点 —— 白点是"选中"的操作柄，悬停不该给。
   *
   * 传空对象即整层清空：这就是「移出即消失」。悬停对象已选中时调用方不该再调它 ——
   * 选中轮廓已经在同一个位置上，两条叠着画没有信息量。
   */
  drawHoverOutline(options: {
    edges?: Array<[number, number, number, number]>;
    points?: Array<[number, number]>;
    rect?: [number, number, number, number];
  } = {}): void {
    this.hoverOutline.clear();
    const { edges = [], points = [], rect } = options;
    const px = 1 / (Math.abs(this.hoverOutline.scale.x) || 1);
    // 段数 = 真正描出去的轮廓段（判据用；0 表示画布上什么都没有）
    this.hoverOutlinePrimitives = edges.length + (rect ? 4 : 0) + (points.length > 0 && edges.length === 0 ? 1 : 0);
    if (rect) {
      const [x0, y0, x1, y1] = rect;
      this.hoverOutline.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    for (const [ax, ay, bx, by] of edges) this.hoverOutline.moveTo(ax, ay).lineTo(bx, by);
    if (rect || edges.length > 0) {
      this.hoverOutline.stroke({ width: 1.6 * px, color: 0xffffff, alpha: 0.95 });
    }
  }

  /** 悬停轮廓的渲染证据（headless 判据用）：真正描出的段数 + 图层相机变换。
   *  只读渲染侧真实状态 —— "状态有值但没画" 与 "画错位置" 两类回归都抓得住
   *  （位置就是 §112 抓到的真 bug：`setCamera` 漏了这一层，轮廓会画在原点）。 */
  hoverDebug(): { primitives: number; scale: number; x: number; y: number } {
    return {
      primitives: this.hoverOutlinePrimitives,
      scale: this.hoverOutline.scale.x,
      x: this.hoverOutline.position.x,
      y: this.hoverOutline.position.y,
    };
  }

  private paint(
    items: RenderItem[],
    target: Map<string, SlotMesh>,
    layer: Container,
    keyPrefix: string,
    seen: Set<string> = new Set<string>(),
    hideUnseen = true,
    order?: Mesh[],
  ): void {
    for (const item of items) {
      const key = keyPrefix + item.slot;
      const vertexCount = item.positions.length / 2;
      const indices = item.kind === 'image'
        ? Uint16Array.from([0, 1, 2, 0, 2, 3])
        : item.triangles;
      const entry = this.obtainMesh(key, vertexCount, indices as Uint16Array, target, layer);
      seen.add(key);
      const normalizedUvs = new Float32Array(item.uvs.length);
      for (let i = 0; i < item.uvs.length; i += 2) {
        normalizedUvs[i] = item.uvs[i] / this.atlasWidth;
        normalizedUvs[i + 1] = item.uvs[i + 1] / this.atlasHeight;
      }
      try {
        if (entry.positionBuffer) {
          (entry.positionBuffer.data as Float32Array).set(item.positions);
          entry.positionBuffer.update();
        }
        if (entry.uvBuffer) {
          (entry.uvBuffer.data as Float32Array).set(normalizedUvs);
          entry.uvBuffer.update();
        }
      } catch {
        entry.geometry = new MeshGeometry({
          positions: item.positions,
          uvs: normalizedUvs,
          indices: Uint32Array.from(indices as Uint16Array),
        });
        entry.mesh.geometry = entry.geometry;
        entry.positionBuffer = entry.geometry.getBuffer('aPosition') as Buffer | null;
        entry.uvBuffer = entry.geometry.getBuffer('aUV') as Buffer | null;
      }
      if (this.texture) entry.mesh.texture = this.texture;
      entry.mesh.alpha = item.alpha;
      entry.mesh.tint = item.tint;
      // official slot 混合模式（语料里 107 处全部是 "add"）
      entry.mesh.blendMode = item.blend as never;
      entry.mesh.visible = true;
      order?.push(entry.mesh);
    }
    if (hideUnseen) {
      for (const [key, entry] of target) {
        if (!seen.has(key)) entry.mesh.visible = false;
      }
    }
  }

  render(): void {
    if (!this.initialized) return;
    this.app.renderer.render(this.app.stage);
  }


  destroy(): void {
    try {
      for (const entry of this.meshes.values()) entry.mesh.destroy();
      this.meshes.clear();
      for (const entry of this.ghostMeshes.values()) entry.mesh.destroy();
      this.ghostMeshes.clear();
      this.hoverOutlinePrimitives = 0;
      if (this.initialized) {
        const canvas = this.app.canvas as HTMLCanvasElement | undefined;
        this.app.destroy(false, { children: true });
        if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
      }
    } catch {
      // renderer may have been torn down before init() resolved (React StrictMode)
    }
    this.destroyed = true;
    this.initialized = false;
  }
}
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** SVG 颜色字面量（如 `#aeaeae`）→ 0xRRGGBB */
export function hexToNum(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16) || 0;
}








