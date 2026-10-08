# cpd-tui

A terminal dashboard for the pi coding agent.

`cpd` opens a tmux layout: a session switcher, pi in the center, and a spare slot.
Switching sessions swaps a live pi pane in place; the layout persists across detach.

Standalone: reads pi session files on disk. No daemon, no network.

## Install

```bash
ln -s "$PWD/bin/cpd" ~/.local/bin/cpd
ln -s "$PWD/bin/cpd-down" ~/.local/bin/cpd-down
```

(Make sure `~/.local/bin` is on your `PATH`.)

## Run

```bash
cpd
```

First run creates a tmux dashboard: a `dash` window with three panes (switcher ~22%,
pi ~48%, an empty reserved slot ~30%), and a hidden `parked` window that will hold other
live pi sessions (built in T4). Running `cpd` again just attaches to the same session —
it never recreates panes or touches your own resizing.

Closing the terminal only detaches; the tmux server (and every pane's process) keeps
running until a reboot or an explicit teardown.

## Tear down

```bash
cpd-down
```

Kills the entire `cpd` tmux server, which kills every pi session running inside it.
Prompts for confirmation unless you pass `-f`.

## How it works

- `cpd` runs on its own tmux server, socket name `cpd` (`tmux -L cpd`), so it never
  touches your default tmux server, prefix, or config.
- `-L` alone does **not** isolate config — a custom-socket server still reads
  `~/.tmux.conf` unless you also pass `-f`. `bin/cpd` always passes `-f cpd.conf` on the
  command that creates the server.
- Panes are identified by a `@cpd_kind` tag (`switcher`/`center`/`slot`) set right after
  creation, never by pane index — indexes are not stable across swaps and layout changes;
  pane ids (`%N`) are.
- The `parked-<session-id-prefix>` windows (created on demand, one per
  dormant/new session brought live) are where other live pi sessions keep
  running in the background while only one is shown in the center pane. Each
  session gets its own window — never stacked as split panes in one shared
  window — so there is no ceiling on how many can be live at once.
- On detach, the current `dash` layout is saved to `~/.cpd/layout` and re-applied the next
  time `cpd` cold-starts (i.e. after a reboot killed the server), so your pane sizes
  survive a reboot too, not just a closed terminal.

### Mouse mode and native text selection

`cpd.conf` sets `mouse on` (click-to-focus panes, drag-to-resize borders, and
click/scroll in the switcher — see "Switcher keys" below). This means a
plain click-drag no longer does your terminal's native text selection — on
macOS hold `Option` while dragging (iTerm2/Terminal.app) to select/copy text
as usual.

### Switcher keys and mouse

Inside the switcher pane (left column):

- `j`/`k` or `↓`/`↑` — move selection
- `Enter` — focus the selected session into the center pane (swaps a live
  session in place, or spawns a dormant one into its own parked window first)
- click a row — select it; click the already-selected row again (or
  double-click) — open it, same as `Enter`
- scroll wheel — scrolls the list when it's longer than the pane
- `n` — create a brand-new pi session. Prompts for a starting directory
  (`↑`/`↓` to choose, `Enter` to confirm, `Esc` to cancel) between the
  currently-selected row's cwd, the repo root, and `$HOME`.
- `d` — delete the selected session, after a `y`/`n` confirmation. Refuses
  with `close it first` if the session is currently live (in a pane) —
  close/swap it out first. Deleted sessions are moved to `~/.cpd/trash/`,
  not permanently unlinked, so a misfire is recoverable.
- `r` — force a manual refresh (liveness also re-polls automatically every
  ~2.5s and after every focus/create/delete, so this is rarely needed)
- `q` / `Ctrl-C` — quit the switcher (does not tear down the dashboard)

From **anywhere** in the `cpd` session (no tmux prefix needed), jump straight
to a dash pane:

- `M-1` — switcher, `M-2` — center (pi), `M-3` — slot

These use Option/Alt as a tmux Meta key. On macOS, if your terminal sends
Option as a literal accented character instead of Meta, enable "Option key
sends Esc+" in iTerm2/Terminal.app → Profiles → Keys for these to register.

### Reboot persistence: what's in scope here and what isn't

This card only persists the **layout** (pane sizes/shape) across a reboot, via the
`~/.cpd/layout` hook above. A later, optional step would be `tmux-resurrect` /
`tmux-continuum`, which can additionally restore window/pane *shape and cwd* across a
reboot without any of this project's code. Important caveat if you add them: they
restore a freshly *re-executed* command in each pane — never a live pi process's actual
in-memory conversation state. Resuming an actual pi session after a reboot is a separate
concern (T5), not something tmux-resurrect can do on its own.
