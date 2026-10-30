'use strict';
// Restore a snapshot into the live session.
//
// herdr recreates the layout after a restart (workspaces, tabs, panes, cwd), but
// panes come back as bare shells. This module fills those idle shells with what
// was running there: nvim restored from its session file, dev servers, TUIs,
// pagers, and other allowlisted programs.
//
// Two modes:
//   rehydrate  only fill panes that already exist (safe automatic boot restore)
//   auto       fill existing panes and recreate any missing workspaces/tabs/panes
//
// Restore is idempotent: a pane that is already running something is never
// typed into.
const fs = require('fs');
const path = require('path');
const herdr = require('./herdr');
const procs = require('./procs');
const allowlist = require('./allowlist');
const sessions = require('./sessions');
const settings = require('./settings');
const snapshot = require('./snapshot');

const AGENT_RESUME = {
  pi: '--session {value}',
  omp: '--resume={value}',
  claude: '--resume {value}',
  codex: 'resume {value}',
  gemini: '--resume {value}',
  copilot: '--resume={value}',
  cursor: '--resume={value}',
  devin: '--resume {value}',
  droid: '--resume {value}',
  opencode: '--session {value}',
  kilo: '--session {value}',
  kimi: '--session {value}',
  qwen: '--resume {value}',
  grok: '--resume {value}',
  agy: '--conversation {value}',
  hermes: '--resume {value}',
  mastracode: '--thread {value}',
  letta: '--conversation {value}',
};
const AGENT_BIN = { cursor: 'cursor-agent', agy: 'agy' };

const posixQuote = (s) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);

function argvToCommand(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  // argv[0] is the program; use its short name so it resolves on PATH.
  const prog = path.basename(String(argv[0]));
  return [prog, ...argv.slice(1).map(posixQuote)].join(' ');
}

function agentCommand(agent) {
  if (!agent || !agent.name) return null;
  const name = String(agent.name).toLowerCase();
  const bin = AGENT_BIN[name] || name;
  const ref = agent.session && agent.session.value;
  const template = AGENT_RESUME[name];
  if (ref != null && template) return `${bin} ${template.replace('{value}', posixQuote(ref))}`;
  return null;
}

// The shell command to relaunch for one snapshot pane, or null to leave the
// pane as a shell.
function commandFor(pane, cfg) {
  if (pane.kind === 'agent') {
    return cfg.restoreAgents ? agentCommand(pane.agent) : null; // herdr resumes agents itself
  }

  if (pane.kind === 'editor' && pane.editor) {
    if (cfg.restoreNvim) {
      const file = pane.editor.session_file;
      if (file && fs.existsSync(file)) return sessions.sessionCommand(pane.editor.name, file);
    }
    // No session file: replay the invocation without the dead -S argument.
    if (pane.app && allowlist.restorable(pane.app.name)) {
      const argv = sessions.stripSessionArgs(pane.editor.argv || (pane.app && pane.app.argv));
      return (argv.length ? argvToCommand(argv) : null) || pane.app.cmdline;
    }
    return null;
  }

  if (pane.kind === 'app' && pane.app) {
    if (!allowlist.restorable(pane.app.name)) return null;
    return pane.app.cmdline || argvToCommand(pane.app.argv);
  }

  return null;
}

// ---- live-session indexing -------------------------------------------------
function liveIndex(live) {
  const rects = new Map();
  for (const layout of live.layouts || []) {
    for (const lp of layout.panes || []) rects.set(lp.pane_id, lp.rect);
  }

  const panesByTab = new Map();
  for (const p of live.panes || []) {
    if (!panesByTab.has(p.tab_id)) panesByTab.set(p.tab_id, []);
    panesByTab.get(p.tab_id).push(p);
  }
  const orderIn = (tabId) =>
    (panesByTab.get(tabId) || [])
      .slice()
      .sort((a, b) => {
        const ra = rects.get(a.pane_id) || {};
        const rb = rects.get(b.pane_id) || {};
        return (ra.y || 0) - (rb.y || 0) || (ra.x || 0) - (rb.x || 0) ||
          String(a.pane_id).localeCompare(String(b.pane_id));
      });

  const tabsByWs = new Map();
  for (const t of live.tabs || []) {
    if (!tabsByWs.has(t.workspace_id)) tabsByWs.set(t.workspace_id, []);
    tabsByWs.get(t.workspace_id).push(t);
  }
  const wsByNumber = new Map();
  const wsByLabel = new Map();
  for (const w of live.workspaces || []) {
    wsByNumber.set(w.number, w);
    if (w.label != null) wsByLabel.set(w.label, w);
  }

  return { live, rects, tabsByWs, wsByNumber, wsByLabel, orderIn };
}

