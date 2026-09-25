# OMP Statusline

Configurable statusline extension for [Pi](https://github.com/earendil-works/pi) and [Oh My Pi](https://github.com/can1357/oh-my-pi).

## Features

- Model, thinking level, working directory, and session name
- Context-window usage and provider quota bars
- Current-session and subagent costs
- Jujutsu change, bookmark, divergence, conflict, and line counts
- Git commit, branch, divergence, conflict, staged, unstaged, and untracked counts
- Live Caveman and Ponytail mode indicators when their plugins are present
- Separate Pi and OMP adapters backed by one shared core

Jujutsu is preferred when the current directory belongs to a `jj` workspace. Git is used as the fallback. Missing VCS executables or non-repository directories hide the VCS row without blocking the editor.

## Requirements

- Node.js 20 or newer
- Pi 0.83 or newer, or OMP 17.2 or newer
- Bun for development and tests only
- Optional: `jj` and/or `git` for repository status

## Install

### Pi from GitHub

```sh
pi install git:github.com/Anthodev/omp-statusline
```

Local development checkout:

```sh
pi install /absolute/path/to/omp-statusline
```

Pi package installation follows its documented package manifest and Git source conventions: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>.

### OMP

Clone the repository, then link it:

```sh
git clone https://github.com/Anthodev/omp-statusline.git
omp plugin link /absolute/path/to/omp-statusline
```

After npm publication:

```sh
omp plugin install @anthodev/omp-statusline
```

OMP discovers `omp.extensions` from `package.json`: <https://github.com/can1357/oh-my-pi/blob/master/docs/skills/authoring-extensions.md#packagejson-manifest>.

Restart the host after installation. Do not load both the package and an older standalone statusline extension simultaneously.

## Configuration

Defaults work without a configuration file. Run `/omp-statusline` to open the settings menu; changes are saved immediately in the active host's agent directory:

- Pi: `~/.pi/agent/omp-statusline.json`
- OMP: `~/.omp/agent/omp-statusline.json`

The file remains editable by hand. Run `/omp-statusline reload` afterward to reload it and refresh all data.

| Option | Default | Accepted values |
| --- | ---: | --- |
| `refreshMs` | `1000` | `250`–`60000` |
| `vcsRefreshMs` | `5000` | `1000`–`300000` |
| `usageRefreshMs` | `60000` | `10000`–`600000` |
| `contextBarWidth` | `20` | `4`–`60` |
| `quotaBarWidth` | `12` | `4`–`40` |
| `progressBarStyle` | `"unicode"` | `"unicode"`, `"extended"` |
| `lineGap` | `false` | boolean |
| `cwdMode` | `"full"` | `"full"`, `"basename"` |
| `showThinking` | `true` | boolean |
| `showSessionName` | `true` | boolean |
| `showVcs` | `true` | boolean |
| `showCostWithoutSubscription` | `true` | boolean |
| `subscriptionAccount` | `""` | account label override |

## Development

```sh
npm install
npm test
npm run typecheck
npm run pack:check
```

Test either host without installing the package:

```sh
pi --no-session -e ./extensions/pi.ts
omp --no-session -e ./extensions/omp.ts
```

## Architecture

- `src/core.ts`: host-neutral statusline behavior
- `extensions/pi.ts`: Pi imports and native timer adapter
- `extensions/omp.ts`: OMP imports, label, and managed timer adapter
- `test/core.test.ts`: rendering, VCS, lifecycle, performance, and adapter regressions

Subscription quota bars use the host's cached usage reports. OMP 18.3 and newer expose them through `modelRegistry.authStorage.usage.reports()`; Pi and older OMP versions expose `modelRegistry.authStorage.fetchUsageReports()`. The statusline supports both interfaces and shows session cost when no matching quota is available.

## License

[MIT](./LICENSE)
