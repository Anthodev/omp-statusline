import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  CustomEditor as BaseCustomEditor,
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  EditorTheme,
  TUI,
} from "@earendil-works/pi-tui";

type StatusTheme = {
  fg(color: string, text: string): string;
};
type StatusColors = {
  model: string;
  path: string;
  vcsClean: string;
  vcsDirty: string;
  context: string;
  spend: string;
  cost: string;
  separator: string;
};
export type StatuslineComponent = {
  render(width: number): readonly string[];
  handleInput?(data: string): void;
  invalidate(): void;
};
export type StatuslineSettingItem = {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];
  submenu?: (currentValue: string, done: (selectedValue?: string) => void) => StatuslineComponent;
};
export type StatuslineRuntime = {
  kind: "omp" | "pi";
  CustomEditor: typeof BaseCustomEditor;
  truncateToWidth(
    text: string,
    maxWidth: number,
    ellipsis?: "",
    preserveAnsi?: boolean,
  ): string;
  visibleWidth(text: string): number;
  getAgentDir(pi: unknown): string;
  createSettingsList(
    items: StatuslineSettingItem[],
    maxVisible: number,
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
  ): StatuslineComponent;
  createInput(
    initialValue: string,
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ): StatuslineComponent;
  initialize?(pi: unknown): void;
  scheduleInterval(
    ctx: unknown,
    callback: () => void | Promise<void>,
    delay: number,
  ): unknown;
  clearTimer(ctx: unknown, handle: unknown): void;
};

let runtime: StatuslineRuntime;
let theme: StatusTheme;
let truncateToWidth: StatuslineRuntime["truncateToWidth"];
let visibleWidth: StatuslineRuntime["visibleWidth"];
let STATUS_COLORS: StatusColors;

const THINKING_COLORS: Record<string, (text: string) => string> = {
  off: text => `\x1b[38;2;108;112;134m${text}\x1b[39m`,
  minimal: text => `\x1b[38;2;137;180;250m${text}\x1b[39m`,
  low: text => `\x1b[38;2;148;226;213m${text}\x1b[39m`,
  medium: text => `\x1b[38;2;166;227;161m${text}\x1b[39m`,
  high: text => `\x1b[38;2;249;226;175m${text}\x1b[39m`,
  xhigh: text => `\x1b[38;2;250;179;135m${text}\x1b[39m`,
  max: text => `\x1b[38;2;243;139;168m${text}\x1b[39m`,
};
const CAVEMAN_LEVELS: Record<string, true> = {
  lite: true,
  full: true,
  ultra: true,
  "wenyan-lite": true,
  wenyan: true,
  "wenyan-full": true,
  "wenyan-ultra": true,
  commit: true,
  review: true,
  compress: true,
  micro: true,
};
const PONYTAIL_MODES: Record<string, true> = {
  off: true,
  lite: true,
  full: true,
  ultra: true,
  review: true,
};
function sanitizeTerminalText(input: string): string {
  let output = "";
  let pendingSpace = false;
  let index = 0;

  const skipStringSequence = (start: number, allowBell: boolean): number => {
    let cursor = start;
    while (cursor < input.length) {
      const code = input.charCodeAt(cursor);
      if (allowBell && code === 0x07) return cursor + 1;
      if (code === 0x9c) return cursor + 1;
      if (code === 0x1b && input[cursor + 1] === "\\") return cursor + 2;
      cursor += 1;
    }
    return cursor;
  };

  const skipCsi = (start: number): number => {
    let cursor = start;
    while (cursor < input.length && input.charCodeAt(cursor) >= 0x30 && input.charCodeAt(cursor) <= 0x3f) {
      cursor += 1;
    }
    while (cursor < input.length && input.charCodeAt(cursor) >= 0x20 && input.charCodeAt(cursor) <= 0x2f) {
      cursor += 1;
    }
    return cursor < input.length && input.charCodeAt(cursor) >= 0x40 && input.charCodeAt(cursor) <= 0x7e
      ? cursor + 1
      : cursor;
  };

  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code === 0x1b) {
      const next = input[index + 1];
      if (next === "[") {
        index = skipCsi(index + 2);
      } else if (next === "]") {
        index = skipStringSequence(index + 2, true);
      } else if (next === "P" || next === "X" || next === "^" || next === "_") {
        index = skipStringSequence(index + 2, false);
      } else {
        let cursor = index + 1;
        while (cursor < input.length && input.charCodeAt(cursor) >= 0x20 && input.charCodeAt(cursor) <= 0x2f) {
          cursor += 1;
        }
        index = cursor < input.length && input.charCodeAt(cursor) >= 0x30 && input.charCodeAt(cursor) <= 0x7e
          ? cursor + 1
          : cursor;
      }
      continue;
    }
    if (code === 0x9b) {
      index = skipCsi(index + 1);
      continue;
    }
    if (code === 0x9d) {
      index = skipStringSequence(index + 1, true);
      continue;
    }
    if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      index = skipStringSequence(index + 1, false);
      continue;
    }
    if (
      code === 0x09
      || code === 0x0a
      || code === 0x0b
      || code === 0x0c
      || code === 0x0d
      || code === 0x85
      || code === 0x2028
      || code === 0x2029
    ) {
      pendingSpace = output.length > 0;
      index += 1;
      continue;
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      index += 1;
      continue;
    }
    if (
      code === 0x061c
      || code === 0x200e
      || code === 0x200f
      || (code >= 0x202a && code <= 0x202e)
      || (code >= 0x2066 && code <= 0x206f)
    ) {
      index += 1;
      continue;
    }
    if (pendingSpace && !output.endsWith(" ") && input[index] !== " ") output += " ";
    pendingSpace = false;
    output += input[index];
    index += 1;
  }
  return output.trim();
}



function readCavemanLevel(): string | null {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const path = join(configDir, ".caveman-active");
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64) return null;
    const level = readFileSync(path, "utf8").trim().toLowerCase();
    return CAVEMAN_LEVELS[level] ? level : null;
  } catch {
    return null;
  }
}

