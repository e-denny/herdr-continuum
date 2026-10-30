'use strict';
// Thin wrapper over the herdr CLI, which speaks the same socket API as the TUI
// and returns JSON when asked. Every call goes through HERDR_BIN_PATH so the
// plugin works with any session/socket transport.
const { spawnSync } = require('child_process');

const BIN = process.env.HERDR_BIN_PATH || 'herdr';
const RETRIES = Number(process.env.HERDR_CONTINUUM_RETRIES || 3);

const TRANSIENT = /BrokenPipe|broken pipe|Connection reset|ConnectionReset|WouldBlock|os error (32|232)|pipe is being closed/i;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no Atomics.wait: just continue */
  }
}

function raw(args, opts = {}) {
  let res;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    res = spawnSync(BIN, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    if (res.error) throw new Error(`herdr ${args.join(' ')}: ${res.error.message}`);
    const blob = `${res.stdout || ''}${res.stderr || ''}`;
    if (attempt < RETRIES && res.status !== 0 && TRANSIENT.test(blob)) {
      sleepSync(150 + attempt * 150);
      continue;
    }
    break;
  }
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Some CLI versions print a status line around the JSON body; slice from the
// first bracket so parsing stays tolerant of that.
function extractJson(text) {
  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  const i = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  return i === -1 ? text : text.slice(i);
}

function json(args) {
  const { code, stdout, stderr } = raw(args);
  const text = (stdout && stdout.trim()) || (stderr && stderr.trim()) || '';
  try {
    return JSON.parse(extractJson(text));
  } catch {
    throw new Error(`herdr ${args.join(' ')} returned non-JSON (exit ${code}): ${text.slice(0, 400)}`);
  }
}

const unwrap = (res) => (res && res.result !== undefined ? res.result : res);

// ---- reads -----------------------------------------------------------------
function snapshot() {
  return unwrap(json(['api', 'snapshot'])).snapshot;
}

function processInfo(paneId) {
  try {
    return unwrap(json(['pane', 'process-info', '--pane', paneId])).process_info || null;
  } catch {
    return null; // pane closed between listing and inspection
  }
}

function paneList(workspaceId) {
  const args = ['pane', 'list'];
  if (workspaceId) args.push('--workspace', workspaceId);
  return unwrap(json(args)).panes || [];
}

function alive() {
  try {
    const r = raw(['status', 'server']);
    return r.code === 0 && /status:\s*running/i.test(r.stdout);
  } catch {
    return false;
  }
}

// ---- writes ----------------------------------------------------------------
function runInPane(paneId, command) {
  return raw(['pane', 'run', paneId, command]);
}

function createWorkspace({ cwd, label } = {}) {
  const args = ['workspace', 'create', '--no-focus'];
  if (cwd) args.push('--cwd', cwd);
  if (label) args.push('--label', label);
  return unwrap(json(args)); // { workspace, tab, root_pane }
}

function createTab({ workspaceId, cwd, label } = {}) {
  const args = ['tab', 'create', '--no-focus', '--workspace', workspaceId];
  if (cwd) args.push('--cwd', cwd);
  if (label) args.push('--label', label);
  return unwrap(json(args)); // { tab, root_pane }
}

function splitPane(paneId, { direction = 'right', ratio = 0.5, cwd } = {}) {
  const args = ['pane', 'split', paneId, '--direction', direction, '--ratio', String(ratio), '--no-focus'];
  if (cwd) args.push('--cwd', cwd);
  return unwrap(json(args)).pane;
}

function focusWorkspace(workspaceId) {
  return raw(['workspace', 'focus', workspaceId]);
}

module.exports = {
  BIN,
  raw,
  json,
  snapshot,
  processInfo,
  paneList,
  alive,
  runInPane,
  createWorkspace,
  createTab,
  splitPane,
  focusWorkspace,
};
