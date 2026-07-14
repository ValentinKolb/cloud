import { prompts, SettingsModal } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import { AccessSection } from "./AccessSection";
import { DangerZone } from "./DangerZone";
import { ExportSection } from "./ExportSection";
import { FeaturesSection } from "./FeaturesSection";
import { GeneralSection } from "./GeneralSection";
import type { NotebookSettingsProps } from "./types";

export const openNotebookSettingsDialog = (props: NotebookSettingsProps): Promise<void> =>
  prompts.dialog<void>((close) => <NotebookSettingsBody {...props} bare close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "large",
  });

function NotebookSettingsBody(props: NotebookSettingsProps & { bare?: boolean; close?: () => void }) {
  const [notebook, setNotebook] = createSignal(props.notebook);

  return (
    <div class={props.bare ? "flex h-[86vh] min-h-0 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-hidden"}>
      <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <SettingsModal
          title="Notebook settings"
          subtitle={notebook().name}
          icon={notebook().icon || "ti-notebook"}
          onClose={props.close}
          closeLabel="Close settings"
        >
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, icon, description, and default start page.">
            <GeneralSection notebook={notebook()} tree={props.tree} canWrite={props.canWrite} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
          <SettingsModal.Tab
            id="features"
            title="View & features"
            icon="ti ti-toggle-right"
            description="Navigation layout and notebook-level behavior."
          >
            <FeaturesSection notebook={notebook()} isAdmin={props.isAdmin} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
          <SettingsModal.Tab id="export" title="Export" icon="ti ti-download" description="Download a portable notebook archive.">
            <ExportSection notebook={notebook()} isAdmin={props.isAdmin} />
          </SettingsModal.Tab>
          {props.isAdmin && (
            <>
              <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
                <AccessSection notebook={notebook()} accessEntries={props.accessEntries} apiKeys={props.apiKeys} isAdmin={props.isAdmin} />
              </SettingsModal.Tab>
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                description="Permanently delete this notebook and all of its notes."
                tone="danger"
              >
                <DangerZone notebook={notebook()} />
              </SettingsModal.Tab>
            </>
          )}
        </SettingsModal>
      </div>
    </div>
  );
}

export default function NotebookSettingsPanel(props: NotebookSettingsProps) {
  return <NotebookSettingsBody {...props} />;
}
