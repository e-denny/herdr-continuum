'use strict';
// Per-boot detection. herdr rewrites its socket when a server starts, so the
// socket's contents+mtime identify one server boot. Plugin event hooks fire
// during that boot too; without this guard the first hook could snapshot a
// half-restored session and overwrite the good pre-crash snapshot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATE_DIR } = require('./paths');

function socketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = [
    path.join(configHome, 'herdr', 'herdr.sock'),
    path.join(os.homedir(), '.herdr', 'herdr.sock'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// A string that changes whenever the server restarts, or null if unknown.
// The socket file cannot be read on Unix (read on a socket fails with ENXIO),
// so its mtime is the reliable part; herdr recreates the socket on every boot.
function token() {
  const sock = socketPath();
  if (!sock) return null;
  try {
    let content = '';
    try {
      content = fs.readFileSync(sock, 'utf8').trim();
    } catch {
      /* Unix socket: not readable, mtime alone identifies the boot */
    }
    const mtime = Math.round(fs.statSync(sock).mtimeMs);
    return `${content || 'mtime'}@${mtime}`;
  } catch {
    return null;
  }
}

const BOOT_FILE = path.join(STATE_DIR, 'boot.json');
const RESTORING_FILE = path.join(STATE_DIR, 'restoring.json');

function storedToken() {
  try {
    return JSON.parse(fs.readFileSync(BOOT_FILE, 'utf8')).token || null;
  } catch {
    return null;
  }
}

function setStoredToken(t) {
  try {
    fs.mkdirSync(path.dirname(BOOT_FILE), { recursive: true });
    fs.writeFileSync(BOOT_FILE, JSON.stringify({ token: t, at: new Date().toISOString() }));
  } catch {
    /* best effort */
  }
}

function bootChanged() {
  const t = token();
  if (!t) return false;
  return storedToken() !== t;
}

function markRestoring(on) {
  try {
    if (on) {
      fs.mkdirSync(path.dirname(RESTORING_FILE), { recursive: true });
      fs.writeFileSync(RESTORING_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
    } else {
      fs.unlinkSync(RESTORING_FILE);
    }
  } catch {
    /* best effort */
  }
}

// A restore currently in progress (and recent enough to be believable).
function isRestoring(maxAgeMs = 5 * 60 * 1000) {
  try {
    const st = fs.statSync(RESTORING_FILE);
    return Date.now() - st.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

module.exports = { socketPath, token, storedToken, setStoredToken, bootChanged, markRestoring, isRestoring, BOOT_FILE, RESTORING_FILE };
