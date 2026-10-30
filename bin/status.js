'use strict';
// Report what the plugin is doing: state directory, daemon, last snapshot.
const fs = require('fs');
const snapshot = require('../lib/snapshot');
const settings = require('../lib/settings');
const daemonctl = require('../lib/daemonctl');
const { SESSION_KEY, STATE_DIR } = require('../lib/paths');

const cfg = settings.load();
const pid = daemonctl.runningPid();
const last = snapshot.loadLast();

console.log(`session:      ${SESSION_KEY}`);
console.log(`state:        ${STATE_DIR}`);
console.log(`interval:     ${cfg.intervalMinutes} min`);
console.log(`autoRestore:  ${cfg.autoRestore ? `on (${cfg.autoRestoreMode} mode)` : 'off'}`);
console.log(`daemon:       ${pid ? `running (pid ${pid})` : 'not running'}`);

if (last) {
  const s = snapshot.summarize(last);
  console.log(`last snapshot: ${last.saved_at}`);
  console.log(`               workspaces=${s.workspaces} panes=${s.panes} apps=${s.apps} editors=${s.editors} agents=${s.agents}`);
  for (const ws of last.workspaces) {
    for (const tab of ws.tabs) {
      for (const p of tab.panes) {
        if (p.kind === 'shell') continue;
        let extra = '';
        if (p.kind === 'editor') extra = ` session=${p.editor.session_file || '(none)'}`;
        else if (p.kind === 'agent') extra = ` agent=${(p.agent && p.agent.name) || '?'}`;
        else if (p.app) extra = ` cmd=${p.app.cmdline}`;
        console.log(`               #${ws.number} ${ws.label || ''} tab ${tab.number}: ${p.kind} ${(p.app && p.app.name) || ''}${extra}`);
      }
    }
  }
} else {
  console.log('last snapshot: none yet');
}

try {
  const logSize = fs.statSync(daemonctl.DAEMON_LOG).size;
  if (logSize) console.log(`daemon log:   ${daemonctl.DAEMON_LOG} (${Math.round(logSize / 1024)}K)`);
} catch {
  /* no log */
}
