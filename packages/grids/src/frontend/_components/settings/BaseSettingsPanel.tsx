import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { SettingsModal } from "@valentinkolb/cloud/ui";
import type { DocumentProfile } from "../../../contracts";
import type { Dashboard } from "../../../service";
import {
  DangerZone,
  DefaultDashboardSelect,
  DocumentProfileForm,
  GeneralForm,
  PermissionsSection,
  TrashSection,
} from "./BaseSettingsSections";

type Props = {
  base: {
    id: string;
    shortId: string;
    name: string;
    description: string | null;
    documentProfile: DocumentProfile;
    defaultDashboardId: string | null;
  };
  accessEntries: AccessEntry[];
  dashboards: Dashboard[];
  onClose?: () => void;
};

export default function BaseSettingsPanel(props: Props) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Base settings"
        subtitle={props.base.name}
        icon="ti ti-table"
        onClose={props.onClose ?? (() => undefined)}
        closeLabel="Close settings"
      >
        <SettingsModal.Tab
          id="general"
          title="General"
          icon="ti ti-id"
          description="Base name and description shown on the grids overview."
        >
          <GeneralForm base={props.base} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="documents"
          title="Documents"
          icon="ti ti-file-type-pdf"
          description="Business identity used by document templates."
        >
          <DocumentProfileForm base={props.base} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="dashboard"
          title="Dashboard"
          icon="ti ti-layout-dashboard"
          description="The dashboard shown when opening this base directly."
        >
          <DefaultDashboardSelect baseId={props.base.id} initial={props.base.defaultDashboardId} dashboards={props.dashboards} />
          <div class="info-block-warning text-xs flex items-start gap-2 mt-3">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>
              Shared dashboards can surface data from views/tables a viewer can't read directly. Make sure the source views match the
              dashboard's audience.
            </span>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Base-level grants apply to every table by default.">
          <div class="info-block-info text-xs flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>
              Override per table from that table's editor: a group with <code class="font-mono">read</code> on the base and{" "}
              <code class="font-mono">write</code> on a single table can edit that table but only read others. Within the same tier, "no
              access" wins; user grants override group grants.
            </span>
          </div>
          <PermissionsSection baseId={props.base.id} initialEntries={props.accessEntries} />
        </SettingsModal.Tab>

        <SettingsModal.Tab id="trash" title="Trash" icon="ti ti-trash" description="Soft-deleted tables, fields, dashboards, and forms.">
          <TrashSection baseId={props.base.id} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Permanently delete this base and all of its contents."
          tone="danger"
        >
          <DangerZone baseId={props.base.id} baseName={props.base.name} />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}
