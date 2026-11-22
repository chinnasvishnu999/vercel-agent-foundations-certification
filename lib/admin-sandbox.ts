// Server-side only (Workflow steps). The admin agent's persistent Vercel
// Sandbox: a named microVM whose filesystem survives between sessions. It
// holds the data files the agent computes over and the agent's memory file.
// Command execution happens here, isolated from the app server.

import { Sandbox } from "@vercel/sandbox";

/** Working directory inside the sandbox; paths below are relative to it. */
export const SANDBOX_HOME = "/vercel/sandbox";
export const DATA_DIR = "data";
export const MEMORY_FILE = "memory/MEMORY.md";

const MEMORY_HEADER =
  "# Admin agent memory\n\nPreferences, corrections and business context saved by the store admin agent.\n\n";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 60 * 1000;
const OUTPUT_LIMIT = 12_000;

/** One sandbox per environment, so local, preview and production data stay apart. */
function sandboxName(): string {
  return `ship-shop-admin-${process.env.VERCEL_ENV ?? "development"}`;
}

export async function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: sandboxName(),
    persistent: true,
    timeout: SESSION_TIMEOUT_MS,
    // Agent-written commands only process local files: no internet access.
    networkPolicy: "deny-all",
    onCreate: async (sbx) => {
      await sbx.mkDir(`${SANDBOX_HOME}/${DATA_DIR}`).catch(() => {});
      await sbx.mkDir(`${SANDBOX_HOME}/memory`).catch(() => {});
      await sbx.writeFiles([
        { path: `${SANDBOX_HOME}/${MEMORY_FILE}`, content: Buffer.from(MEMORY_HEADER) },
      ]);
    },
  });
}

/**
 * Save a fetched back-office dataset as JSON for later sandbox computation.
 * Each conversation gets its own folder (data/<workspace>/), so admins asking
 * at the same time never overwrite each other's files.
 */
export async function writeDataset(workspace: string, name: string, value: unknown): Promise<string> {
  const sandbox = await getAdminSandbox();
  const dir = `${DATA_DIR}/${workspace}`;
  const path = `${dir}/${name}.json`;
  await sandbox.mkDir(`${SANDBOX_HOME}/${DATA_DIR}`).catch(() => {});
  await sandbox.mkDir(`${SANDBOX_HOME}/${dir}`).catch(() => {});
  await sandbox.writeFiles([
    { path: `${SANDBOX_HOME}/${path}`, content: Buffer.from(JSON.stringify(value, null, 2)) },
  ]);
  return path;
}

/** Remove conversation folders older than a day (datasets are re-fetched anyway). */
export async function cleanupOldWorkspaces(): Promise<void> {
  const sandbox = await getAdminSandbox();
  await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      `mkdir -p ${DATA_DIR} && find ${DATA_DIR} -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + ; find ${DATA_DIR} -maxdepth 1 -type f -name '*.json' -delete`,
    ],
    cwd: SANDBOX_HOME,
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
}

function cap(text: string): { text: string; truncated: boolean } {
  return text.length > OUTPUT_LIMIT
    ? { text: `${text.slice(0, OUTPUT_LIMIT)}\n… (output truncated)`, truncated: true }
    : { text, truncated: false };
}

export type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};

/** Run a bash command in the admin sandbox (cwd = SANDBOX_HOME, 60 s limit). */
export async function runInSandbox(command: string): Promise<CommandResult> {
  const sandbox = await getAdminSandbox();
  const started = Date.now();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: SANDBOX_HOME,
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  const stdout = cap(await result.stdout());
  const stderr = cap(await result.stderr());
  return {
    command,
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    durationMs: Date.now() - started,
  };
}

/** The memory file's contents (empty string when nothing has been saved). */
export async function readMemory(): Promise<string> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: `${SANDBOX_HOME}/${MEMORY_FILE}` });
  const text = buffer ? buffer.toString("utf8") : "";
  return text.startsWith(MEMORY_HEADER) ? text.slice(MEMORY_HEADER.length).trim() : text.trim();
}

/**
 * Append one dated note to the memory file. A note already saved (same kind
 * and text, any date) isn't written twice. Returns the full memory and
 * whether anything was added.
 */
export async function appendMemory(
  kind: string,
  note: string,
  today: string,
): Promise<{ memory: string; added: boolean }> {
  const sandbox = await getAdminSandbox();
  const path = `${SANDBOX_HOME}/${MEMORY_FILE}`;
  const current = await sandbox.readFileToBuffer({ path });
  const base = current ? current.toString("utf8") : MEMORY_HEADER;
  const entry = `(${kind}) ${note.replace(/\s+/g, " ").trim()}`;
  const exists = base
    .split("\n")
    .some((l) => l.replace(/^- \[\d{4}-\d{2}-\d{2}\] /, "").toLowerCase() === entry.toLowerCase());
  const next = exists ? base : `${base}- [${today}] ${entry}\n`;
  if (!exists) {
    await sandbox.mkDir(`${SANDBOX_HOME}/memory`).catch(() => {});
    await sandbox.writeFiles([{ path, content: Buffer.from(next) }]);
  }
  return { memory: next.slice(MEMORY_HEADER.length).trim(), added: !exists };
}
