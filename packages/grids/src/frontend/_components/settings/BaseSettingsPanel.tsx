import { NoticeCard, SettingsModal } from "@k2b/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { DocumentProfile } from "../../../contracts";
import { DangerZone, DocumentProfileForm, GeneralForm, PermissionsSection, TrashSection } from "./BaseSettingsSections";

type Props = {
  base: {
    id: string;
    shortId: string;
    name: string;
    description: string | null;
    documentProfile: DocumentProfile;
  };
  accessEntries: AccessEntry[];
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

        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Base grants control direct access to all Base data.">
          <NoticeCard tone="info" icon={false} bodyClass="flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>
              A Base grant applies to every table, view, form, document template, and workflow in this Base. Custom Apps use independent
              grants and can be shared without exposing direct Base access.
            </span>
          </NoticeCard>
          <PermissionsSection baseId={props.base.id} initialEntries={props.accessEntries} />
        </SettingsModal.Tab>

        <SettingsModal.Tab id="trash" title="Trash" icon="ti ti-trash" description="Soft-deleted tables, fields, and forms.">
          <TrashSection baseId={props.base.id} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Move this grid and its contents to trash. It remains restorable."
          tone="danger"
        >
          <DangerZone baseId={props.base.id} baseName={props.base.name} />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}
