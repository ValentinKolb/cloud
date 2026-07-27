import { ColorInput, Placeholder, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { LocalTag } from "../../service/local-tags";
import type { SavedConversationView } from "../../service/saved-views";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import { openMailSearchBuilder } from "./MailSearchBuilder";
import { summarizeMailSearchExpression } from "./mail-search-builder-model";

type OrganizationContext = MailboxSettingsContext["organization"];

function TagEditor(props: {
  tag?: LocalTag;
  loading: boolean;
  onSave: (value: { name: string; color: string }) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [name, setName] = createSignal(props.tag?.name ?? "");
  const [color, setColor] = createSignal(props.tag?.color ?? "#6b7280");
  createEffect(() => props.onDirtyChange(name() !== (props.tag?.name ?? "") || color() !== (props.tag?.color ?? "#6b7280")));
  onCleanup(() => props.onDirtyChange(false));

  return (
    <form
      class="flex flex-col gap-2 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name().trim()) props.onSave({ name: name(), color: color() });
      }}
    >
      <TextInput label="Name" placeholder="Tag name" value={name} onInput={setName} required />
      <ColorInput label="Color" value={color} onChange={setColor} />
      <div class="flex items-center gap-2">
        <button type="submit" class="btn-primary btn-sm" disabled={props.loading}>
          <i class={`ti ${props.loading ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
          {props.tag ? "Save" : "Create tag"}
        </button>
        <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function MailOrganizationSettings(props: {
  mailboxId: string;
  permission: MailboxSettingsContext["permission"];
  initial: OrganizationContext;
  onDirtyChange?: (dirty: boolean) => void;
  onWorkspaceChange: () => void;
}) {
  const [views, setViews] = createSignal(props.initial.savedViews);
  const [tags, setTags] = createSignal(props.initial.localTags);
  const [tagEditor, setTagEditor] = createSignal<LocalTag | "new" | null>(null);
  const [tagEditorDirty, setTagEditorDirty] = createSignal(false);
  const canWrite = () => props.permission === "write" || props.permission === "admin";
  let disposed = false;
  let actionController: AbortController | null = null;

  createEffect(() => props.onDirtyChange?.(tagEditorDirty()));
  onCleanup(() => {
    disposed = true;
    actionController?.abort();
    props.onDirtyChange?.(false);
  });

  const editView = async (existing?: SavedConversationView) => {
    const result = await openMailSearchBuilder({
      mailboxId: props.mailboxId,
      initialState: existing?.filter ?? null,
      initialQuery: "",
      mode: "saved_view",
      initialSavedView: existing ?? null,
      canWrite: canWrite(),
    });
    if (disposed || result?.action !== "saved") return;
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
    if (!confirmed || disposed) return;
    actionController?.abort();
    const controller = new AbortController();
    actionController = controller;
    try {
      const response = await apiClient.mailboxes[":mailboxId"]["saved-views"][":viewId"].$delete(
        {
          param: { mailboxId: props.mailboxId, viewId: view.id },
          json: { expectedRevision: view.revision },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete view"));
      if (disposed || actionController !== controller) return;
      setViews((current) => current.filter((item) => item.id !== view.id));
      props.onWorkspaceChange();
      toast.success("Saved view deleted");
    } catch (error) {
      if (!disposed && actionController === controller && !(error instanceof DOMException && error.name === "AbortError")) {
        await prompts.error(error instanceof Error ? error.message : "Failed to delete view");
      }
    } finally {
      if (actionController === controller) actionController = null;
    }
  };

  const saveTag = mutations.create<{ tag: LocalTag; edited: boolean }, { existing?: LocalTag; name: string; color: string }>({
    mutation: async ({ existing, name, color }, { abortSignal }) => {
      const response = existing
        ? await apiClient.mailboxes[":mailboxId"]["local-tags"][":tagId"].$patch(
            {
              param: { mailboxId: props.mailboxId, tagId: existing.id },
              json: { expectedRevision: existing.revision, name, color },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["local-tags"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: { name, color },
            },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save tag"));
      return { tag: await response.json(), edited: Boolean(existing) };
    },
    onSuccess: ({ tag: saved, edited }) => {
      setTags((current) => (edited ? current.map((tag) => (tag.id === saved.id ? saved : tag)) : [...current, saved]));
      setTagEditor(null);
      props.onWorkspaceChange();
      toast.success(edited ? "Tag updated" : "Tag created");
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => saveTag.abort());

  const removeTag = async (tag: LocalTag) => {
    const confirmed = await prompts.confirm(`Remove “${tag.name}” from every conversation?`, {
      title: "Delete tag?",
      confirmText: "Delete tag",
      variant: "danger",
    });
    if (!confirmed || disposed) return;
    actionController?.abort();
    const controller = new AbortController();
    actionController = controller;
    try {
      const response = await apiClient.mailboxes[":mailboxId"]["local-tags"][":tagId"].$delete(
        {
          param: { mailboxId: props.mailboxId, tagId: tag.id },
          json: { expectedRevision: tag.revision },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete tag"));
      if (disposed || actionController !== controller) return;
      setTags((current) => current.filter((item) => item.id !== tag.id));
      props.onWorkspaceChange();
      toast.success("Tag deleted");
    } catch (error) {
      if (!disposed && actionController === controller && !(error instanceof DOMException && error.name === "AbortError")) {
        await prompts.error(error instanceof Error ? error.message : "Failed to delete tag");
      }
    } finally {
      if (actionController === controller) actionController = null;
    }
  };

  return (
    <div class="flex flex-col gap-8">
      <section class="flex flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold text-primary">Saved views</h3>
            <p class="text-xs text-dimmed">Reusable folder and collaboration filters shown in the mailbox navigation.</p>
          </div>
          <button type="button" class="btn-secondary btn-sm shrink-0 whitespace-nowrap" onClick={() => void editView()}>
            <i class="ti ti-plus" aria-hidden="true" /> New view
          </button>
        </div>
        <Show
          when={views().length > 0}
          fallback={
            <Placeholder variant="panel" icon="ti ti-filter-off" title="No saved views" description="Create a private or shared view." />
          }
        >
          <div class="flex flex-col gap-1">
            <For each={views()}>
              {(view) => (
                <div class="group flex min-h-12 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
                  <i class={`ti ${view.scope === "private" ? "ti-user" : "ti-users"} text-secondary`} aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-primary">{view.name}</span>
                    <span class="block truncate text-xs text-dimmed" title={summarizeMailSearchExpression(view.filter.expression)}>
                      {view.scope === "private" ? "Only me" : "Shared with mailbox"} ·{" "}
                      {summarizeMailSearchExpression(view.filter.expression)}
                    </span>
                  </span>
                  <Show when={view.scope === "private" || canWrite()}>
                    <div class="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <button
                        type="button"
                        class="icon-btn icon-btn-sm"
                        aria-label={`Edit ${view.name}`}
                        onClick={() => void editView(view)}
                      >
                        <i class="ti ti-pencil" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn icon-btn-sm"
                        aria-label={`Delete ${view.name}`}
                        onClick={() => void removeView(view)}
                      >
                        <i class="ti ti-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={canWrite()}>
        <section class="flex flex-col gap-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold text-primary">Conversation tags</h3>
              <p class="text-xs text-dimmed">Organize conversations for your team, saved views, and automations.</p>
            </div>
            <button type="button" class="btn-secondary btn-sm" disabled={tagEditor() !== null} onClick={() => setTagEditor("new")}>
              <i class="ti ti-plus" aria-hidden="true" /> New tag
            </button>
          </div>
          <Show when={tagEditor() === "new"}>
            <TagEditor
              loading={saveTag.loading()}
              onSave={(value) => saveTag.mutate(value)}
              onCancel={() => setTagEditor(null)}
              onDirtyChange={setTagEditorDirty}
            />
          </Show>
          <Show
            when={tags().length > 0}
            fallback={<Placeholder variant="panel" icon="ti ti-tags-off" title="No tags" description="Create the first mailbox tag." />}
          >
            <For each={tags()}>
              {(tag) => (
                <Show
                  when={tagEditor() === tag}
                  fallback={
                    <div class="group/tag flex items-center gap-2 py-1">
                      <span class="h-3 w-3 shrink-0 rounded-full" style={{ "background-color": tag.color }} />
                      <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{tag.name}</span>
                      <div class="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/tag:opacity-100 sm:group-focus-within/tag:opacity-100">
                        <button
                          type="button"
                          class="icon-btn icon-btn-sm"
                          aria-label={`Edit ${tag.name}`}
                          disabled={tagEditor() !== null}
                          onClick={() => setTagEditor(tag)}
                        >
                          <i class="ti ti-pencil" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn icon-btn-sm"
                          aria-label={`Delete ${tag.name}`}
                          disabled={tagEditor() !== null}
                          onClick={() => void removeTag(tag)}
                        >
                          <i class="ti ti-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  }
                >
                  <TagEditor
                    tag={tag}
                    loading={saveTag.loading()}
                    onSave={(value) => saveTag.mutate({ existing: tag, ...value })}
                    onCancel={() => setTagEditor(null)}
                    onDirtyChange={setTagEditorDirty}
                  />
                </Show>
              )}
            </For>
          </Show>
        </section>
      </Show>
    </div>
  );
}
