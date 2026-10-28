/**
 * BoneStudio 桌面外壳（M6「Windows 打包」）。
 *
 * 主进程只做三件事：开一个窗口、加载 `dist/index.html`、去掉 Electron 自带菜单栏
 * （编辑器有自己的菜单）。生产构建里没有 `window.__boneStudio` 调试探针，
 * 所以桌面侧的验证走 DOM（标题 / 画布 / 元件选择器）。
 */
const { app, BrowserWindow, shell } = require('electron');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

// 免安装产物里本文件位于 `<app>/tools/desktop/main.cjs`，应用根就是 `<app>`
const ROOT = join(__dirname, '..', '..');
const INDEX = join(ROOT, 'dist', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    title: 'BoneStudio - 龙骨动画编辑器',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  if (!existsSync(INDEX)) {
    console.error('[desktop] dist/index.html 不存在:', INDEX);
  }
  win.loadFile(INDEX);
  // 外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});