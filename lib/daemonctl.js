'use strict';
// Starting/stopping the detached autosave daemon.
//
// The pidfile records the pid and the server-boot token the daemon belongs to,
// so a daemon left over from a replaced server can be retired instead of being
// mistaken for the current one.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const boot = require('./boot');
const { DAEMON_PID, DAEMON_LOG, PLUGIN_ROOT, ensureDirs } = require('./paths');

function readState() {
  try {
    const raw = fs.readFileSync(DAEMON_PID, 'utf8').trim();
    if (!raw) return { pid: null, token: null };
    if (raw.startsWith('{')) {
      const j = JSON.parse(raw);
      return { pid: Number(j.pid) || null, token: j.token || null };
    }
    return { pid: Number(raw) || null, token: null };
  } catch {
    return { pid: null, token: null };
  }
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function runningPid() {
  const st = readState();
  return st.pid && isRunning(st.pid) ? st.pid : null;
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no Atomics.wait: skip the grace period */
  }
}

function retireStale(st) {
  if (!st.pid || !isRunning(st.pid)) return;
  const current = boot.token();
  if (!st.token || !current || st.token === current) return; // current boot: keep it
  try {
    process.kill(st.pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 30 && isRunning(st.pid); i++) sleepSync(50);
}

// Start the daemon if this server boot does not already have one. Detached +
// unref so the plugin command exits immediately; output goes to daemon.log.
function start() {
  ensureDirs();
  const st = readState();
  retireStale(st);

  const alive = st.pid && isRunning(st.pid) ? st.pid : null;
  if (alive) return { started: false, pid: alive };

  const out = fs.openSync(DAEMON_LOG, 'a');
  try {
    const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'bin', 'daemon.js')], {
      cwd: PLUGIN_ROOT,
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    return { started: true, pid: child.pid };
  } finally {
    try {
      fs.closeSync(out);
    } catch {
      /* child keeps its own copy */
    }
  }
}

function stop() {
  const pid = runningPid();
  if (!pid) return { stopped: false };
  try {
    process.kill(pid, 'SIGTERM');
    return { stopped: true, pid };
  } catch {
    return { stopped: false, pid };
  }
}

module.exports = { start, stop, runningPid, readState, isRunning, DAEMON_LOG };
