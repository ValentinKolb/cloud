import type { DateContext } from "@k2b/stdlib";
import { AppWorkspace, prompts } from "@k2b/ui";
import type { ResourceApiKey } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { apiClient } from "@/api/client";
import type { Notebook, NoteTreeNode } from "../sidebar/types";
import { openNotebookSettingsDialog } from "./NotebookSettingsPanel";

type Props = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  permission: string;
  viewTransitionName?: string;
  dateConfig: DateContext;
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
    let apiKeys: ResourceApiKey[] = [];
    if (isAdmin()) {
      const [accessResponse, apiKeysResponse] = await Promise.all([
        apiClient[":id"].access.$get({
          param: { id: props.notebook.shortId },
        }),
        apiClient[":id"]["api-keys"].$get({
          param: { id: props.notebook.shortId },
        }),
      ]);
      if (!accessResponse.ok) {
        await prompts.error(await readErrorMessage(accessResponse, "Failed to load notebook permissions."));
        return;
      }
      if (!apiKeysResponse.ok) {
        await prompts.error(await readErrorMessage(apiKeysResponse, "Failed to load notebook API keys."));
        return;
      }
      accessEntries = (await accessResponse.json()) as AccessEntry[];
      apiKeys = ((await apiKeysResponse.json()) as { items: ResourceApiKey[] }).items;
    }

    await openNotebookSettingsDialog({
      notebook: props.notebook,
      tree: props.tree,
      accessEntries,
      apiKeys,
      isAdmin: isAdmin(),
      canWrite: canWrite(),
      dateConfig: props.dateConfig,
    });
  };

  return (
    <AppWorkspace.SidebarItem
      icon="ti ti-settings"
      onClick={() => void open()}
      title="Settings"
      viewTransitionName={props.viewTransitionName}
    >
      Settings
    </AppWorkspace.SidebarItem>
  );
}
