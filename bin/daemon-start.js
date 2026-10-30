'use strict';
// Start the detached autosave daemon (action).
const daemonctl = require('../lib/daemonctl');

const res = daemonctl.start();
console.log(res.started ? `autosave daemon started (pid ${res.pid})` : `autosave daemon already running (pid ${res.pid})`);
