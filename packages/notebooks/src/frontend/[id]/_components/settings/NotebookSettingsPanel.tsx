import { prompts, SettingsModal } from "@k2b/ui";
import { createSignal } from "solid-js";
import { ApiKeysSection, PermissionsSection } from "./AccessSection";
import { DangerZone } from "./DangerZone";
import { ExportSection } from "./ExportSection";
import { FeaturesSection } from "./FeaturesSection";
import { GeneralSection } from "./GeneralSection";
import type { NotebookSettingsProps } from "./types";

export const openNotebookSettingsDialog = (props: NotebookSettingsProps): Promise<void> =>
  prompts.dialog<void>((close) => <NotebookSettingsBody {...props} close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "large",
    cancelBehavior: "ignore",
  });

export function NotebookSettingsBody(props: NotebookSettingsProps & { close: () => void }) {
  const [notebook, setNotebook] = createSignal(props.notebook);
  const [activeTab, setActiveTab] = createSignal("general");
  const [generalDirty, setGeneralDirty] = createSignal(false);
  const [exportDirty, setExportDirty] = createSignal(false);
  const activeTabDirty = () => (activeTab() === "general" ? generalDirty() : activeTab() === "export" ? exportDirty() : false);

  const confirmDiscard = async () =>
    !activeTabDirty() ||
    prompts.confirm("Discard the unsaved changes in this section?", {
      title: "Discard changes?",
      icon: "ti ti-alert-triangle",
      confirmText: "Discard",
      variant: "danger",
    });

  const requestTabChange = async (nextTab: string) => {
    if (nextTab === activeTab() || !(await confirmDiscard())) return;
    setActiveTab(nextTab);
  };

  const requestClose = async () => {
    if (await confirmDiscard()) props.close();
  };

  return (
    <div class="dialog-fixed-frame flex min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Notebook settings"
        activeTab={activeTab()}
        onTabChange={(tab) => void requestTabChange(tab)}
        onClose={() => void requestClose()}
        closeLabel="Close settings"
      >
        <SettingsModal.Group title="Notebook">
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, icon, description, and default start page.">
            <GeneralSection
              notebook={notebook()}
              tree={props.tree}
              canWrite={props.canWrite}
              dateConfig={props.dateConfig}
              onNotebookChange={setNotebook}
              onDirtyChange={setGeneralDirty}
            />
          </SettingsModal.Tab>
          <SettingsModal.Tab
            id="features"
            title="View & behavior"
            icon="ti ti-toggle-right"
            description="Navigation layout and notebook-level behavior."
          >
            <FeaturesSection notebook={notebook()} isAdmin={props.isAdmin} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
        </SettingsModal.Group>

        {props.isAdmin && (
          <>
            <SettingsModal.Group title="Sharing">
              <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
                <PermissionsSection notebook={notebook()} />
              </SettingsModal.Tab>
              <SettingsModal.Tab
                id="api-keys"
                title="API keys"
                icon="ti ti-key"
                description="Resource-bound integration credentials. Changes save immediately."
              >
                <ApiKeysSection notebook={notebook()} />
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Data">
              <SettingsModal.Tab
                id="export"
                title="Export & snapshots"
                icon="ti ti-download"
                description="Download a portable archive or configure automatic snapshots."
              >
                <ExportSection notebook={notebook()} onDirtyChange={setExportDirty} />
              </SettingsModal.Tab>
            </SettingsModal.Group>

            <SettingsModal.Group title="Lifecycle">
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                description="Permanently delete this notebook and all of its notes."
                tone="danger"
              >
                <DangerZone notebook={notebook()} />
              </SettingsModal.Tab>
            </SettingsModal.Group>
          </>
        )}
      </SettingsModal>
    </div>
  );
}
