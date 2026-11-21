const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let serverProcess = null;

function getFreePort(startPort = 34567) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(getFreePort(startPort + 1)));
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(port, retries = 50) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (++count >= retries) {
          reject(new Error(`백엔드 서버(포트 ${port}) 응답 시간 초과`));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

function killServerProcess() {
  if (serverProcess && serverProcess.pid) {
    try {
      execSync(`taskkill /PID ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // 이미 종료됨
    }
    serverProcess = null;
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '웹사이트 관리 리스트',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    const port = await getFreePort(34567);
    const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
    const nodeExe = app.isPackaged
      ? path.join(process.resourcesPath, 'node.exe')
      : 'node';
    const serverScript = path.join(baseDir, 'backend', 'server.js');

    let serverLogs = '';
    serverProcess = spawn(nodeExe, [serverScript], {
      cwd: path.join(baseDir, 'backend'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: path.join(app.getPath('userData'), 'sites.db'),
      },
      windowsHide: true,
    });

    serverProcess.stdout.on('data', (data) => {
      serverLogs += data.toString();
    });

    serverProcess.stderr.on('data', (data) => {
      serverLogs += data.toString();
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null && !mainWindow) {
        dialog.showErrorBox('백엔드 서버 오류', serverLogs || `종료 코드: ${code}`);
        app.quit();
      }
    });

    await waitForServer(port);
    createWindow(port);
  } catch (err) {
    killServerProcess();
    dialog.showErrorBox('SiteMonitor 실행 오류', err.stack || err.message);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('will-quit', () => {
  killServerProcess();
});

app.on('window-all-closed', () => {
  killServerProcess();
  app.quit();
});