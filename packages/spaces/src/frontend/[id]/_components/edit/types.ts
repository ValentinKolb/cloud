import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { SpaceDetail } from "@/contracts";
import type { SpaceUserSettings } from "../settings/SpaceSettingsStore";

export type SpaceEditPanelProps = {
  space: SpaceDetail;
  baseUrl: string;
  initialSettings: SpaceUserSettings;
  onClose?: () => void;
  accessEntries?: AccessEntry[];
  apiKeys?: ResourceApiKey[];
  isAdmin?: boolean;
};
