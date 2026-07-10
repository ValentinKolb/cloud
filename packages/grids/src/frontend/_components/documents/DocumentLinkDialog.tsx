import { CopyButton, dialogCore, PanelDialog, panelDialogOptions, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { CreateDocumentLinkResponse, DocumentLink, DocumentLinkTtl, DocumentRunSummary } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

export type DocumentLinkDialogArgs = {
  run: DocumentRunSummary;
  onCreated: (link: DocumentLink) => void | Promise<void>;
};

const ttlOptions: Array<{ value: DocumentLinkTtl; label: string; description: string }> = [
  { value: "1d", label: "1 day", description: "Short handoff" },
  { value: "7d", label: "7 days", description: "One week" },
  { value: "30d", label: "30 days", description: "Default" },
  { value: "90d", label: "90 days", description: "Long running" },
];

const absoluteUrl = (url: string): string => {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
};

export const openDocumentLinkDialog = (args: DocumentLinkDialogArgs) =>
  dialogCore.open<void>((close) => <DocumentLinkDialog args={args} close={close} />, panelDialogOptions);

function DocumentLinkDialog(props: { args: DocumentLinkDialogArgs; close: () => void }) {
  const [expiresIn, setExpiresIn] = createSignal<DocumentLinkTtl>("30d");
  const [comment, setComment] = createSignal("");
  const [createdUrl, setCreatedUrl] = createSignal<string | null>(null);
  const createMut = mutations.create<CreateDocumentLinkResponse, void>({
    mutation: async () => {
      const res = await apiClient.documents.runs[":runId"].links.$post({
        param: { runId: props.args.run.id },
        json: { expiresIn: expiresIn(), comment: comment().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not create document link"));
      return res.json();
    },
    onSuccess: async (created) => {
      const url = absoluteUrl(created.url);
      setCreatedUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // The visible copy button below is the fallback for locked-down browsers.
      }
      await props.args.onCreated(created.link);
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header title="Create public link" subtitle={props.args.run.filename} icon="ti ti-link" close={props.close} />
      <PanelDialog.Body>
        <Show
          when={createdUrl()}
          fallback={
            <section class="flex flex-col gap-3">
              <div>
                <p class="text-sm font-medium text-primary">Validity</p>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">
                  <For each={ttlOptions}>
                    {(option) => (
                      <button
                        type="button"
                        class={`rounded-md border px-3 py-2 text-left transition-colors ${
                          expiresIn() === option.value
                            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                            : "border-zinc-200 bg-white text-secondary hover:text-primary dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                        onClick={() => setExpiresIn(option.value)}
                      >
                        <span class="block text-sm font-medium">{option.label}</span>
                        <span class="block text-xs text-dimmed">{option.description}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <TextInput
                label="Comment"
                description="Optional internal note. It is not visible to people using the link."
                value={comment}
                onInput={setComment}
                icon="ti ti-message"
                placeholder="Why this link exists"
              />
              <div class="info-block-info text-xs">
                <i class="ti ti-shield-lock" />
                The URL works without login until it expires or is revoked. It downloads this stored document snapshot only.
              </div>
            </section>
          }
        >
          {(url) => (
            <section class="flex flex-col gap-3">
              <div class="info-block-success text-xs">
                <i class="ti ti-check" />
                Link created and copied to clipboard.
              </div>
              <code class="block break-all rounded-md bg-zinc-100 p-2 font-mono text-xs text-secondary dark:bg-zinc-900">{url()}</code>
              <div class="flex flex-wrap items-center gap-2">
                <CopyButton text={url()} label="Copy link" class="btn-input btn-sm" />
                <a href={url()} target="_blank" rel="noreferrer" class="btn-input btn-sm">
                  <i class="ti ti-external-link" />
                  Open link
                </a>
              </div>
            </section>
          )}
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={createMut.loading()}>
            {createdUrl() ? "Done" : "Cancel"}
          </button>
          <Show when={!createdUrl()}>
            <button type="button" class="btn-primary btn-sm" onClick={() => createMut.mutate(undefined)} disabled={createMut.loading()}>
              {createMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-link-plus" />}
              Create link
            </button>
          </Show>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
