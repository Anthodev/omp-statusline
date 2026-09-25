<h1 align="center">OMP Statusline</h1>

<p align="center">
  <strong>Context, quotas, costs, and repository state at a glance, inside Oh My Pi.</strong>
  <br>
  A configurable statusline panel that lives under your editor and keeps what matters one glance away.
</p>

<p align="center">
  <a href="#about">About</a>
  · <a href="#features">Features</a>
  · <a href="#compatibility">Compatibility</a>
  · <a href="#getting-started">Getting started</a>
  · <a href="#commands-and-configuration">Configuration</a>
  · <a href="#privacy">Privacy</a>
  · <a href="#build-from-source">Build from source</a>
  · <a href="#license">MIT License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OMP-17.2%2B-00A5E0" alt="Requires OMP 17.2 or newer">
  <img src="https://img.shields.io/badge/VCS-jujutsu%20%7C%20git-00A5E0" alt="Works with Jujutsu and Git repositories">
</p>

## About

OMP Statusline turns the bottom of your Oh My Pi editor into a compact information panel. One look tells you which model and thinking level you are running, how much of the context window is left, where your provider's 5-hour and weekly quotas stand, what the current session costs, and what state your repository is in — without typing a single command.

Everything is configurable from a built-in settings menu. Open it with `/omp-statusline`, flip a few switches, and your choices are saved immediately; there is no configuration file to create by hand unless you want one.

Illustrative rendering (colors follow your theme):

```text
󰚩 glm-5.3-flash  󰔟 medium   ~/dev/perso/tools/omp-statusline        my-session
ctx ██████░░░░░░░░░░ 38%  61k/160k    5h ███░░░░░░░░░░ 27% 2h    week ██████░░░░ 52%
 qonktknk (-12/+340)  refactor: target Oh My Pi only  󰃀 develop
```

## Features

- **Everything important in one panel.** Model, thinking level, working directory, session name, and live Caveman and Ponytail mode indicators when their plugins are present, all on a single bordered row under your editor.
- **Context you can read.** The context bar shows the percentage and raw token counts of the active window, and shifts from green to warning at 80% and error at 95% so you notice before truncation, not after.
- **Quotas from your subscription.** 5-hour and weekly provider windows render as bars with a reset countdown, read from the usage reports your host already caches — no extra network calls.
- **Costs when you pay per token.** Without a matching subscription report, the panel shows current-session and subagent costs instead, tracked live from assistant message usage.
- **Repository state without leaving the editor.** Jujutsu comes first: change ID, description, bookmark, conflicts, and changed-line counts. In a Git repository you get the commit subject, branch, ahead/behind arrows, conflicts, and staged, unstaged, and untracked counts, with a GitHub, GitLab, or Codeberg icon for the remote.
- **Two-tap configuration.** The `/omp-statusline` menu covers every setting with plain-language labels; changes save as you make them. Prefer editing JSON? The same file stays hand-editable.
- **Quiet and graceful.** Refresh intervals are independent (screen, repository, usage), and rows hide when they have nothing useful to show: no repository, no thinking level, no usage report.

## Compatibility

| Requirement | Details |
| --- | --- |
| Host | OMP 17.2 or newer |
| Repository status | Optional; `jj` preferred, `git` used as fallback |
| Building from source | Node.js 20 or newer, Bun |

Outside a repository, or when `jj` and `git` are missing, the VCS row simply disappears; the rest of the statusline keeps working.

## Getting started

1. Install from GitHub — pin a release tag when you want a fixed version:

   ```sh
   omp plugin install 'github:Anthodev/omp-statusline'                  # latest
   omp plugin install 'github:Anthodev/omp-statusline#v0.1.0'           # pinned release
   omp plugin install 'https://github.com/Anthodev/omp-statusline.git'  # full Git URL
   ```

2. Or link a local checkout, for example to follow ongoing development:

   ```sh
   git clone https://github.com/Anthodev/omp-statusline.git
   omp plugin link /absolute/path/to/omp-statusline
   ```

3. Verify with `omp plugin list`, then start a new OMP session. Do not load the package and an older standalone statusline extension at the same time.
4. Run `/omp-statusline` and set the panel up the way you like it. Every change saves immediately to `~/.omp/agent/omp-statusline.json`.

## Commands and configuration

| Command | Action |
| --- | --- |
| `/omp-statusline` | Open the settings menu; changes save immediately |
| `/omp-statusline reload` | Re-read the configuration file and refresh all data |

Defaults work without a configuration file. The file written by the settings menu remains editable by hand — run `/omp-statusline reload` afterward to apply your edits.

| Option | Default | Accepted values | Controls |
| --- | ---: | --- | --- |
| `refreshMs` | `1000` | `250`–`60000` | Statusline refresh interval |
| `vcsRefreshMs` | `5000` | `1000`–`300000` | Git and Jujutsu refresh interval |
| `usageRefreshMs` | `60000` | `10000`–`600000` | Provider usage refresh interval |
| `contextBarWidth` | `20` | `4`–`60` | Cells in the context bar |
| `quotaBarWidth` | `12` | `4`–`40` | Cells in each quota bar |
| `progressBarStyle` | `"unicode"` | `"unicode"`, `"extended"` | Character set of the bars |
| `lineGap` | `false` | boolean | Blank line between editor and statusline |
| `cwdMode` | `"full"` | `"full"`, `"basename"` | Full path or final component only |
| `showThinking` | `true` | boolean | Show the active thinking level |
| `showSessionName` | `true` | boolean | Show the current session name |
| `showVcs` | `true` | boolean | Show repository information |
| `showCostWithoutSubscription` | `true` | boolean | Show session cost when no quota matches |
| `subscriptionAccount` | `""` | text | Account label used to pick the matching quota report |

## Privacy

OMP Statusline runs entirely inside your editor. It reads the usage reports your host has already cached, runs `jj` or `git` locally, and writes a single configuration file in your agent directory. It makes no network requests of its own and collects no telemetry.

## Build from source

Install Node.js 20 or newer and Bun, then:

```sh
npm install
npm test
npm run typecheck
npm run pack:check
```

To run the extension inside a real OMP without installing the package:

```sh
omp --no-session -e ./extensions/omp.ts
```

## Contributing

Bug reports are welcome on the [issue tracker](https://github.com/Anthodev/omp-statusline/issues). A useful report includes your OMP version, the statusline configuration file, the terminal you use, and the steps to reproduce.

## License

[MIT](./LICENSE)
