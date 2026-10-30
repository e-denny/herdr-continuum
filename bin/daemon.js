'use strict';
// Detached autosave daemon: one snapshot every intervalMinutes (5 by default),
// tmux-continuum style. Started by the startup hook, never shown as a pane.
const fs = require('fs');
const path = require('path');
const herdr = require('../lib/herdr');
const snapshot = require('../lib/snapshot');
const settings = require('../lib/settings');
const boot = require('../lib/boot');
const log = require('../lib/log');
const { DAEMON_PID, ensureDirs } = require('../lib/paths');

function readPid() {
  try {
    const raw = fs.readFileSync(DAEMON_PID, 'utf8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) return Number(JSON.parse(raw).pid) || null;
    return Number(raw) || null;
  } catch {
    return null;
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

function removePid() {
  try {
    if (readPid() === process.pid) fs.unlinkSync(DAEMON_PID);
  } catch {
    /* already gone */
  }
}

function writePid(token) {
  fs.mkdirSync(path.dirname(DAEMON_PID), { recursive: true });
  fs.writeFileSync(DAEMON_PID, JSON.stringify({ pid: process.pid, token: token || null, started_at: new Date().toISOString() }));
}

function main() {
  ensureDirs();
  const existing = readPid();
  if (existing && existing !== process.pid && isRunning(existing)) {
    // Another daemon owns this session; stand down quietly.
    process.exit(0);
  }

  const cfg = settings.load();
  const intervalMs = Math.max(60_000, cfg.intervalMinutes * 60_000);
  const startToken = boot.token();
  writePid(startToken);

  log.info(`daemon start pid=${process.pid} interval=${cfg.intervalMinutes}m state=${snapshot.SNAP_DIR}`);

  const shutdown = (why) => {
    log.info(`daemon stop pid=${process.pid} (${why})`);
    removePid();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('exit', removePid);

  let timer = null;
  const oneshot = !!process.env.HERDR_CONTINUUM_ONESHOT;

  function tick() {
    // A different server boot means this daemon is orphaned: the startup hook
    // for the new server owns snapshots now.
    const nowToken = boot.token();
    if (startToken && nowToken && nowToken !== startToken) {
      shutdown('server rebooted');
      return;
    }
    if (!herdr.alive()) {
      shutdown('herdr server is not running');
      return;
    }
    if (boot.isRestoring()) {
      log.info('skipping snapshot: restore in progress');
    } else {
      try {
        const res = snapshot.save();
        const s = res.summary;
        log.info(
          `snapshot ${path.basename(res.file)} workspaces=${s.workspaces} panes=${s.panes} ` +
          `apps=${s.apps} editors=${s.editors} agents=${s.agents}` +
          (res.pruned ? ` pruned=${res.pruned}` : ''),
        );
      } catch (e) {
        log.error(`snapshot failed: ${e && e.message ? e.message : e}`);
      }
    }
    if (oneshot) {
      shutdown('oneshot');
      return;
    }
    timer = setTimeout(tick, intervalMs);
  }

  // First snapshot immediately: the startup hook starts this daemon after
  // auto-restore has finished, so it records the restored state right away.
  tick();
}
main();
