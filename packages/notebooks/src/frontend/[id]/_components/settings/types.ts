import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { LogTableEntry, ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { Notebook, NoteTreeNode } from "../sidebar/types";

export type NotebookSettingsProps = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  isAdmin: boolean;
  canWrite: boolean;
};

export type NoteSelectOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};

export type BackupStatus = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  scheduleCron: string;
  accessKeyIdSet: boolean;
  secretAccessKeySet: boolean;
  configured: boolean;
  missing: string[];
  target: string | null;
};

export type BackupRunResult = {
  message: string;
  exportedAt: string;
  filename: string;
  bytes: number;
  sha256: string;
  paths: {
    latestZip: string;
    snapshotZip: string;
    manifest: string;
  };
};

export type BackupDraft = Pick<BackupStatus, "enabled" | "endpoint" | "region" | "bucket">;

export type SnapshotLogEntry = LogTableEntry;
