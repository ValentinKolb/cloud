import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { Notebook, NoteTreeNode } from "../sidebar/types";
import { openNotebookSettingsDialog } from "./NotebookSettingsPanel";

type Props = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  permission: string;
  variant: "desktop" | "mobile";
  viewTransitionName?: string;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
  } catch {
    // Use fallback.
  }
  return fallback;
};

export default function NotebookSettingsButton(props: Props) {
  const isAdmin = () => props.permission === "admin";
  const canWrite = () => props.permission === "write" || props.permission === "admin";

  const open = async () => {
    let accessEntries: AccessEntry[] = [];
    if (isAdmin()) {
      const response = await apiClient[":id"].access.$get({
        param: { id: props.notebook.shortId },
      });
      if (!response.ok) {
        await prompts.error(await readErrorMessage(response, "Failed to load notebook permissions."));
        return;
      }
      accessEntries = (await response.json()) as AccessEntry[];
    }

    await openNotebookSettingsDialog({
      notebook: props.notebook,
      tree: props.tree,
      accessEntries,
      isAdmin: isAdmin(),
      canWrite: canWrite(),
    });
  };

  if (props.variant === "mobile") {
    return (
      <button
        type="button"
        onClick={() => void open()}
        class="sidebar-item-mobile w-full"
        style={props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined}
      >
        <i class="ti ti-settings" />
        Settings
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
      title="Settings"
      aria-label={`Settings for ${props.notebook.name}`}
      style={props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined}
    >
      <i class="ti ti-settings text-xs" />
    </button>
  );
}
