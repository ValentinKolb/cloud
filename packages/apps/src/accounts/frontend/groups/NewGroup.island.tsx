import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { CopyButton } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { refreshCurrentPath } from "../lib/navigation";

/** Normalizes group name: lowercase, hyphens instead of spaces/underscores, alphanumeric only. */
const normalizeName = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[_ ]/g, "-")
    .replace(/[^a-z0-9-]/g, "");

type CreateGroupResult = {
  cn: string;
  description: string | null;
  gidnumber: number | null;
};

/** New Group button - opens form dialog, shows NFS commands on success. */
export default function NewGroup() {
  const mutation = mutations.create<CreateGroupResult, { name: string; description?: string; posix?: boolean }>({
    mutation: async (vars) => {
      const res = await apiClient.groups.$post({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to create group.");
      }
      return res.json();
    },
    onSuccess: async (data) => {
      const g = data.cn;

      if (!data.gidnumber) {
        // Non-POSIX group: no NFS commands needed
        await prompts.alert(`Group "${g}" created successfully.`, {
          title: "Group Created",
          icon: "ti ti-check",
        });
        refreshCurrentPath();
        return;
      }

      const commands = `sudo nfsctl groupadd ${g}`;

      prompts.dialog(
        (close) => (
          <div class="flex flex-col gap-4">
            <div class="info-block-success">
              Group <code class="font-mono font-semibold">{g}</code> created successfully.
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-zinc-700 dark:text-zinc-300">Run on the NFS server:</span>
                <CopyButton text={commands} label="Copy" />
              </div>
              <pre class="rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 text-xs font-mono text-zinc-700 dark:text-zinc-300 overflow-x-auto whitespace-pre">
                {commands}
              </pre>
            </div>
            <div class="flex justify-end">
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => {
                  close();
                  refreshCurrentPath();
                }}
              >
                Done
              </button>
            </div>
          </div>
        ),
        { title: "Group Created", icon: "ti ti-check" },
      );
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New Group",
      icon: "ti ti-users-group",
      confirmText: "Create",
      fields: {
        name: {
          type: "text" as const,
          label: "Name",
          placeholder: "my-group",
          required: true,
          description: "Will be normalized to lowercase with hyphens.",
          validate: (v: string | undefined) => {
            if (!v) return "Name is required.";
            const normalized = normalizeName(v);
            if (!normalized) return "Name must contain at least one alphanumeric character.";
            return null;
          },
        },
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Project group for...",
        },
        posix: {
          type: "boolean" as const,
          label: "POSIX group",
          description: "Only POSIX groups can have shared files",
        },
      },
    });

    if (result) {
      await mutation.mutate({
        name: normalizeName(result.name),
        description: result.description || undefined,
        posix: result.posix,
      });
    }
  };

  return (
    <button type="button" class="btn-secondary shrink-0 self-stretch px-3" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-plus" />
      <span class="hidden sm:inline">{mutation.loading() ? "Creating..." : "New Group"}</span>
    </button>
  );
}
