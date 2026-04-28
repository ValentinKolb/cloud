import { Dropdown } from "@valentinkolb/cloud/ui";
import { CopyButton } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";

type GroupActionsProps = {
  id: string;
  name: string;
  provider: "ipa" | "local";
  isPosix: boolean;
  description: string | null;
  listHref: string;
};

/** Per-group action dropdown menu. */
export default function GroupActions(props: GroupActionsProps) {
  const deleteMutation = mutations.create<void, string>({
    mutation: async (id) => {
      const res = await apiClient.groups[":id"].$delete({ param: { id } });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to delete group.");
      }
    },
    onSuccess: async () => {
      const g = props.name;
      const providerLabel = props.provider === "ipa" ? "FreeIPA" : "Local";

      if (!props.isPosix) {
        await prompts.alert(`Group "${g}" deleted from ${providerLabel}.`, {
          title: "Group Deleted",
          icon: "ti ti-check",
        });
        navigateTo(props.listHref);
        return;
      }

      const deleteCmd = `sudo nfsctl groupdel ${g}`;

      prompts.dialog(
        (close) => (
          <div class="flex flex-col gap-4">
            <div class="info-block-success">
              Group <code class="font-mono font-semibold">{g}</code> deleted from {providerLabel}.
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-zinc-700 dark:text-zinc-300">Delete / archive files:</span>
                <CopyButton text={deleteCmd} label="Copy" />
              </div>
              <pre class="rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 text-xs font-mono text-zinc-700 dark:text-zinc-300 overflow-x-auto whitespace-pre">
                {deleteCmd}
              </pre>
            </div>

            <div class="flex justify-end">
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => {
                  close();
                  navigateTo(props.listHref);
                }}
              >
                Done
              </button>
            </div>
          </div>
        ),
        { title: "Group Deleted", icon: "ti ti-check" },
      );
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const editMutation = mutations.create<void, { description: string }>({
    mutation: async (vars) => {
      const res = await apiClient.groups[":id"].$patch({
        param: { id: props.id },
        json: vars,
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to update group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleEdit = async () => {
    const result = await prompts.form({
      title: "Edit Group",
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Group description...",
          multiline: true,
          default: props.description ?? "",
        },
      },
    });
    if (result) {
      await editMutation.mutate({ description: result.description ?? "" });
    }
  };

  const handleMakePosix = async () => {
      const confirmed = await prompts.confirm(
        `Convert "${props.name}" to a POSIX group? This assigns a stable GID for filesystem integrations and cannot be undone.`,
        {
          title: "Make POSIX",
          icon: "ti ti-transform",
          confirmText: "Convert",
          cancelText: "Cancel",
        },
      );
    if (confirmed) {
      const res = await apiClient.groups[":id"].posix.$put({
        param: { id: props.id },
      });
      if (res.ok) refreshCurrentPath();
      else prompts.error("Failed to convert group to POSIX.");
    }
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete the group "${props.name}"? This action cannot be undone.`, {
      title: "Delete Group",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });

    if (confirmed) {
      await deleteMutation.mutate(props.id);
    }
  };

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="Group actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-48"
      elements={[
        {
          items: [
            ...(!props.isPosix
              ? [
                  {
                    icon: "ti ti-transform",
                    label: "Make POSIX",
                    action: handleMakePosix,
                  },
                ]
              : []),
            {
              icon: "ti ti-pencil",
              label: "Edit",
              action: handleEdit,
            },
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: handleDelete,
              variant: "danger" as const,
            },
          ],
        },
      ]}
    />
  );
}
