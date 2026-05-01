import { createSignal, For, Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { CreateContactInput } from "../../service";
import { resolveContactName } from "../../shared";

type Props = {
  bookId: string;
  /** Show the Import button. Read-only users see only Export. */
  canWrite: boolean;
};

type ImportCandidate = {
  candidate: CreateContactInput;
  match: { existingId: string; existingName: string } | null;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const errorMessage = async (res: Response, fallback: string) => {
  try {
    const data = (await res.json()) as unknown;
    if (isObject(data) && typeof data["message"] === "string" && data["message"].length > 0) {
      return data["message"];
    }
  } catch {}
  return fallback;
};

/** Inline preview + commit for a vCard import. Lives inside a prompts.dialog. */
function ImportDialog(props: { bookId: string; close: (created: number) => void }) {
  const [stage, setStage] = createSignal<"upload" | "preview" | "committing">("upload");
  const [filename, setFilename] = createSignal<string>("");
  const [candidates, setCandidates] = createSignal<ImportCandidate[]>([]);
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  const previewMutation = mutations.create<ImportCandidate[], string>({
    mutation: async (content) => {
      const res = await apiClient.books[":bookId"].import.preview.$post({
        param: { bookId: props.bookId },
        json: { format: "vcard", content },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to parse vCard"));
      const data = (await res.json()) as { candidates: ImportCandidate[] };
      return data.candidates;
    },
    onSuccess: (parsed) => {
      setCandidates(parsed);
      // Default selection: every candidate that does NOT already match a known
      // contact. The user can flip the checkbox to import duplicates anyway.
      setSelected(new Set<number>(parsed.flatMap((c, i) => (c.match ? [] : [i]))));
      setStage("preview");
    },
    onError: (error) => prompts.error(error.message),
  });

  const commitMutation = mutations.create<{ created: number; failures: string[] }, ImportCandidate[]>({
    mutation: async (chosen) => {
      const res = await apiClient.books[":bookId"].import.commit.$post({
        param: { bookId: props.bookId },
        json: { contacts: chosen.map((c) => c.candidate) },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to import contacts"));
      return (await res.json()) as { created: number; failures: string[] };
    },
    onSuccess: (result) => {
      if (result.failures.length > 0) {
        prompts.error(`Imported ${result.created}, ${result.failures.length} failed: ${result.failures[0]}`);
      }
      props.close(result.created);
    },
    onError: (error) => {
      prompts.error(error.message);
      setStage("preview");
    },
  });

  const handleFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      previewMutation.mutate(content);
    };
    reader.readAsText(file);
  };

  const toggleIndex = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set<number>(candidates().map((_, i) => i)));
  const selectNone = () => setSelected(new Set<number>());

  const submit = () => {
    const chosen = candidates().filter((_, i) => selected().has(i));
    if (chosen.length === 0) {
      prompts.error("Pick at least one contact to import");
      return;
    }
    setStage("committing");
    commitMutation.mutate(chosen);
  };

  return (
    <div class="flex flex-col gap-3">
      <Show when={stage() === "upload"}>
        <p class="text-xs text-dimmed">
          Upload a vCard file (.vcf). Multiple contacts in one file are supported. After upload you'll see a preview where you can pick which contacts to import.
        </p>
        <label class="paper flex cursor-pointer flex-col items-center gap-2 px-6 py-8 text-sm text-dimmed transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
          <i class="ti ti-upload text-2xl" />
          <span>{previewMutation.loading() ? "Reading…" : "Click to choose a .vcf file"}</span>
          <input type="file" accept=".vcf,text/vcard" class="hidden" onChange={handleFileChange} />
        </label>
      </Show>

      <Show when={stage() === "preview"}>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-dimmed">
            {filename()} — {candidates().length} contact{candidates().length === 1 ? "" : "s"} found
          </span>
          <div class="flex items-center gap-1">
            <button type="button" class="btn-simple btn-sm text-xs text-dimmed hover:text-primary" onClick={selectAll}>
              Select all
            </button>
            <button type="button" class="btn-simple btn-sm text-xs text-dimmed hover:text-primary" onClick={selectNone}>
              Select none
            </button>
          </div>
        </div>
        <ul class="flex max-h-96 flex-col gap-1 overflow-y-auto">
          <For each={candidates()}>
            {(item, index) => (
              <li>
                <label class="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <input
                    type="checkbox"
                    checked={selected().has(index())}
                    onChange={() => toggleIndex(index())}
                    class="sr-only peer"
                  />
                  <div
                    aria-hidden="true"
                    class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 border-zinc-300 transition-colors peer-checked:border-blue-500 peer-checked:bg-blue-500 peer-checked:text-white dark:border-zinc-600"
                  >
                    <Show when={selected().has(index())}>
                      <i class="ti ti-check text-[10px]" />
                    </Show>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm text-primary">
                      {resolveContactName(item.candidate as Parameters<typeof resolveContactName>[0]) || "Unnamed"}
                    </div>
                    <div class="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-dimmed">
                      <Show when={item.candidate.companyName}>
                        <span>{item.candidate.companyName}</span>
                      </Show>
                      <Show when={(item.candidate.emails ?? []).length > 0}>
                        <span>{item.candidate.emails?.[0]?.email}</span>
                      </Show>
                      <Show when={(item.candidate.phones ?? []).length > 0}>
                        <span>{item.candidate.phones?.[0]?.phone}</span>
                      </Show>
                    </div>
                    <Show when={item.match}>
                      {(match) => (
                        <div class="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <i class="ti ti-alert-circle text-[10px]" />
                          Already exists as „{match().existingName}"
                        </div>
                      )}
                    </Show>
                  </div>
                </label>
              </li>
            )}
          </For>
        </ul>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="btn-secondary btn-sm"
            onClick={() => {
              setStage("upload");
              setCandidates([]);
              setSelected(new Set<number>());
            }}
          >
            Back
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={submit}
            disabled={selected().size === 0 || commitMutation.loading()}
          >
            <Show when={commitMutation.loading()} fallback={<i class="ti ti-check" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            Import {selected().size} contact{selected().size === 1 ? "" : "s"}
          </button>
        </div>
      </Show>

      <Show when={stage() === "committing"}>
        <div class="flex items-center justify-center gap-2 py-8 text-sm text-dimmed">
          <i class="ti ti-loader-2 animate-spin" /> Importing…
        </div>
      </Show>
    </div>
  );
}

export default function BookActions(props: Props) {
  const openImport = async () => {
    const created = await prompts.dialog<number>(
      (close) => <ImportDialog bookId={props.bookId} close={close} />,
      { title: "Import contacts", icon: "ti ti-upload", size: "large" },
    );
    if (created && created > 0) {
      refreshCurrentPath();
    }
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <Show when={props.canWrite}>
        <button
          type="button"
          class="btn-secondary btn-sm"
          onClick={openImport}
          title="Import contacts from a vCard file"
        >
          <i class="ti ti-upload" /> Import vCard
        </button>
      </Show>
      <a
        href={`/api/contacts/books/${props.bookId}/export.vcf`}
        class="btn-secondary btn-sm"
        title="Export as vCard"
      >
        <i class="ti ti-address-book" /> Export vCard
      </a>
      <a
        href={`/api/contacts/books/${props.bookId}/export.csv`}
        class="btn-secondary btn-sm"
        title="Export as CSV"
      >
        <i class="ti ti-file-type-csv" /> Export CSV
      </a>
    </div>
  );
}
