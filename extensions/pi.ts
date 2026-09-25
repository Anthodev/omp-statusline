import { CustomEditor, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  SettingsList,
  type SettingItem,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { createOmpStatusline } from "../src/core.ts";

function scheduleNativeInterval(
  _ctx: unknown,
  callback: () => void | Promise<void>,
  delay: number,
): NodeJS.Timeout {
  return setInterval(() => {
    void Promise.resolve()
      .then(callback)
      .catch(error => console.error("OMP Statusline timer failed:", error));
  }, delay);
}

function clearNativeTimer(_ctx: unknown, handle: unknown): void {
  clearInterval(handle as NodeJS.Timeout);
}

export default createOmpStatusline({
  kind: "pi",
  CustomEditor,
  truncateToWidth,
  visibleWidth,
  getAgentDir: () => getAgentDir(),
  createSettingsList: (items, maxVisible, onChange, onCancel) =>
    // The shared component contract accepts OMP's readonly render output; Pi returns mutable arrays.
    new SettingsList(items as unknown as SettingItem[], maxVisible, getSettingsListTheme(), onChange, onCancel),
  createInput: (initialValue, onSubmit, onCancel) => {
    const input = new Input();
    input.setValue(initialValue);
    input.onSubmit = onSubmit;
    input.onEscape = onCancel;
    return input;
  },
  scheduleInterval: scheduleNativeInterval,
  clearTimer: clearNativeTimer,
});
