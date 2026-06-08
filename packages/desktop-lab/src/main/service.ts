import { join } from "node:path";
import { cloudClient } from "../cloud/client";
import type {
  BridgeResult,
  ConnectCloudInput,
  DesktopLabBridge,
  DesktopLabState,
  MarkdownWorkspace,
  SaveLocalNoteInput,
  SetModeInput,
} from "../bridge/types";
import { DesktopLabStore } from "./local-db";
import { MarkdownWorkspaceService } from "./markdown-workspace";

const nowIso = () => new Date().toISOString();

const ok = <T>(data: T): BridgeResult<T> => ({ ok: true, data });
const fail = <T>(error: unknown): BridgeResult<T> => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
});

export type DesktopLabServiceOptions = {
  dataDir?: string;
};

type DesktopLabDataBridge = Pick<
  DesktopLabBridge,
  | "getState"
  | "getMarkdownWorkspace"
  | "removeMarkdownFolder"
  | "rescanMarkdownFolders"
  | "readMarkdownFile"
  | "saveMarkdownFile"
  | "createMarkdownFile"
  | "renameMarkdownFile"
  | "deleteMarkdownFile"
  | "setMode"
  | "saveLocalNote"
  | "connectCloud"
  | "disconnectCloud"
  | "syncNow"
>;

type DesktopLabServiceExtra = {
  addMarkdownFolderPath: (path: string) => Promise<BridgeResult<MarkdownWorkspace>>;
};

export const createDesktopLabService = (
  options: DesktopLabServiceOptions = {},
): DesktopLabDataBridge & DesktopLabServiceExtra & { close: () => void } => {
  const dataDir = options.dataDir ?? join(import.meta.dir, "../../.local");
  const store = new DesktopLabStore(join(dataDir, "desktop-lab.sqlite"));
  const markdown = new MarkdownWorkspaceService(store);

  const service: DesktopLabDataBridge & DesktopLabServiceExtra & { close: () => void } = {
    getState: async () => ok(store.getState()),

    getMarkdownWorkspace: async () => {
      try {
        return ok(markdown.getWorkspace());
      } catch (error) {
        return fail(error);
      }
    },

    addMarkdownFolderPath: async (path) => {
      try {
        return ok(markdown.addFolder(path));
      } catch (error) {
        return fail(error);
      }
    },

    removeMarkdownFolder: async (input) => {
      try {
        return ok(markdown.removeFolder(input.id));
      } catch (error) {
        return fail(error);
      }
    },

    rescanMarkdownFolders: async () => {
      try {
        return ok(markdown.getWorkspace());
      } catch (error) {
        return fail(error);
      }
    },

    readMarkdownFile: async (input) => {
      try {
        return ok(markdown.readFile(input.path));
      } catch (error) {
        return fail(error);
      }
    },

    saveMarkdownFile: async (input) => {
      try {
        return ok(markdown.saveFile(input.path, input.markdown));
      } catch (error) {
        return fail(error);
      }
    },

    createMarkdownFile: async (input) => {
      try {
        return ok(markdown.createFile(input.folderId, input.name));
      } catch (error) {
        return fail(error);
      }
    },

    renameMarkdownFile: async (input) => {
      try {
        return ok(markdown.renameFile(input.path, input.name));
      } catch (error) {
        return fail(error);
      }
    },

    deleteMarkdownFile: async (input) => {
      try {
        return ok(markdown.deleteFile(input.path));
      } catch (error) {
        return fail(error);
      }
    },

    setMode: async (input: SetModeInput) => {
      try {
        return ok(store.setMode(input.mode));
      } catch (error) {
        return fail(error);
      }
    },

    saveLocalNote: async (input: SaveLocalNoteInput) => {
      try {
        return ok(store.setLocalNote(input.value));
      } catch (error) {
        return fail(error);
      }
    },

    connectCloud: async (input: ConnectCloudInput) => {
      try {
        const baseUrl = cloudClient.normalizeBaseUrl(input.baseUrl);
        const session = await cloudClient.adminLogin(baseUrl, input.adminToken);
        const connectedAt = nowIso();
        const state = store.saveCloudConnection({
          baseUrl,
          credentialKind: "session",
          sessionToken: session.sessionToken,
          user: {
            id: session.user.id,
            uid: session.user.uid,
            displayName: session.user.displayName,
            profile: session.user.profile,
            provider: session.user.provider,
            roles: session.user.roles,
          },
          connectedAt,
          lastVerifiedAt: connectedAt,
        });
        return ok(store.setSyncStatus({ state: "idle", message: "Cloud connection verified.", lastSyncAt: connectedAt }) ?? state);
      } catch (error) {
        return fail(error);
      }
    },

    disconnectCloud: async () => {
      try {
        return ok(store.clearCloudConnection());
      } catch (error) {
        return fail(error);
      }
    },

    syncNow: async () => {
      try {
        const connection = store.getCloudConnection();
        if (!connection) {
          const state = store.setSyncStatus({
            state: "idle",
            message: "Local-only mode: nothing to sync.",
            lastSyncAt: nowIso(),
          });
          return ok(state);
        }

        store.setSyncStatus({ state: "syncing", message: "Checking Cloud session...", lastSyncAt: store.getState().sync.lastSyncAt });
        const user = await cloudClient.getMe(connection.baseUrl, connection.sessionToken);
        const verifiedAt = nowIso();
        store.updateCloudVerification(
          {
            id: user.id,
            uid: user.uid,
            displayName: user.displayName,
            profile: user.profile,
            provider: user.provider,
            roles: user.roles,
          },
          verifiedAt,
        );
        const state = store.setSyncStatus({
          state: "idle",
          message: "Cloud session is valid. No domain sync is configured yet.",
          lastSyncAt: verifiedAt,
        });
        return ok(state);
      } catch (error) {
        const state = store.setSyncStatus({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
          lastSyncAt: store.getState().sync.lastSyncAt,
        });
        return ok(state);
      }
    },

    close: () => store.close(),
  };

  return service;
};

export type DesktopLabService = ReturnType<typeof createDesktopLabService>;