function findWorkspace(idx, ws) {
  return idx.wsByNumber.get(ws.number) || (ws.label != null ? idx.wsByLabel.get(ws.label) : null) || null;
}

function findTab(idx, workspaceId, tab, fallbackIndex) {
  const tabs = (idx.tabsByWs.get(workspaceId) || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
  return tabs.find((t) => t.number === tab.number) || tabs[fallbackIndex] || null;
}

// ---- pane creation ---------------------------------------------------------
const clampRatio = (r) => Math.max(0.08, Math.min(0.92, r || 0.5));

function splitGeometry(prev, cur) {
  if (!prev || !cur) return { direction: 'right', ratio: 0.5 };
  const sameRow = Math.abs((cur.y || 0) - (prev.y || 0)) <= 1;
  const sameCol = Math.abs((cur.x || 0) - (prev.x || 0)) <= 1;
  if (sameRow && (cur.x || 0) > (prev.x || 0)) {
    return { direction: 'right', ratio: clampRatio((cur.width || 1) / ((prev.width || 1) + (cur.width || 1))) };
  }
  if (sameCol && (cur.y || 0) > (prev.y || 0)) {
    return { direction: 'down', ratio: clampRatio((cur.height || 1) / ((prev.height || 1) + (cur.height || 1))) };
  }
  const dx = Math.abs((cur.x || 0) - (prev.x || 0));
  const dy = Math.abs((cur.y || 0) - (prev.y || 0));
  return dx >= dy ? { direction: 'right', ratio: 0.5 } : { direction: 'down', ratio: 0.5 };
}

// Grow a tab until it has as many panes as the snapshot. Returns live pane ids
// in the same geometric order as the snapshot's panes.
function ensurePaneCount(paneIds, savedPanes, tabCwd, o, act) {
  const ids = paneIds.slice();
  while (ids.length < savedPanes.length) {
    const i = ids.length;
    const geom = splitGeometry(savedPanes[i - 1] && savedPanes[i - 1].rect, savedPanes[i] && savedPanes[i].rect);
    const cwd = (savedPanes[i] && savedPanes[i].cwd) || tabCwd;
    act('split', `${ids[i - 1]} ${geom.direction} ratio=${geom.ratio.toFixed(2)} cwd=${cwd || '-'}`);
    if (o.dryRun) {
      ids.push(`<new:${i}>`);
      continue;
    }
    const created = herdr.splitPane(ids[i - 1], { ...geom, cwd });
    if (!created || !created.pane_id) break;
    ids.push(created.pane_id);
  }
  return ids;
}

// ---- execution -------------------------------------------------------------
function fillPanes(liveIds, savedPanes, o, act) {
  savedPanes.forEach((pane, i) => {
    const paneId = liveIds[i];
    if (!paneId) return;
    const cmd = commandFor(pane, o.cfg);
    if (!cmd) {
      if (pane.kind === 'app-unlisted' && pane.app)
        act('skip', `${paneId} (${pane.app.name} is not on the allowlist)`);
      return;
    }

    const what = pane.kind === 'editor' ? `nvim:${path.basename(pane.editor.session_file || '')}` : `${pane.kind}:${(pane.app && pane.app.name) || '?'}`;
    if (!o.dryRun) {
      const pref = herdr.processInfo(paneId);
      if (!pref || !procs.idle(pref)) {
        act('skip', `${paneId} is busy`);
        return;
      }
    }
    act('run', `${paneId} <- ${what}  (${cmd})`);
    if (!o.dryRun) herdr.runInPane(paneId, cmd);
  });
}

function restoreWorkspace(ws, liveWs, o, act) {
  ws.tabs.forEach((tab, ti) => {
    const liveTab = findTab(o.idx, liveWs.workspace_id, tab, ti);

    if (!liveTab) {
      if (o.mode === 'rehydrate') {
        act('skip', `workspace "${ws.label}" tab ${tab.number}: no live tab (rehydrate mode)`);
        return;
      }
      act('tab.create', `workspace "${ws.label}" tab "${tab.label || tab.number}"`);
      if (o.dryRun) {
        fillPanes(tab.panes.map((_, i) => `<new-tab-pane:${i}>`), tab.panes, o, act);
        return;
      }
      const created = herdr.createTab({ workspaceId: liveWs.workspace_id, cwd: tab.panes[0]?.cwd || ws.cwd, label: tab.label || undefined });
      const rootId = created && created.root_pane && created.root_pane.pane_id;
      if (!rootId) {
        act('skip', `tab "${tab.label}" could not be created`);
        return;
      }
      const ids = ensurePaneCount([rootId], tab.panes, ws.cwd, o, act);
      fillPanes(ids, tab.panes, o, act);
      return;
    }

    const livePanes = o.idx.orderIn(liveTab.tab_id);
    let ids = livePanes.map((p) => p.pane_id);

    if (ids.length < tab.panes.length) {
      if (o.mode === 'rehydrate') {
        act('skip', `tab "${tab.label}": has ${ids.length}/${tab.panes.length} panes (rehydrate mode)`);
      } else {
        ids = ensurePaneCount(ids, tab.panes, tab.panes[0]?.cwd || ws.cwd, o, act);
      }
    }
    fillPanes(ids, tab.panes, o, act);
  });
}

function recreateWorkspace(ws, o, act) {
  act('workspace.create', `#${ws.number} "${ws.label || ''}" cwd=${ws.cwd || '-'}`);
  if (o.dryRun) {
    ws.tabs.forEach((tab, ti) => {
      fillPanes(tab.panes.map((_, i) => `<new-ws${ws.number}-tab${ti}-pane${i}>`), tab.panes, o, act);
    });
    return;
  }
  const created = herdr.createWorkspace({ cwd: ws.cwd, label: ws.label || undefined });
  const workspaceId = created.workspace && created.workspace.workspace_id;
  const rootId = created.root_pane && created.root_pane.pane_id;
  if (!workspaceId || !rootId) {
    act('skip', `workspace #${ws.number} could not be created`);
    return;
  }

  ws.tabs.forEach((tab, ti) => {
    let root = rootId;
    if (ti > 0) {
      act('tab.create', `workspace #${ws.number} tab "${tab.label || tab.number}"`);
      const t = herdr.createTab({ workspaceId, cwd: tab.panes[0]?.cwd || ws.cwd, label: tab.label || undefined });
      root = t && t.root_pane && t.root_pane.pane_id;
      if (!root) {
        act('skip', `tab "${tab.label}" could not be created`);
        return;
      }
    }
    const ids = ensurePaneCount([root], tab.panes, tab.panes[0]?.cwd || ws.cwd, o, act);
    fillPanes(ids, tab.panes, o, act);
  });
}

function restore(model, opts = {}) {
  const cfg = settings.load();
  const o = {
    cfg,
    mode: opts.mode === 'rehydrate' ? 'rehydrate' : 'auto',
    dryRun: !!opts.dryRun,
    actions: [],
  };
  const act = (action, detail) => {
    o.actions.push({ action, detail });
    if (opts.log) opts.log(`${action.padEnd(16)} ${detail}`);
  };

  const live = herdr.snapshot();
  o.idx = liveIndex(live);

  for (const ws of model.workspaces) {
    const liveWs = findWorkspace(o.idx, ws);
    if (liveWs) restoreWorkspace(ws, liveWs, o, act);
    else if (o.mode === 'rehydrate') act('skip', `workspace #${ws.number} "${ws.label || ''}" is not in this session (rehydrate mode)`);
    else recreateWorkspace(ws, o, act);
  }

  if (cfg.restoreFocus && !o.dryRun && model.focused && model.focused.workspace_id) {
    const ws = model.workspaces.find((w) => w.workspace_id === model.focused.workspace_id);
    const liveWs = ws && findWorkspace(o.idx, ws);
    if (liveWs) {
      try {
        herdr.focusWorkspace(liveWs.workspace_id);
      } catch {
        /* focus is cosmetic */
      }
    }
  }

  return { actions: o.actions, mode: o.mode, dryRun: o.dryRun };
}

function loadModel(file) {
  if (file) return snapshot.loadFile(file);
  const model = snapshot.loadLast();
  if (!model) throw new Error('no snapshot yet — run the "save" action first');
  return model;
}

module.exports = { restore, loadModel, commandFor, agentCommand, argvToCommand };