function persistCavemanLevel(level: string | null): void {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const path = join(configDir, ".caveman-active");
  if (level === null) {
    try {
      unlinkSync(path);
    } catch {
      // Already inactive or unavailable.
    }
    return;
  }

  let tempPath: string | undefined;
  try {
    mkdirSync(configDir, { recursive: true });
    const directory = lstatSync(configDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return;
    try {
      if (lstatSync(path).isSymbolicLink()) return;
    } catch {
      // Missing target is valid.
    }
    tempPath = join(configDir, `.caveman-active.${process.pid}.${Date.now()}`);
    writeFileSync(tempPath, level, { flag: "wx", mode: 0o600 });
    renameSync(tempPath, path);
    tempPath = undefined;
  } catch {
    // Best-effort synchronization; in-memory badge still updates.
  } finally {
    if (tempPath) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failure.
      }
    }
  }
}
function readPonytailDefaultMode(): string {
  const envMode = process.env.PONYTAIL_DEFAULT_MODE?.trim().toLowerCase();
  if (envMode && PONYTAIL_MODES[envMode] && envMode !== "review") return envMode;

  const configRoot = process.env.XDG_CONFIG_HOME
    || (process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : join(homedir(), ".config"));
  try {
    const config = JSON.parse(
      readFileSync(join(configRoot, "ponytail", "config.json"), "utf8").replace(/^\uFEFF/, ""),
    ) as { defaultMode?: unknown };
    const mode = typeof config.defaultMode === "string"
      ? config.defaultMode.trim().toLowerCase()
      : "";
    return PONYTAIL_MODES[mode] && mode !== "review" ? mode : "full";
  } catch {
    return "full";
  }
}

function persistedCavemanLevel(entry: unknown): string | null | undefined {
  if (!entry || typeof entry !== "object" || !("customType" in entry)) return undefined;
  if (entry.customType !== "caveman-level" || !("data" in entry)) return undefined;
  if (!entry.data || typeof entry.data !== "object" || !("level" in entry.data)) return undefined;
  if (typeof entry.data.level !== "string") return undefined;
  const level = entry.data.level.trim().toLowerCase();
  if (level === "off") return null;
  return CAVEMAN_LEVELS[level] ? level : undefined;
}

function latestCavemanLevel(ctx: ExtensionContext): string | null | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const level = persistedCavemanLevel(entries[index]);
    if (level !== undefined) return level;
  }
  return undefined;
}

function persistedPonytailMode(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || !("customType" in entry)) return null;
  if (entry.customType !== "ponytail-mode" || !("data" in entry)) return null;
  if (!entry.data || typeof entry.data !== "object" || !("mode" in entry.data)) return null;
  if (typeof entry.data.mode !== "string") return null;
  const mode = entry.data.mode.trim().toLowerCase();
  return PONYTAIL_MODES[mode] ? mode : null;
}

function latestPonytailMode(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const mode = persistedPonytailMode(entries[index]);
    if (mode) return mode;
  }
  return null;
}


type Config = {
  refreshMs: number;
  vcsRefreshMs: number;
  usageRefreshMs: number;
  contextBarWidth: number;
  quotaBarWidth: number;
  progressBarStyle: "unicode" | "extended";
  lineGap: boolean;
  cwdMode: "full" | "basename";
  showThinking: boolean;
  showSessionName: boolean;
  showVcs: boolean;
  showCostWithoutSubscription: boolean;
  subscriptionAccount: string;
};

type ChangeCounts = {
  added: number;
  deleted: number;
  untracked: number;
};
type Divergence = {
  ahead: number;
  behind: number;
};

type VcsState = ((({
  kind: "jj";
  changeId: string;
  description: string;
  bookmark: string;
} | ({
  kind: "git";
  title: string;
  branch: string;
}) & Divergence)) & ChangeCounts & {
  conflicted: boolean;
  remoteUrl: string;
}) | null;

type UsageLimit = {
  id?: string;
  label?: string;
  scope?: { modelId?: string; tier?: string; windowId?: string };
  window?: { id?: string; label?: string; durationMs?: number; resetsAt?: number };
  amount?: {
    used?: number;
    limit?: number;
    usedFraction?: number;
    remainingFraction?: number;
    unit?: string;
  };
};

type UsageReport = {
  provider?: string;
  limits?: UsageLimit[];
  metadata?: Record<string, unknown>;
};
type PersistedEntry = {
  type?: string;
  message?: {
    role?: string;
    usage?: { cost?: { total?: number } };
  };
  customType?: string;
  data?: { mode?: unknown };
};
type OmpModelRegistry = {
  authStorage?: {
    fetchUsageReports?(): Promise<unknown>;
    usage?: { reports(): Promise<unknown> };
  };
};


type SessionCosts = {
  current: number;
  subagent: number;
  total: number;
};
type CostFileCache = {
  size: number;
  mtimeNs: bigint;
  cost: number;
  trailing: Buffer;
};
type RuntimeState = {
  config: Config;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  vcs: VcsState;
  usageReports: UsageReport[];
  usageProvider: string;
  cavemanLevel: string | null;
  cavemanSessionManaged: boolean;
  ponytailMode: string | null;
  costs: SessionCosts;
  timers: unknown[];
  active: boolean;
  vcsGeneration: number;
  usageGeneration: number;
  costFiles: Map<string, CostFileCache>;
  vcsRefreshing: boolean;
  usageRefreshing: boolean;
  lastLeafId: string | null;
  restartTimers?: () => void;
  requestRender?: () => void;
};

const DEFAULT_CONFIG: Config = {
  refreshMs: 1000,
  vcsRefreshMs: 5000,
  usageRefreshMs: 60000,
  contextBarWidth: 20,
  quotaBarWidth: 12,
  progressBarStyle: "unicode",
  lineGap: false,
  cwdMode: "full",
  showThinking: true,
  showSessionName: true,
  showVcs: true,
  showCostWithoutSubscription: true,
  subscriptionAccount: "",
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}
function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}


