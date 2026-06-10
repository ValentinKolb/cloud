import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { PermissionEditor, prompts, type ResourceApiKey, ResourceApiKeys, SettingsModal, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import { readErrorMessage } from "./api";
import BookActions from "./BookActions.island";
import BookTagsManager from "./BookTagsManager.island";
import DeleteBookButton from "./DeleteBookButton";

type Props = {
  bookId: string;
  initialName: string;
  initialDescription: string | null;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  initialTags: ContactTag[];
};

/**
 * Contact book settings panel for admin users.
 * Includes metadata editing and ACL management.
 */
export default function BookSettingsForm(props: Props) {
  const [name, setName] = createSignal(props.initialName);
  const [description, setDescription] = createSignal(props.initialDescription ?? "");

  const updateMutation = mutations.create<void, void>({
    mutation: async () => {
      const trimmedName = name().trim();
      if (!trimmedName) {
        throw new Error("Book name is required");
      }

      const response = await apiClient.books[":bookId"].$patch({
        param: { bookId: props.bookId },
        json: {
          name: trimmedName,
          description: description().trim() || null,
        },
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update book"));
    },
    onSuccess: () => {
      toast.success("Book settings saved");
      refreshCurrentPath();
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Contact book settings"
        subtitle={name().trim() || props.initialName}
        icon="ti ti-cube"
        onClose={() => navigateTo(`/app/contacts/${props.bookId}`)}
        closeLabel="Close settings"
      >
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Book name and description.">
          <div class="space-y-3">
            <TextInput
              label="Book Name"
              icon="ti ti-cube"
              placeholder="Sales Contacts"
              required
              value={name}
              onInput={setName}
              onSubmit={() => updateMutation.mutate(undefined)}
            />

            <TextInput
              label="Description"
              icon="ti ti-notes"
              multiline
              placeholder="Optional description"
              value={description}
              onInput={setDescription}
              onSubmit={() => updateMutation.mutate(undefined)}
            />
          </div>

          <button
            type="button"
            class="btn-primary btn-sm"
            disabled={updateMutation.loading()}
            onClick={() => updateMutation.mutate(undefined)}
          >
            {updateMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-device-floppy" />}
            Save
          </button>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Book vocabulary assigned from the contact editor.">
          <p class="text-xs text-dimmed">
            Tags categorize contacts in this book (e.g. „VIP", „Lead", „Supplier"). Manage the vocabulary here; assign tags from the contact
            editor.
          </p>
          <BookTagsManager bookId={props.bookId} initialTags={props.initialTags} />
        </SettingsModal.Tab>

        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
          <div class="flex flex-col gap-6">
            <PermissionEditor
              initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient.books[":bookId"].access.$post({
                  param: { bookId: props.bookId },
                  json: { principal, permission },
                });

                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access"));

                return await response.json();
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient.books[":bookId"].access[":accessId"].$patch({
                  param: { bookId: props.bookId, accessId },
                  json: { permission },
                });

                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access"));
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient.books[":bookId"].access[":accessId"].$delete({
                  param: { bookId: props.bookId, accessId },
                });

                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access"));
              }}
            />
            <div>
              <ResourceApiKeys
                title="API keys"
                description="Resource-bound keys for integrations that need access to this contact book."
                initialKeys={props.apiKeys}
                createKey={async (input) => {
                  const response = await apiClient.books[":bookId"]["api-keys"].$post({
                    param: { bookId: props.bookId },
                    json: input,
                  });
                  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create API key"));
                  return (await response.json()) as { credential: ResourceApiKey; token: string };
                }}
                revokeKey={async (credentialId) => {
                  const response = await apiClient.books[":bookId"]["api-keys"][":credentialId"].$delete({
                    param: { bookId: props.bookId, credentialId },
                  });
                  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke API key"));
                }}
              />
            </div>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="transfer"
          title="Import & export"
          icon="ti ti-arrows-exchange"
          description="Bulk import contacts or export the book."
        >
          <p class="text-xs text-dimmed">
            Bulk-import contacts from a vCard file or export the entire book as vCard / CSV. Restricted to book admins to prevent accidental
            data extraction.
          </p>
          <BookActions bookId={props.bookId} canWrite />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Permanently delete this book and all contacts in it."
          tone="danger"
        >
          <p class="text-xs text-dimmed">Deleting this book also removes all contacts within it.</p>
          <DeleteBookButton bookId={props.bookId} bookName={name().trim() || props.initialName} />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}
