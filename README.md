# cpd-tui

A terminal dashboard for the pi coding agent.

`cpd` opens a tmux layout: a session switcher, pi in the center, and a spare slot.
Switching sessions swaps a live pi pane in place; the layout persists across detach.

Standalone: reads pi session files on disk. No daemon, no network.
