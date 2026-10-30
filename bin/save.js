'use strict';
// Save a snapshot now. Bound to an action, and used by hand / scripts.
const snapshot = require('../lib/snapshot');
const { ensureDirs } = require('../lib/paths');

try {
  ensureDirs();
  const res = snapshot.save();
  const s = res.summary;
  console.log(`saved ${res.file}`);
  console.log(
    `workspaces=${s.workspaces} panes=${s.panes} apps=${s.apps} editors=${s.editors} agents=${s.agents}` +
    (res.pruned ? ` pruned=${res.pruned}` : ''),
  );
} catch (e) {
  console.error(`herdr-continuum: snapshot failed: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
