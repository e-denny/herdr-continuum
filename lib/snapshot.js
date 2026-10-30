'use strict';
// Builds and persists the snapshot model.
//
// herdr already persists the layout (workspaces, tabs, panes, cwd, agent session
// refs). This snapshot adds the missing half: which program was occupying each
// pane, plus the editor session file needed to rebuild an nvim view.
const fs = require('fs');
const path = require('path');
const herdr = require('./herdr');
const procs = require('./procs');
const allowlist = require('./allowlist');
const sessions = require('./sessions');
const settings = require('./settings');
const { SNAP_DIR, LAST, ensureDirs } = require('./paths');

const VERSION = 1;
const TOOL = 'herdr-continuum';

function rectsByPane(snap) {
  const map = new Map();
  for (const layout of snap.layouts || []) {
    for (const lp of layout.panes || []) map.set(lp.pane_id, { rect: lp.rect, layout });
  }
  return map;
}

function layoutsByTab(snap) {
  const map = new Map();
  for (const layout of snap.layouts || []) map.set(layout.tab_id, layout);
  return map;
}

function sortPanes(panes, rects) {
  return panes.slice().sort((a, b) => {
    const ra = (rects.get(a.pane_id) || {}).rect || {};
    const rb = (rects.get(b.pane_id) || {}).rect || {};
    return (ra.y || 0) - (rb.y || 0) || (ra.x || 0) - (rb.x || 0) || String(a.pane_id).localeCompare(String(b.pane_id));
  });
}

function describePane(pane, cfg, agentByPane) {
  const pref = herdr.processInfo(pane.pane_id);
  const fg = procs.foreground(pref);
  const cwd = pane.cwd || (fg && fg.cwd) || null;

  const out = {
    index: 0, // filled by the caller
    pane_id: pane.pane_id,
    cwd,
    kind: 'shell',
  };

  const agent = agentByPane.get(pane.pane_id);
  if (pane.agent || agent) {
    // herdr resumes these itself; we only record them for information (and for
    // the optional restoreAgents escape hatch).
    out.kind = 'agent';
    out.agent = {
      name: (agent && agent.agent) || pane.agent || null,
      session: (agent && agent.agent_session) || pane.agent_session || null,
      cmdline: fg ? fg.cmdline : null,
    };
    return out;
  }

  if (!fg) return out; // idle shell

  out.app = {
    name: fg.name,
    argv: fg.argv,
    cmdline: fg.cmdline,
    cwd: fg.cwd || cwd,
  };

  if (cfg.restoreNvim && sessions.isEditorName(fg.name)) {
    const found = sessions.findSessionFile({ cwd: fg.cwd || cwd, argv: fg.argv, settings: cfg });
    out.kind = 'editor';
    out.editor = {
      name: fg.name,
      argv: fg.argv,
      session_file: found ? found.file : null,
      session_source: found ? found.source : null,
    };
  } else {
    out.kind = allowlist.restorable(fg.name) ? 'app' : 'app-unlisted';
  }

  return out;
}

