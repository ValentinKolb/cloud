import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { ScriptWorkerRequest, ScriptWorkerResponse } from "./script-intelligence-protocol";

const WORKER_PATH = "/public/notebooks/script-intelligence-worker.js";
const MAX_SCRIPT_CHARS = 20_000;
const REQUEST_TIMEOUT_MS = 1_500;

type ScriptBlock = {
  from: number;
  to: number;
  code: string;
  pos: number;
};

type WorkerClient = {
  complete: (code: string, pos: number) => Promise<Completion[] | null>;
};

let workerClient: WorkerClient | null = null;
let workerAvailable = true;
let nextRequestId = 1;
let latestCompletionRequest = 0;

const scriptTextFor = (state: EditorState, from: number, to: number): string => state.sliceDoc(from, to);

const findScriptBlock = (state: EditorState, pos: number): ScriptBlock | null => {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node && node.name !== "FencedCode") node = node.parent ?? null;
  if (!node) return null;

  let isScript = false;
  let child = node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      isScript = state.sliceDoc(child.from, child.to).trim().toLowerCase() === "script";
      break;
    }
    child = child.nextSibling;
  }
  if (!isScript) return null;

  const openLine = state.doc.lineAt(node.from);
  const closeLine = state.doc.lineAt(Math.max(node.from, node.to - 1));
  const from = Math.min(openLine.to + 1, state.doc.length);
  const to = closeLine.number > openLine.number && closeLine.text.trim().startsWith("```") ? Math.max(from, closeLine.from - 1) : node.to;
  if (pos < from || pos > to) return null;
  return { from, to, code: scriptTextFor(state, from, to), pos: Math.max(0, Math.min(pos - from, to - from)) };
};

const shouldQueryTypeScript = (context: CompletionContext): boolean => {
  if (context.explicit) return true;
  const word = context.matchBefore(/[\w$]*$/);
  if (word && word.text.length >= 2) return true;
  return context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos) === ".";
};

const workerUrl = (): string => {
  const url = new URL(WORKER_PATH, window.location.origin);
  const version = new URL(import.meta.url).searchParams.get("v");
  if (version) url.searchParams.set("v", version);
  return url.toString();
};

const mapWorkerOption = (option: ScriptWorkerResponse["options"] extends (infer T)[] | null ? T : never): Completion => ({
  label: option.label,
  type: option.type as Completion["type"],
  detail: option.detail,
  boost: -20,
});

const createWorkerClient = (): WorkerClient | null => {
  if (!workerAvailable || typeof window === "undefined" || typeof Worker === "undefined") return null;

  try {
    const worker = new Worker(workerUrl(), { type: "module", name: "notebooks-script-intelligence" });
    const pending = new Map<number, (options: Completion[] | null) => void>();

    worker.onmessage = (event: MessageEvent<ScriptWorkerResponse>) => {
      const response = event.data;
      const resolve = pending.get(response.id);
      if (!resolve) return;
      pending.delete(response.id);
      resolve(response.options ? response.options.map(mapWorkerOption) : null);
    };

    worker.onerror = (event) => {
      console.warn("[notebooks] script intelligence worker unavailable", event.message);
      workerAvailable = false;
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
      worker.terminate();
      if (workerClient?.complete === client.complete) workerClient = null;
    };

    const client: WorkerClient = {
      complete: (code, pos) =>
        new Promise((resolve) => {
          const id = nextRequestId++;
          const timeout = window.setTimeout(() => {
            pending.delete(id);
            resolve(null);
          }, REQUEST_TIMEOUT_MS);

          pending.set(id, (options) => {
            window.clearTimeout(timeout);
            resolve(options);
          });

          const request: ScriptWorkerRequest = { id, type: "complete", code, pos };
          worker.postMessage(request);
        }),
    };

    return client;
  } catch (error) {
    console.warn("[notebooks] failed to start script intelligence worker", error);
    workerAvailable = false;
    return null;
  }
};

const getWorkerClient = (): WorkerClient | null => {
  workerClient ??= createWorkerClient();
  return workerClient;
};

export const createScriptTypeCompletionSource =
  (clientFactory: () => WorkerClient | null = getWorkerClient) =>
  async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!shouldQueryTypeScript(context)) return null;
    const block = findScriptBlock(context.state, context.pos);
    if (!block || block.code.length > MAX_SCRIPT_CHARS) return null;

    const client = clientFactory();
    if (!client) return null;

    const requestId = ++latestCompletionRequest;
    const options = await client.complete(block.code, block.pos);
    if (requestId !== latestCompletionRequest) return null;
    if (!options?.length) return null;

    const word = context.matchBefore(/[\w$]*$/);
    return {
      from: word ? word.from : context.pos,
      options,
      validFor: /^[\w$]*$/,
    };
  };

export const scriptTypeCompletionSource = createScriptTypeCompletionSource();

export const __testing = {
  findScriptBlock,
  shouldQueryTypeScript,
};
