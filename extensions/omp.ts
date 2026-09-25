import { CustomEditor, getAgentDir, getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import { Input, SettingsList, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { createOmpStatusline, type StatuslineRuntime } from "../src/core.ts";

type OmpTimerContext = {
  setInterval(callback: () => void | Promise<void>, delay: number): unknown;
  clearTimer(handle: unknown): void;
};

function getTimerContext(ctx: unknown): OmpTimerContext {
  if (
    !ctx
    || typeof ctx !== "object"
    || !("setInterval" in ctx)
    || typeof ctx.setInterval !== "function"
    || !("clearTimer" in ctx)
    || typeof ctx.clearTimer !== "function"
  ) {
    throw new TypeError("OMP managed timer API is unavailable");
  }
  return ctx as OmpTimerContext;
}

export default createOmpStatusline({
  kind: "omp",
  // Pi and OMP expose runtime-compatible editors through distinct nominal types.
  CustomEditor: CustomEditor as unknown as StatuslineRuntime["CustomEditor"],
  truncateToWidth,
  visibleWidth,
  getAgentDir: () => getAgentDir(),
  createSettingsList: (items, maxVisible, onChange, onCancel) =>
    new SettingsList(items, maxVisible, getSettingsListTheme(), onChange, onCancel),
  createInput: (initialValue, onSubmit, onCancel) => {
    const input = new Input();
    input.setValue(initialValue);
    input.onSubmit = onSubmit;
    input.onEscape = onCancel;
    return input;
  },
  initialize: pi => {
    if (!pi || typeof pi !== "object" || !("setLabel" in pi) || typeof pi.setLabel !== "function") {
      throw new TypeError("OMP ExtensionAPI.setLabel is unavailable");
    }
    pi.setLabel("OMP Statusline");
  },
  scheduleInterval: (ctx, callback, delay) => getTimerContext(ctx).setInterval(callback, delay),
  clearTimer: (ctx, handle) => {
    getTimerContext(ctx).clearTimer(handle);
  },
});
