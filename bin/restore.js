'use strict';
// Restore a snapshot.
//
//   node bin/restore.js                 # auto: fill idle panes, recreate missing layout
//   node bin/restore.js --rehydrate     # only fill panes that already exist
//   node bin/restore.js --dry-run       # print the plan, change nothing
//   node bin/restore.js --file <path>   # restore a specific snapshot
const restore = require('../lib/restore');

function parse(argv) {
  const opts = { mode: 'auto', dryRun: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--rehydrate') opts.mode = 'rehydrate';
    else if (a === '--auto') opts.mode = 'auto';
    else if (a === '--file') opts.file = argv[++i] || null;
    else if (a.startsWith('--file=')) opts.file = a.slice('--file='.length);
    else if (a === '--help' || a === '-h') {
      console.log('usage: restore [--dry-run] [--rehydrate|--auto] [--file <snapshot.json>]');
      process.exit(0);
    } else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parse(process.argv.slice(2));

try {
  const model = restore.loadModel(opts.file);
  console.log(`herdr-continuum: snapshot ${model.saved_at} (${opts.mode}${opts.dryRun ? ', dry run' : ''})`);
  const res = restore.restore(model, {
    mode: opts.mode,
    dryRun: opts.dryRun,
    log: (line) => console.log(`  ${line}`),
  });
  const ran = res.actions.filter((a) => a.action === 'run').length;
  const skipped = res.actions.filter((a) => a.action === 'skip').length;
  console.log(`herdr-continuum: ${ran} pane(s) relaunched, ${skipped} skipped${opts.dryRun ? ' (dry run: nothing changed)' : ''}`);
} catch (e) {
  console.error(`herdr-continuum: restore failed: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
