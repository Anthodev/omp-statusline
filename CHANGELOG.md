# Changelog

## [0.1.0] - 2026-09-25

Initial release of the configurable statusline extension for Oh My Pi.

### Features
- Statusline rows for model, thinking level, working directory (full path or basename), and session name.
- Context-window usage bar with percentage and token counts.
- Provider quota bars for the 5-hour and weekly windows, read from the host's cached usage reports (`modelRegistry.authStorage.usage.reports()` on OMP 18.3+, `fetchUsageReports()` on older versions).
- Current-session and subagent costs, tracked live from assistant message usage events and shown when no matching subscription quota is available.
- Jujutsu-first VCS row: change ID, description, bookmark, divergence, conflict, and line counts; Git fallback with commit, branch, divergence, conflict, staged, unstaged, and untracked counts.
- Live Caveman and Ponytail mode indicators when their plugins are present.
- `/omp-statusline` command opening an interactive settings menu; changes save immediately to `~/.omp/agent/omp-statusline.json`.
- JSON configuration with bounded refresh intervals (`refreshMs`, `vcsRefreshMs`, `usageRefreshMs`), bar widths (`contextBarWidth`, `quotaBarWidth`), progress bar styles (`unicode`/`extended`), display toggles, an optional line gap, and a subscription account selector (`omp-statusline.example.json`).
- Theme-aware colors through the host's `statusLine*` theme keys.
