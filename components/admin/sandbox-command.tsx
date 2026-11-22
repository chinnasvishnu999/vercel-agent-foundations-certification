import { AlertCircle, CheckCircle2, Loader2, Terminal } from "lucide-react";

import type { AdminToolPart } from "@/components/admin/admin-tool-result";

type BashOutput = {
  status: "ok" | "failed";
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};

/** A sandbox command in the admin chat: running, finished (with output) or failed. */
export function SandboxCommand({ part }: { part: AdminToolPart }) {
  const input = (part as { input?: { command?: string } }).input;
  const command = input?.command ?? "";
  const running = part.state === "input-streaming" || part.state === "input-available";
  const output = part.state === "output-available" ? (part.output as BashOutput) : null;
  const failed = part.state === "output-error" || output?.status === "failed";

  return (
    <figure
      className="overflow-hidden rounded-md border border-border bg-muted/40 text-xs"
      aria-label="Sandbox command"
    >
      <figcaption className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Terminal className="size-3.5" aria-hidden="true" />
          Vercel Sandbox
        </span>
        <span role="status" className="flex items-center gap-1">
          {running && (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Running…
            </>
          )}
          {!running && failed && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="size-3.5" aria-hidden="true" />
              {part.state === "output-error" ? "Sandbox unavailable" : `Failed (exit ${output?.exitCode})`}
            </span>
          )}
          {!running && !failed && output && (
            <>
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Done in {(output.durationMs / 1000).toFixed(1)} s
            </>
          )}
        </span>
      </figcaption>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all px-2 py-1.5 font-mono text-[11px] text-foreground">
        <span className="select-none text-muted-foreground">$ </span>
        {command}
      </pre>
      {output && (output.stdout || output.stderr) && (
        <pre
          className="max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-border bg-background px-2 py-1.5 font-mono text-[11px]"
          aria-label="Command output"
        >
          {output.stdout}
          {output.stderr && <span className="text-destructive">{output.stderr}</span>}
        </pre>
      )}
      {part.state === "output-error" && (
        <p className="border-t border-border px-2 py-1.5 text-destructive">
          The sandbox couldn&apos;t run this command after retries.
        </p>
      )}
    </figure>
  );
}
