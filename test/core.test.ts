import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOmpStatusline,
  type StatuslineRuntime,
} from "../src/core.ts";

type ExecResult = { code: number; stdout: string };
type Exec = (command: string, args: string[], options?: { cwd?: string }) => Promise<ExecResult>;
type Handler = (event: unknown, context: TestContext) => void | Promise<void>;
type Command = {
  description: string;
  handler(args: string, context: TestContext): void | Promise<void>;
};
type MenuSetting = {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];
  submenu?: unknown;
};
type SettingsMenu = {
  items: MenuSetting[];
  change?: (id: string, value: string) => void;
};
type ScheduledJob = {
  callback: () => void | Promise<void>;
  delay: number;
};
type SessionEntry = {
  type: string;
  message: { role: string; usage?: { cost?: { total?: number } } };
};
type TestContext = {
  cwd: string;
  model?: { id: string; provider: string };
  modelRegistry: object;
  getContextUsage(): undefined;
  sessionManager: {
    getBranch(): unknown[];
    getEntries(): SessionEntry[];
    getLeafId(): string | null;
    getLeafEntry(): unknown;
    getSessionFile(): string | undefined;
  };
  ui: {
    theme: { fg(color: string, text: string): string };
    setEditorComponent(factory: EditorFactory): void;
    getEditorComponent(): EditorFactory | undefined;
    requestRender(): void;
    notify(): void;
    custom<T>(
      factory: (
        tui: { requestRender(): void },
        theme: { fg(color: string, text: string): string },
        keybindings: object,
        done: (value: T) => void,
      ) => { render(width: number): string[] },
    ): Promise<T | undefined>;
  };
};
type EditorFactory = (
  tui: { requestRender(): void },
  theme: { editorPaddingX: number },
  keybindings: object,
) => { render(width: number): string[] };

class ManualScheduler {
  private nextHandle = 1;
  private readonly jobs = new Map<number, ScheduledJob>();

  set(callback: () => void | Promise<void>, delay: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.jobs.set(handle, { callback, delay });
    return handle;
  }

  clear(handle: unknown): void {
    if (typeof handle === "number") this.jobs.delete(handle);
  }

  delays(): number[] {
    return [...this.jobs.values()].map(job => job.delay).sort((left, right) => left - right);
  }

  async runDelay(delay: number): Promise<void> {
    const callbacks = [...this.jobs.values()]
      .filter(job => job.delay === delay)
      .map(job => job.callback);
    for (const callback of callbacks) await callback();
    await Promise.resolve();
  }
}

class BaseEditor {
  protected borderColor = (text: string): string => text;

  constructor(_tui: unknown, _theme: unknown, _keybindings: unknown) {}

  render(_width: number): string[] {
    return ["base"];
  }
}

type HostOptions = {
  config?: Record<string, unknown>;
  agentDir?: string;
  cwd?: string;
  exec?: Exec;
  modelId?: string;
  provider?: string;
  sessionName?: string;
  sessionFile?: string;
  entries?: SessionEntry[];
  ponytail?: boolean;
  fetchUsageReports?: () => Promise<unknown>;
  usageReports?: () => Promise<unknown>;
  leaf?: { id: string | null; entry: unknown };
};

