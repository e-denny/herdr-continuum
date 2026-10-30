# herdr-continuum

**tmux-resurrect + tmux-continuum for [herdr](https://herdr.dev).**

Every five minutes a detached daemon records what is actually running in every
herdr pane: the workspace/tab/pane layout, each pane's working directory, and the
program occupying it. When herdr's server stops and starts again — a reboot, a
crash, `herdr server stop` — herdr brings the layout back as bare shells, and this
plugin puts the programs back: **nvim restored from its session file**, dev
servers, watchers, TUIs, pagers, REPLs and other allowlisted CLIs.

```
snapshot every 5 min                 herdr restart
┌───────────────────────┐            ┌───────────────────────────────┐
│ workspace #2 llm-wiki │            │ workspace #2 llm-wiki         │
│  tab 1                │            │  tab 1                        │
│   pane 0: nvim        │  ────────► │   pane 0: nvim -S Session.vim │
│   pane 1: npm run dev │            │   pane 1: npm run dev         │
│   pane 2: htop        │            │   pane 2: htop                │
└───────────────────────┘            └───────────────────────────────┘
```

## What herdr already does

herdr's own snapshot restore already brings back the **shape**: workspaces,
tabs, panes, cwd, layout and focus. With `[session] resume_agents_on_restore`
it also resumes supported agents (pi, claude, codex, …) into their native
conversation sessions.

What it does **not** do is re-run the programs that were in the panes. That is
this plugin's job. It does not touch agent panes by default, so an agent is never
launched twice.

## How it works

1. **Snapshot daemon** — the startup hook launches a detached `node` process that
   writes a snapshot every `intervalMinutes` (default **5**). It is not a herdr
   pane, so it never appears in the layout. It exits by itself when the server
   stops or when a new server boot takes over.
2. **Event snapshots** — herdr event hooks (`pane.created`, `pane.closed`,
   `pane.exited`, `tab.*`, `workspace.*`, `pane.agent_detected`) take an extra
   snapshot, debounced to at most one per `debounceSeconds` (default 20). They
   also restart the daemon if it is ever missing.
3. **Boot auto-restore** — the startup hook runs after herdr has restored the
   layout, waits `autoRestoreSettleMs`, then fills every **idle shell** whose
   snapshot says something was running there. Panes that are already busy are
   skipped, so restore is idempotent and never types into a running program.
4. **First-event guard** — the first event of a new server boot is ignored, and a
   `restoring` marker is held while auto-restore runs, so a half-restored session
   can never overwrite the pre-crash snapshot.

Snapshots are versioned files plus a `last.json` pointer, so older restore points
are always available. The newest `keepSnapshots` (default 48, i.e. four hours at
5-minute intervals) are retained per session.

## nvim restore

Editors are handled specially. At snapshot time the plugin records the editor's
working directory and finds its session file, in this order:

1. an explicit `-S <file>` (or `--session <file>`) in the running editor's argv
2. `<cwd>/Session.vim`, then `<cwd>/Session.nvim` — vim-obsession's default
3. Neovim's state session directory using persistence.nvim's naming
   (`$XDG_STATE_HOME/nvim/sessions/%home%user%project.vim`)

Restore then runs:

```sh
nvim -S /abs/path/to/Session.vim
```

If no session file exists, the captured invocation is replayed instead (for
example `nvim notes.md`). Set `restoreNvim: false` to disable the special case.

vim-obsession keeps `Session.vim` in the cwd up to date and writes it on exit, so
this normally restores the exact buffers, splits and cursor position.

## Install

Requires **Node.js 18+** and **herdr 0.9+**.

```sh
# from GitHub:
herdr plugin install e-denny/herdr-continuum

# or from a local checkout (while iterating):
herdr plugin link ~/Projects/herdr-continuum --enabled

herdr plugin list
herdr plugin action list --plugin edgar.herdr-continuum
```

Then reload the config if you changed keybindings:

```sh
herdr server reload-config
```

The plugin's startup hook runs on the next herdr server start. To start the
autosave daemon without restarting herdr:

```sh
herdr plugin action invoke edgar.herdr-continuum.daemon-start
```

## Actions

| Action id | Does |
| --- | --- |
| `edgar.herdr-continuum.save` | write a snapshot now |
| `edgar.herdr-continuum.restore` | restore the newest snapshot (`auto` mode) |
| `edgar.herdr-continuum.restore-preview` | print the restore plan, change nothing |
| `edgar.herdr-continuum.list` | list snapshots for this session |
| `edgar.herdr-continuum.status` | daemon state, last snapshot, what was captured |
| `edgar.herdr-continuum.daemon-start` | start the 5-minute daemon |
| `edgar.herdr-continuum.daemon-stop` | stop the 5-minute daemon |

Suggested keybindings in `config.toml`:

```toml
[[keys.command]]
key = "prefix+ctrl+s"
type = "plugin_action"
command = "edgar.herdr-continuum.save"
description = "continuum: save snapshot"

[[keys.command]]
key = "prefix+ctrl+r"
type = "plugin_action"
command = "edgar.herdr-continuum.restore"
description = "continuum: restore snapshot"

# Save, then stop herdr cleanly (restores on the next boot).
# Run the script directly, not via `plugin action invoke`: the action is
# asynchronous, and the server could stop before the snapshot is written.
[[keys.command]]
key = "prefix+q"
type = "shell"
command = "node /home/edgar/Projects/herdr-continuum/bin/save.js; herdr server stop"
description = "snapshot with herdr-continuum, then exit herdr"
```

From a terminal:

```sh
herdr plugin action invoke edgar.herdr-continuum.save
herdr plugin action invoke edgar.herdr-continuum.restore-preview
```

## Restore modes

| Mode | Flag | Behaviour |
| --- | --- | --- |
| `auto` | `--auto` (default for the action) | fill idle panes and recreate missing workspaces/tabs/panes |
| `rehydrate` | `--rehydrate` (default for boot auto-restore) | only fill panes that already exist |
| dry run | `--dry-run` | print the plan, touch nothing |
| specific file | `--file <snapshot.json>` | restore an older snapshot |

Boot auto-restore uses `rehydrate` so a stale snapshot cannot recreate a
workspace you closed on purpose. If herdr's own `session.json` is lost, run the
manual restore action: `auto` mode rebuilds the missing workspaces.

Restore is idempotent: a pane that is already running something is skipped, so
running it twice does nothing the second time.

## Configuration

Settings live at
`~/.config/herdr/plugins/config/edgar.herdr-continuum/settings.json`
(created with defaults on first run):

| Key | Default | Meaning |
| --- | --- | --- |
| `intervalMinutes` | `5` | daemon snapshot interval |
| `autoRestore` | `true` | rehydrate automatically on server start |
| `autoRestoreSettleMs` | `3000` | wait after startup before rehydrating |
| `autoRestoreMode` | `"rehydrate"` | `"rehydrate"` or `"auto"` for boot restores |
| `restoreNvim` | `true` | restore nvim/vim with `-S <session file>` |
| `nvimSessionNames` | `["Session.vim","Session.nvim"]` | session file names to look for in the editor cwd |
| `nvimPersistenceDir` | `""` | override persistence.nvim's session dir |
| `restoreAgents` | `false` | relaunch agents too (only if herdr's own resume is disabled) |
| `debounceSeconds` | `20` | minimum seconds between event-driven snapshots |
| `keepSnapshots` | `48` | snapshots retained per session |
| `restoreFocus` | `false` | focus the workspace that was focused at snapshot time |
| `extraPrograms` | `[]` | extra allowlist entries, e.g. `["deno","bun"]` |

Environment overrides: `HERDR_CONTINUUM_INTERVAL_MINUTES`,
`HERDR_CONTINUUM_AUTO_RESTORE`, `HERDR_CONTINUUM_RESTORE_AGENTS`,
`HERDR_CONTINUUM_DEBOUNCE_SECONDS`, `HERDR_CONTINUUM_KEEP`.

### Allowlist

Only programs listed in
`~/.config/herdr/plugins/config/edgar.herdr-continuum/allowlist.txt` are
relaunched. The file is seeded from `config/allowlist.default.txt` on first
snapshot. One program name per line; `#` comments; a lone `*` means "relaunch
everything". Matching ignores paths, case and a trailing `.exe`.

ssh/mosh are deliberately not in the default list — reconnecting remote sessions
unattended is rarely what you want. Add them if it is.

Agents are not listed: herdr resumes them natively.

## State

```
~/.local/state/herdr/plugins/edgar.herdr-continuum/
  sessions/<session>/
    snapshots/snapshot-YYYYMMDD-HHMMSS.json
    last.json          # newest snapshot
    daemon.pid
    daemon.log
    boot.json          # which server boot owns the daemon
    debounce.json
```

Named herdr sessions (`herdr --session work`) get their own `sessions/<name>/`
directory, derived from the socket path, so restoring one session never touches
another.

## Troubleshooting

```sh
herdr plugin log list --plugin edgar.herdr-continuum   # action/event/startup output
herdr plugin action invoke edgar.herdr-continuum.status
tail -f ~/.local/state/herdr/plugins/edgar.herdr-continuum/sessions/default/daemon.log
```

- **Nothing restored after a restart** — check `status`: is there a last snapshot?
  Was it taken before the restart? Run `restore-preview` to see the plan.
- **A program was not relaunched** — it is not on the allowlist, or the pane was
  already busy. Add the program name to `allowlist.txt`.
- **nvim came back without its buffers** — no `Session.vim` existed in the
  editor's cwd (or persistence.nvim had no session). Check `status`, which lists
  the captured session file per editor pane.
- **Auto-restore is too early** — raise `autoRestoreSettleMs`.

## Limitations

- The command is restored, not the process: a dev server's in-memory state,
  unsaved scratch buffers in non-obsession editors, and shell pipelines only
  partially survive. `tail -f x | grep y` comes back as its foreground leader.
- Programs whose captured cmdline contains shell metacharacters are re-run as
  captured; they may need a manual fix in unusual quoting cases.
- Layout geometry for recreated panes is inferred from the saved pane rectangles;
  simple rows/columns come back faithfully, deeply nested grids are approximated.
  This only matters when `auto` mode has to recreate panes — herdr's own restore
  handles the normal reboot case.
- Agent panes are left to herdr. If you disable
  `[session] resume_agents_on_restore`, set `restoreAgents: true` to have this
  plugin relaunch them from the captured session ref.

## Layout

```
herdr-plugin.toml        manifest: startup hook, actions, events
bin/startup.js           boot: wait, rehydrate, start the daemon
bin/daemon.js            detached 5-minute snapshot loop
bin/event.js             debounced snapshot on layout changes
bin/save.js              snapshot now
bin/restore.js           restore / preview
bin/list.js              list snapshots
bin/status.js            daemon + last snapshot report
bin/daemon-start.js      start the daemon
bin/daemon-stop.js       stop the daemon
lib/herdr.js             herdr CLI wrapper (JSON, retries)
lib/snapshot.js          snapshot model + persistence
lib/restore.js           planner + executor
lib/sessions.js          nvim session file discovery
lib/procs.js             "what is running in this pane?"
lib/allowlist.js         relaunch allowlist
lib/boot.js              per-server-boot guard
lib/daemonctl.js         detached daemon control
lib/settings.js          settings.json
lib/paths.js             state/config locations
config/allowlist.default.txt
```

## License

MIT. This is a standalone process that talks to herdr over its CLI/socket API.
