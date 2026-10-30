'use strict';
// Durable locations for the plugin.
//
// herdr injects HERDR_PLUGIN_STATE_DIR / HERDR_PLUGIN_CONFIG_DIR for plugin
// commands. When a script is run by hand (e.g. `node bin/save.js`) we fall back
// to per-user XDG locations.
//
// Snapshots are kept per herdr session: the default session and every named
// `herdr --session <name>` get their own directory, so restoring one session
// never pulls in another session's panes. The session key is derived from the
// socket path because that is the one identifier every command receives.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ROOT = process.env.HERDR_PLUGIN_ROOT || path.resolve(__dirname, '..');
const PLUGIN_ID = 'edgar.herdr-continuum';

// Match herdr's own plugin layout when run by hand, so `node bin/save.js` and
// the plugin actions share one set of snapshots.
const STATE_ROOT =
  process.env.HERDR_PLUGIN_STATE_DIR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'herdr', 'plugins', PLUGIN_ID);

const CONFIG_DIR =
  process.env.HERDR_PLUGIN_CONFIG_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'herdr', 'plugins', 'config', PLUGIN_ID);

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_') || 'default';

// herdr session names never contain "/" but be defensive anyway.
function sessionKey() {
  const explicit = process.env.HERDR_SESSION_NAME || process.env.HERDR_SESSION;
  if (explicit) return sanitize(explicit);

  const sock = process.env.HERDR_SOCKET_PATH;
  if (sock) {
    const dir = path.dirname(sock);
    // Named sessions live in <config>/herdr/sessions/<name>/herdr.sock
    if (path.basename(path.dirname(dir)) === 'sessions') return sanitize(path.basename(dir));
    return 'default';
  }
  return 'default';
}

const SESSION_KEY = sessionKey();
const STATE_DIR = path.join(STATE_ROOT, 'sessions', SESSION_KEY);

const SNAP_DIR = path.join(STATE_DIR, 'snapshots');
const LAST = path.join(STATE_DIR, 'last.json');
const LOCK = path.join(STATE_DIR, 'snapshot.lock');
const DAEMON_PID = path.join(STATE_DIR, 'daemon.pid');
const DAEMON_LOG = path.join(STATE_DIR, 'daemon.log');
const DEBOUNCE = path.join(STATE_DIR, 'debounce.json');

function ensureDirs() {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

module.exports = {
  PLUGIN_ROOT,
  PLUGIN_ID,
  CONFIG_DIR,
  STATE_ROOT,
  STATE_DIR,
  SESSION_KEY,
  SNAP_DIR,
  LAST,
  LOCK,
  DAEMON_PID,
  DAEMON_LOG,
  DEBOUNCE,
  ensureDirs,
};
