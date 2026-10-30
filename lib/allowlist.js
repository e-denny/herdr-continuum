'use strict';
// Decides which foreground programs are safe to relaunch on restore.
//
// Mirrors tmux-resurrect's `@resurrect-processes`: an idle shell is never
// restored, agent panes are left to herdr's native agent resume, and every other
// program must appear in the allowlist.
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, PLUGIN_ROOT } = require('./paths');
const settings = require('./settings');

const USER_FILE = path.join(CONFIG_DIR, 'allowlist.txt');
const DEFAULT_FILE = path.join(PLUGIN_ROOT, 'config', 'allowlist.default.txt');

// Interactive shells mean "this pane is idle", nothing to restore.
const SHELLS = new Set([
  'sh', 'bash', 'dash', 'ash', 'zsh', 'fish', 'nu', 'nushell', 'elvish', 'xonsh',
  'pwsh', 'powershell', 'cmd', 'command', 'tcsh', 'csh', 'ksh', 'busybox',
]);

function baseName(value) {
  if (!value) return '';
  let b = path.basename(String(value).trim());
  b = b.toLowerCase();
  if (b.endsWith('.exe')) b = b.slice(0, -4);
  return b;
}

function isShellName(name) {
  return SHELLS.has(baseName(name));
}

function ensureUserFile() {
  try {
    if (!fs.existsSync(USER_FILE) && fs.existsSync(DEFAULT_FILE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.copyFileSync(DEFAULT_FILE, USER_FILE);
    }
  } catch {
    /* fall back to reading the packaged default in place */
  }
}

let cache = null; // { key, all, names }
function load() {
  const s = settings.load();
  const key = `${USER_FILE}:${fs.existsSync(USER_FILE) ? fs.statSync(USER_FILE).mtimeMs : 0}:` +
    `${(s.extraPrograms || []).join(',')}`;
  if (cache && cache.key === key) return cache;

  ensureUserFile();
  const file = fs.existsSync(USER_FILE) ? USER_FILE : DEFAULT_FILE;
  let names = [];
  try {
    names = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(baseName);
  } catch {
    names = [];
  }

  const merged = new Set([...names, ...(s.extraPrograms || []).map(baseName)]);
  cache = { key, all: merged.has('*'), names: merged };
  return cache;
}

function restorable(name) {
  const { all, names } = load();
  return all || names.has(baseName(name));
}

module.exports = { load, isShellName, restorable, baseName, USER_FILE, DEFAULT_FILE };
