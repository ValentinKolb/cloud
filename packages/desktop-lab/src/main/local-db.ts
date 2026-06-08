import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { CloudConnection, DesktopLabState, DesktopMode, MarkdownWorkspace, SyncStatus } from "../bridge/types";

type StoredConnection = CloudConnection & {
  sessionToken: string;
};

const DEFAULT_SYNC: SyncStatus = {
  state: "idle",
  message: "Local data is ready.",
  lastSyncAt: null,
};

const readJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class DesktopLabStore {
  readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.migrate();
  }

  close() {
    this.db.close();
  }

  getState(): DesktopLabState {
    const connection = this.getCloudConnection();
    const mode = this.getSetting<DesktopMode>("mode", connection ? "cloud" : "unset");
    return {
      mode,
      localNote: this.getSetting("local.note", ""),
      cloud: connection ? this.toPublicConnection(connection) : null,
      sync: this.getSetting("sync.status", DEFAULT_SYNC),
    };
  }

  setMode(mode: Exclude<DesktopMode, "unset">): DesktopLabState {
    this.setSetting("mode", mode);
    return this.getState();
  }

  setLocalNote(value: string): DesktopLabState {
    this.setSetting("local.note", value);
    return this.getState();
  }

  getMarkdownFolderPaths(): string[] {
    const rows = this.db.query("SELECT path FROM markdown_folders ORDER BY added_at ASC").all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  getLastMarkdownFilePath(): string | null {
    return this.getSetting<string | null>("markdown.lastFilePath", null);
  }

  setLastMarkdownFilePath(path: string | null): void {
    this.setSetting("markdown.lastFilePath", path);
  }

  addMarkdownFolder(path: string): void {
    this.db
      .query(`
        INSERT INTO markdown_folders (path, added_at)
        VALUES ($path, CURRENT_TIMESTAMP)
        ON CONFLICT(path) DO NOTHING
      `)
      .run({ $path: path });
  }

  removeMarkdownFolder(path: string): void {
    this.db.query("DELETE FROM markdown_folders WHERE path = $path").run({ $path: path });
    if (this.getLastMarkdownFilePath()?.startsWith(path)) this.setLastMarkdownFilePath(null);
  }

  saveMarkdownWorkspaceSnapshot(workspace: MarkdownWorkspace): void {
    this.setSetting("markdown.workspaceSnapshot", workspace);
  }

  getMarkdownWorkspaceSnapshot(): MarkdownWorkspace {
    return this.getSetting<MarkdownWorkspace>("markdown.workspaceSnapshot", { folders: [], lastFilePath: null });
  }

  setSyncStatus(sync: SyncStatus): DesktopLabState {
    this.setSetting("sync.status", sync);
    return this.getState();
  }

  saveCloudConnection(connection: StoredConnection): DesktopLabState {
    this.db
      .query(`
      INSERT INTO cloud_connections (
        id, base_url, credential_kind, session_token, user_json, connected_at, last_verified_at
      )
      VALUES ('primary', $baseUrl, $credentialKind, $sessionToken, $userJson, $connectedAt, $lastVerifiedAt)
      ON CONFLICT(id) DO UPDATE SET
        base_url = excluded.base_url,
        credential_kind = excluded.credential_kind,
        session_token = excluded.session_token,
        user_json = excluded.user_json,
        connected_at = excluded.connected_at,
        last_verified_at = excluded.last_verified_at
    `)
      .run({
        $baseUrl: connection.baseUrl,
        $credentialKind: connection.credentialKind,
        $sessionToken: connection.sessionToken,
        $userJson: JSON.stringify(connection.user),
        $connectedAt: connection.connectedAt,
        $lastVerifiedAt: connection.lastVerifiedAt,
      });
    this.setSetting("mode", "cloud");
    return this.getState();
  }

  updateCloudVerification(user: StoredConnection["user"], verifiedAt: string): StoredConnection | null {
    const current = this.getCloudConnection();
    if (!current) return null;
    const updated = { ...current, user, lastVerifiedAt: verifiedAt };
    this.saveCloudConnection(updated);
    return updated;
  }

  getCloudConnection(): StoredConnection | null {
    const row = this.db
      .query(`
      SELECT base_url, credential_kind, session_token, user_json, connected_at, last_verified_at
      FROM cloud_connections
      WHERE id = 'primary'
    `)
      .get() as {
      base_url: string;
      credential_kind: CloudConnection["credentialKind"] | null;
      session_token: string;
      user_json: string;
      connected_at: string;
      last_verified_at: string | null;
    } | null;

    if (!row) return null;
    const user = readJson<StoredConnection["user"] | null>(row.user_json, null);
    if (!user) return null;
    return {
      baseUrl: row.base_url,
      credentialKind: row.credential_kind ?? "session",
      sessionToken: row.session_token,
      user,
      connectedAt: row.connected_at,
      lastVerifiedAt: row.last_verified_at,
    };
  }

  clearCloudConnection(): DesktopLabState {
    this.db.query("DELETE FROM cloud_connections WHERE id = 'primary'").run();
    this.setSetting("mode", "local");
    this.setSyncStatus({ state: "idle", message: "Cloud connection removed. Local data is still available.", lastSyncAt: null });
    return this.getState();
  }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS local_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cloud_connections (
        id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        credential_kind TEXT NOT NULL DEFAULT 'session',
        session_token TEXT NOT NULL,
        user_json TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_verified_at TEXT
      )
    `);
    this.addColumnIfMissing("cloud_connections", "credential_kind", "TEXT NOT NULL DEFAULT 'session'");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        scope TEXT PRIMARY KEY,
        cursor TEXT,
        last_pull_at TEXT,
        last_push_at TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS markdown_folders (
        path TEXT PRIMARY KEY,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private getSetting<T>(key: string, fallback: T): T {
    const row = this.db.query("SELECT value_json FROM local_settings WHERE key = $key").get({ $key: key }) as { value_json: string } | null;
    return readJson(row?.value_json ?? null, fallback);
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private setSetting(key: string, value: unknown) {
    this.db
      .query(`
      INSERT INTO local_settings (key, value_json, updated_at)
      VALUES ($key, $value, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
      .run({ $key: key, $value: JSON.stringify(value) });
  }

  private toPublicConnection(connection: StoredConnection): CloudConnection {
    return {
      baseUrl: connection.baseUrl,
      credentialKind: connection.credentialKind,
      user: connection.user,
      connectedAt: connection.connectedAt,
      lastVerifiedAt: connection.lastVerifiedAt,
    };
  }
}
