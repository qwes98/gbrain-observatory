import { spawn, type ChildProcessByStdio } from "node:child_process";
import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";

export const executionPolicy = { timeoutMs: 15_000, stdoutBytes: 1_048_576, stderrBytes: 65_536, killGraceMs: 250 } as const;
export type ConnectionConfig = { executable: string; cwd: string };
export type Command = "version" | "capabilities" | "sources" |
  { kind: "pages"; sourceId: string; offset: number } |
  { kind: "page"; sourceId: string; slug: string } |
  { kind: "backlinks"; sourceId: string; slug: string };
export type ProcessCause = "not-found" | "permission" | "timeout" | "output-limit" | "failed";
export type ExecutionResult = { ok: true; stdout: string } | { ok: false; cause: ProcessCause };
const argv = {
  version: ["--version"], capabilities: ["--tools-json"], sources: ["call", "sources_list", "{}"],
};
function commandArguments(command: Command): readonly string[] | null {
  if (typeof command === "string") return argv[command];
  if (!/^[a-z0-9-]{1,32}$/.test(command.sourceId)) return null;
  if (command.kind === "pages") {
    if (!Number.isSafeInteger(command.offset) || command.offset < 0 || command.offset >= 100 || command.offset % 10 !== 0) return null;
    return ["call", "list_pages", JSON.stringify({ source_id: command.sourceId, sort: "created_desc", limit: 10, offset: command.offset })];
  }
  if (typeof command.slug !== "string" || !command.slug.length || command.slug.length > 1024 || /[\0\r\n]/.test(command.slug)) return null;
  if (command.kind === "backlinks") return ["call", "get_backlinks", JSON.stringify({ source_id: command.sourceId, slug: command.slug, limit: 10 })];
  return ["call", "get_page", JSON.stringify({ source_id: command.sourceId, slug: command.slug, fuzzy: false })];
}

export function getConnectionConfig(environment: NodeJS.ProcessEnv = process.env): ConnectionConfig | null {
  const executable = environment.OBSERVATORY_GBRAIN_EXECUTABLE;
  const cwd = environment.OBSERVATORY_GBRAIN_CWD;
  // The operator audits local routing, optional recording/transmission and startup lifecycle before opting in.
  if (environment.OBSERVATORY_GBRAIN_READ_AUDIT !== "local-read-reviewed" || !executable || !cwd ||
      !isAbsolute(executable) || !isAbsolute(cwd) || /[\0\r\n]/.test(executable + cwd)) return null;
  return { executable, cwd };
}

const cleanupKey = Symbol.for("observatory.gbrain.active-groups");
const runtime = globalThis as typeof globalThis & { [cleanupKey]?: Set<() => void> };
function activeGroups(): Set<() => void> {
  if (!runtime[cleanupKey]) {
    const groups = new Set<() => void>();
    runtime[cleanupKey] = groups;
    const cleanup = () => { for (const stop of groups) stop(); };
    process.on("exit", cleanup);
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const hadSignalHandler = process.listenerCount(signal) > 0;
      const handleSignal = () => {
        cleanup();
        // Do not replace the server's shutdown handlers or swallow Node's default signal exit.
        if (!hadSignalHandler && process.listenerCount(signal) === 1) {
          process.removeListener(signal, handleSignal);
          process.kill(process.pid, signal);
        }
      };
      process.on(signal, handleSignal);
    }
  }
  return runtime[cleanupKey];
}
function executionCause(error: unknown): ProcessCause {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" ? "not-found" : code === "EACCES" ? "permission" : "failed";
}

/** Fixed public operations and validated structural arguments; no shell or request-derived environment. */
export function runCommand(config: ConnectionConfig, command: Command, deadline?: number): Promise<ExecutionResult> {
  const args = commandArguments(command);
  if (!args) return Promise.resolve({ ok: false, cause: "failed" });
  const timeout = Math.min(executionPolicy.timeoutMs, deadline === undefined ? executionPolicy.timeoutMs : deadline - Date.now());
  if (timeout <= 0) return Promise.resolve({ ok: false, cause: "timeout" });
  return new Promise(resolve => {
    let cause: ProcessCause | undefined;
    let output: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try { child = spawn(config.executable, [...args], {
      cwd: config.cwd, shell: false, detached: process.platform !== "win32",
      env: { ...process.env, GBRAIN_SKIP_STARTUP_HOOKS: "1", GBRAIN_SWEEP: "0", GBRAIN_NO_BANNER: "1", GBRAIN_NO_RETRY_CONNECT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }); } catch (error) { resolve({ ok: false, cause: executionCause(error) }); return; }
    function signal(signalName: NodeJS.Signals) {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signalName);
        else process.kill(-child.pid, signalName);
      } catch { /* The process may have already exited. */ }
    }
    const groups = activeGroups();
    const cleanup = () => signal("SIGKILL");
    groups.add(cleanup);
    function stop(reason: ProcessCause) {
      if (cause) return;
      cause = reason;
      output = [];
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), executionPolicy.killGraceMs);
    }
    const timer = setTimeout(() => stop("timeout"), timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > executionPolicy.stdoutBytes) stop("output-limit");
      if (!cause) output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > executionPolicy.stderrBytes) stop("output-limit");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      cause ??= executionCause(error);
    });
    // close follows exit and stream closure: do not release the execution lease before reaping.
    child.on("close", code => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      cleanup();
      groups.delete(cleanup);
      resolve(cause ? { ok: false, cause } : code === 0
        ? { ok: true, stdout: Buffer.concat(output).toString("utf8") }
        : { ok: false, cause: "failed" });
    });
  });
}
