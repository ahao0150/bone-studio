/**
 * 免安装 Windows 产物（M6「Windows 打包」）。
 *
 * 把 `dist/`、桌面主进程与 **Electron 自带的运行时**拼到一个目录里：
 *
 *   release/BoneStudio-win32-x64/
 *   ├─ BoneStudio.exe            ← electron.exe 改名而来
 *   ├─ *.dll / locales/ …        ← Electron 运行时原样复制
 *   └─ resources/app/            ← Electron 默认加载的应用目录
 *      ├─ package.json           ← main 指向 tools/desktop/main.cjs
 *      ├─ tools/desktop/main.cjs
 *      └─ dist/…                 ← 生产构建产物
 *
 * 双击 `BoneStudio.exe` 即可运行，**不需要** electron-builder / 安装包工具链
 * （后者还得再下几百 MB 的 nsis / winCodeSign）。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = join(ROOT, 'release', 'BoneStudio-win32-x64');
const APP = join(OUT, 'resources', 'app');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html 不存在 —— 先跑 `npm run build`');
  process.exit(2);
}
if (!existsSync(join(ELECTRON, 'electron.exe'))) {
  console.error('Electron 运行时不存在 —— 先 `npm i -D electron` 再 `node node_modules/electron/install.js`');
  process.exit(2);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

// ① Electron 运行时
cpSync(ELECTRON, OUT, { recursive: true });
// ② 应用（主进程 + 生产产物）
mkdirSync(join(APP, 'tools', 'desktop'), { recursive: true });
cpSync(DIST, join(APP, 'dist'), { recursive: true });
copyFileSync(join(ROOT, 'tools', 'desktop', 'main.cjs'), join(APP, 'tools', 'desktop', 'main.cjs'));
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
writeFileSync(join(APP, 'package.json'), JSON.stringify({
  name: 'bone-studio-desktop',
  productName: 'BoneStudio',
  version,
  main: 'tools/desktop/main.cjs',
}, null, 2));
// ③ 可执行文件改名，双击就能认出是哪个应用
copyFileSync(join(OUT, 'electron.exe'), join(OUT, 'BoneStudio.exe'));

const bytes = (path) => {
  try {
    return readFileSync(path).length;
  } catch {
    return 0;
  }
};
console.log(JSON.stringify({
  out: OUT,
  exe: join(OUT, 'BoneStudio.exe'),
  entryBytes: bytes(join(APP, 'dist', 'index.html')),
  mainBytes: bytes(join(APP, 'tools', 'desktop', 'main.cjs')),
}, null, 2));