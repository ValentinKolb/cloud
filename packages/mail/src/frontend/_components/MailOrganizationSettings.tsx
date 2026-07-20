import { Placeholder, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { LocalTag } from "../../service/local-tags";
import type { SavedConversationView } from "../../service/saved-views";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import { openMailSearchBuilder } from "./MailSearchBuilder";
import { summarizeMailSearchExpression } from "./mail-search-builder-model";

type OrganizationContext = MailboxSettingsContext["organization"];

export default function MailOrganizationSettings(props: {
  mailboxId: string;
  permission: MailboxSettingsContext["permission"];
  initial: OrganizationContext;
  onWorkspaceChange: () => void;
}) {
  const [views, setViews] = createSignal(props.initial.savedViews);
  const [tags, setTags] = createSignal(props.initial.localTags);
  const canWrite = () => props.permission === "write" || props.permission === "admin";

  const editView = async (existing?: SavedConversationView) => {
    const result = await openMailSearchBuilder({
      mailboxId: props.mailboxId,
      initialState: existing?.filter ?? null,
      initialQuery: "",
      mode: "saved_view",
      initialSavedView: existing ?? null,
      canWrite: canWrite(),
    });
    if (result?.action !== "saved") return;
    const saved = result.view;
    setViews((current) => (existing ? current.map((view) => (view.id === saved.id ? saved : view)) : [...current, saved]));
    props.onWorkspaceChange();
  };

  const removeView = async (view: SavedConversationView) => {
    const confirmed = await prompts.confirm(`Remove “${view.name}” from the mailbox navigation?`, {
      title: "Delete saved view?",
      confirmText: "Delete view",
      variant: "danger",
    });
    if (!confirmed) return;
    const response = await apiClient.mailboxes[":mailboxId"]["saved-views"][":viewId"].$delete({
      param: { mailboxId: props.mailboxId, viewId: view.id },
      json: { expectedRevision: view.revision },
    });
    if (!response.ok) return prompts.error(await readApiError(response, "Failed to delete view"));
    setViews((current) => current.filter((item) => item.id !== view.id));
    props.onWorkspaceChange();
    toast.success("Saved view deleted");
  };

  const saveTag = mutations.create<{ tag: LocalTag; edited: boolean }, { existing?: LocalTag; name: string }>({
    mutation: async ({ existing, name }) => {
      const response = existing
        ? await apiClient.mailboxes[":mailboxId"]["local-tags"][":tagId"].$patch({
            param: { mailboxId: props.mailboxId, tagId: existing.id },
            json: { expectedRevision: existing.revision, name },
          })
        : await apiClient.mailboxes[":mailboxId"]["local-tags"].$post({
            param: { mailboxId: props.mailboxId },
            json: { name },
          });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save tag"));
      return { tag: await response.json(), edited: Boolean(existing) };
    },
    onSuccess: ({ tag: saved, edited }) => {
      setTags((current) => (edited ? current.map((tag) => (tag.id === saved.id ? saved : tag)) : [...current, saved]));
      props.onWorkspaceChange();
      toast.success(edited ? "Tag renamed" : "Tag created");
    },
    onError: (error) => prompts.error(error.message),
  });

  const editTag = async (existing?: LocalTag) => {
    const values = await prompts.form({
      title: existing ? "Rename tag" : "New tag",
      fields: { name: { type: "text", label: "Name", default: existing?.name ?? "", required: true } },
      confirmText: existing ? "Rename tag" : "Create tag",
    });
    if (values) saveTag.mutate({ existing, name: values.name });
  };

  const removeTag = async (tag: LocalTag) => {
    const confirmed = await prompts.confirm(`Remove “${tag.name}” from every conversation?`, {
      title: "Delete tag?",
      confirmText: "Delete tag",
      variant: "danger",
    });
    if (!confirmed) return;
    const response = await apiClient.mailboxes[":mailboxId"]["local-tags"][":tagId"].$delete({
      param: { mailboxId: props.mailboxId, tagId: tag.id },
      json: { expectedRevision: tag.revision },
    });
    if (!response.ok) return prompts.error(await readApiError(response, "Failed to delete tag"));
    setTags((current) => current.filter((item) => item.id !== tag.id));
    props.onWorkspaceChange();
    toast.success("Tag deleted");
  };

  return (
    <div class="flex flex-col gap-2">
      <section class="flex flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold text-primary">Saved views</h3>
            <p class="text-xs text-dimmed">Reusable folder and collaboration filters shown in the mailbox navigation.</p>
          </div>
          <button type="button" class="btn-primary btn-sm shrink-0 whitespace-nowrap" onClick={() => void editView()}>
            <i class="ti ti-plus" aria-hidden="true" /> New view
          </button>
        </div>
        <Show
          when={views().length > 0}
          fallback={
            <Placeholder variant="panel" icon="ti ti-filter-off" title="No saved views" description="Create a private or shared view." />
          }
        >
          <For each={views()}>
            {(view) => (
              <div class="paper flex items-center gap-3 p-3">
                <i class={`ti ${view.scope === "private" ? "ti-user" : "ti-users"} text-dimmed`} aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-primary">{view.name}</span>
                  <span class="block text-xs text-dimmed">{view.scope === "private" ? "Only me" : "Shared with mailbox"}</span>
                  <span class="block truncate text-xs text-dimmed" title={summarizeMailSearchExpression(view.filter.expression)}>
                    {summarizeMailSearchExpression(view.filter.expression)}
                  </span>
                </span>
                <Show when={view.scope === "private" || canWrite()}>
                  <button type="button" class="btn-simple btn-sm" onClick={() => void editView(view)}>
                    <i class="ti ti-pencil" aria-hidden="true" /> Edit
                  </button>
                  <button type="button" class="icon-btn" aria-label={`Delete ${view.name}`} onClick={() => void removeView(view)}>
                    <i class="ti ti-trash" aria-hidden="true" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </section>

      <Show when={canWrite()}>
        <section class="flex flex-col gap-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold text-primary">Conversation tags</h3>
              <p class="text-xs text-dimmed">Mailbox-local labels used by people, search, and automations.</p>
            </div>
            <button type="button" class="btn-secondary btn-sm" onClick={() => void editTag()}>
              <i class="ti ti-plus" aria-hidden="true" /> New tag
            </button>
          </div>
          <Show
            when={tags().length > 0}
            fallback={<Placeholder variant="panel" icon="ti ti-tags-off" title="No tags" description="Create the first mailbox tag." />}
          >
            <For each={tags()}>
              {(tag) => (
                <div class="paper flex items-center gap-3 p-3">
                  <i class="ti ti-tag text-dimmed" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{tag.name}</span>
                  <button type="button" class="btn-simple btn-sm" onClick={() => void editTag(tag)}>
                    <i class="ti ti-pencil" aria-hidden="true" /> Rename
                  </button>
                  <button type="button" class="icon-btn" aria-label={`Delete ${tag.name}`} onClick={() => void removeTag(tag)}>
                    <i class="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </section>
      </Show>
    </div>
  );
}
