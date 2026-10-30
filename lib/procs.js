'use strict';
// Turns herdr's `pane process-info` into "what program is really in this pane?".
//
// process-info reports the PTY foreground process group, which on Linux and
// macOS is exactly what we want: the program occupying the pane, not the shell.
const { isShellName, baseName } = require('./allowlist');

// Never mistake the plugin's own helpers for the pane's program (only possible
// when a snapshot is run by hand inside a pane).
const SELF_RE = /herdr-continuum|bin[\\/](save|restore|list|startup|event|daemon)\.js/i;

function isSelf(p) {
  if (!p) return false;
  if (p.pid === process.pid) return true;
  return !!(p.cmdline && SELF_RE.test(p.cmdline));
}

function nameOf(p) {
  if (!p) return '';
  return baseName(p.name || (p.argv && p.argv[0]) || (p.cmdline || '').split(/\s+/)[0]);
}

function isShellProcess(p) {
  return isShellName(nameOf(p));
}

// The primary user-launched program in a pane, or null when it is an idle shell.
// pref = { shell_pid, foreground_process_group_id, foreground_processes }
function foreground(pref) {
  if (!pref || !Array.isArray(pref.foreground_processes)) return null;

  const candidates = pref.foreground_processes.filter(
    (p) => p && p.pid !== pref.shell_pid && !isSelf(p),
  );
  if (!candidates.length) return null;

  // A nested shell (`zsh -l`, `bash` …) is still an idle pane.
  const real = candidates.filter((p) => !isShellProcess(p));
  if (!real.length) return null;

  // Prefer the foreground process-group leader (the program the user started),
  // else the first entry, which herdr reports in start order.
  const leader = real.find((p) => p.pid === pref.foreground_process_group_id);
  const p = leader || real[0];

  return {
    pid: p.pid,
    name: nameOf(p),
    argv: Array.isArray(p.argv) ? p.argv.slice() : null,
    cmdline: p.cmdline || (Array.isArray(p.argv) ? p.argv.join(' ') : null),
    cwd: p.cwd || null,
    isShell: false,
  };
}

// True when the pane is sitting at an idle shell prompt (safe to type into).
// Unknown process data is treated as busy so restore never types into a program
// it cannot see.
function idle(pref) {
  if (!pref) return false;
  if (!Array.isArray(pref.foreground_processes)) return false;
  return foreground(pref) === null;
}

module.exports = { foreground, idle, isShellProcess, nameOf, isSelf };