function loadConfig(path: string): Config {
  try {
    const input = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
    return {
      refreshMs: boundedNumber(input.refreshMs, DEFAULT_CONFIG.refreshMs, 250, 60_000),
      vcsRefreshMs: boundedNumber(input.vcsRefreshMs, DEFAULT_CONFIG.vcsRefreshMs, 1000, 300_000),
      usageRefreshMs: boundedNumber(input.usageRefreshMs, DEFAULT_CONFIG.usageRefreshMs, 10_000, 600_000),
      contextBarWidth: boundedNumber(input.contextBarWidth, DEFAULT_CONFIG.contextBarWidth, 4, 60),
      quotaBarWidth: boundedNumber(input.quotaBarWidth, DEFAULT_CONFIG.quotaBarWidth, 4, 40),
      progressBarStyle: input.progressBarStyle === "extended" ? "extended" : "unicode",
      lineGap: booleanValue(input.lineGap, DEFAULT_CONFIG.lineGap),
      cwdMode: input.cwdMode === "basename" ? "basename" : "full",
      showThinking: booleanValue(input.showThinking, DEFAULT_CONFIG.showThinking),
      showSessionName: booleanValue(input.showSessionName, DEFAULT_CONFIG.showSessionName),
      showVcs: booleanValue(input.showVcs, DEFAULT_CONFIG.showVcs),
      showCostWithoutSubscription: booleanValue(
        input.showCostWithoutSubscription,
        DEFAULT_CONFIG.showCostWithoutSubscription,
      ),
      subscriptionAccount:
        typeof input.subscriptionAccount === "string" ? input.subscriptionAccount.trim() : "",
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(path: string, config: Config): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Refusing to replace symbolic link: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tempPath, path);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toString();
}

function formatRemaining(resetsAt: number | undefined): string {
  if (!resetsAt) return "";
  const minutes = Math.max(0, Math.ceil((resetsAt - Date.now()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function usedFraction(limit: UsageLimit): number | undefined {
  const amount = limit.amount;
  if (!amount) return undefined;
  if (typeof amount.usedFraction === "number") return amount.usedFraction;
  if (typeof amount.used === "number" && typeof amount.limit === "number" && amount.limit > 0) {
    return amount.used / amount.limit;
  }
  if (amount.unit === "percent" && typeof amount.used === "number") return amount.used / 100;
  if (typeof amount.remainingFraction === "number") return 1 - amount.remainingFraction;
  return undefined;
}

function progressBar(fraction: number, width: number, style: Config["progressBarStyle"]): string {
  const safe = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(safe * width);
  const token = safe >= 0.95 ? "error" : safe >= 0.8 ? "warning" : "success";
  if (style === "extended") {
    const middle = Math.max(0, width - 2);
    const bar = filled === 0
      ? "\uEE00" + "\uEE01".repeat(middle) + "\uEE02"
      : filled >= width
        ? "\uEE03" + "\uEE04".repeat(middle) + "\uEE05"
        : "\uEE03" + "\uEE04".repeat(Math.max(0, filled - 1))
          + "\uEE01".repeat(Math.max(0, width - filled - 1)) + "\uEE02";
    return theme.fg(token, bar);
  }
  return theme.fg(token, "█".repeat(filled)) + theme.fg("dim", "░".repeat(width - filled));
}

function findWindow(report: UsageReport, kind: "5h" | "7d"): UsageLimit | undefined {
  const limits = report.limits ?? [];
  const targetMs = kind === "5h" ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const tolerance = kind === "5h" ? 90 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const directId = kind === "5h" ? "openai-codex:primary" : "openai-codex:secondary";
  const labelPattern = kind === "5h" ? /5\s*(?:hour|h)/i : /(?:weekly|week|7\s*day|7d)/i;

  return [...limits]
    .filter(limit => {
      const windowId = limit.window?.id ?? limit.scope?.windowId ?? "";
      const duration = limit.window?.durationMs;
      return (
        windowId.toLowerCase() === kind ||
        (typeof duration === "number" && Math.abs(duration - targetMs) <= tolerance) ||
        labelPattern.test(`${limit.label ?? ""} ${limit.window?.label ?? ""}`)
      );
    })
    .sort((a, b) => {
      if (a.id === directId) return -1;
      if (b.id === directId) return 1;
      const aScoped = a.scope?.modelId || a.scope?.tier ? 1 : 0;
      const bScoped = b.scope?.modelId || b.scope?.tier ? 1 : 0;
      return aScoped - bScoped;
    })[0];
}

function selectUsageReport(state: RuntimeState): UsageReport | undefined {
  const reports = state.usageReports.filter(report => report.provider === state.usageProvider);
  const selector = state.config.subscriptionAccount.toLowerCase();
  if (!selector) return reports[0];
  return reports.find(report => JSON.stringify(report.metadata ?? {}).toLowerCase().includes(selector));
}

function persistedAssistantCost(entry: unknown): number {
  if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "message") return 0;
  if (!("message" in entry) || !entry.message || typeof entry.message !== "object") return 0;
  if (!("role" in entry.message) || entry.message.role !== "assistant") return 0;
  if (!("usage" in entry.message) || !entry.message.usage || typeof entry.message.usage !== "object") return 0;
  const usage = entry.message.usage;
  if (!("cost" in usage) || !usage.cost || typeof usage.cost !== "object") return 0;
  const cost = "total" in usage.cost ? usage.cost.total : undefined;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

function parseCostBuffer(input: Buffer): { cost: number; trailing: Buffer } {
  const finalNewline = input.lastIndexOf(0x0a);
  let cost = 0;
  if (finalNewline >= 0) {
    for (const line of input.subarray(0, finalNewline).toString("utf8").split("\n")) {
      if (!line) continue;
      try {
        cost += persistedAssistantCost(JSON.parse(line));
      } catch {
        // Ignore malformed complete records without losing later valid records.
      }
    }
  }
  let trailing = Buffer.from(input.subarray(finalNewline + 1));
  if (trailing.length > 0) {
    try {
      cost += persistedAssistantCost(JSON.parse(trailing.toString("utf8")));
      trailing = Buffer.alloc(0);
    } catch {
      // Retain a partial final record and combine it with the next append.
    }
  }
  return { cost, trailing };
}

function readFileRange(path: string, start: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  const descriptor = openSync(path, "r");
  let offset = 0;
  try {
    while (offset < length) {
      const count = readSync(descriptor, buffer, offset, length - offset, start + offset);
      if (count === 0) break;
      offset += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return offset === length ? buffer : Buffer.from(buffer.subarray(0, offset));
}

function getSubagentCost(state: RuntimeState): number {
  const sessionFile = state.ctx.sessionManager.getSessionFile();
  if (!sessionFile) return 0;
  const seen = new Set<string>();
  let total = 0;
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.name.endsWith(".jsonl")) {
        seen.add(path);
        const previous = state.costFiles.get(path);
        try {
          const stat = statSync(path, { bigint: true });
          const size = Number(stat.size);
          let next: CostFileCache;
          if (previous && previous.size === size && previous.mtimeNs === stat.mtimeNs) {
            next = previous;
          } else if (previous && size > previous.size) {
            const parsed = parseCostBuffer(Buffer.concat([
              previous.trailing,
              readFileRange(path, previous.size, size - previous.size),
            ]));
            next = {
              size,
              mtimeNs: stat.mtimeNs,
              cost: previous.cost + parsed.cost,
              trailing: parsed.trailing,
            };
          } else {
            const parsed = parseCostBuffer(readFileSync(path));
            next = { size, mtimeNs: stat.mtimeNs, cost: parsed.cost, trailing: parsed.trailing };
          }
          state.costFiles.set(path, next);
          total += next.cost;
        } catch {
          if (previous) total += previous.cost;
        }
      }
    }
  };
  visit(sessionFile.slice(0, -".jsonl".length));
  for (const path of state.costFiles.keys()) {
    if (!seen.has(path)) state.costFiles.delete(path);
  }
  return total;
}

function getSessionCosts(state: RuntimeState): SessionCosts {
  let current = 0;
  for (const entry of state.ctx.sessionManager.getEntries()) current += persistedAssistantCost(entry);
  const subagent = getSubagentCost(state);
  return { current, subagent, total: current + subagent };
}


function refreshCosts(state: RuntimeState): void {
  state.costs = state.config.showCostWithoutSubscription
    ? getSessionCosts(state)
    : { current: 0, subagent: 0, total: 0 };
}


function divergencePart(vcs: Extract<VcsState, { kind: "git" }>): string {
  const parts = [
    vcs.ahead > 0 ? theme.fg("success", `↑${vcs.ahead}`) : "",
    vcs.behind > 0 ? theme.fg("error", `↓${vcs.behind}`) : "",
  ].filter(Boolean);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function vcsParts(state: RuntimeState): string[] {
  if (!state.config.showVcs || !state.vcs) return [];

  const changes =
    `(${theme.fg("error", `-${state.vcs.deleted}`)}/${theme.fg("success", `+${state.vcs.added}`)})`;
  const untracked = state.vcs.untracked > 0
    ? ` ${theme.fg("warning", `?${state.vcs.untracked}`)}`
    : "";
  const conflict = state.vcs.conflicted ? ` ${theme.fg("error", "")}` : "";
  if (state.vcs.kind === "jj") {
    return [
      `${theme.fg(STATUS_COLORS.vcsClean, ` ${sanitizeTerminalText(state.vcs.changeId)}`)} ${changes}${untracked}${conflict}`,
      theme.fg("text", sanitizeTerminalText(state.vcs.description)),
      state.vcs.bookmark
        ? theme.fg(STATUS_COLORS.vcsDirty, `󰃀 ${sanitizeTerminalText(state.vcs.bookmark)}`)
        : "",
    ].filter(Boolean);
  }

  return [
    `${theme.fg("text", ` ${sanitizeTerminalText(state.vcs.title)}`)} ${changes}${untracked}${conflict}`,
    state.vcs.branch
      ? `${theme.fg(STATUS_COLORS.vcsDirty, ` ${sanitizeTerminalText(state.vcs.branch)}`)}${divergencePart(state.vcs)}`
      : "",
  ].filter(Boolean);
}
function vcsIcon(remoteUrl: string): string {
  const normalized = remoteUrl.toLowerCase();
  if (normalized.includes("github.com")) return "";
  if (normalized.includes("gitlab.com")) return "";
  if (normalized.includes("codeberg.org")) return "";
  return "";
}

function vcsLine(
  state: RuntimeState,
  width: number,
  editorPaddingX: number,
  borderColor: (text: string) => string,
): string | null {
  const parts = vcsParts(state);
  if (!state.vcs || parts.length === 0) return null;

  const sidePadding = Math.min(editorPaddingX, Math.max(0, Math.floor((width - 2) / 2)));
  const innerWidth = Math.max(0, width - 2 - sidePadding * 2);
  const separator = theme.fg(STATUS_COLORS.separator, "  ");
  const icon = theme.fg(STATUS_COLORS.vcsClean, vcsIcon(state.vcs.remoteUrl));
  const content = truncateToWidth(` ${[icon, ...parts].join(separator)}`, innerWidth, "", true);
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  const edge = borderColor("│");
  const row = " ".repeat(sidePadding) + content + padding + " ".repeat(sidePadding);
  return edge + row + edge;
}



function topBorder(
  state: RuntimeState,
  width: number,
  borderColor: (text: string) => string,
): { content: string; width: number } {
  const model = sanitizeTerminalText(state.ctx.model?.id ?? "no-model");
  const thinkingLevel = state.pi.getThinkingLevel();
  const thinkingLabel = sanitizeTerminalText(thinkingLevel ?? "");
  const cwd = state.config.cwdMode === "full" ? state.ctx.cwd : basename(state.ctx.cwd);
  const parts = [
    theme.fg(STATUS_COLORS.model, `󰚩 ${model}`),
    state.config.showThinking && thinkingLabel
      ? (THINKING_COLORS[thinkingLevel ?? ""] ?? THINKING_COLORS.off)(`󰔟 ${thinkingLabel}`)
      : "",
    theme.fg(STATUS_COLORS.path, ` ${sanitizeTerminalText(cwd)}`),
  ].filter(Boolean);

  const separator = theme.fg(STATUS_COLORS.separator, "  ");
  let left = ` ${parts.join(separator)} `;
  const sessionName = sanitizeTerminalText(state.pi.getSessionName() ?? "");
  const rightParts = [
    state.cavemanLevel
      ? theme.fg("warning", `CAVEMAN: ${state.cavemanLevel.toUpperCase()}`)
      : "",
    state.ponytailMode && state.ponytailMode !== "off"
      ? theme.fg("success", `PONYTAIL: ${state.ponytailMode.toUpperCase()}`)
      : "",
    state.config.showSessionName && sessionName ? sessionName : "",
  ].filter(Boolean);
  const rightSeparator = theme.fg(STATUS_COLORS.separator, " | ");
  let right = rightParts.length > 0 ? ` ${rightParts.join(rightSeparator)} ` : "";
  right = truncateToWidth(right, Math.max(0, Math.floor(width * 0.35)), "");
  left = truncateToWidth(left, Math.max(0, width - visibleWidth(right) - (right ? 1 : 0)), "");
  const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  const content = left + borderColor("─".repeat(fill)) + right;
  return { content, width };
}

function quotaPart(
  label: string,
  limit: UsageLimit,
  width: number,
  style: Config["progressBarStyle"],
): string {
  const fraction = usedFraction(limit);
  if (fraction === undefined) return "";
  const percent = `${Math.round(fraction * 100)}%`;
  const remaining = formatRemaining(limit.window?.resetsAt);
  return [
    theme.fg(STATUS_COLORS.spend, label),
    progressBar(fraction, width, style),
    theme.fg("text", percent),
    remaining ? theme.fg("muted", remaining) : "",
  ].filter(Boolean).join(" ");
}

function metricsLine(
  state: RuntimeState,
  width: number,
  editorPaddingX: number,
  borderColor: (text: string) => string,
): string {
  const sidePadding = Math.min(editorPaddingX, Math.max(0, Math.floor((width - 2) / 2)));
  const innerWidth = Math.max(0, width - 2 - sidePadding * 2);
  const usage = state.ctx.getContextUsage();
  const parts: string[] = [];

  if (usage) {
    const tokens = usage.tokens ?? 0;
    const percent = usage.percent ?? 0;
    const fraction = usage.contextWindow > 0 ? tokens / usage.contextWindow : percent / 100;
    parts.push([
      theme.fg(STATUS_COLORS.context, "ctx"),
      progressBar(fraction, state.config.contextBarWidth, state.config.progressBarStyle),
      theme.fg("text", `${percent.toFixed(1)}%`),
      theme.fg("muted", `${formatTokens(tokens)}/${formatTokens(usage.contextWindow)}`),
    ].join(" "));
  }

  const report = selectUsageReport(state);
  const fiveHour = report ? findWindow(report, "5h") : undefined;
  const weekly = report ? findWindow(report, "7d") : undefined;
  const quotas = [
    fiveHour
      ? quotaPart("5h", fiveHour, state.config.quotaBarWidth, state.config.progressBarStyle)
      : "",
    weekly
      ? quotaPart("week", weekly, state.config.quotaBarWidth, state.config.progressBarStyle)
      : "",
  ].filter(Boolean);

  if (quotas.length > 0) {
    parts.push(...quotas);
  } else if (state.config.showCostWithoutSubscription) {
    parts.push(theme.fg(
      STATUS_COLORS.cost,
      `chat $${state.costs.current.toFixed(2)}  total $${state.costs.total.toFixed(2)}`,
    ));
  }

  const separator = theme.fg(STATUS_COLORS.separator, "  │  ");
  const content = truncateToWidth(` ${parts.join(separator)}`, innerWidth, "", true);
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  const edge = borderColor("│");
  const row = " ".repeat(sidePadding) + content + padding + " ".repeat(sidePadding);
  return edge + row + edge;
}

function createEditorClass(CustomEditor: typeof BaseCustomEditor) {
  return class OmpStatuslineEditor extends CustomEditor {
    private readonly editorPaddingX: number;

    constructor(
      tui: TUI,
      editorTheme: EditorTheme,
      keybindings: KeybindingsManager,
      private readonly runtimeState: RuntimeState,
    ) {
      super(tui, editorTheme, keybindings);
      const padding = "editorPaddingX" in editorTheme && typeof editorTheme.editorPaddingX === "number"
        ? editorTheme.editorPaddingX
        : 2;
      this.editorPaddingX = Math.max(0, padding);
    }

    override render(width: number): string[] {
      const thinkingLevel = this.runtimeState.pi.getThinkingLevel();
      this.borderColor = THINKING_COLORS[thinkingLevel ?? "off"] ?? THINKING_COLORS.off;
      const lines = [...super.render(width)];
      if (width >= 6 && lines.length > 0) {
        const border = topBorder(this.runtimeState, width - 6, this.borderColor).content;
        lines[0] = this.borderColor("╭──") + border + this.borderColor("──╮");
      }
      if (width >= 4 && lines.length > 0) {
        const vcs = vcsLine(this.runtimeState, width, this.editorPaddingX, this.borderColor);
        const metrics = metricsLine(this.runtimeState, width, this.editorPaddingX, this.borderColor);
        const statusLines = vcs ? [vcs, metrics] : [metrics];
        if (this.runtimeState.config.lineGap) {
          const edge = this.borderColor("│");
          statusLines.unshift(edge + " ".repeat(width - 2) + edge);
        }
        lines.splice(1, 0, ...statusLines);
      }
      return lines;
    }
  };
}

async function run(pi: ExtensionAPI, cwd: string, command: string, args: string[]): Promise<string | null> {
  const result = await pi.exec(command, args, { cwd, timeout: 2000 });
  return result.code === 0 ? result.stdout.trim() || null : null;
}
function parseJjStat(output: string | null): ChangeCounts {
  const added = output?.match(/(\d+) insertions?\(\+\)/)?.[1];
  const deleted = output?.match(/(\d+) deletions?\(-\)/)?.[1];
  return {
    added: added ? Number.parseInt(added, 10) : 0,
    deleted: deleted ? Number.parseInt(deleted, 10) : 0,
    untracked: 0,
  };
}

function parseGitNumstat(output: string | null): ChangeCounts {
  let added = 0;
  let deleted = 0;
  for (const line of output?.split("\n") ?? []) {
    const [lineAdded, lineDeleted] = line.split("\t", 2);
    const parsedAdded = Number.parseInt(lineAdded, 10);
    const parsedDeleted = Number.parseInt(lineDeleted, 10);
    if (Number.isFinite(parsedAdded)) added += parsedAdded;
    if (Number.isFinite(parsedDeleted)) deleted += parsedDeleted;
  }
  return { added, deleted, untracked: 0 };
}
function formatJjBookmarks(bookmarks: string, syncState: string | null): string {
  const syncedByBookmark = new Map<string, boolean>();
  for (const line of syncState?.split("\n") ?? []) {
    const [name, synced] = line.split("\t", 2);
    if (name) syncedByBookmark.set(name, synced === "true");
  }
  return bookmarks
    .split(/\s+/)
    .filter(Boolean)
    .map(name => syncedByBookmark.get(name) === false ? `${name}*` : name)
    .join(", ");
}

function parseGitStatus(output: string | null): Divergence & {
  branch: string;
  conflicted: boolean;
  untracked: number;
} {
  const records = output?.split("\0") ?? [];
  const headers = records.filter(record => record.startsWith("# ")).join("\n");
  const branch = headers.match(/^# branch\.head (.+)$/m)?.[1] ?? "";
  const divergence = headers.match(/^# branch\.ab \+(\d+) -(\d+)$/m);
  return {
    branch: branch === "(detached)" ? "" : branch,
    ahead: divergence ? Number.parseInt(divergence[1], 10) : 0,
    behind: divergence ? Number.parseInt(divergence[2], 10) : 0,
    conflicted: records.some(record => record.startsWith("u ")),
    untracked: records.filter(record => record.startsWith("? ")).length,
  };
}



async function updateVcs(state: RuntimeState, generation: number): Promise<void> {

  let vcs: VcsState = null;
  const jjRoot = await run(state.pi, state.ctx.cwd, "jj", ["root"]);
  if (jjRoot) {
    const [metadata, bookmarks, bookmarkSyncState, remoteList, stat] = await Promise.all([
      run(state.pi, state.ctx.cwd, "jj", [
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        'change_id.short(8) ++ "\n" ++ description.first_line() ++ "\n" ++ conflict',
      ]),
      run(state.pi, state.ctx.cwd, "jj", [
        "log",
        "--no-graph",
        "-r",
        "heads(::@ & bookmarks())",
        "-T",
        "bookmarks",
      ]),
      run(state.pi, state.ctx.cwd, "jj", [
        "bookmark",
        "list",
        "--all-remotes",
        "-T",
        'if(!remote, name ++ "\t" ++ synced ++ "\n")',
      ]),
      run(state.pi, state.ctx.cwd, "jj", ["git", "remote", "list"]),
      run(state.pi, state.ctx.cwd, "jj", ["diff", "--stat"]),
    ]);
    const [changeId, description, conflict] = metadata?.split("\n", 3) ?? [];
    const bookmark = formatJjBookmarks(bookmarks ?? "", bookmarkSyncState);
    const remoteUrl = remoteList
      ?.split("\n")
      .map(line => line.trim().split(/\s+/, 2))
      .find(([name]) => name === "origin")?.[1] ?? "";
    vcs = changeId
      ? {
          kind: "jj",
          changeId,
          description: description || "(no description)",
          bookmark,
          conflicted: conflict === "true",
          remoteUrl,
          ...parseJjStat(stat),
        }
      : null;
  } else {
    const gitRoot = await run(state.pi, state.ctx.cwd, "git", ["rev-parse", "--show-toplevel"]);
    if (gitRoot) {
      const [head, title, status, remoteUrl, numstat] = await Promise.all([
        run(state.pi, state.ctx.cwd, "git", ["rev-parse", "--verify", "HEAD"]),
        run(state.pi, state.ctx.cwd, "git", ["log", "-1", "--pretty=%s"]),
        run(state.pi, state.ctx.cwd, "git", [
          "status",
          "--porcelain=v2",
          "--branch",
          "--untracked-files=all",
          "-z",
        ]),
        run(state.pi, state.ctx.cwd, "git", ["remote", "get-url", "origin"]),
        run(state.pi, state.ctx.cwd, "git", ["diff", "--numstat", "HEAD"]),
      ]);
      const resolvedNumstat = head
        ? numstat
        : await run(state.pi, state.ctx.cwd, "git", ["diff", "--cached", "--numstat"]);
      const gitStatus = parseGitStatus(status);
      vcs = {
        kind: "git",
        title: head ? title ?? "(no description)" : "(no commits)",
        remoteUrl: remoteUrl ?? "",
        ...parseGitNumstat(resolvedNumstat),
        ...gitStatus,
      };
    }
  }
  if (!state.active || generation !== state.vcsGeneration) return;
  state.vcs = vcs;
  state.requestRender?.();
}


async function updateUsage(
  state: RuntimeState,
  generation: number,
): Promise<void> {
  let nextReports: UsageReport[] | undefined;
  const authStorage = (state.ctx.modelRegistry as unknown as OmpModelRegistry).authStorage;
  if (authStorage) {
    try {
      const reports = await (authStorage.usage?.reports
        ? authStorage.usage.reports()
        : authStorage.fetchUsageReports?.());
      if (Array.isArray(reports)) nextReports = reports as UsageReport[];
    } catch {
      // Keep the last successful report; OMP's usage cache handles provider backoff.
    }
  }
  if (!state.active || generation !== state.usageGeneration) return;
  if (nextReports) state.usageReports = nextReports;
  state.requestRender?.();
}

async function refreshVcs(state: RuntimeState): Promise<void> {
  if (!state.active) return;
  if (!state.config.showVcs) {
    state.vcsGeneration += 1;
    state.vcs = null;
    state.requestRender?.();
    return;
  }
  if (state.vcsRefreshing) return;
  state.vcsRefreshing = true;
  const generation = ++state.vcsGeneration;
  try {
    await updateVcs(state, generation);
  } finally {
    state.vcsRefreshing = false;
  }
}

async function refreshUsage(state: RuntimeState): Promise<void> {
  if (!state.active) return;
  const provider = state.ctx.model?.provider ?? "";
  if (provider !== state.usageProvider) {
    state.usageProvider = provider;
    state.usageReports = [];
    state.usageGeneration += 1;
  }
  if (state.usageRefreshing) return;
  state.usageRefreshing = true;
  const generation = ++state.usageGeneration;
  try {
    await updateUsage(state, generation);
  } finally {
    state.usageRefreshing = false;
    if (state.active && generation !== state.usageGeneration) void refreshUsage(state);
  }
}

function stopTimers(state: RuntimeState): void {
  for (const timer of state.timers) runtime.clearTimer(state.ctx, timer);
  state.timers = [];
}

function startTimers(
  state: RuntimeState,
  editorFactory: (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => BaseCustomEditor,
): void {
  stopTimers(state);
  let lastModel = `${state.ctx.model?.provider ?? ""}/${state.ctx.model?.id ?? ""}`;
  state.timers.push(
    runtime.scheduleInterval(state.ctx, () => {
      if (!state.active) return;
      if (runtime.kind === "pi" && state.ctx.ui.getEditorComponent() !== editorFactory) {
        state.ctx.ui.setEditorComponent(editorFactory);
      }
      const currentModel = `${state.ctx.model?.provider ?? ""}/${state.ctx.model?.id ?? ""}`;
      if (!state.cavemanSessionManaged) state.cavemanLevel = readCavemanLevel();
      const leafId = state.ctx.sessionManager.getLeafId();
      if (leafId !== state.lastLeafId) {
        state.lastLeafId = leafId;
        const leaf = state.ctx.sessionManager.getLeafEntry();
        const cavemanLevel = persistedCavemanLevel(leaf);
        if (cavemanLevel !== undefined) {
          state.cavemanLevel = cavemanLevel;
          state.cavemanSessionManaged = true;
        }
        if (state.ponytailMode) {
          state.ponytailMode = persistedPonytailMode(leaf) ?? state.ponytailMode;
        }
      }
      state.requestRender?.();
      if (currentModel !== lastModel) {
        lastModel = currentModel;
        return refreshUsage(state);
      }
    }, state.config.refreshMs),
    runtime.scheduleInterval(state.ctx, () => refreshVcs(state), state.config.vcsRefreshMs),
    runtime.scheduleInterval(state.ctx, async () => {
      if (!state.active) return;
      if (state.ponytailMode) {
        state.ponytailMode = latestPonytailMode(state.ctx) ?? state.ponytailMode;
      }
      refreshCosts(state);
      await refreshUsage(state);
    }, state.config.usageRefreshMs),
  );
}

const NUMBER_SETTING_BOUNDS = {
  refreshMs: [250, 60_000],
  vcsRefreshMs: [1000, 300_000],
  usageRefreshMs: [10_000, 600_000],
  contextBarWidth: [4, 60],
  quotaBarWidth: [4, 40],
} as const;

type NumberSettingId = keyof typeof NUMBER_SETTING_BOUNDS;

function isNumberSettingId(id: string): id is NumberSettingId {
  return Object.prototype.hasOwnProperty.call(NUMBER_SETTING_BOUNDS, id);
}

function updatedConfig(config: Config, id: string, value: string): Config {
  if (isNumberSettingId(id)) {
    const number = Number(value);
    const [min, max] = NUMBER_SETTING_BOUNDS[id];
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new RangeError(`${id} must be an integer between ${min} and ${max}`);
    }
    return { ...config, [id]: number };
  }

  switch (id) {
    case "progressBarStyle":
      if (value !== "unicode" && value !== "extended") throw new TypeError(`Invalid ${id}`);
      return { ...config, progressBarStyle: value };
    case "cwdMode":
      if (value !== "full" && value !== "basename") throw new TypeError(`Invalid ${id}`);
      return { ...config, cwdMode: value };
    case "lineGap":
    case "showThinking":
    case "showSessionName":
    case "showVcs":
    case "showCostWithoutSubscription":
      if (value !== "on" && value !== "off") throw new TypeError(`Invalid ${id}`);
      return { ...config, [id]: value === "on" };
    case "subscriptionAccount":
      return { ...config, subscriptionAccount: sanitizeTerminalText(value.trim()) };
    default:
      throw new TypeError(`Unknown OMP Statusline setting: ${id}`);
  }
}

function applySetting(state: RuntimeState, configPath: string, id: string, value: string): void {
  const nextConfig = updatedConfig(state.config, id, value);
  saveConfig(configPath, nextConfig);
  state.config = nextConfig;

  if (id === "refreshMs" || id === "vcsRefreshMs" || id === "usageRefreshMs") {
    state.restartTimers?.();
  } else if (id === "showVcs") {
    void refreshVcs(state);
  } else if (id === "showCostWithoutSubscription") {
    refreshCosts(state);
  }
  state.requestRender?.();
}

function createInputSubmenu(
  tui: TUI,
  ctx: ExtensionContext,
  title: string,
  description: string,
  currentValue: string,
  done: (selectedValue?: string) => void,
  bounds?: readonly [number, number],
): StatuslineComponent {
  let errorMessage = "";
  const input = runtime.createInput(
    currentValue,
    value => {
      const trimmed = value.trim();
      if (bounds) {
        const number = Number(trimmed);
        if (!/^\d+$/.test(trimmed) || !Number.isInteger(number) || number < bounds[0] || number > bounds[1]) {
          errorMessage = `Enter an integer from ${bounds[0]} to ${bounds[1]}`;
          tui.requestRender();
          return;
        }
        done(String(number));
        return;
      }
      done(sanitizeTerminalText(trimmed));
    },
    () => done(),
  );

  return {
    render(width) {
      const contentWidth = Math.max(1, width - 2);
      const lines = [
        ` ${ctx.ui.theme.fg("accent", title)}`,
        ` ${ctx.ui.theme.fg("muted", description)}`,
        "",
        ...input.render(contentWidth).map(line => ` ${line}`),
      ];
      if (errorMessage) lines.push("", ` ${ctx.ui.theme.fg("warning", errorMessage)}`);
      lines.push("", ` ${ctx.ui.theme.fg("dim", "Enter to save · Esc to go back")}`);
      return lines.map(line => truncateToWidth(line, width, "", true));
    },
    handleInput(data) {
      input.handleInput?.(data);
      tui.requestRender();
    },
    invalidate() {
      input.invalidate?.();
    },
  };
}

async function showSettingsMenu(state: RuntimeState, configPath: string): Promise<void> {
  await state.ctx.ui.custom<void>((tui, _uiTheme, _keybindings, done) => {
    const numberItem = (
      id: NumberSettingId,
      label: string,
      description: string,
    ): StatuslineSettingItem => ({
      id,
      label,
      description,
      currentValue: String(state.config[id]),
      submenu: (currentValue, close) => createInputSubmenu(
        tui,
        state.ctx,
        label,
        `${description} (${NUMBER_SETTING_BOUNDS[id][0]}–${NUMBER_SETTING_BOUNDS[id][1]})`,
        currentValue,
        close,
        NUMBER_SETTING_BOUNDS[id],
      ),
    });
    const toggleItem = (
      id: "lineGap" | "showThinking" | "showSessionName" | "showVcs" | "showCostWithoutSubscription",
      label: string,
      description: string,
    ): StatuslineSettingItem => ({
      id,
      label,
      description,
      currentValue: state.config[id] ? "on" : "off",
      values: ["on", "off"],
    });

    const items: StatuslineSettingItem[] = [
      numberItem("refreshMs", "Render refresh", "Statusline refresh interval in milliseconds"),
      numberItem("vcsRefreshMs", "VCS refresh", "Git and Jujutsu refresh interval in milliseconds"),
      numberItem("usageRefreshMs", "Usage refresh", "Provider usage refresh interval in milliseconds"),
      numberItem("contextBarWidth", "Context bar width", "Number of cells in the context progress bar"),
      numberItem("quotaBarWidth", "Quota bar width", "Number of cells in provider quota bars"),
      {
        id: "progressBarStyle",
        label: "Progress bar style",
        description: "Character set used for progress bars",
        currentValue: state.config.progressBarStyle,
        values: ["unicode", "extended"],
      },
      toggleItem("lineGap", "Line gap", "Add a blank line between the editor and statusline"),
      {
        id: "cwdMode",
        label: "Working directory",
        description: "Show the full path or only its final component",
        currentValue: state.config.cwdMode,
        values: ["full", "basename"],
      },
      toggleItem("showThinking", "Thinking level", "Show the active thinking level"),
      toggleItem("showSessionName", "Session name", "Show the current session name"),
      toggleItem("showVcs", "Version control", "Show Git or Jujutsu repository information"),
      toggleItem(
        "showCostWithoutSubscription",
        "API session cost",
        "Show session cost when no subscription usage report is available",
      ),
      {
        id: "subscriptionAccount",
        label: "Subscription account",
        description: "Optional account label override; submit an empty value to clear it",
        currentValue: state.config.subscriptionAccount,
        submenu: (currentValue, close) => createInputSubmenu(
          tui,
          state.ctx,
          "Subscription account",
          "Exact account label; leave empty for automatic selection",
          currentValue,
          close,
        ),
      },
    ];

    const settingsList = runtime.createSettingsList(
      items,
      10,
      (id, newValue) => {
        try {
          applySetting(state, configPath, id, newValue);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.ctx.ui.notify(`Could not save OMP Statusline settings: ${message}`, "error");
          done();
        }
      },
      () => done(),
    );

    return {
      render(width) {
        return [
          ` ${state.ctx.ui.theme.fg("accent", "OMP Statusline Settings")}`,
          "",
          ...settingsList.render(width),
        ];
      },
      handleInput(data) {
        settingsList.handleInput?.(data);
        tui.requestRender();
      },
      invalidate() {
        settingsList.invalidate?.();
      },
    };
  });
}

export function createOmpStatusline(runtimeAdapter: StatuslineRuntime): (pi: ExtensionAPI) => void {
  runtime = runtimeAdapter;
  truncateToWidth = runtime.truncateToWidth;
  visibleWidth = runtime.visibleWidth;
  STATUS_COLORS = runtime.kind === "omp"
    ? {
        model: "statusLineModel",
        path: "statusLinePath",
        vcsClean: "statusLineGitClean",
        vcsDirty: "statusLineGitDirty",
        context: "statusLineContext",
        spend: "statusLineSpend",
        cost: "statusLineCost",
        separator: "statusLineSep",
      }
    : {
        model: "accent",
        path: "muted",
        vcsClean: "success",
        vcsDirty: "warning",
        context: "accent",
        spend: "text",
        cost: "warning",
        separator: "dim",
      };
  const OmpStatuslineEditor = createEditorClass(runtime.CustomEditor);

  return function ompStatusline(pi: ExtensionAPI): void {
    const configPath = join(runtime.getAgentDir(pi), "omp-statusline.json");
    let activeState: RuntimeState | undefined;

    runtime.initialize?.(pi);
    pi.registerCommand("omp-statusline", {
      description: `Configure OMP Statusline (${sanitizeTerminalText(configPath)})`,
      handler: async (args, ctx) => {
        const state = activeState;
        if (!state?.active) {
          ctx.ui.notify("OMP Statusline settings require an active session", "warning");
          return;
        }

        const action = args.trim().toLowerCase();
        if (action === "reload") {
          state.config = loadConfig(configPath);
          refreshCosts(state);
          state.restartTimers?.();
          await Promise.all([refreshVcs(state), refreshUsage(state)]);
          ctx.ui.notify("OMP Statusline configuration reloaded", "info");
          return;
        }
        if (action) {
          ctx.ui.notify("Usage: /omp-statusline [reload]", "warning");
          return;
        }
        await showSettingsMenu(state, configPath);
      },
    });

    pi.on("message_end", (event, _ctx) => {
      const state = activeState;
      if (!state?.active || !state.config.showCostWithoutSubscription) return;
      const cost = event.message.role === "assistant" ? event.message.usage.cost.total : 0;
      if (cost === 0) return;
      const current = state.costs.current + cost;
      state.costs = { current, subagent: state.costs.subagent, total: current + state.costs.subagent };
      state.requestRender?.();
    });

    pi.on("input", (event, _ctx) => {
      const state = activeState;
      if (!state?.active) return;
      let changed = false;
      const text = event.text.trim();
      const cavemanCommand = text.match(/^\/caveman(?::caveman)?(?:\s+([a-z-]+))?$/i);
      const cavemanMode = (cavemanCommand?.[1] ?? "full").toLowerCase();
      const deactivateCaveman = cavemanCommand?.[1]?.toLowerCase() === "off"
        || /^(?:normal mode|stop caveman|disable caveman|turn off caveman)$/i.test(text);
      if (deactivateCaveman) {
        state.cavemanLevel = null;
        persistCavemanLevel(null);
        changed = true;
      } else if (cavemanCommand && CAVEMAN_LEVELS[cavemanMode]) {
        state.cavemanLevel = cavemanMode;
        persistCavemanLevel(cavemanMode);
        changed = true;
      }

      const ponytailMode = text.match(/^\/ponytail\s+([a-z-]+)\s*$/i)?.[1]?.toLowerCase();
      if (state.ponytailMode && ponytailMode && PONYTAIL_MODES[ponytailMode]) {
        state.ponytailMode = ponytailMode;
        changed = true;
      }
      if (changed) state.requestRender?.();
    });

    pi.on("session_tree", (_event, _ctx) => {
      const state = activeState;
      if (!state?.active) return;
      refreshCosts(state);
      const cavemanLevel = latestCavemanLevel(state.ctx);
      state.cavemanSessionManaged = cavemanLevel !== undefined;
      state.cavemanLevel = cavemanLevel !== undefined ? cavemanLevel : readCavemanLevel();
      if (state.ponytailMode) {
        state.ponytailMode = latestPonytailMode(state.ctx) ?? state.ponytailMode;
      }
      state.lastLeafId = state.ctx.sessionManager.getLeafId();
      state.requestRender?.();
    });

    pi.on("session_shutdown", (_event, _ctx) => {
      const state = activeState;
      if (!state) return;
      state.active = false;
      state.vcsGeneration += 1;
      state.usageGeneration += 1;
      stopTimers(state);
      activeState = undefined;
    });

    pi.on("session_start", async (_event, ctx) => {
      const previousState = activeState;
      if (previousState) {
        previousState.active = false;
        previousState.vcsGeneration += 1;
        previousState.usageGeneration += 1;
        stopTimers(previousState);
      }
      theme = ctx.ui.theme as unknown as StatusTheme;
      const sessionCavemanLevel = latestCavemanLevel(ctx);
      const state: RuntimeState = {
        config: loadConfig(configPath),
        ctx,
        pi,
        vcs: null,
        usageReports: [],
        usageProvider: ctx.model?.provider ?? "",
        cavemanLevel: sessionCavemanLevel !== undefined ? sessionCavemanLevel : readCavemanLevel(),
        cavemanSessionManaged: sessionCavemanLevel !== undefined,
        ponytailMode: pi.getCommands().some(command => command.name === "ponytail")
          ? latestPonytailMode(ctx) ?? readPonytailDefaultMode()
          : null,
        costs: { current: 0, subagent: 0, total: 0 },
        timers: [],
        active: true,
        vcsGeneration: 0,
        usageGeneration: 0,
        costFiles: new Map(),
        lastLeafId: ctx.sessionManager.getLeafId(),
        vcsRefreshing: false,
        usageRefreshing: false,
      };
      activeState = state;

      const editorFactory = (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
        state.requestRender = () => tui.requestRender();
        return new OmpStatuslineEditor(tui, editorTheme, keybindings, state);
      };
      state.restartTimers = () => {
        startTimers(state, editorFactory);
      };
      ctx.ui.setEditorComponent(editorFactory);
      refreshCosts(state);
      state.restartTimers();
      await Promise.all([refreshVcs(state), refreshUsage(state)]);
    });
  };
}
