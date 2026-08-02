import { Button, Placeholder, prompts, StatusBadge, toast } from "@k2b/ui";
import { type DateContext, dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

  const load = mutations.create<AttachmentLinkPage, void>({
    mutation: async (_input, context) => {
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"].$get(
        {
          param: { mailboxId: props.mailboxId },
          query: { limit: "50" },
        },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load attachment links"));
      return response.json();
    },
    onSuccess: (page) => {
      setLinks(page.items);
      setNextCursor(page.nextCursor);
    },
  });

  const loadMore = mutations.create<AttachmentLinkPage, string>({
    mutation: async (cursor, context) => {
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"].$get(
        {
          param: { mailboxId: props.mailboxId },
          query: { limit: "50", cursor },
        },
        { init: { signal: context.abortSignal } },
      );
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
    mutation: async (link, context) => {
      const confirmed = await prompts.confirm(
        `People using this link will no longer be able to download ${link.filename ?? "the attachment"}.`,
        { title: "Revoke public link?", confirmText: "Revoke link", variant: "danger" },
      );
      if (!confirmed) return "";
      const response = await apiClient.mailboxes[":mailboxId"]["attachment-links"][":linkId"].$delete(
        { param: { mailboxId: props.mailboxId, linkId: link.id } },
        { init: { signal: context.abortSignal } },
      );
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

  onMount(() => load.mutate());
  onCleanup(() => {
    load.abort();
    loadMore.abort();
    revoke.abort();
  });

  return (
    <section class="flex flex-col gap-2">
      <p class="text-xs text-dimmed">
        Public download links created from received or draft attachments. Revoking a link does not delete the attachment.
      </p>
      <Show when={!load.loading()} fallback={<Placeholder state="loading" title="Loading shared links" />}>
        <Show
          when={!load.error()}
          fallback={
            <Placeholder
              variant="panel"
              icon="ti ti-alert-triangle"
              title="Could not load shared links"
              description={load.error()?.message}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => load.mutate()}>
                  Retry
                </Button>
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
                title="No shared links"
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
                      <i class="ti ti-file-symlink shrink-0 text-dimmed" aria-hidden="true" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-primary">{link.filename ?? link.contentType}</span>
                        <span class="block text-xs text-dimmed">
                          {link.downloadCount} download{link.downloadCount === 1 ? "" : "s"}
                          {link.maxDownloads === null ? "" : ` of ${link.maxDownloads}`}
                          {link.expiresAt ? ` · expires ${dates.formatDateTime(link.expiresAt, props.dateConfig)}` : " · no expiry"}
                          {link.passwordProtected ? " · password protected" : ""}
                        </span>
                      </span>
                      <StatusBadge tone={status() === "active" ? "ok" : "neutral"} label={status()} />
                      <Show when={status() === "active"}>
                        <Button variant="ghost" size="sm" type="button" disabled={revoke.loading()} onClick={() => revoke.mutate(link)}>
                          <i class="ti ti-link-off" aria-hidden="true" /> Revoke
                        </Button>
                      </Show>
                    </div>
                  );
                }}
              </For>
              <Show when={nextCursor()}>
                {(cursor) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    class="self-start"
                    disabled={loadMore.loading()}
                    onClick={() => loadMore.mutate(cursor())}
                  >
                    {loadMore.loading() ? "Loading..." : "Load more"}
                  </Button>
                )}
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
