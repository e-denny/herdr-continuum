'use strict';
// Locating editor session files.
//
// The snapshot records the session file that was in use so restore can run
// `nvim -S <file>` (the requirement: bring back the exact editor view).
//
// Lookup order:
//   1. an explicit `-S <file>` in the editor's own argv
//   2. <cwd>/Session.vim then <cwd>/Session.nvim   (vim-obsession's default)
//   3. Neovim's state session directory, persistence.nvim's naming scheme
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDITORS = new Set(['nvim', 'vim', 'vi']);
const isEditorName = (name) => EDITORS.has(String(name || '').toLowerCase());

function existsFile(p) {
  try {
    return !!p && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// `-S foo`, `-Sfoo`, `--session foo`
function sessionFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '-S' || a === '--session') return argv[i + 1] || null;
    if (a.startsWith('-S') && a.length > 2) return a.slice(2);
    if (a.startsWith('--session=')) return a.slice('--session='.length);
  }
  return null;
}

// The same argv with session arguments removed, for the case where the session
// file has disappeared and the editor should start with just its files.
function stripSessionArgs(argv) {
  if (!Array.isArray(argv)) return [];
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '-S' || a === '--session') {
      i++; // drop the value too
      continue;
    }
    if ((a.startsWith('-S') && a.length > 2) || a.startsWith('--session=')) continue;
    out.push(argv[i]);
  }
  return out;
}

// persistence.nvim: every run of \ / : becomes %, then `.vim`, optionally with
// a `%<branch>` suffix. Match the encoded prefix and take the newest file.
function persistenceSession(cwd, dir) {
  if (!cwd || !dir) return null;
  const encoded = String(cwd).replace(/[\\/:]+/g, '%');
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.vim') && (f === `${encoded}.vim` || f.startsWith(`${encoded}%`)));
  } catch {
    return null;
  }
  if (!entries.length) return null;
  const scored = entries
    .map((f) => ({ file: path.join(dir, f), mtime: mtimeMs(path.join(dir, f)) }))
    .sort((a, b) => b.mtime - a.mtime);
  return scored[0].file;
}

function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function defaultPersistenceDir() {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'nvim', 'sessions');
}

// Returns { file, source } or null. `cwd` should be the editor process's cwd.
function findSessionFile({ cwd, argv, settings }) {
  // 1. explicit -S argument
  const explicit = sessionFromArgv(argv);
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : cwd ? path.join(cwd, explicit) : explicit;
    if (existsFile(abs)) return { file: abs, source: 'argv' };
  }

  // 2. session file in the editor's working directory
  const names = (settings && settings.nvimSessionNames) || ['Session.vim', 'Session.nvim'];
  if (cwd) {
    for (const name of names) {
      const cand = path.join(cwd, name);
      if (existsFile(cand)) return { file: cand, source: 'cwd' };
    }
  }

  // 3. persistence.nvim state directory
  const dir = (settings && settings.nvimPersistenceDir) || defaultPersistenceDir();
  const persisted = persistenceSession(cwd, dir);
  if (persisted) return { file: persisted, source: 'persistence' };

  return null;
}

// `nvim -S <file>` with a POSIX-safe quote.
function sessionCommand(editor, file) {
  const quote = (s) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
  return `${path.basename(editor || 'nvim')} -S ${quote(file)}`;
}

module.exports = { isEditorName, findSessionFile, sessionFromArgv, stripSessionArgs, sessionCommand, defaultPersistenceDir };
