'use strict';
// Event hook. Snapshots on layout/agent changes, debounced, and makes sure the
// autosave daemon is alive.
//
// The first event of a new server boot is deliberately ignored: herdr may still
// be restoring panes, and a snapshot taken now would overwrite the pre-crash
// snapshot before the startup hook gets to restore it.
const snapshot = require('../lib/snapshot');
const settings = require('../lib/settings');
const boot = require('../lib/boot');
const daemonctl = require('../lib/daemonctl');
const log = require('../lib/log');
const { DEBOUNCE, ensureDirs } = require('../lib/paths');
const fs = require('fs');

function readDebounce() {
  try {
    return JSON.parse(fs.readFileSync(DEBOUNCE, 'utf8')).at || 0;
  } catch {
    return 0;
  }
}

function writeDebounce(at) {
  try {
    fs.writeFileSync(DEBOUNCE, JSON.stringify({ at }));
  } catch {
    /* best effort */
  }
}

function main() {
  ensureDirs();
  const cfg = settings.load();

  // New server boot? Claim it and stay out of the way of the startup hook.
  if (boot.bootChanged()) {
    boot.setStoredToken(boot.token());
    console.log('herdr-continuum: new server boot detected; skipping event snapshot');
    return;
  }

  if (boot.isRestoring()) {
    console.log('herdr-continuum: restore in progress; skipping event snapshot');
    return;
  }

  const now = Date.now();
  const last = readDebounce();
  if (cfg.debounceSeconds > 0 && now - last < cfg.debounceSeconds * 1000) {
    // Too soon: still make sure the daemon is running, then stand down.
    const d = daemonctl.start();
    if (d.started) console.log(`herdr-continuum: autosave daemon started (pid ${d.pid})`);
    return;
  }

  try {
    const res = snapshot.save();
    writeDebounce(now);
    const s = res.summary;
    console.log(`herdr-continuum: saved ${res.file} (apps=${s.apps} editors=${s.editors} agents=${s.agents})`);
  } catch (e) {
    log.error(`event snapshot failed: ${e && e.message ? e.message : e}`);
    console.error(`herdr-continuum: event snapshot failed: ${e && e.message ? e.message : e}`);
  }

  const d = daemonctl.start();
  if (d.started) console.log(`herdr-continuum: autosave daemon started (pid ${d.pid})`);
}

main();
