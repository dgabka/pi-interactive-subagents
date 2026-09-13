import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isTmuxSession(): boolean {
  return Boolean(process.env.TMUX);
}

export function tmuxSetupHint(): string {
  return "Start pi inside tmux (`tmux new -A -s pi 'pi'`).";
}

function requireTmux(): void {
  if (!isTmuxSession()) throw new Error(`Pi is not running inside tmux. ${tmuxSetupHint()}`);
}

export function isFishShell(): boolean {
  return basename(process.env.SHELL ?? "") === "fish";
}

export function exitStatusVar(): string {
  return isFishShell() ? "$status" : "$?";
}

export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function createSurface(name: string): string {
  return createSurfaceSplit(name, "right", process.env.TMUX_PANE);
}

export function createSurfaceSplit(
  _name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  requireTmux();
  const args = ["split-window", "-d"];
  args.push(direction === "left" || direction === "right" ? "-h" : "-v");
  if (direction === "left" || direction === "up") args.push("-b");
  if (fromSurface) args.push("-t", fromSurface);
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) throw new Error(`Unexpected tmux split-window output: ${pane}`);
  return pane;
}

export function renameCurrentTab(title: string): void {
  requireTmux();
  if (process.env.PI_SUBAGENT_RENAME_TMUX_WINDOW !== "1") return;
  const pane = process.env.TMUX_PANE;
  if (!pane) throw new Error("TMUX_PANE not set");
  const window = execFileSync(
    "tmux",
    ["display-message", "-p", "-t", pane, "#{window_id}"],
    { encoding: "utf8" },
  ).trim();
  execFileSync("tmux", ["rename-window", "-t", window, title]);
}

export function renameWorkspace(title: string): void {
  requireTmux();
  if (process.env.PI_SUBAGENT_RENAME_TMUX_SESSION !== "1") return;
  const pane = process.env.TMUX_PANE;
  if (!pane) throw new Error("TMUX_PANE not set");
  const session = execFileSync(
    "tmux",
    ["display-message", "-p", "-t", pane, "#{session_id}"],
    { encoding: "utf8" },
  ).trim();
  execFileSync("tmux", ["rename-session", "-t", session, title]);
}

export function sendCommand(surface: string, command: string): void {
  requireTmux();
  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command]);
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"]);
}

export function sendEscape(surface: string): void {
  requireTmux();
  execFileSync("tmux", ["send-keys", "-t", surface, "Escape"]);
}

export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });
  const script = ["#!/bin/bash", options?.scriptPreamble?.trimEnd(), command]
    .filter((part) => part !== undefined)
    .join("\n");
  writeFileSync(scriptPath, script + "\n", { mode: 0o755 });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

export function readScreen(surface: string, lines = 50): string {
  requireTmux();
  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
}

export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireTmux();
  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

export function closeSurface(surface: string): void {
  requireTmux();
  execFileSync("tmux", ["kill-pane", "-t", surface]);
}

export interface PollResult {
  reason: "done" | "ping" | "sentinel" | "error";
  exitCode: number;
  ping?: { name: string; message: string };
  errorMessage?: string;
}

function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "ping") {
    return { reason: "ping", exitCode: 0, ping: { name: data.name, message: data.message } };
  }
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim()
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) throw new Error("Aborted while waiting for subagent to finish");

    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    if (options.sentinelFile && existsSync(options.sentinelFile)) {
      return { reason: "sentinel", exitCode: 0 };
    }

    try {
      const match = (await readScreenAsync(surface, 5)).match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) return { reason: "sentinel", exitCode: Number(match[1]) };
    } catch {}

    options.onTick?.(Math.floor((Date.now() - start) / 1000));
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
