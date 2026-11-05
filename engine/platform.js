/**
 * PLATFORM — khác biệt Windows / macOS / Linux gom một chỗ:
 * tên lệnh Python, đường dẫn Chrome, mở thư mục, tắt Chrome cũ của một profile.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// Tìm lệnh trong PATH (trả đường dẫn đầy đủ hoặc '')
function which(cmd) {
  const exts = IS_WIN ? ['.exe', '.cmd', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch (_) {}
    }
  }
  return '';
}

// Lệnh Python mặc định: Windows là "python"; Linux/macOS ưu tiên "python3" (Ubuntu không có "python")
const PY = IS_WIN ? 'python' : (which('python3') ? 'python3' : 'python');

// Python 3.12 cho VieNeu trên Linux/macOS (Windows giữ danh sách sẵn có trong từng module)
function python312Candidates() {
  if (IS_WIN) return [];
  return [path.join(os.homedir(), '.local', 'bin', 'python3.12'), '/usr/local/bin/python3.12', '/usr/bin/python3.12', '/opt/homebrew/bin/python3.12'];
}

function chromePath() {
  if (IS_MAC) return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (IS_WIN) {
    return [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
      .map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(p => fs.existsSync(p)) || 'chrome.exe';
  }
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const p = which(c);
    if (p) return p;
  }
  return '/usr/bin/google-chrome';
}

// Mở thư mục / file bằng trình quản lý file của hệ điều hành
function openPath(p, done = () => {}) {
  const cmd = IS_WIN ? 'explorer.exe' : IS_MAC ? 'open' : 'xdg-open';
  execFile(cmd, [p], () => done());
}

// Chrome cũ còn giữ profile (app tắt đột ngột) → tắt đúng tiến trình dùng profile đó, xoá khoá SingletonLock
function killChromeForProfile(profileDir) {
  if (!profileDir || IS_MAC) return Promise.resolve();
  const unlock = () => { for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.unlinkSync(path.join(profileDir, f)); } catch (_) {} } };
  return new Promise(resolve => {
    if (IS_WIN) {
      const escaped = profileDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -match '${escaped}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      ], { timeout: 4500 }, () => { unlock(); resolve(); });
    } else {
      // pkill -f khớp nguyên chuỗi --user-data-dir=<profile> (ký tự đặc biệt được thoát cho regex)
      const pat = '--user-data-dir=' + profileDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      execFile('pkill', ['-f', '--', pat], { timeout: 4500 }, () => setTimeout(() => { unlock(); resolve(); }, 300));
    }
  });
}

module.exports = { IS_WIN, IS_MAC, IS_LINUX, PY, which, python312Candidates, chromePath, openPath, killChromeForProfile };
