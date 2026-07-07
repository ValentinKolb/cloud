import { Placeholder, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import type { WorkflowRun } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

export type ScannerWorkflowOption = {
  id: string;
  name: string;
  description: string | null;
};

export type ScanWorkflowPageState = {
  initialCode: string;
  scan:
    | {
        baseName: string;
        tableName: string;
        recordId: string;
        recordLabel: string;
        workflows: ScannerWorkflowOption[];
      }
    | null;
  error: string | null;
};

export default function ScanWorkflowPage(props: { state: ScanWorkflowPageState }) {
  const [code, setCode] = createSignal(props.state.initialCode);
  const [workflowId, setWorkflowId] = createSignal(props.state.scan?.workflows[0]?.id ?? "");
  const [lastRun, setLastRun] = createSignal<WorkflowRun | null>(null);

  const openCode = () => {
    const next = code().trim();
    if (!next) return;
    const url = new URL("/app/grids/scan", window.location.origin);
    url.searchParams.set("code", next);
    window.location.href = `${url.pathname}${url.search}`;
  };

  const runMut = mutations.create<WorkflowRun, void>({
    mutation: async (_, { abortSignal }) => {
      const selectedWorkflowId = workflowId();
      const scannedCode = code().trim();
      if (!scannedCode) throw new Error("Scan a code first.");
      if (!selectedWorkflowId) throw new Error("Choose a scanner workflow first.");
      const res = await fetch(`/api/grids/workflows/${encodeURIComponent(selectedWorkflowId)}/run/scanner`, {
        method: "POST",
        signal: abortSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: scannedCode }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not run scanner workflow."));
      return res.json();
    },
    onSuccess: (run) => {
      setLastRun(run);
      toast.success(`Workflow ${run.status}`);
    },
    onError: (error) => {
      setLastRun(null);
      toast.error(error.message);
    },
  });

  return (
    <div class="flex min-h-full flex-col items-center bg-zinc-50 px-3 py-6 dark:bg-zinc-950">
      <main class="flex w-full max-w-4xl flex-col gap-3">
        <header class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
            <i class="ti ti-scan text-lg" />
          </span>
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-primary">Scan workflow</h1>
            <p class="text-sm text-dimmed">Scan a printed Grids code and run a permitted scanner workflow.</p>
          </div>
        </header>

        <form
          class="paper p-3"
          onSubmit={(event) => {
            event.preventDefault();
            openCode();
          }}
        >
          <TextInput
            label="Scan code"
            icon="ti ti-barcode"
            value={code}
            onInput={setCode}
            placeholder="Scan or paste a code..."
          />
          <div class="mt-2 flex items-center justify-end gap-2">
            <button type="submit" class="btn-input btn-sm" disabled={!code().trim()}>
              <i class="ti ti-search" />
              Resolve code
            </button>
          </div>
        </form>

        <Show when={props.state.error}>
          {(message) => (
            <div class="info-block-danger text-sm">
              <i class="ti ti-alert-triangle" />
              {message()}
            </div>
          )}
        </Show>

        <Show
          when={props.state.scan}
          fallback={
            <Placeholder surface="paper">
              {props.state.initialCode ? "This scan code could not be resolved." : "Scan a code to continue."}
            </Placeholder>
          }
        >
          {(scan) => (
            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
              <section class="paper p-3">
                <h2 class="detail-section-label">Scanned record</h2>
                <div class="mt-2 flex items-center gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-secondary dark:bg-zinc-900">
                    <i class="ti ti-database" />
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-primary">{scan().recordLabel}</p>
                    <p class="truncate text-xs text-dimmed">
                      {scan().baseName} · {scan().tableName}
                    </p>
                  </div>
                </div>
                <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <dt class="text-dimmed">Record</dt>
                  <dd class="min-w-0 truncate font-mono text-secondary">{scan().recordId}</dd>
                  <dt class="text-dimmed">Code</dt>
                  <dd class="min-w-0 truncate font-mono text-secondary">{code()}</dd>
                </dl>
              </section>

              <section class="paper p-3">
                <h2 class="detail-section-label">Workflow</h2>
                <Show
                  when={scan().workflows.length > 0}
                  fallback={<p class="mt-2 text-sm text-dimmed">No runnable scanner workflow is available for this record.</p>}
                >
                  <div class="mt-2 flex flex-col gap-2">
                    <For each={scan().workflows}>
                      {(workflow) => (
                        <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-100 p-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                          <input
                            type="radio"
                            class="mt-1"
                            checked={workflowId() === workflow.id}
                            onChange={() => setWorkflowId(workflow.id)}
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-medium text-primary">{workflow.name}</span>
                            <Show when={workflow.description}>
                              {(description) => <span class="block text-xs text-dimmed">{description()}</span>}
                            </Show>
                          </span>
                        </label>
                      )}
                    </For>
                    <button
                      type="button"
                      class="btn-primary btn-sm justify-center"
                      onClick={() => runMut.mutate(undefined)}
                      disabled={runMut.loading() || !workflowId()}
                    >
                      {runMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-player-play" />}
                      Run workflow
                    </button>
                  </div>
                </Show>
              </section>
            </div>
          )}
        </Show>

        <Show when={lastRun()}>
          {(run) => (
            <section class="paper p-3 text-sm">
              <div class="flex items-center gap-2">
                <span class={`badge ${run().status === "succeeded" ? "badge-success" : "badge-danger"}`}>{run().status}</span>
                <span class="font-mono text-xs text-secondary">{run().id}</span>
              </div>
              <Show when={run().error}>
                {(error) => <p class="mt-2 text-red-600 dark:text-red-400">{error()}</p>}
              </Show>
            </section>
          )}
        </Show>
      </main>
    </div>
  );
}
