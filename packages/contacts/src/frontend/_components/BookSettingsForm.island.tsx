import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { PermissionEditor, prompts, refreshCurrentPath, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import BookActions from "./BookActions.island";
import BookTagsManager from "./BookTagsManager.island";
import DeleteBookButton from "./DeleteBookButton";

type Props = {
  bookId: string;
  initialName: string;
  initialDescription: string | null;
  accessEntries: AccessEntry[];
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

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data.message ?? "Failed to update book");
      }
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  return (
    <div class="flex flex-col gap-8">
      <section class="space-y-4">
        <h2 class="section-label mb-0 flex items-center gap-2">
          <i class="ti ti-settings text-dimmed" />
          General
        </h2>

        <div class="space-y-3">
          <TextInput
            label="Book Name"
            icon="ti ti-address-book"
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
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="space-y-3">
        <h2 class="section-label mb-0 flex items-center gap-2">
          <i class="ti ti-tags text-dimmed" />
          Tags
        </h2>
        <p class="text-xs text-dimmed">
          Tags categorize contacts in this book (e.g. „VIP", „Lead", „Supplier"). Manage the vocabulary here; assign tags from the contact
          editor.
        </p>
        <BookTagsManager bookId={props.bookId} initialTags={props.initialTags} />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="space-y-4">
        <h2 class="section-label mb-0 flex items-center gap-2">
          <i class="ti ti-shield text-dimmed" />
          Permissions
        </h2>
        <PermissionEditor
          initialEntries={props.accessEntries}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await apiClient.books[":bookId"].access.$post({
              param: { bookId: props.bookId },
              json: { principal, permission },
            });

            if (!response.ok) {
              const data = (await response.json().catch(() => ({}))) as {
                message?: string;
              };
              throw new Error(data.message ?? "Failed to grant access");
            }

            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient.books[":bookId"].access[":accessId"].$patch({
              param: { bookId: props.bookId, accessId },
              json: { permission },
            });

            if (!response.ok) {
              const data = (await response.json().catch(() => ({}))) as {
                message?: string;
              };
              throw new Error(data.message ?? "Failed to update access");
            }
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient.books[":bookId"].access[":accessId"].$delete({
              param: { bookId: props.bookId, accessId },
            });

            if (!response.ok) {
              const data = (await response.json().catch(() => ({}))) as {
                message?: string;
              };
              throw new Error(data.message ?? "Failed to revoke access");
            }
          }}
        />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="space-y-3">
        <h2 class="section-label mb-0 flex items-center gap-2">
          <i class="ti ti-arrows-exchange text-dimmed" />
          Import &amp; Export
        </h2>
        <p class="text-xs text-dimmed">
          Bulk-import contacts from a vCard file or export the entire book as vCard / CSV. Restricted to book admins to prevent accidental
          data extraction.
        </p>
        <BookActions bookId={props.bookId} canWrite />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="space-y-3">
        <h2 class="section-label mb-0 text-red-500 flex items-center gap-2">
          <i class="ti ti-alert-triangle text-red-500" />
          Danger Zone
        </h2>
        <p class="text-xs text-dimmed">Deleting this book also removes all contacts within it.</p>
        <DeleteBookButton bookId={props.bookId} bookName={name().trim() || props.initialName} />
      </section>
    </div>
  );
}
