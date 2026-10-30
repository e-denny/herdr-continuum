'use strict';
// User-editable settings, seeded once at $HERDR_PLUGIN_CONFIG_DIR/settings.json.
// The file is re-read on every call so editing it takes effect immediately
// (useful while iterating on a restore).
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const FILE = path.join(CONFIG_DIR, 'settings.json');

const DEFAULTS = {
  // tmux-continuum behaviour: how often the background daemon writes a snapshot.
  intervalMinutes: 5,

  // Rehydrate the last snapshot automatically in the startup hook, after herdr
  // has recreated the layout. Manual restores always work when this is false.
  autoRestore: true,

  // How long the startup hook waits after herdr restores the session before it
  // fills idle shells, so panes and shells are fully up.
  autoRestoreSettleMs: 3000,

  // Startup auto-restore only fills panes that exist; it never recreates a
  // workspace you deliberately closed. The manual "restore" action uses
  // "auto" and can recreate missing workspaces/tabs/panes.
  autoRestoreMode: 'rehydrate', // "rehydrate" | "auto"

  // Relaunch nvim/vim with `-S <session file>` when one can be found.
  restoreNvim: true,

  // Session file names looked up in the editor's working directory, in order.
  nvimSessionNames: ['Session.vim', 'Session.nvim'],

  // Also look in Neovim's state session directory (persistence.nvim layout).
  nvimPersistenceDir: '', // empty -> $XDG_STATE_HOME/nvim/sessions

  // herdr already resumes supported agents natively. Leave off to avoid
  // launching two copies of an agent; turn on only if you disable herdr's
  // [session] resume_agents_on_restore.
  restoreAgents: false,

  // Debounce for event-driven snapshots (pane/workspace shape changes).
  debounceSeconds: 20,

  // Snapshots retained per session before the oldest are pruned.
  keepSnapshots: 48,

  // Restore focus to the workspace that was focused at snapshot time.
  restoreFocus: false,

  // Extra allowlist entries, e.g. ["deno", "bun"]. Merged with allowlist.txt.
  extraPrograms: [],
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

function load() {
  let user = {};
  if (fs.existsSync(FILE)) {
    user = readJson(FILE);
  } else {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
    } catch {
      /* read-only config dir: run with defaults */
    }
  }

  const s = { ...DEFAULTS, ...user };
  s.extraPrograms = Array.isArray(user.extraPrograms) ? user.extraPrograms : DEFAULTS.extraPrograms;
  s.nvimSessionNames = Array.isArray(user.nvimSessionNames) && user.nvimSessionNames.length
    ? user.nvimSessionNames
    : DEFAULTS.nvimSessionNames;

  // Environment overrides, handy for scripts and one-off restores.
  const env = process.env;
  if (env.HERDR_CONTINUUM_AUTO_RESTORE != null)
    s.autoRestore = /^(1|true|on|yes)$/i.test(env.HERDR_CONTINUUM_AUTO_RESTORE);
  if (env.HERDR_CONTINUUM_INTERVAL_MINUTES) s.intervalMinutes = num(env.HERDR_CONTINUUM_INTERVAL_MINUTES, s.intervalMinutes);
  if (env.HERDR_CONTINUUM_KEEP) s.keepSnapshots = num(env.HERDR_CONTINUUM_KEEP, s.keepSnapshots);
  if (env.HERDR_CONTINUUM_DEBOUNCE_SECONDS) s.debounceSeconds = num(env.HERDR_CONTINUUM_DEBOUNCE_SECONDS, s.debounceSeconds);
  if (env.HERDR_CONTINUUM_RESTORE_AGENTS != null)
    s.restoreAgents = /^(1|true|on|yes)$/i.test(env.HERDR_CONTINUUM_RESTORE_AGENTS);

  s.intervalMinutes = Math.max(0.1, num(s.intervalMinutes, DEFAULTS.intervalMinutes));
  s.keepSnapshots = Math.max(1, Math.floor(num(s.keepSnapshots, DEFAULTS.keepSnapshots)));
  s.debounceSeconds = Math.max(0, num(s.debounceSeconds, DEFAULTS.debounceSeconds));
  return s;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { load, FILE, DEFAULTS };
