'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} = require('electron');

const { createStore } = require('./config');
const { registerIpc } = require('./ipc');
const { migrate } = require('./migrate');
const scheduler = require('./scheduler');

app.setName('CacheNook');

if (process.env.CACHENOOK_THEME === 'dark') nativeTheme.themeSource = 'dark';
if (process.env.CACHENOOK_THEME === 'light') nativeTheme.themeSource = 'light';

// GUI apps get a minimal PATH. Add the usual developer tool locations so brew,
// docker and xcrun can be found without reading the user's shell config.
const extraPaths = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.volta', 'bin'),
  path.join(os.homedir(), 'Library', 'pnpm'),
];
process.env.PATH = [...extraPaths, process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(':');

const TRAY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAA1UlEQVQ4jb3SP0oDQRTH8c9uLGzFiJZ6AUPKQNqQxhNYeQMhEWs9keghcgSr/COlTYixEYS1mFmIsrNJEPw2M7zfvN+8eW/4I40t+jFucI5PLPc1gBUOcYU2XqNZkhx3mGC0Ec/Qw/225Bd84AEXO1T4g2FMvkzoBzitMxjHm1NcY54SmyjQqTHoxDMnZSDfEMt9UWOQxfWryuANU/RrDPpYqPgPJQOhia0KrYX3eCZJA89Y41F4c1do7BpPv6quJBfGORX6UWCGW2GMO5PhCGf7JP0/392+JKMSoPsUAAAAAElFTkSuQmCC';

const MAIN_TEXT = {
  en: {
    open: 'Open CacheNook',
    scan: 'Scan now',
    settings: 'Settings…',
    updates: 'Check for Updates…',
    quit: 'Quit CacheNook',
    about: 'About CacheNook',
    hide: 'Hide CacheNook',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    services: 'Services',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    lastCleanup: 'Last cleanup',
    none: 'none yet',
    nothing: 'nothing to remove',
    auto: 'Automatic cleanup',
    off: 'off',
  },
  vi: {
    open: 'Mở CacheNook',
    scan: 'Quét ngay',
    settings: 'Cài đặt…',
    updates: 'Kiểm tra cập nhật…',
    quit: 'Thoát CacheNook',
    about: 'Giới thiệu CacheNook',
    hide: 'Ẩn CacheNook',
    hideOthers: 'Ẩn ứng dụng khác',
    showAll: 'Hiện tất cả',
    services: 'Dịch vụ',
    edit: 'Sửa',
    view: 'Hiển thị',
    window: 'Cửa sổ',
    lastCleanup: 'Lần dọn gần nhất',
    none: 'chưa có',
    nothing: 'không có gì để xoá',
    auto: 'Tự động dọn',
    off: 'tắt',
  },
};

let language = 'en';
let mainWindow = null;
let tray = null;

function m(key) {
  return (MAIN_TEXT[language] || MAIN_TEXT.en)[key] || MAIN_TEXT.en[key];
}
const smokeTest = Boolean(process.env.CACHENOOK_SMOKE);
const smokeView = process.env.CACHENOOK_SMOKE_VIEW || '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1_080,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'CacheNook',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161c18' : '#e9efe7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (smokeTest) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message || ''}`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[smoke] load failed: ${code} ${description}`);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (smokeView) {
            await mainWindow.webContents.executeJavaScript(
              `document.querySelector('.tab[data-view="${smokeView}"]')?.click()`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, Number(process.env.CACHENOOK_SMOKE_VIEW_WAIT) || 1_800),
            );
          }
          const image = await mainWindow.webContents.capturePage();
          require('node:fs').writeFileSync('/tmp/cachenook-smoke.png', image.toPNG());
          console.log('[smoke] captured');
        } catch (error) {
          console.error(`[smoke] capture failed: ${error.message}`);
        }
        app.quit();
      }, Number(process.env.CACHENOOK_SMOKE_DELAY) || 8_000);
    });
  } else {
    mainWindow.once('ready-to-show', () => mainWindow.show());
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  const value = n / 1000 ** index;
  const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 1 ? (index >= 3 ? 1 : 0) : 2;
  return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[index]}`;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToWindow(channel) {
  showWindow();
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow) mainWindow.webContents.send(channel);
    });
  } else {
    mainWindow.webContents.send(channel);
  }
}

function nextRunLabel(schedule) {
  if (!schedule) return 'off';
  const now = new Date();
  const date = new Date(now);
  date.setHours(schedule.hour, schedule.minute, 0, 0);
  const diff = (schedule.weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  if (date <= now) date.setDate(date.getDate() + 7);
  const loc = language === 'vi' ? 'vi-VN' : undefined;
  return `${date.toLocaleDateString(loc, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })} ${language === 'vi' ? 'lúc' : 'at'} ${date.toLocaleTimeString(loc, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

async function buildTrayMenu() {
  let status = null;
  try {
    status = await scheduler.getStatus();
  } catch {
    status = null;
  }

  const last = status?.lastRun;
  const loc = language === 'vi' ? 'vi-VN' : undefined;
  let lastLabel = `${m('lastCleanup')}: ${m('none')}`;
  if (last?.finishedAt) {
    const finished = new Date(last.finishedAt);
    const when =
      language === 'vi'
        ? `${String(finished.getDate()).padStart(2, '0')}/${String(
            finished.getMonth() + 1,
          ).padStart(2, '0')}`
        : finished.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
    lastLabel =
      last.totalFreed > 0
        ? `${m('lastCleanup')}: ${formatBytes(last.totalFreed)} · ${when}`
        : `${m('lastCleanup')}: ${m('nothing')} · ${when}`;
  }

  const scheduleLabel = status?.installed
    ? `${m('auto')}: ${nextRunLabel(status.schedule)}`
    : `${m('auto')}: ${m('off')}`;

  return Menu.buildFromTemplate([
    { label: m('open'), click: showWindow },
    {
      label: m('scan'),
      click: () => sendToWindow('app:scan-now'),
    },
    {
      label: m('settings'),
      click: () => sendToWindow('app:open-settings'),
    },
    { type: 'separator' },
    { label: lastLabel, enabled: false },
    { label: scheduleLabel, enabled: false },
    { type: 'separator' },
    { label: m('quit'), click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromDataURL(TRAY_ICON);
  if (icon.isEmpty()) return;

  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('CacheNook');

  const openMenu = async () => {
    try {
      tray.popUpContextMenu(await buildTrayMenu());
    } catch {
      // tray is best effort
    }
  };

  tray.on('click', openMenu);
  tray.on('right-click', openMenu);
}

function buildMenu() {
  const devItems = app.isPackaged
    ? []
    : [{ role: 'toggleDevTools' }, { type: 'separator' }];

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: m('about') },
        { type: 'separator' },
        {
          label: m('settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('app:open-settings');
          },
        },
        {
          label: m('updates'),
          click: () => sendToWindow('app:check-updates'),
        },
        { type: 'separator' },
        { role: 'services', label: m('services') },
        { type: 'separator' },
        { role: 'hide', label: m('hide') },
        { role: 'hideOthers', label: m('hideOthers') },
        { role: 'unhide', label: m('showAll') },
        { type: 'separator' },
        { role: 'quit', label: m('quit') },
      ],
    },
    {
      label: m('edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: m('view'),
      submenu: [
        ...devItems,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu', label: m('window') },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await migrate();
    await scheduler.refreshIfStale();

    if (!app.isPackaged && app.dock) {
      const icon = path.join(__dirname, '..', '..', 'assets', 'icon-1024.png');
      if (fs.existsSync(icon)) app.dock.setIcon(icon);
    }

    language = createStore(app.getPath('userData')).load().language || 'en';
    app.setAboutPanelOptions({
      applicationName: 'CacheNook',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: 'Open source under the MIT license.',
    });

    registerIpc({
      getWindow: () => mainWindow,
      onLanguageChange: (next) => {
        language = next;
        buildMenu();
      },
    });
    buildMenu();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) {
        event.preventDefault();
        shell.openExternal(url).catch(() => {});
      }
    });
  });
}
