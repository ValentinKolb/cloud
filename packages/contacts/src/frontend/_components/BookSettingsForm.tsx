import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  confirmDiscardIfDirty,
  prompts,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
  TagEditor,
  TextInput,
  toast,
} from "@k2b/ui";
import { type GrantableLevel, PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, Principal } from "@valentinkolb/cloud/contracts";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactBook, ContactTag } from "../../service";
import { readErrorMessage } from "./api";
import BookActions from "./BookActions";
import type { BookSettingsContext } from "./BookSettingsDialog";
import { createBlockedReconciliation, createQueuedReconciliation, settingsInteractionBlocked } from "./book-settings-reconcile";
import DeleteBookButton from "./DeleteBookButton";

type Props = {
  context: () => BookSettingsContext;
  initialTab?: string;
  onClose: () => void;
  onDeleted: () => void;
  onWorkspaceChange: () => void;
  onReconcile: () => Promise<void>;
};

/** Contact book settings for book administrators. */
export default function BookSettingsForm(props: Props) {
  const bookId = () => props.context().book.id;
  const [activeTab, setActiveTab] = createSignal(props.initialTab ?? "general");
  const [savedName, setSavedName] = createSignal(props.context().book.name);
  const [savedDescription, setSavedDescription] = createSignal(props.context().book.description ?? "");
  const [name, setName] = createSignal(savedName());
  const [description, setDescription] = createSignal(savedDescription());
  const [tagEditorDirty, setTagEditorDirty] = createSignal(false);
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const [settingsReconciling, setSettingsReconciling] = createSignal(false);
  const [ownerRequestCount, setOwnerRequestCount] = createSignal(0);
  const [deleteBookPending, setDeleteBookPending] = createSignal(false);
  const [tagReconcileError, setTagReconcileError] = createSignal<string | null>(null);
  const [tagReconciling, setTagReconciling] = createSignal(false);
  let deleteTagConfirming = false;
  let navigationPromptPending = false;
  let disposed = false;

  const nameChanged = () => name() !== savedName();
  const descriptionChanged = () => description() !== savedDescription();
  const changeCount = () => Number(nameChanged()) + Number(descriptionChanged());
  const nameError = () => (name().trim() ? undefined : "Book name is required");
  const discardMetadata = () => {
    setName(savedName());
    setDescription(savedDescription());
  };

  const settingsCoverage = createQueuedReconciliation(props.onReconcile, (state) => {
    setSettingsReconciling(state.reconciling);
    setReconcileError(state.error);
  });
  const reconcile = settingsCoverage.run;
  const coverageBlocked = () => settingsReconciling() || reconcileError() !== null;

  const updateMutation = mutations.create<ContactBook, { bookId: string; name: string; description: string | null }>({
    mutation: async (input, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].$patch(
        {
          param: { bookId: input.bookId },
          json: { name: input.name, description: input.description },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update book"));
      return response.json();
    },
    onSuccess: (book) => {
      const nextDescription = book.description ?? "";
      setName(book.name);
      setDescription(nextDescription);
      setSavedName(book.name);
      setSavedDescription(nextDescription);
      props.onWorkspaceChange();
      toast.success("Book settings saved");
      reconcile("The change was saved, but contact book settings could not be reloaded.");
    },
    onError: (error) => prompts.error(error.message),
  });
  const saveMetadata = () => {
    if (disposed || settingsBusy()) return;
    const trimmedName = name().trim();
    if (!trimmedName) return;
    void updateMutation.mutate({ bookId: bookId(), name: trimmedName, description: description().trim() || null });
  };

  type TagValue = { name: string; color: string };
  const createTagMutation = mutations.create<ContactTag, { bookId: string; value: TagValue }>({
    mutation: async (input, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].tags.$post(
        { param: { bookId: input.bookId }, json: input.value },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create tag"));
      return response.json();
    },
  });

  const updateTagMutation = mutations.create<ContactTag, { bookId: string; tagId: string; value: TagValue }>({
    mutation: async (input, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].tags[":tagId"].$patch(
        { param: { bookId: input.bookId, tagId: input.tagId }, json: input.value },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update tag"));
      return response.json();
    },
  });

  const deleteTagMutation = mutations.create<void, { bookId: string; tagId: string }>({
    mutation: async (input, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].tags[":tagId"].$delete(
        { param: { bookId: input.bookId, tagId: input.tagId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete tag"));
    },
  });
  const tagOperationPending = () =>
    createTagMutation.loading() ||
    updateTagMutation.loading() ||
    deleteTagMutation.loading() ||
    tagReconciling() ||
    tagReconcileError() !== null;

  const tagCoverage = createBlockedReconciliation(props.onReconcile, (state) => {
    setTagReconciling(state.reconciling);
    setTagReconcileError(state.error);
  });

  const completeTagWrite = async (successMessage: string, failureMessage: string) => {
    props.onWorkspaceChange();
    await tagCoverage.run(failureMessage);
    if (!disposed) toast.success(successMessage);
  };

  const createTag = async (value: TagValue) => {
    if (disposed || settingsBusy()) return;
    await createTagMutation.mutate({ bookId: bookId(), value: { ...value } });
    if (disposed) return;
    if (createTagMutation.error()) throw createTagMutation.error();
    await completeTagWrite("Tag created", "The tag was created, but the tag list could not be reloaded.");
  };
  const updateTag = async (tag: ContactTag, value: TagValue) => {
    if (disposed || settingsBusy()) return;
    await updateTagMutation.mutate({ bookId: bookId(), tagId: tag.id, value: { ...value } });
    if (disposed) return;
    if (updateTagMutation.error()) throw updateTagMutation.error();
    await completeTagWrite("Tag updated", "The tag was updated, but the tag list could not be reloaded.");
  };

  const deleteTag = async (tag: ContactTag) => {
    if (disposed || settingsBusy()) return;
    deleteTagConfirming = true;
    try {
      const confirmed = await prompts.confirm(`Delete "${tag.name}"? It will be removed from all contacts in this book.`, {
        title: "Delete tag",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed || disposed) return;

      await deleteTagMutation.mutate({ bookId: bookId(), tagId: tag.id });
      if (disposed) return;
      if (deleteTagMutation.error()) throw deleteTagMutation.error();
      await completeTagWrite("Tag deleted", "The tag was deleted, but the tag list could not be reloaded.");
    } finally {
      deleteTagConfirming = false;
    }
  };

  const requestControllers = new Set<AbortController>();
  const runRequest = async <T,>(request: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (disposed) throw new DOMException("Contact book settings were closed", "AbortError");
    if (settingsBusy()) throw new Error("Another contact book settings change is still in progress");
    const controller = new AbortController();
    requestControllers.add(controller);
    setOwnerRequestCount((count) => count + 1);
    try {
      const result = await request(controller.signal);
      if (disposed) throw new DOMException("Contact book settings were closed", "AbortError");
      return result;
    } finally {
      requestControllers.delete(controller);
      if (!disposed) setOwnerRequestCount((count) => Math.max(0, count - 1));
    }
  };

  const grantAccess = async (input: { bookId: string; principal: Principal; permission: GrantableLevel }): Promise<AccessEntry> => {
    const created = await runRequest(async (abortSignal) => {
      const response = await apiClient.books[":bookId"].access.$post(
        { param: { bookId: input.bookId }, json: { principal: input.principal, permission: input.permission } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access"));
      return response.json();
    });
    props.onWorkspaceChange();
    reconcile("Access was granted, but the permission list could not be reloaded.");
    return created;
  };
  const updateAccess = async (input: { bookId: string; accessId: string; permission: GrantableLevel }): Promise<void> => {
    await runRequest(async (abortSignal) => {
      const response = await apiClient.books[":bookId"].access[":accessId"].$patch(
        { param: { bookId: input.bookId, accessId: input.accessId }, json: { permission: input.permission } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access"));
    });
    props.onWorkspaceChange();
    reconcile("Access was updated, but the permission list could not be reloaded.");
  };
  const revokeAccess = async (input: { bookId: string; accessId: string }): Promise<void> => {
    await runRequest(async (abortSignal) => {
      const response = await apiClient.books[":bookId"].access[":accessId"].$delete(
        { param: { bookId: input.bookId, accessId: input.accessId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access"));
    });
    props.onWorkspaceChange();
    reconcile("Access was revoked, but the permission list could not be reloaded.");
  };

  type CreateApiKeyInput = { name: string; expiresAt: string | null; permission: GrantableLevel };
  const createApiKey = async (input: {
    bookId: string;
    value: CreateApiKeyInput;
  }): Promise<{ credential: ResourceApiKey; token: string }> => {
    const created = await runRequest(async (abortSignal) => {
      const response = await apiClient.books[":bookId"]["api-keys"].$post(
        { param: { bookId: input.bookId }, json: input.value },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create API key"));
      return response.json();
    });
    props.onWorkspaceChange();
    reconcile("The API key was created, but the API key list could not be reloaded.");
    return created;
  };
  const revokeApiKey = async (input: { bookId: string; credentialId: string }): Promise<void> => {
    await runRequest(async (abortSignal) => {
      const response = await apiClient.books[":bookId"]["api-keys"][":credentialId"].$delete(
        { param: { bookId: input.bookId, credentialId: input.credentialId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke API key"));
    });
    props.onWorkspaceChange();
    reconcile("The API key was revoked, but the API key list could not be reloaded.");
  };

  onCleanup(() => {
    disposed = true;
    updateMutation.abort();
    createTagMutation.abort();
    updateTagMutation.abort();
    deleteTagMutation.abort();
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
    tagCoverage.dispose();
    settingsCoverage.dispose();
  });

  const settingsActivityBlocked = () =>
    settingsInteractionBlocked({
      writePending: updateMutation.loading() || ownerRequestCount() > 0 || tagOperationPending() || deleteTagConfirming,
      childWritePending: deleteBookPending(),
      coveragePending: settingsReconciling(),
      coverageError: reconcileError() !== null,
    });
  const settingsBusy = () => navigationPromptPending || settingsActivityBlocked();

  const requestTabChange = async (nextTab: string) => {
    if (nextTab === activeTab()) return;
    if (settingsBusy()) return;
    navigationPromptPending = true;
    try {
      if (!(await confirmDiscardIfDirty(tagEditorDirty))) return;
      if (disposed || settingsActivityBlocked()) return;
      setActiveTab(nextTab);
    } finally {
      navigationPromptPending = false;
    }
  };

  const requestClose = async () => {
    if (settingsBusy()) return;
    navigationPromptPending = true;
    try {
      if (!(await confirmDiscardIfDirty(() => changeCount() > 0 || tagEditorDirty()))) return;
      if (disposed || settingsActivityBlocked()) return;
      props.onClose();
    } finally {
      navigationPromptPending = false;
    }
  };

  return (
    <SettingsModal
      title="Contact book settings"
      activeTab={activeTab()}
      onTabChange={(tab) => void requestTabChange(tab)}
      onClose={() => void requestClose()}
      closeLabel="Close settings"
    >
      <Show when={reconcileError()}>
        <div class="mx-4 mt-3 flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300" role="status">
          <span>{reconcileError()}</span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => void settingsCoverage.retry()}
            disabled={settingsReconciling()}
          >
            Retry reload
          </Button>
        </div>
      </Show>
      <SettingsModal.Group title="Book">
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name and context shown across Contacts.">
          <SettingsGroup title="Identity" description="Describe what belongs in this contact book.">
            <SettingsField
              label="Book name"
              description="Shown in navigation and when choosing a destination book."
              error={nameError}
              changed={nameChanged}
            >
              <TextInput
                aria-label="Book name"
                placeholder="Sales contacts"
                required
                value={name}
                onValueChange={setName}
                onSubmit={saveMetadata}
              />
            </SettingsField>
            <SettingsField
              label="Description"
              description="Optional context for people who can access this book."
              error={() => undefined}
              changed={descriptionChanged}
            >
              <TextInput
                aria-label="Description"
                multiline
                lines={3}
                placeholder="Optional description"
                value={description}
                onValueChange={setDescription}
                onSubmit={saveMetadata}
              />
            </SettingsField>
          </SettingsGroup>
          <SettingsModal.Footer>
            <SettingsPanelFooter
              changeCount={changeCount}
              loading={updateMutation.loading}
              onDiscard={discardMetadata}
              onSave={saveMetadata}
            />
          </SettingsModal.Footer>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Vocabulary used to categorize contacts in this book.">
          <SettingsGroup title="Vocabulary" description="Create tags here, then assign them from the contact editor.">
            <Show when={tagReconciling()}>
              <p class="text-xs text-dimmed" role="status">
                Reloading tags…
              </p>
            </Show>
            <Show when={tagReconcileError()}>
              <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300" role="status">
                <span>{tagReconcileError()}</span>
                <Button type="button" variant="secondary" size="xs" onClick={() => void tagCoverage.retry()} disabled={tagReconciling()}>
                  Retry reload
                </Button>
              </div>
            </Show>
            <TagEditor
              items={props.context().tags}
              onCreate={createTag}
              onUpdate={updateTag}
              onDelete={deleteTag}
              onDirtyChange={setTagEditorDirty}
              disabled={coverageBlocked() || tagReconciling() || tagReconcileError() !== null}
            />
          </SettingsGroup>
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <SettingsModal.Group title="Sharing">
        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
          <SettingsGroup title="People and groups" description="Choose who can read, edit, or administer this contact book.">
            <Show when={props.context().accessEntries} keyed>
              {(accessEntries) => (
                <PermissionEditor
                  initialEntries={accessEntries.filter((entry) => entry.principal.type !== "service_account")}
                  canEdit={!coverageBlocked()}
                  grantAccess={async (principal, permission) => {
                    return grantAccess({ bookId: bookId(), principal, permission });
                  }}
                  updateAccess={async (accessId, permission) => {
                    await updateAccess({ bookId: bookId(), accessId, permission });
                  }}
                  revokeAccess={async (accessId) => {
                    await revokeAccess({ bookId: bookId(), accessId });
                  }}
                />
              )}
            </Show>
          </SettingsGroup>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="api-keys"
          title="API keys"
          icon="ti ti-key"
          description="Resource-bound credentials for integrations. Changes save immediately."
        >
          <Show when={props.context().apiKeys} keyed>
            {(apiKeys) => (
              <fieldset disabled={coverageBlocked()}>
                <ResourceApiKeys
                  title="Integration access"
                  description="Create keys that can access only this contact book."
                  initialKeys={apiKeys}
                  createKey={async (input) => {
                    return createApiKey({ bookId: bookId(), value: { ...input } });
                  }}
                  revokeKey={async (credentialId) => {
                    await revokeApiKey({ bookId: bookId(), credentialId });
                  }}
                />
              </fieldset>
            )}
          </Show>
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <SettingsModal.Group title="Data">
        <SettingsModal.Tab
          id="transfer"
          title="Import & export"
          icon="ti ti-arrows-exchange"
          description="Bring contacts into this book or download a portable copy."
        >
          <SettingsGroup title="Contact data" description="Imports are previewed before anything is created.">
            <BookActions bookId={bookId()} canWrite={!coverageBlocked()} onImported={props.onWorkspaceChange} />
          </SettingsGroup>
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <SettingsModal.Group title="Lifecycle">
        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Permanently delete this book and every contact in it."
          tone="danger"
        >
          <SettingsGroup title="Delete contact book" description="This action cannot be undone.">
            <SettingsGroup.Action>
              <DeleteBookButton
                bookId={bookId()}
                bookName={name().trim() || savedName()}
                onDeleted={props.onDeleted}
                onPendingChange={setDeleteBookPending}
                disabled={coverageBlocked()}
              />
            </SettingsGroup.Action>
          </SettingsGroup>
        </SettingsModal.Tab>
      </SettingsModal.Group>
    </SettingsModal>
  );
}
