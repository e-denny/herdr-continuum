'use strict';
// Tiny logger. Plugin command stdout/stderr already lands in `herdr plugin log`;
// the daemon has no such parent, so it also appends to its own log file.
const fs = require('fs');
const { DAEMON_LOG } = require('./paths');

const MAX_BYTES = 1024 * 1024;

function rotate() {
  try {
    const st = fs.statSync(DAEMON_LOG);
    if (st.size > MAX_BYTES) fs.renameSync(DAEMON_LOG, `${DAEMON_LOG}.1`);
  } catch {
    /* no log file yet */
  }
}

function line(level, msg) {
  const text = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    rotate();
    fs.appendFileSync(DAEMON_LOG, text);
  } catch {
    /* logging is best-effort */
  }
  return text.trimEnd();
}

module.exports = {
  info: (m) => line('info', m),
  warn: (m) => line('warn', m),
  error: (m) => line('error', m),
  log: line,
  file: DAEMON_LOG,
};