type Host = {
  root: string;
  scheduler: ManualScheduler;
  commands: Map<string, Command>;
  events: Map<string, Handler>;
  context: TestContext;
  renderRequests: { count: number };
  sessionReads: { entries: number; branch: number };
  writeConfig(config: Record<string, unknown>): void;
  settingsMenu: SettingsMenu;
  start(): Promise<{ render(width: number): string[] }>;
  shutdown(): Promise<void>;
  restoreGlobals(): void;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createHost(options: HostOptions = {}): Host {
  const root = mkdtempSync(join(tmpdir(), "omp-statusline-test-"));
  roots.push(root);
  const scheduler = new ManualScheduler();
  const commands = new Map<string, Command>();
  const events = new Map<string, Handler>();
  const renderRequests = { count: 0 };
  const sessionReads = { entries: 0, branch: 0 };
  let editorFactory: EditorFactory | undefined;
  const writeConfig = (config: Record<string, unknown>): void => {
    writeFileSync(join(root, "omp-statusline.json"), JSON.stringify(config));
  };
  writeConfig(options.config ?? {});

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = ((callback: () => void, delay?: number) =>
    scheduler.set(callback, delay ?? 0)) as typeof setInterval;
  globalThis.clearInterval = ((handle: unknown) => scheduler.clear(handle)) as typeof clearInterval;

  const exec: Exec = options.exec ?? (async () => ({ code: 1, stdout: "" }));
  const settingsMenu: SettingsMenu = { items: [] };
  const context: TestContext = {
    cwd: options.cwd ?? root,
    model: { id: options.modelId ?? "test-model", provider: options.provider ?? "test-provider" },
    modelRegistry: options.fetchUsageReports
      ? { authStorage: { fetchUsageReports: options.fetchUsageReports } }
      : options.usageReports
      ? { authStorage: { usage: { reports: options.usageReports } } }
      : {},
    getContextUsage: () => undefined,
    sessionManager: {
      getBranch: () => {
        sessionReads.branch += 1;
        return [];
      },
      getEntries: () => {
        sessionReads.entries += 1;
        return options.entries ?? [];
      },
      getSessionFile: () => options.sessionFile,
      getLeafId: () => options.leaf?.id ?? null,
      getLeafEntry: () => options.leaf?.entry,
    },
    ui: {
      theme: { fg: (_color, text) => text },
      setEditorComponent: factory => {
        editorFactory = factory;
      },
      getEditorComponent: () => editorFactory,
      requestRender: () => {
        renderRequests.count += 1;
      },
      notify: () => {},
      custom: async factory => {
        factory(
          { requestRender: () => { renderRequests.count += 1; } },
          { fg: (_color, text) => text },
          {},
          () => {},
        );
        return undefined;
      },
    },
  };
  const pi = {
    exec,
    getCommands: () => options.ponytail ? [{ name: "ponytail" }] : [],
    getSessionName: () => options.sessionName ?? "Test Session",
    getThinkingLevel: () => "off",
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    setLabel: () => {},
  };
  const runtime = {
    kind: "pi",
    CustomEditor: BaseEditor,
    truncateToWidth: (text: string, width: number) => text.slice(0, width),
    visibleWidth: (text: string) => stripTrustedStyles(text).length,
    getAgentDir: () => options.agentDir ?? root,
    scheduleInterval: (_context: unknown, callback: () => void | Promise<void>, delay: number) =>
      scheduler.set(callback, delay),
    clearTimer: (_context: unknown, handle: unknown) => scheduler.clear(handle),
    createSettingsList: (
      items: MenuSetting[],
      _maxVisible: number,
      onChange: (id: string, value: string) => void,
      _onCancel: () => void,
    ) => {
      settingsMenu.items = items;
      settingsMenu.change = onChange;
      return { render: () => [], handleInput: () => {}, invalidate: () => {} };
    },
    createInput: () => ({ render: () => [], handleInput: () => {}, invalidate: () => {} }),
  } as unknown as StatuslineRuntime;
  createOmpStatusline(runtime)(pi as never);
  return {
    root,
    scheduler,
    commands,
    events,
    context,
    renderRequests,
    sessionReads,
    writeConfig,
    settingsMenu,
    async start() {
      const handler = events.get("session_start");
      if (!handler) throw new Error("session_start handler missing");
      await handler({}, context);
      if (!editorFactory) throw new Error("editor factory missing");
      return editorFactory({ requestRender: () => {} }, { editorPaddingX: 2 }, {});
    },
    async shutdown() {
      const handler = events.get("session_shutdown");
      if (handler) await handler({}, context);
    },
    restoreGlobals() {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
}

function stripTrustedStyles(text: string): string {
  return text.replace(/\x1b\[38;2;\d+;\d+;\d+m|\x1b\[39m/g, "");
}

function visibleRows(editor: { render(width: number): string[] }): string[] {
  return editor.render(300).map(stripTrustedStyles);
}

function gitExec(title: string, branch = "main", statusSuffix = ""): Exec {
  return async (command, args) => {
    if (command === "jj") return { code: 1, stdout: "" };
    if (command !== "git") return { code: 1, stdout: "" };
    if (args[0] === "rev-parse") {
      return { code: 0, stdout: args.includes("--verify") ? "deadbeef" : "/repo" };
    }
    if (args[0] === "log") return { code: 0, stdout: title };
    if (args[0] === "status") {
      return { code: 0, stdout: `# branch.head ${branch}\0# branch.ab +0 -0\0${statusSuffix}` };
    }
    if (args[0] === "diff") return { code: 0, stdout: "" };
    return { code: 1, stdout: "" };
  };
}

function jjExec(description: string, bookmark: string): Exec {
  return async (command, args) => {
    if (command !== "jj") return { code: 1, stdout: "" };
    if (args[0] === "root") return { code: 0, stdout: "/repo" };
    if (args[0] === "log" && args.includes("@")) {
      return { code: 0, stdout: `change-id\n${description}\nfalse` };
    }
    if (args[0] === "log") return { code: 0, stdout: bookmark };
    if (args[0] === "diff") return { code: 0, stdout: "0 files changed" };
    return { code: 1, stdout: "" };
  };
}

describe("terminal-safe rendering", () => {
  test.each([
    ["Git", gitExec("safe-title\x1b(Bafter\x1b[31mred\x1b[0m\x1b]52;c;secret\x1b\\\nnext\u202etext")],
    ["Jujutsu", jjExec("safe-description\x1b[2J\x1b]8;;https://evil;secret\x07visible", "safe-bookmark\x07")],
  ])("sanitizes %s repository metadata", async (_name, exec) => {
    const rawCwd = "/tmp/safe-cwd\x1b[2J\nnext";
    const host = createHost({
      cwd: rawCwd,
      exec,
      modelId: "safe-model\x1b[31mred\u2066text",
      sessionName: "safe-session\x1b]52;c;secret\x07\nnext\u202dtext",
    });
    try {
      const editor = await host.start();
      const rows = visibleRows(editor);
      expect(rows.join(" ")).toContain("safe-");
      expect(rows.join(" ")).not.toContain("secret");
      if (_name === "Git") expect(rows.join(" ")).toContain("safe-titleafterred nexttext");
      expect(rows.every(row => !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/.test(row))).toBe(true);
    } finally {
      await host.shutdown();
      host.restoreGlobals();
    }
  });
});

test("invalid boolean-shaped config values use boolean defaults", async () => {
  const host = createHost({
    config: { lineGap: "false", showSessionName: 0, showVcs: false },
    sessionName: "Visible Session",
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Visible Session");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("sanitizes the host agent directory in the command description", () => {
  const host = createHost({ agentDir: "/tmp/agent\x1b[2J\nnext\u202etext" });
  try {
    const command = host.commands.get("omp-statusline");
    expect(command?.description).toBe("Configure OMP Statusline (/tmp/agent nexttext/omp-statusline.json)");
  } finally {
    host.restoreGlobals();
  }
});

test("basename mode preserves backslashes in POSIX directory names", async () => {
  const host = createHost({
    config: { cwdMode: "basename", showVcs: false },
    cwd: "/work/customer\\release",
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows[0]).toContain("customer\\release");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("render uses cached subagent costs until the usage refresh", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-statusline-cost-test-"));
  roots.push(root);
  const sessionFile = join(root, "main.jsonl");
  const subagentDir = join(root, "main");
  mkdirSync(subagentDir);
  const childFile = join(subagentDir, "child.jsonl");
  const childEntry = (cost: number): string => JSON.stringify({
    type: "message",
    message: { role: "assistant", usage: { cost: { total: cost } } },
  }) + "\n";
  writeFileSync(childFile, childEntry(1));
  const host = createHost({
    sessionFile,
    entries: [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.5 } } } }],
  });
  try {
    const editor = await host.start();
    expect(visibleRows(editor).join(" ")).toContain("chat $0.50  total $1.50");
    appendFileSync(childFile, childEntry(2));
    expect(visibleRows(editor).join(" ")).toContain("chat $0.50  total $1.50");
    await host.scheduler.runDelay(60_000);
    expect(visibleRows(editor).join(" ")).toContain("chat $0.50  total $3.50");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("fast refresh avoids session scans and message events update current cost", async () => {
  const host = createHost({
    entries: [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.5 } } } }],
  });
  try {
    const editor = await host.start();
    host.sessionReads.entries = 0;
    host.sessionReads.branch = 0;
    await host.scheduler.runDelay(1000);
    expect(host.sessionReads).toEqual({ entries: 0, branch: 0 });
    const messageEnd = host.events.get("message_end");
    if (!messageEnd) throw new Error("message_end handler missing");
    await messageEnd({
      message: { role: "assistant", usage: { cost: { total: 0.25 } } },
    }, host.context);
    expect(host.sessionReads).toEqual({ entries: 0, branch: 0 });
    expect(visibleRows(editor).join(" ")).toContain("chat $0.75  total $0.75");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("Ponytail leaf updates the cached mode without a branch scan", async () => {
  const leaf = { id: null as string | null, entry: undefined as unknown };
  const host = createHost({ ponytail: true, leaf, config: { showVcs: false } });
  try {
    const editor = await host.start();
    host.sessionReads.branch = 0;
    leaf.id = "ponytail-mode-1";
    leaf.entry = { customType: "ponytail-mode", data: { mode: "ultra" } };
    await host.scheduler.runDelay(1000);
    expect(host.sessionReads.branch).toBe(0);
    expect(visibleRows(editor).join(" ")).toContain("PONYTAIL: ULTRA");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("input commands update Caveman and Ponytail badges immediately", async () => {
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const host = createHost({ ponytail: true, config: { showVcs: false } });
  process.env.CLAUDE_CONFIG_DIR = host.root;
  const cavemanFlag = join(host.root, ".caveman-active");
  writeFileSync(cavemanFlag, "full");
  try {
    const editor = await host.start();
    const input = host.events.get("input");
    if (!input) throw new Error("input handler missing");
    expect(visibleRows(editor)[0]).toContain("CAVEMAN: FULL");

    await input({ text: "/caveman lite" }, host.context);
    expect(visibleRows(editor)[0]).toContain("CAVEMAN: LITE");
    expect(readFileSync(cavemanFlag, "utf8")).toBe("lite");

    await input({ text: "/ponytail ultra" }, host.context);
    expect(visibleRows(editor)[0]).toContain("PONYTAIL: ULTRA");

    await input({ text: "normal mode" }, host.context);
    expect(visibleRows(editor)[0]).not.toContain("CAVEMAN:");
    expect(existsSync(cavemanFlag)).toBe(false);
  } finally {
    await host.shutdown();
    host.restoreGlobals();
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  }
});

test("Pi Caveman leaf state overrides the global flag across refreshes", async () => {
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const leaf = { id: null as string | null, entry: undefined as unknown };
  const host = createHost({ leaf, config: { showVcs: false } });
  process.env.CLAUDE_CONFIG_DIR = host.root;
  writeFileSync(join(host.root, ".caveman-active"), "lite");
  try {
    const editor = await host.start();
    expect(visibleRows(editor)[0]).toContain("CAVEMAN: LITE");
    leaf.id = "caveman-level-1";
    leaf.entry = { customType: "caveman-level", data: { level: "full" } };
    await host.scheduler.runDelay(1000);
    expect(visibleRows(editor)[0]).toContain("CAVEMAN: FULL");
    await host.scheduler.runDelay(1000);
    expect(visibleRows(editor)[0]).toContain("CAVEMAN: FULL");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  }
});

test("VCS timer skips a refresh while the previous refresh is pending", async () => {

  let blocking = false;
  let calls = 0;
  let release: ((result: ExecResult) => void) | undefined;
  const host = createHost({
    exec: async (command, args) => {
      if (command === "jj" && args[0] === "root") {
        calls += 1;
        if (blocking) return new Promise<ExecResult>(resolve => {
          release = resolve;
        });
      }
      return { code: 1, stdout: "" };
    },
  });
  try {
    await host.start();
    calls = 0;
    blocking = true;
    const first = host.scheduler.runDelay(5000);
    const second = host.scheduler.runDelay(5000);
    await Promise.resolve();
    expect(calls).toBe(1);
    release?.({ code: 1, stdout: "" });
    await Promise.all([first, second]);
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("usage timer skips a fetch while the previous fetch is pending", async () => {
  let blocking = false;
  let calls = 0;
  let release: ((reports: unknown) => void) | undefined;
  const host = createHost({
    fetchUsageReports: async () => {
      calls += 1;
      if (blocking) return new Promise<unknown>(resolve => {
        release = resolve;
      });
      return [];
    },
  });
  try {
    await host.start();
    calls = 0;
    blocking = true;
    const first = host.scheduler.runDelay(60_000);
    const second = host.scheduler.runDelay(60_000);
    await Promise.resolve();
    expect(calls).toBe(1);
    release?.([]);
    await Promise.all([first, second]);
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("usage refresh retries after an in-flight A-B-A provider switch", async () => {
  let blockNext = false;
  let calls = 0;
  let release: ((reports: unknown) => void) | undefined;
  const host = createHost({
    fetchUsageReports: async () => {
      calls += 1;
      if (blockNext) {
        blockNext = false;
        return new Promise<unknown>(resolve => {
          release = resolve;
        });
      }
      return [];
    },
  });
  try {
    await host.start();
    calls = 0;
    blockNext = true;
    const pending = host.scheduler.runDelay(60_000);
    host.context.model = { id: "model-b", provider: "provider-b" };
    await host.scheduler.runDelay(1000);
    host.context.model = { id: "test-model", provider: "test-provider" };
    await host.scheduler.runDelay(1000);
    expect(calls).toBe(1);
    release?.([]);
    await pending;
    await Promise.resolve();
    expect(calls).toBe(2);
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("OMP 18 namespaced usage reports render the weekly quota instead of chat cost", async () => {
  const host = createHost({
    modelId: "gpt-6-sol",
    provider: "openai-codex",
    usageReports: async () => [
      {
        provider: "openai-codex",
        limits: [
          {
            id: "openai-codex:secondary",
            window: { id: "7d", durationMs: 604_800_000, resetsAt: Date.now() + 3_600_000 },
            amount: { usedFraction: 0.98 },
          },
        ],
      },
    ],
  });
  try {
    const editor = await host.start();
    const rows = visibleRows(editor).join(" ");
    expect(rows).toContain("week ████████████ 98%");
    expect(rows).not.toContain("chat $");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("config reload replaces timer cadences and shutdown clears them", async () => {
  const host = createHost({ config: { refreshMs: 1000, vcsRefreshMs: 5000, usageRefreshMs: 60000 } });
  try {
    await host.start();
    expect(host.scheduler.delays()).toEqual([1000, 5000, 60000]);
    host.writeConfig({ refreshMs: 250, vcsRefreshMs: 1000, usageRefreshMs: 10000 });
    const command = host.commands.get("omp-statusline");
    if (!command) throw new Error("omp-statusline command missing");
    await command.handler("reload", host.context);
    expect(host.scheduler.delays()).toEqual([250, 1000, 10000]);
    await host.shutdown();
    expect(host.scheduler.delays()).toEqual([]);
  } finally {
    host.restoreGlobals();
  }
});

test("settings menu persists changes and applies timer cadence immediately", async () => {
  const host = createHost({ config: { refreshMs: 1000, showSessionName: true } });
  try {
    await host.start();
    const command = host.commands.get("omp-statusline");
    if (!command) throw new Error("omp-statusline command missing");

    await command.handler("", host.context);
    expect(host.settingsMenu.items.map(item => item.id)).toContain("refreshMs");
    expect(host.settingsMenu.items).toHaveLength(13);
    expect(host.settingsMenu.items.map(item => item.id)).toContain("subscriptionAccount");

    host.settingsMenu.change?.("refreshMs", "250");
    host.settingsMenu.change?.("showSessionName", "off");

    expect(host.scheduler.delays()).toEqual([250, 5000, 60000]);
    expect(JSON.parse(readFileSync(join(host.root, "omp-statusline.json"), "utf8"))).toMatchObject({
      refreshMs: 250,
      showSessionName: false,
    });
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("shutdown clears timers when the host provides a fresh event context", async () => {
  const host = createHost();
  try {
    await host.start();
    expect(host.scheduler.delays()).toHaveLength(3);
    const shutdown = host.events.get("session_shutdown");
    if (!shutdown) throw new Error("session_shutdown handler missing");
    await shutdown({}, { ...host.context });
    expect(host.scheduler.delays()).toEqual([]);
  } finally {
    host.restoreGlobals();
  }
});

test("Git status displays untracked files separately from line counts", async () => {
  const host = createHost({
    exec: gitExec("Title", "main", "? untracked.txt\0"),
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows.join(" ")).toContain("(-0/+0) ?1");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("Git status renders every untracked file in an unborn repository", async () => {
  const repository = mkdtempSync(join(tmpdir(), "omp-statusline-git-test-"));
  roots.push(repository);
  const init = Bun.spawnSync(["git", "init", "-b", "main"], { cwd: repository });
  expect(init.exitCode).toBe(0);
  mkdirSync(join(repository, "new"));
  writeFileSync(join(repository, "new", "one.txt"), "one\n");
  writeFileSync(join(repository, "new", "two.txt"), "two\n");
  const host = createHost({
    cwd: repository,
    exec: async (command, args, options) => {
      const result = Bun.spawnSync([command, ...args], {
        cwd: options?.cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      return { code: result.exitCode, stdout: result.stdout.toString() };
    },
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows.join(" ")).toContain("(no commits)");
    expect(rows.join(" ")).toContain("?2");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("Git status counts staged lines in an unborn repository", async () => {
  const repository = mkdtempSync(join(tmpdir(), "omp-statusline-git-staged-test-"));
  roots.push(repository);
  expect(Bun.spawnSync(["git", "init", "-b", "main"], { cwd: repository }).exitCode).toBe(0);
  writeFileSync(join(repository, "staged.txt"), "staged\n");
  expect(Bun.spawnSync(["git", "add", "staged.txt"], { cwd: repository }).exitCode).toBe(0);
  const host = createHost({
    cwd: repository,
    exec: async (command, args, options) => {
      const result = Bun.spawnSync([command, ...args], {
        cwd: options?.cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      return { code: result.exitCode, stdout: result.stdout.toString() };
    },
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows.join(" ")).toContain("(no commits)");
    expect(rows.join(" ")).toContain("(-0/+1)");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("Git status distinguishes an empty commit subject from an unborn HEAD", async () => {
  const repository = mkdtempSync(join(tmpdir(), "omp-statusline-git-empty-title-test-"));
  roots.push(repository);
  expect(Bun.spawnSync(["git", "init", "-b", "main"], { cwd: repository }).exitCode).toBe(0);
  writeFileSync(join(repository, "tracked.txt"), "base\n");
  expect(Bun.spawnSync(["git", "add", "tracked.txt"], { cwd: repository }).exitCode).toBe(0);
  const commit = Bun.spawnSync([
    "git",
    "-c",
    "user.name=Review",
    "-c",
    "commit.gpgSign=false",
    "-c",
    "user.email=review@example.com",
    "commit",
    "--allow-empty-message",
    "-m",
    "",
  ], { cwd: repository });
  expect(commit.exitCode).toBe(0);
  appendFileSync(join(repository, "tracked.txt"), "changed\n");
  const host = createHost({
    cwd: repository,
    exec: async (command, args, options) => {
      const result = Bun.spawnSync([command, ...args], {
        cwd: options?.cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      return { code: result.exitCode, stdout: result.stdout.toString() };
    },
  });
  try {
    const rows = visibleRows(await host.start());
    expect(rows.join(" ")).toContain("(no description)");
    expect(rows.join(" ")).toContain("(-0/+1)");
  } finally {
    await host.shutdown();
    host.restoreGlobals();
  }
});

test("both host entrypoints resolve the neutral shared core", async () => {
  const entrypoints = [
    join(import.meta.dir, "..", "extensions", "omp.ts"),
    join(import.meta.dir, "..", "extensions", "pi.ts"),
  ];
  for (const entrypoint of entrypoints) {
    const result = await Bun.build({
      entrypoints: [entrypoint],
      packages: "external",
      target: "bun",
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
  }
});