function build() {
  const cfg = settings.load();
  allowlist.load(); // seed the user's editable allowlist on first snapshot
  const snap = herdr.snapshot();
  const rects = rectsByPane(snap);
  const layouts = layoutsByTab(snap);

  const agentByPane = new Map();
  for (const a of snap.agents || []) if (a && a.pane_id) agentByPane.set(a.pane_id, a);

  const tabsByWs = new Map();
  for (const t of snap.tabs || []) {
    if (!tabsByWs.has(t.workspace_id)) tabsByWs.set(t.workspace_id, []);
    tabsByWs.get(t.workspace_id).push(t);
  }
  const panesByTab = new Map();
  for (const p of snap.panes || []) {
    if (!panesByTab.has(p.tab_id)) panesByTab.set(p.tab_id, []);
    panesByTab.get(p.tab_id).push(p);
  }

  const workspaces = (snap.workspaces || [])
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .map((ws) => {
      const tabs = (tabsByWs.get(ws.workspace_id) || [])
        .slice()
        .sort((a, b) => (a.number || 0) - (b.number || 0))
        .map((tab) => {
          const panes = sortPanes(panesByTab.get(tab.tab_id) || [], rects).map((p, i) => {
            const described = describePane(p, cfg, agentByPane);
            described.index = i;
            described.rect = (rects.get(p.pane_id) || {}).rect || null;
            return described;
          });
          const layout = layouts.get(tab.tab_id);
          return {
            tab_id: tab.tab_id,
            number: tab.number,
            label: tab.label || null,
            zoomed: !!(layout && layout.zoomed),
            panes,
          };
        });

      const firstCwd = tabs[0] && tabs[0].panes[0] && tabs[0].panes[0].cwd;
      return {
        workspace_id: ws.workspace_id,
        number: ws.number,
        label: ws.label || null,
        cwd: firstCwd || null,
        active_tab_id: ws.active_tab_id || null,
        tabs,
      };
    });

  return {
    version: VERSION,
    tool: TOOL,
    saved_at: new Date().toISOString(),
    herdr: {
      version: snap.version || null,
      protocol: snap.protocol || null,
    },
    focused: {
      workspace_id: snap.focused_workspace_id || null,
      tab_id: snap.focused_tab_id || null,
      pane_id: snap.focused_pane_id || null,
    },
    workspaces,
  };
}

function stamp(iso) {
  // 2026-07-06T18:04:11.123Z -> 20260706-180411
  return iso.replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function prune(keep) {
  let files;
  try {
    files = fs.readdirSync(SNAP_DIR).filter((f) => /^snapshot-\d{8}-\d{6}\.json$/.test(f)).sort();
  } catch {
    return 0;
  }
  let removed = 0;
  while (files.length > keep) {
    try {
      fs.unlinkSync(path.join(SNAP_DIR, files.shift()));
      removed++;
    } catch {
      break;
    }
  }
  return removed;
}

function summarize(model) {
  let panes = 0, apps = 0, editors = 0, agents = 0;
  for (const ws of model.workspaces)
    for (const tab of ws.tabs)
      for (const p of tab.panes) {
        panes++;
        if (p.kind === 'agent') agents++;
        else if (p.kind === 'editor') editors++;
        else if (p.kind === 'app') apps++;
      }
  return { workspaces: model.workspaces.length, panes, apps, editors, agents };
}

// Build and persist a snapshot. Returns { file, model, summary }.
function save() {
  ensureDirs();
  const cfg = settings.load();
  const model = build();
  const text = JSON.stringify(model, null, 2) + '\n';
  const file = path.join(SNAP_DIR, `snapshot-${stamp(model.saved_at)}.json`);

  writeAtomic(file, text);
  writeAtomic(LAST, text);
  const pruned = prune(cfg.keepSnapshots);

  return { file, model, summary: summarize(model), pruned };
}

function loadLast() {
  if (!fs.existsSync(LAST)) return null;
  return JSON.parse(fs.readFileSync(LAST, 'utf8'));
}

function loadFile(file) {
  const model = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!model || model.tool !== TOOL || !Array.isArray(model.workspaces))
    throw new Error(`${file} is not a ${TOOL} snapshot`);
  return model;
}

function list() {
  try {
    return fs
      .readdirSync(SNAP_DIR)
      .filter((f) => /^snapshot-\d{8}-\d{6}\.json$/.test(f))
      .sort()
      .map((f) => {
        const full = path.join(SNAP_DIR, f);
        let summary = null;
        try {
          summary = summarize(JSON.parse(fs.readFileSync(full, 'utf8')));
        } catch {
          /* skip unreadable file details */
        }
        return { file: full, name: f, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs, summary };
      });
  } catch {
    return [];
  }
}

module.exports = { build, save, loadLast, loadFile, list, summarize, VERSION, TOOL, SNAP_DIR, LAST };
