'use strict';
// Stop the detached autosave daemon (action).
const daemonctl = require('../lib/daemonctl');

const res = daemonctl.stop();
console.log(res.stopped ? `autosave daemon stopped (pid ${res.pid})` : 'autosave daemon was not running');
