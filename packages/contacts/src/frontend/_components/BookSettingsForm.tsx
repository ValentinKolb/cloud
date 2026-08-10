import { mutation as mutations } from "@k2b/stdlib/solid";
import {
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
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactBook, ContactTag } from "../../service";
import { readErrorMessage } from "./api";
import BookActions from "./BookActions";
import DeleteBookButton from "./DeleteBookButton";

type Props = {
  bookId: string;
  initialName: string;
  initialDescription: string | null;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  initialTags: ContactTag[];
  initialTab?: string;
  onClose: () => void;
  onDeleted: () => void;
  onWorkspaceChange: () => void;
};

/** Contact book settings for book administrators. */
export default function BookSettingsForm(props: Props) {
  const [activeTab, setActiveTab] = createSignal(props.initialTab ?? "general");
  const [savedName, setSavedName] = createSignal(props.initialName);
  const [savedDescription, setSavedDescription] = createSignal(props.initialDescription ?? "");
  const [name, setName] = createSignal(savedName());
  const [description, setDescription] = createSignal(savedDescription());
  const [tags, setTags] = createSignal([...props.initialTags]);
  const [tagEditorDirty, setTagEditorDirty] = createSignal(false);

  const nameChanged = () => name() !== savedName();
  const descriptionChanged = () => description() !== savedDescription();
  const changeCount = () => Number(nameChanged()) + Number(descriptionChanged());
  const nameError = () => (name().trim() ? undefined : "Book name is required");
  const discardMetadata = () => {
    setName(savedName());
    setDescription(savedDescription());
  };

  const updateMutation = mutations.create<ContactBook, void>({
    mutation: async () => {
      const trimmedName = name().trim();
      if (!trimmedName) throw new Error("Book name is required");

      const response = await apiClient.books[":bookId"].$patch({
        param: { bookId: props.bookId },
        json: {
          name: trimmedName,
          description: description().trim() || null,
        },
      });
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
    },
    onError: (error) => prompts.error(error.message),
  });

  const createTag = async (value: { name: string; color: string }) => {
    const response = await apiClient.books[":bookId"].tags.$post({
      param: { bookId: props.bookId },
      json: value,
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create tag"));
    const created = await response.json();
    setTags([...tags(), created].sort((left, right) => left.name.localeCompare(right.name)));
    props.onWorkspaceChange();
    toast.success("Tag created");
  };

  const updateTag = async (tag: ContactTag, value: { name: string; color: string }) => {
    const response = await apiClient.books[":bookId"].tags[":tagId"].$patch({
      param: { bookId: props.bookId, tagId: tag.id },
      json: value,
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update tag"));
    const updated = await response.json();
    setTags(
      tags()
        .map((entry) => (entry.id === updated.id ? updated : entry))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
    props.onWorkspaceChange();
    toast.success("Tag updated");
  };

  const deleteTag = async (tag: ContactTag) => {
    const confirmed = await prompts.confirm(`Delete "${tag.name}"? It will be removed from all contacts in this book.`, {
      title: "Delete tag",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;

    const response = await apiClient.books[":bookId"].tags[":tagId"].$delete({
      param: { bookId: props.bookId, tagId: tag.id },
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete tag"));
    setTags(tags().filter((entry) => entry.id !== tag.id));
    props.onWorkspaceChange();
    toast.success("Tag deleted");
  };

  const requestTabChange = async (nextTab: string) => {
    if (nextTab === activeTab()) return;
    if (!(await confirmDiscardIfDirty(tagEditorDirty))) return;
    setActiveTab(nextTab);
  };

  const requestClose = async () => {
    if (!(await confirmDiscardIfDirty(() => changeCount() > 0 || tagEditorDirty()))) return;
    props.onClose();
  };

  return (
    <SettingsModal
      title="Contact book settings"
      activeTab={activeTab()}
      onTabChange={(tab) => void requestTabChange(tab)}
      onClose={() => void requestClose()}
      closeLabel="Close settings"
    >
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
                onSubmit={() => updateMutation.mutate(undefined)}
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
                onSubmit={() => updateMutation.mutate(undefined)}
              />
            </SettingsField>
          </SettingsGroup>
          <SettingsModal.Footer>
            <SettingsPanelFooter
              changeCount={changeCount}
              loading={updateMutation.loading}
              onDiscard={discardMetadata}
              onSave={() => updateMutation.mutate(undefined)}
            />
          </SettingsModal.Footer>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Vocabulary used to categorize contacts in this book.">
          <SettingsGroup title="Vocabulary" description="Create tags here, then assign them from the contact editor.">
            <TagEditor items={tags()} onCreate={createTag} onUpdate={updateTag} onDelete={deleteTag} onDirtyChange={setTagEditorDirty} />
          </SettingsGroup>
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <SettingsModal.Group title="Sharing">
        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
          <SettingsGroup title="People and groups" description="Choose who can read, edit, or administer this contact book.">
            <PermissionEditor
              initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient.books[":bookId"].access.$post({
                  param: { bookId: props.bookId },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access"));
                const entry = await response.json();
                props.onWorkspaceChange();
                return entry;
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient.books[":bookId"].access[":accessId"].$patch({
                  param: { bookId: props.bookId, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access"));
                props.onWorkspaceChange();
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient.books[":bookId"].access[":accessId"].$delete({
                  param: { bookId: props.bookId, accessId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access"));
                props.onWorkspaceChange();
              }}
            />
          </SettingsGroup>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="api-keys"
          title="API keys"
          icon="ti ti-key"
          description="Resource-bound credentials for integrations. Changes save immediately."
        >
          <ResourceApiKeys
            title="Integration access"
            description="Create keys that can access only this contact book."
            initialKeys={props.apiKeys}
            createKey={async (input) => {
              const response = await apiClient.books[":bookId"]["api-keys"].$post({
                param: { bookId: props.bookId },
                json: input,
              });
              if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create API key"));
              const result = (await response.json()) as { credential: ResourceApiKey; token: string };
              props.onWorkspaceChange();
              return result;
            }}
            revokeKey={async (credentialId) => {
              const response = await apiClient.books[":bookId"]["api-keys"][":credentialId"].$delete({
                param: { bookId: props.bookId, credentialId },
              });
              if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke API key"));
              props.onWorkspaceChange();
            }}
          />
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
            <BookActions bookId={props.bookId} canWrite onImported={props.onWorkspaceChange} />
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
              <DeleteBookButton bookId={props.bookId} bookName={name().trim() || savedName()} onDeleted={props.onDeleted} />
            </SettingsGroup.Action>
          </SettingsGroup>
        </SettingsModal.Tab>
      </SettingsModal.Group>
    </SettingsModal>
  );
}
