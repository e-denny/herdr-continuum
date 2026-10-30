'use strict';
// Startup hook. Runs once after herdr has restored the session layout.
//
// 1. Claim this server boot (so event hooks don't snapshot a half-restored session).
// 2. Wait a moment for shells to come up.
// 3. Rehydrate the last snapshot (nvim sessions, dev servers, TUIs, …).
// 4. Start the detached 5-minute snapshot daemon.
const snapshot = require('../lib/snapshot');
const restore = require('../lib/restore');
const settings = require('../lib/settings');
const boot = require('../lib/boot');
const daemonctl = require('../lib/daemonctl');
const log = require('../lib/log');
const { ensureDirs } = require('../lib/paths');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  ensureDirs();
  const cfg = settings.load();

  // Claim the boot before doing anything slow; event hooks compare against this.
  boot.setStoredToken(boot.token());

  if (cfg.autoRestore) {
    let model = null;
    try {
      model = snapshot.loadLast();
    } catch (e) {
      console.error(`herdr-continuum: could not read the last snapshot: ${e && e.message ? e.message : e}`);
      log.error(`could not read the last snapshot: ${e && e.message ? e.message : e}`);
    }
    if (!model) {
      console.log('herdr-continuum: no usable snapshot yet; nothing to restore');
    } else {
      boot.markRestoring(true);
      try {
        await sleep(Math.max(0, Number(cfg.autoRestoreSettleMs) || 0));
        const mode = cfg.autoRestoreMode === 'auto' ? 'auto' : 'rehydrate';
        console.log(`herdr-continuum: auto-restore (${mode}) from ${model.saved_at}`);
        const res = restore.restore(model, { mode, log: (line) => console.log(`  ${line}`) });
        const ran = res.actions.filter((a) => a.action === 'run').length;
        console.log(`herdr-continuum: auto-restore finished (${ran} pane(s) relaunched)`);
      } catch (e) {
        console.error(`herdr-continuum: auto-restore failed: ${e && e.message ? e.message : e}`);
        log.error(`auto-restore failed: ${e && e.message ? e.message : e}`);
      } finally {
        boot.markRestoring(false);
      }
    }
  } else {
    console.log('herdr-continuum: autoRestore is off; only the daemon will start');
  }

  const d = daemonctl.start();
  console.log(d.started ? `herdr-continuum: autosave daemon started (pid ${d.pid})` : `herdr-continuum: autosave daemon already running (pid ${d.pid})`);
}

main().catch((e) => {
  console.error(`herdr-continuum: startup hook error: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
