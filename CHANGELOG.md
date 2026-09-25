# Changelog

## [0.1.0] - 2026-09-25

Initial release of the configurable statusline extension for Pi and Oh My Pi.

### Features
- Shared core rendering model, thinking level, working directory, session name, context-window usage, provider quota bars, and session/subagent costs (`src/core.ts`).
- Separate Pi and OMP adapters backed by the same core (`extensions/pi.ts`, `extensions/omp.ts`).
- Jujutsu-first VCS row with Git fallback: change/bookmark/commit identities, divergence, conflicts, and dirty counts.
- Live Caveman and Ponytail mode indicators when their plugins are present.
- JSON configuration with per-section ordering and styling (`omp-statusline.example.json`).
