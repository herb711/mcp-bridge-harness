const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const appRoot = path.resolve(__dirname, '..');
const webIndex = path.join(appRoot, 'web', 'index.html');
const apiModulePath = path.join(appRoot, 'dist', 'harness', 'api.js');
const shimModulePath = path.join(appRoot, 'dist', 'harness', 'shim.js');
let apiModulePromise;
let shimModulePromise;

function importApiModule() {
  if (!apiModulePromise) {
    apiModulePromise = import(pathToFileURL(apiModulePath).href);
  }
  return apiModulePromise;
}

function importShimModule() {
  if (!shimModulePromise) {
    shimModulePromise = import(pathToFileURL(shimModulePath).href);
  }
  return shimModulePromise;
}

function applyPackagedEnv() {
  if (!app.isPackaged) return;
  const installDir = path.dirname(process.execPath);
  const resourcesDir = process.resourcesPath || path.join(installDir, 'resources');
  process.env.MCP_HARNESS_PACKAGED = '1';
  process.env.MCP_HARNESS_INSTALL_DIR = installDir;
  process.env.MCP_HARNESS_RESOURCES_DIR = resourcesDir;
  process.env.MCP_HARNESS_EXECUTABLE = process.execPath;
}

function isDesktopPackaged() {
  return Boolean(process.env.MCP_HARNESS_DESKTOP) || app.isPackaged;
}

async function ensureMcpShimFromMain() {
  if (!app.isPackaged) return null;
  try {
    const shim = await importShimModule();
    if (typeof shim.ensureMcpShim === 'function') {
      const shimPath = await shim.ensureMcpShim();
      if (shimPath) console.log(`MCP Harness shim installed at ${shimPath}`);
      return shimPath;
    }
  } catch (error) {
    console.warn('Failed to install MCP Harness shim:', error);
  }
  return null;
}

async function ensureBuilt() {
  if (!fs.existsSync(apiModulePath)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'MCP Harness 未构建',
      message: '缺少 dist/harness/api.js。请先运行 npm run build。',
    });
    app.quit();
    return false;
  }
  if (!fs.existsSync(webIndex)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'MCP Harness UI 缺失',
      message: '缺少 web/index.html。请确认发布包包含 web 目录。',
    });
    app.quit();
    return false;
  }
  return true;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'MCP Harness',
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(webIndex);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const local = pathToFileURL(webIndex).href;
    if (url !== local && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'MCP Harness',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit', label: isMac ? '关闭窗口' : '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('harness:api', async (_event, request) => {
  const api = await importApiModule();
  const value = await api.handleHarnessApi(request || {});
  if (value === undefined) throw new Error('Unknown API endpoint.');
  return value;
});

ipcMain.handle('harness:openPath', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'Invalid path.' };
  const result = await shell.openPath(filePath);
  return result ? { ok: false, error: result } : { ok: true };
});

ipcMain.handle('harness:reinstallShim', async () => {
  const shimPath = await ensureMcpShimFromMain();
  return { ok: Boolean(shimPath), shimPath: shimPath || null };
});

ipcMain.handle('harness:installUpdate', async (_event, payload) => {
  if (!isDesktopPackaged()) {
    return { ok: false, error: '一键更新仅在桌面 App 中可用，请在发布页手动下载安装包。' };
  }
  const filePath = payload && typeof payload.filePath === 'string' ? payload.filePath : '';
  if (!filePath) return { ok: false, error: '未提供本地更新包路径。' };
  if (!fs.existsSync(filePath)) return { ok: false, error: '更新包不存在或已失效，请重新检查更新。' };
  try {
    const result = await shell.openPath(filePath);
    if (result) return { ok: false, error: result };
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

app.whenReady().then(async () => {
  process.env.MCP_HARNESS_DESKTOP = '1';
  applyPackagedEnv();
  await ensureMcpShimFromMain();
  if (!(await ensureBuilt())) return;
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
