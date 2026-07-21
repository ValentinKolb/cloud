import { Placeholder, prompts, toast } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { AttachmentLink, AttachmentLinkPage } from "../../contracts";
import { readApiError } from "./api-response";

const linkStatus = (link: AttachmentLink): "active" | "expired" | "exhausted" | "revoked" => {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) return "expired";
  if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads) return "exhausted";
  return "active";
};

export default function MailAttachmentLinksSettings(props: { mailboxId: string; dateConfig: DateContext }) {
  const [links, setLinks] = createSignal<AttachmentLink[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"].$get({
        param: { mailboxId: props.mailboxId },
        query: { limit: "50" },
      });
      if (!response.ok) {
        setLoadError(await readApiError(response, "Could not load attachment links"));
        return;
      }
      const page = await response.json();
      setLinks(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load attachment links");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  const loadMore = mutations.create<AttachmentLinkPage, string>({
    mutation: async (cursor) => {
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"].$get({
        param: { mailboxId: props.mailboxId },
        query: { limit: "50", cursor },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load more attachment links"));
      return response.json();
    },
    onSuccess: (page) => {
      setLinks((current) => {
        const existing = new Set(current.map((link) => link.id));
        return [...current, ...page.items.filter((link) => !existing.has(link.id))];
      });
      setNextCursor(page.nextCursor);
    },
    onError: (error) => prompts.error(error.message),
  });

  const revoke = mutations.create<string, AttachmentLink>({
    mutation: async (link) => {
      const confirmed = await prompts.confirm(
        `People using this link will no longer be able to download ${link.filename ?? "the attachment"}.`,
        { title: "Revoke public link?", confirmText: "Revoke link", variant: "danger" },
      );
      if (!confirmed) return "";
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"][":linkId"].$delete({
        param: { mailboxId: props.mailboxId, linkId: link.id },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not revoke attachment link"));
      return link.id;
    },
    onSuccess: (linkId) => {
      if (!linkId) return;
      setLinks((current) => current.map((link) => (link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link)));
      toast.success("Public link revoked");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <section class="flex flex-col gap-2">
      <div>
        <h3 class="text-sm font-semibold text-primary">Shared attachments</h3>
        <p class="text-xs text-dimmed">Public download links created from received or draft attachments.</p>
      </div>
      <Show when={!loading()} fallback={<Placeholder state="loading" title="Loading shared attachments" />}>
        <Show
          when={!loadError()}
          fallback={
            <Placeholder
              variant="panel"
              icon="ti ti-alert-triangle"
              title="Could not load shared attachments"
              description={loadError() ?? undefined}
              action={
                <button type="button" class="btn-secondary btn-sm" onClick={() => void load()}>
                  Retry
                </button>
              }
            />
          }
        >
          <Show
            when={links().length > 0}
            fallback={
              <Placeholder
                variant="panel"
                icon="ti ti-link-off"
                title="No shared attachments"
                description="Use the link button next to an attachment in a message to create one."
              />
            }
          >
            <div class="flex flex-col gap-2">
              <For each={links()}>
                {(link) => {
                  const status = () => linkStatus(link);
                  return (
                    <div class="paper flex min-w-0 items-center gap-3 p-3">
                      <i class="ti ti-file-link shrink-0 text-dimmed" aria-hidden="true" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-primary">{link.filename ?? link.contentType}</span>
                        <span class="block text-xs text-dimmed">
                          {link.downloadCount} download{link.downloadCount === 1 ? "" : "s"}
                          {link.maxDownloads === null ? "" : ` of ${link.maxDownloads}`}
                          {link.expiresAt ? ` · expires ${dates.formatDateTime(link.expiresAt, props.dateConfig)}` : " · no expiry"}
                          {link.passwordProtected ? " · password protected" : ""}
                        </span>
                      </span>
                      <span class={`badge badge-sm ${status() === "active" ? "badge-success" : "badge-neutral"}`}>{status()}</span>
                      <Show when={status() === "active"}>
                        <button type="button" class="btn-simple btn-sm" disabled={revoke.loading()} onClick={() => revoke.mutate(link)}>
                          <i class="ti ti-link-off" aria-hidden="true" /> Revoke
                        </button>
                      </Show>
                    </div>
                  );
                }}
              </For>
              <Show when={nextCursor()}>
                {(cursor) => (
                  <button
                    type="button"
                    class="btn-secondary btn-sm self-start"
                    disabled={loadMore.loading()}
                    onClick={() => loadMore.mutate(cursor())}
                  >
                    {loadMore.loading() ? "Loading..." : "Load more"}
                  </button>
                )}
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
