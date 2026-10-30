'use strict';
// List snapshots for this herdr session, newest last.
const snapshot = require('../lib/snapshot');
const { SESSION_KEY } = require('../lib/paths');

const rows = snapshot.list();
if (!rows.length) {
  console.log(`no snapshots yet for session "${SESSION_KEY}" (${snapshot.SNAP_DIR})`);
  process.exit(0);
}

console.log(`session "${SESSION_KEY}"  ${snapshot.SNAP_DIR}`);
for (const r of rows) {
  const s = r.summary || {};
  const when = new Date(r.mtime).toISOString().replace('T', ' ').replace(/\..*/, '');
  console.log(
    `${r.name}  ${when}  ` +
    `ws=${String(s.workspaces || '?').padStart(2)} panes=${String(s.panes || '?').padStart(2)} ` +
    `apps=${String(s.apps || 0).padStart(2)} editors=${String(s.editors || 0).padStart(2)} ` +
    `agents=${String(s.agents || 0).padStart(2)}  ${Math.round(r.size / 1024)}K`,
  );
}
