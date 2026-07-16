import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { SpaceDetail, SpaceWormhole } from "@/contracts";
import type { SpaceUserSettings } from "../settings/SpaceSettingsStore";

export type SpaceEditPanelProps = {
  space: SpaceDetail;
  baseUrl: string;
  initialSettings: SpaceUserSettings;
  onClose?: () => void;
  onWorkspaceChange?: () => void;
  accessEntries?: AccessEntry[];
  apiKeys?: ResourceApiKey[];
  wormholes?: SpaceWormhole[];
  isAdmin?: boolean;
  canWrite?: boolean;
};
