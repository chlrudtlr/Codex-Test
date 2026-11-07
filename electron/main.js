import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStore, atomicWrite } from './storage.js';
import { visibleBounds } from './window-state.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const indexFile = path.join(directory, '../src/index.html');
const appId = 'com.daynote.desktop';
let mainWindow;
let store;
let windowFile;
let boundsTimer;
let lastWindowState;
let restoringBounds = false;
let restoredBounds;

// Tests use an isolated directory and never alter the user's actual records.
if (process.env.DAYNOTE_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.DAYNOTE_TEST_DATA);
app.setName('Daynote');
app.setAppUserModelId(appId);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function settings() {
  const supported = ['win32', 'darwin'].includes(process.platform) && app.isPackaged;
  let enabled = false;
  if (supported) {
    const login = app.getLoginItemSettings();
    enabled = login.openAtLogin && (process.platform !== 'win32' || login.executableWillLaunchAtLogin);
  }
  return { autoLaunch: enabled, autoLaunchSupported: supported, platform: process.platform,
    packaged: app.isPackaged, dataPath: store.file, version: app.getVersion() };
}

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('허용되지 않은 요청입니다.');
  }
}

function saveBounds() {
  if (!lastWindowState) return;
  try {
    atomicWrite(windowFile, lastWindowState);
  } catch (error) {
    console.error('창 위치 저장 실패:', error.message);
  }
}

function captureBounds() {
  if (restoringBounds || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  // Electron/Chromium can round DIP sizes outward at fractional Windows scale
  // factors (electron/electron#55245). Keep the requested persisted rectangle
  // until it actually changes, so startup rounding never accumulates per launch.
  if (restoredBounds && restoredBounds.maximized === maximized &&
    ['x', 'y', 'width', 'height'].every(key => Math.abs(restoredBounds[key] - bounds[key]) <= 2)) return;
  restoredBounds = null;
  lastWindowState = { ...bounds, maximized };
}

function createWindow() {
  restoringBounds = true;
  restoredBounds = null;
  lastWindowState = null;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(windowFile, 'utf8')); } catch { /* First run. */ }
  const bounds = visibleBounds(saved, screen.getAllDisplays());
  const primary = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    width: Math.min(1240, primary.width), height: Math.min(820, primary.height),
    minWidth: Math.min(920, primary.width), minHeight: Math.min(640, primary.height),
    ...(bounds ?? {}),
    title: 'Daynote', backgroundColor: '#f5f6f2', show: false,
    icon: path.join(directory, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.loadFile(indexFile);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Apply saved bounds after the native frame exists, so Windows constructor
    // frame adjustments do not change the requested geometry.
    if (bounds) {
      mainWindow.setBounds(bounds);
      if (saved?.maximized) mainWindow.maximize();
      restoredBounds = { ...bounds, maximized: Boolean(saved?.maximized) };
      lastWindowState = restoredBounds;
    }
    restoringBounds = false;
    captureBounds();
  });
  for (const name of ['resize', 'move', 'maximize', 'unmaximize']) {
    mainWindow.on(name, () => {
      captureBounds();
      clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 250);
    });
  }
  mainWindow.on('close', () => { clearTimeout(boundsTimer); saveBounds(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (singleInstance) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    store = new DataStore(app.getPath('userData'));
    windowFile = path.join(app.getPath('userData'), 'window-state.json');
    try { store.load(); } catch (error) {
      dialog.showErrorBox('Daynote 저장 파일 오류', `${error.message}\n\n저장 위치: ${store.file}\n기존 기록을 보호하기 위해 앱을 종료합니다.`);
      app.quit(); return;
    }
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]) : null);
    ipcMain.handle('calendar:load', event => {
      trusted(event); return { data: store.load(), recoveryMessage: store.recoveryMessage };
    });
    ipcMain.handle('calendar:save', (event, data) => { trusted(event); store.save(data); return true; });
    ipcMain.on('calendar:flush', (event, data) => {
      try { trusted(event); store.save(data); event.returnValue = { ok: true }; }
      catch (error) { event.returnValue = { ok: false, message: error.message }; }
    });
    ipcMain.handle('settings:get', event => { trusted(event); return settings(); });
    ipcMain.handle('settings:auto-launch', (event, enabled) => {
      trusted(event);
      if (!settings().autoLaunchSupported || typeof enabled !== 'boolean') throw new Error('설치된 Windows 또는 macOS 앱에서 설정할 수 있습니다.');
      app.setLoginItemSettings({ openAtLogin: enabled });
      const updated = settings();
      if (enabled && !updated.autoLaunch) throw new Error('자동 실행을 등록하지 못했습니다. 운영체제의 시작 앱 설정을 확인해주세요.');
      return updated;
    });
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Daynote 실행 오류', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
