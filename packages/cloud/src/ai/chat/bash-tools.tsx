import { fileIcons } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import { formatAiFileSize } from "../attachments";
import type { AiTurnBlock } from "../protocol";
import { useAiMessageActions } from "./message-actions";
import { isRecord } from "./message-utils";
import { ChatUtilityDisclosure, ChatUtilityLine, PulseDots } from "./primitives";

type ToolBlock = Extract<AiTurnBlock, { kind: "tool" }>;

const bashCommand = (args: unknown): string => (isRecord(args) && typeof args.command === "string" ? args.command : "");

type BashFileDiff = { created: string[]; updated: string[]; deleted: string[] };
type BashResult = { stdout: string; stderr: string; exitCode: number; files?: BashFileDiff };

const toStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);

const bashResult = (result: unknown): BashResult | null => {
  if (!isRecord(result) || typeof result.exitCode !== "number") return null;
  const files = isRecord(result.files)
    ? { created: toStringArray(result.files.created), updated: toStringArray(result.files.updated), deleted: toStringArray(result.files.deleted) }
    : undefined;
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), exitCode: result.exitCode, files };
};

const firstLine = (text: string): string => text.split("\n").find((line) => line.trim())?.trim() ?? "";

/** First line that says something — skips separators like "---" or "===" (frontmatter, rules). */
const firstMeaningfulLine = (text: string): string =>
  text
    .split("\n")
    .find((line) => /[\p{L}\p{N}]/u.test(line))
    ?.trim() ?? "";

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

/** "+report.csv ~sum.txt" — compact created/updated/deleted marker list, capped. */
const fileDiffSummary = (files: BashFileDiff | undefined): string => {
  if (!files) return "";
  const marked = [
    ...files.created.map((path) => `+${baseName(path)}`),
    ...files.updated.map((path) => `~${baseName(path)}`),
    ...files.deleted.map((path) => `−${baseName(path)}`),
  ];
  if (marked.length === 0) return "";
  return marked.length > 3 ? `${marked.slice(0, 3).join(" ")} +${marked.length - 3} more` : marked.join(" ");
};

/** Collapsed-row description: what ran, and what came of it. */
const bashSummary = (command: string, result: BashResult | null): string => {
  const head = firstLine(command);
  if (!result) return head;
  const outcome =
    result.exitCode !== 0
      ? `exit ${result.exitCode}${firstMeaningfulLine(result.stderr) ? ` · ${firstMeaningfulLine(result.stderr)}` : ""}`
      : fileDiffSummary(result.files) || firstMeaningfulLine(result.stdout);
  return outcome ? `${head} → ${outcome}` : head;
};

/** Terminal-style disclosure for the sandboxed bash tool. */
export function BashToolBlock(props: { block: ToolBlock }) {
  const command = () => bashCommand(props.block.args);
  const result = () => bashResult(props.block.result);
  const running = () => props.block.status === "running";
  const failed = () => Boolean(props.block.isError) || (result()?.exitCode ?? 0) !== 0;

  return (
    <Show
      when={!running()}
      fallback={
        <ChatUtilityLine
          meta={{ icon: "ti ti-terminal-2", label: "bash", description: firstLine(command()) || undefined }}
          trailing={<PulseDots />}
        />
      }
    >
      <ChatUtilityDisclosure
        meta={{
          icon: "ti ti-terminal-2",
          label: "bash",
          description: bashSummary(command(), result()) || undefined,
          tone: failed() ? "danger" : "neutral",
        }}
      >
        <div class="max-w-xl overflow-hidden rounded-md bg-zinc-950 font-mono text-[11px] leading-5 text-zinc-100 [box-shadow:var(--theme-recess)] dark:bg-black/60">
          <div class="max-h-72 overflow-auto p-2.5">
            <pre class="whitespace-pre-wrap text-cyan-300">
              {command()
                .split("\n")
                .map((line, index) => (index === 0 ? `$ ${line}` : `  ${line}`))
                .join("\n")}
            </pre>
            <Show when={result()}>
              {(bash) => (
                <>
                  <Show when={bash().stdout}>
                    <pre class="mt-1.5 whitespace-pre-wrap text-zinc-100">{bash().stdout}</pre>
                  </Show>
                  <Show when={bash().stderr}>
                    <pre class="mt-1.5 whitespace-pre-wrap text-red-300">{bash().stderr}</pre>
                  </Show>
                  <Show when={bash().exitCode !== 0}>
                    <p class="mt-1.5 text-red-300">exit {bash().exitCode}</p>
                  </Show>
                  <Show when={fileDiffSummary(bash().files)}>
                    <p class="mt-1.5 text-zinc-500">files: {fileDiffSummary(bash().files)}</p>
                  </Show>
                </>
              )}
            </Show>
            <Show when={!result() && props.block.isError}>
              <pre class="mt-1.5 whitespace-pre-wrap text-red-300">{String(props.block.result ?? "Tool failed")}</pre>
            </Show>
          </div>
        </div>
      </ChatUtilityDisclosure>
    </Show>
  );
}

type PresentResult = { path: string; size: number; mediaType: string };

const presentResult = (block: ToolBlock): PresentResult | null => {
  if (isRecord(block.result) && typeof block.result.path === "string") {
    return { path: block.result.path, size: Number(block.result.size ?? 0), mediaType: String(block.result.mediaType ?? "") };
  }
  if (isRecord(block.args) && typeof block.args.path === "string") {
    return { path: block.args.path, size: 0, mediaType: "" };
  }
  return null;
};

/** File handed to the user from the conversation VFS — a quiet row, matching the other tool rows. */
export function PresentToolBlock(props: { block: ToolBlock }) {
  const actions = useAiMessageActions();
  const file = () => presentResult(props.block);
  const title = () => (isRecord(props.block.args) && typeof props.block.args.title === "string" ? props.block.args.title : null);
  const name = () => {
    const path = file()?.path ?? "";
    return path.slice(path.lastIndexOf("/") + 1) || path;
  };
  const icon = () => fileIcons.getFileIcon({ name: name(), type: "file", mimeType: file()?.mediaType || "application/octet-stream" });
  const href = () => (file() ? (actions.fileUrl?.(file()!.path) ?? null) : null);

  return (
    <Show
      when={file() && !props.block.isError}
      fallback={
        <Show when={props.block.status === "running"}>
          <ChatUtilityLine meta={{ icon: "ti ti-file-export", label: "Preparing file" }} trailing={<PulseDots />} />
        </Show>
      }
    >
      <div class="inline-flex min-h-7 max-w-full items-center gap-1.5 py-1 text-xs leading-none text-dimmed">
        <i class={`ti ${icon()} shrink-0 text-base leading-none`} aria-hidden="true" />
        <span class="min-w-0 truncate font-medium text-secondary" title={file()!.path}>
          {title() ?? name()}
        </span>
        <Show when={title()}>
          <span class="min-w-0 truncate">{name()}</span>
        </Show>
        <Show when={file()!.size > 0}>
          <span class="shrink-0">{formatAiFileSize(file()!.size)}</span>
        </Show>
        <Show when={href()}>
          {(downloadHref) => (
            <a
              class="inline-flex shrink-0 items-center gap-1 font-medium text-secondary underline-offset-2 transition-colors hover:text-primary hover:underline"
              href={downloadHref()}
              download={name()}
              title={`Download ${name()}`}
            >
              <i class="ti ti-download text-sm leading-none" aria-hidden="true" />
              Download
            </a>
          )}
        </Show>
      </div>
    </Show>
  );
}
