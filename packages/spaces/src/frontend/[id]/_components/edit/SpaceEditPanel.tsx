import { SettingsModal } from "@valentinkolb/cloud/ui";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import { AccessSection } from "./AccessSection";
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

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Space settings"
        onClose={props.onClose ?? (() => requestSpacesRouteNavigation(`/app/spaces/${props.space.id}`, { scroll: "preserve" }))}
        closeLabel="Close settings"
      >
        {canWrite() && (
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, description, and color.">
            <GeneralSection space={props.space} />
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab
          id="defaults"
          title="Defaults"
          icon="ti ti-layout-sidebar"
          description="Personal defaults for this space and home widgets."
        >
          <DefaultsSection spaceId={props.space.id} initialSettings={props.initialSettings} />
        </SettingsModal.Tab>

        {canWrite() && (
          <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Vocabulary used to categorize space items.">
            <TagsSection spaceId={props.space.id} tags={props.space.tags} />
          </SettingsModal.Tab>
        )}

        {canWrite() && (
          <SettingsModal.Tab id="statuses" title="Statuses" icon="ti ti-columns-3" description="Kanban columns and item workflow states.">
            <StatusesSection spaceId={props.space.id} columns={props.space.columns} />
          </SettingsModal.Tab>
        )}

        {isAdmin() && (
          <SettingsModal.Tab id="wormholes" title="Wormholes" icon="ti ti-arrow-bounce" description="Move items into another Space.">
            <WormholesSection spaceId={props.space.id} initialWormholes={props.wormholes ?? []} />
          </SettingsModal.Tab>
        )}

        {isAdmin() && props.accessEntries && (
          <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
            <AccessSection spaceId={props.space.id} accessEntries={props.accessEntries} apiKeys={props.apiKeys ?? []} />
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab id="calendar" title="Calendar" icon="ti ti-calendar-share" description="iCal export and subscription URL.">
          <CalendarSection spaceId={props.space.id} icalToken={props.space.icalToken} baseUrl={props.baseUrl} isAdmin={isAdmin()} />
        </SettingsModal.Tab>

        {isAdmin() && (
          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Permanently delete this space and all of its items."
            tone="danger"
          >
            <DangerZone spaceId={props.space.id} spaceName={props.space.name} />
          </SettingsModal.Tab>
        )}
      </SettingsModal>
    </div>
  );
}
