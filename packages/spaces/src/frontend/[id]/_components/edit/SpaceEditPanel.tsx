import { prompts, SettingsModal } from "@k2b/ui";
import { createSignal } from "solid-js";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import { ApiKeysSection, PermissionsSection } from "./AccessSection";
import { CalendarSection } from "./CalendarSection";
import { DangerZone } from "./DangerZone";
import { DefaultsSection } from "./DefaultsSection";
import { GeneralSection } from "./GeneralSection";
import { StatusesSection } from "./StatusesSection";
import { TagsSection } from "./TagsSection";
import type { SpaceEditPanelProps } from "./types";
import { WormholesSection } from "./WormholesSection";

export default function SpaceEditPanel(props: SpaceEditPanelProps) {
  const isAdmin = () => props.isAdmin === true;
  const canWrite = () => props.canWrite === true;
  const [activeTab, setActiveTab] = createSignal(canWrite() ? "general" : "defaults");
  const [generalDirty, setGeneralDirty] = createSignal(false);
  const [tagsDirty, setTagsDirty] = createSignal(false);
  const [statusesDirty, setStatusesDirty] = createSignal(false);
  const [wormholesDirty, setWormholesDirty] = createSignal(false);
  const activeTabDirty = () => {
    if (activeTab() === "general") return generalDirty();
    if (activeTab() === "tags") return tagsDirty();
    if (activeTab() === "statuses") return statusesDirty();
    if (activeTab() === "wormholes") return wormholesDirty();
    return false;
  };
  const close = () => {
    if (props.onClose) props.onClose();
    else requestSpacesRouteNavigation(`/app/spaces/${props.space.id}`, { scroll: "preserve" });
  };
  const confirmDiscard = async () =>
    !activeTabDirty() ||
    prompts.confirm("Discard the unfinished changes in this section?", {
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
    if (await confirmDiscard()) close();
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Space settings"
        activeTab={activeTab()}
        onTabChange={(tab) => void requestTabChange(tab)}
        onClose={() => void requestClose()}
        closeLabel="Close settings"
      >
        {canWrite() && (
          <SettingsModal.Group title="Space">
            <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, description, and color.">
              <GeneralSection space={props.space} onWorkspaceChange={props.onWorkspaceChange} onDirtyChange={setGeneralDirty} />
            </SettingsModal.Tab>
            <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Vocabulary used to categorize space items.">
              <TagsSection
                spaceId={props.space.id}
                tags={props.space.tags}
                onWorkspaceChange={props.onWorkspaceChange}
                onSettingsChange={props.onSettingsChange}
                onDirtyChange={setTagsDirty}
              />
            </SettingsModal.Tab>
            <SettingsModal.Tab id="statuses" title="Statuses" icon="ti ti-columns-3" description="Kanban columns and workflow states.">
              <StatusesSection
                spaceId={props.space.id}
                columns={props.space.columns}
                onWorkspaceChange={props.onWorkspaceChange}
                onSettingsChange={props.onSettingsChange}
                onDirtyChange={setStatusesDirty}
              />
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}

        <SettingsModal.Group title="Personal">
          <SettingsModal.Tab
            id="defaults"
            title="Defaults"
            icon="ti ti-layout-sidebar"
            description="Browser defaults for this space and home widgets. Changes apply immediately."
          >
            <DefaultsSection spaceId={props.space.id} initialSettings={props.initialSettings} />
          </SettingsModal.Tab>
        </SettingsModal.Group>

        <SettingsModal.Group title="Connections">
          <SettingsModal.Tab id="calendar" title="Calendar" icon="ti ti-calendar-share" description="iCal export and subscription URL.">
            <CalendarSection spaceId={props.space.id} icalToken={props.space.icalToken} baseUrl={props.baseUrl} isAdmin={isAdmin()} />
          </SettingsModal.Tab>
          {isAdmin() && (
            <SettingsModal.Tab id="wormholes" title="Wormholes" icon="ti ti-arrow-bounce" description="Move items into another Space.">
              <WormholesSection spaceId={props.space.id} initialWormholes={props.wormholes ?? []} onDirtyChange={setWormholesDirty} />
            </SettingsModal.Tab>
          )}
        </SettingsModal.Group>

        {isAdmin() && props.accessEntries && (
          <SettingsModal.Group title="Sharing">
            <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
              <PermissionsSection
                spaceId={props.space.id}
                accessEntries={props.accessEntries}
                onWorkspaceChange={props.onWorkspaceChange}
              />
            </SettingsModal.Tab>
            <SettingsModal.Tab
              id="api-keys"
              title="API keys"
              icon="ti ti-key"
              description="Resource-bound integration credentials. Changes save immediately."
            >
              <ApiKeysSection spaceId={props.space.id} apiKeys={props.apiKeys ?? []} />
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}

        {isAdmin() && (
          <SettingsModal.Group title="Lifecycle">
            <SettingsModal.Tab
              id="danger"
              title="Danger zone"
              icon="ti ti-alert-triangle"
              description="Permanently delete this space and all of its items."
              tone="danger"
            >
              <DangerZone spaceId={props.space.id} spaceName={props.space.name} />
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}
      </SettingsModal>
    </div>
  );
}
