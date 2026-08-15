import { type SQL, type SQLQuery, sql } from "bun";
import type { CloudResourceRef } from "../contracts/capabilities";
import type { AccessSubject } from "../server";
import {
  buildAccessPrincipalCondition,
  createAccess,
  deleteAccess,
  hasPermission,
  type PermissionLevel,
  type Principal,
} from "../server/services/access";
import { toPgUuidArray } from "../services/postgres";
import { mountAiProjectFilePath } from "./file-mount";
import { withAiShortIdForDb } from "./short-id";
import type { AiProjectPromptSnapshot } from "./types";

export const AI_PROJECT_NAME_MAX_CHARS = 120;
export const AI_PROJECT_DESCRIPTION_MAX_CHARS = 500;
export const AI_PROJECT_INSTRUCTIONS_MAX_CHARS = 16_000;
export const AI_PROJECT_KNOWLEDGE_MAX_CHARS = 100_000;
export const AI_PROJECT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const AI_PROJECT_PROMPT_MANIFEST_MAX_CHARS = 20_000;

export type AiProjectPermission = Exclude<PermissionLevel, "none">;

export class AiProjectLastAdminError extends Error {
  constructor() {
    super("A Project must keep at least one admin access entry.");
    this.name = "AiProjectLastAdminError";
  }
}

export type AiProject = {
  id: string;
  shortId: string;
  appId: string;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  defaultModelProfileId: string | null;
  permission: AiProjectPermission;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AiProjectKnowledge = {
  id: string;
  shortId: string;
  projectId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type AiProjectFile = {
  id: string;
  shortId: string;
  projectId: string;
  path: string;
  mediaType: string;
  size: number;
  updatedAt: string;
};

export type AiProjectReference = {
  id: string;
  shortId: string;
  projectId: string;
  ref: CloudResourceRef;
  label: string;
  createdAt: string;
};

export type AiProjectAccess = {
  id: string;
  shortId: string;
  principal: Principal;
  permission: AiProjectPermission;
  displayName?: string;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  short_id: string;
  app_id: string;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  default_model_profile_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type KnowledgeRow = {
  id: string;
  short_id: string;
  project_id: string;
  title: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type FileRow = {
  id: string;
  short_id: string;
  project_id: string;
  path: string;
  media_type: string;
  size: number;
  updated_at: Date | string;
};

type ReferenceRow = {
  id: string;
  short_id: string;
  project_id: string;
  resource_type: string;
  resource_id: string;
  label: string;
  created_at: Date | string;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const actorUserId = (subject: AccessSubject | null): string | null => (subject?.type === "user" ? subject.userId : null);

const principalForSubject = (subject: AccessSubject): Principal =>
  subject.type === "user"
    ? { type: "user", userId: subject.userId }
    : { type: "service_account", serviceAccountId: subject.serviceAccountId };

const accessMatch = (subject: AccessSubject | null): SQLQuery =>
  buildAccessPrincipalCondition({
    subject,
    columns: {
      userId: sql`access.user_id`,
      groupId: sql`access.group_id`,
      serviceAccountId: sql`access.service_account_id`,
      authenticatedOnly: sql`access.authenticated_only`,
    },
  });

const permissionFor = async (row: ProjectRow, subject: AccessSubject | null, db: SQL = sql): Promise<AiProjectPermission | "none"> => {
  const match = accessMatch(subject);
  const rows = await db<{ permission: AiProjectPermission }[]>`
    SELECT access.permission
    FROM ai.project_access project_access
    JOIN auth.access access ON access.id = project_access.access_id
    WHERE project_access.project_id = ${row.id}::uuid AND ${match}
    ORDER BY CASE access.permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END DESC
    LIMIT 1
  `;
  return rows[0]?.permission ?? "none";
};

const toProject = async (row: ProjectRow, subject: AccessSubject | null, db: SQL = sql): Promise<AiProject | null> => {
  const permission = await permissionFor(row, subject, db);
  if (permission === "none") return null;
  return {
    id: row.id,
    shortId: row.short_id,
    appId: row.app_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    instructions: row.instructions,
    defaultModelProfileId: row.default_model_profile_id,
    permission,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

const toKnowledge = (row: KnowledgeRow): AiProjectKnowledge => ({
  id: row.id,
  shortId: row.short_id,
  projectId: row.project_id,
  title: row.title,
  content: row.content,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const toFile = (row: FileRow): AiProjectFile => ({
  id: row.id,
  shortId: row.short_id,
  projectId: row.project_id,
  path: row.path,
  mediaType: row.media_type,
  size: Number(row.size),
  updatedAt: iso(row.updated_at),
});

const toReference = (row: ReferenceRow): AiProjectReference => ({
  id: row.id,
  shortId: row.short_id,
  projectId: row.project_id,
  ref: { type: row.resource_type, id: row.resource_id },
  label: row.label,
  createdAt: iso(row.created_at),
});

const getRow = async (projectId: string, appId: string): Promise<ProjectRow | null> => {
  const rows = await sql<ProjectRow[]>`SELECT * FROM ai.projects WHERE id = ${projectId}::uuid AND app_id = ${appId}`;
  return rows[0] ?? null;
};

const getRowByShortId = async (shortId: string): Promise<ProjectRow | null> => {
  const rows = await sql<ProjectRow[]>`SELECT * FROM ai.projects WHERE short_id = ${shortId}`;
  return rows[0] ?? null;
};

const requireProject = async (
  projectId: string,
  appId: string,
  subject: AccessSubject | null,
  permission: AiProjectPermission = "read",
): Promise<AiProject | null> => {
  const row = await getRow(projectId, appId);
  if (!row) return null;
  const project = await toProject(row, subject);
  return project && hasPermission(project.permission, permission) ? project : null;
};

const requireProjectByShortId = async (
  shortId: string,
  appId: string,
  subject: AccessSubject | null,
  permission: AiProjectPermission = "read",
): Promise<AiProject | null> => {
  const row = await getRowByShortId(shortId);
  if (!row || row.app_id !== appId) return null;
  const project = await toProject(row, subject);
  return project && hasPermission(project.permission, permission) ? project : null;
};

const touchProject = async (db: SQL, projectId: string): Promise<void> => {
  await db`UPDATE ai.projects SET revision = revision + 1, updated_at = now() WHERE id = ${projectId}::uuid`;
};

const normalizeProjectPath = (value: string): string => {
  const path = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.length > 500 || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid project file path.");
  }
  return path;
};

export const aiProjects = {
  async create(input: {
    appId: string;
    subject: AccessSubject;
    name: string;
    description?: string;
    icon?: string;
    instructions?: string;
    defaultModelProfileId?: string | null;
  }): Promise<AiProject> {
    return sql.begin(async (tx) => {
      const rows = await withAiShortIdForDb(
        tx,
        "idx_ai_projects_short_id",
        (attempt, shortId) => attempt<ProjectRow[]>`
        INSERT INTO ai.projects (short_id, app_id, name, description, icon, instructions, default_model_profile_id)
        VALUES (
          ${shortId}, ${input.appId},
          ${input.name.trim()}, ${input.description?.trim() ?? ""}, ${input.icon?.trim() || "ti ti-folders"},
          ${input.instructions?.trim() ?? ""}, ${input.defaultModelProfileId?.trim() || null}
        )
        RETURNING *
      `,
      );
      const created = await createAccess({ principal: principalForSubject(input.subject), permission: "admin" }, tx);
      if (!created.ok) throw new Error(created.error.message);
      await withAiShortIdForDb(
        tx,
        "idx_ai_project_access_short_id",
        (attempt, shortId) => attempt`
        INSERT INTO ai.project_access (project_id, access_id, short_id)
        VALUES (${rows[0]!.id}::uuid, ${created.data.id}::uuid, ${shortId})
      `,
      );
      return { ...(await toProject(rows[0]!, input.subject, tx))!, permission: "admin" };
    });
  },

  async list(subject: AccessSubject | null, appId: string): Promise<AiProject[]> {
    const match = accessMatch(subject);
    const rows = await sql<ProjectRow[]>`
      SELECT DISTINCT project.*, lower(project.name) AS sort_name
      FROM ai.projects project
      JOIN ai.project_access project_access ON project_access.project_id = project.id
      JOIN auth.access access ON access.id = project_access.access_id
      WHERE project.app_id = ${appId}
        AND access.permission <> 'none' AND ${match}
      ORDER BY lower(project.name), project.id
      LIMIT 200
    `;
    return (await Promise.all(rows.map((row) => toProject(row, subject)))).filter((project): project is AiProject => Boolean(project));
  },

  async resolveShortIds(projectIds: readonly string[], appId: string, subject: AccessSubject | null): Promise<Map<string, string>> {
    const ids = [...new Set(projectIds)];
    if (!ids.length) return new Map();
    const match = accessMatch(subject);
    const rows = await sql<{ id: string; short_id: string }[]>`
      SELECT DISTINCT project.id, project.short_id
      FROM ai.projects project
      JOIN ai.project_access project_access ON project_access.project_id = project.id
      JOIN auth.access access ON access.id = project_access.access_id
      WHERE project.id = ANY(${toPgUuidArray(ids)}::uuid[])
        AND project.app_id = ${appId}
        AND access.permission <> 'none' AND ${match}
    `;
    return new Map(rows.map((row) => [row.id, row.short_id]));
  },

  async scopeVersion(subject: AccessSubject | null, appId: string): Promise<string> {
    const projects = await this.list(subject, appId);
    return projects
      .map((project) => `${project.shortId}:${project.permission}`)
      .sort()
      .join("|");
  },

  get: requireProject,
  getByShortId: requireProjectByShortId,

  async update(
    projectId: string,
    appId: string,
    subject: AccessSubject | null,
    input: Partial<Pick<AiProject, "name" | "description" | "icon" | "instructions" | "defaultModelProfileId">>,
  ): Promise<AiProject | null> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return null;
    const rows = await sql<ProjectRow[]>`
      UPDATE ai.projects
      SET name = COALESCE(${input.name?.trim() ?? null}, name),
          description = COALESCE(${input.description?.trim() ?? null}, description),
          icon = COALESCE(${input.icon?.trim() ?? null}, icon),
          instructions = COALESCE(${input.instructions?.trim() ?? null}, instructions),
          default_model_profile_id = CASE
            WHEN ${Object.hasOwn(input, "defaultModelProfileId")} THEN ${input.defaultModelProfileId?.trim() || null}
            ELSE default_model_profile_id
          END,
          revision = revision + 1,
          updated_at = now()
      WHERE id = ${projectId}::uuid AND app_id = ${appId}
      RETURNING *
    `;
    return rows[0] ? toProject(rows[0], subject) : null;
  },

  async delete(projectId: string, appId: string, subject: AccessSubject | null): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [project] = await tx<ProjectRow[]>`
        SELECT * FROM ai.projects WHERE id = ${projectId}::uuid AND app_id = ${appId} FOR UPDATE
      `;
      if (!project || !hasPermission(await permissionFor(project, subject, tx), "admin")) return false;
      const accessIds = (
        await tx<{ access_id: string }[]>`SELECT access_id FROM ai.project_access WHERE project_id = ${projectId}::uuid`
      ).map((row) => row.access_id);
      await tx`DELETE FROM ai.projects WHERE id = ${projectId}::uuid`;
      if (accessIds.length) await tx`DELETE FROM auth.access WHERE id = ANY(${toPgUuidArray(accessIds)}::uuid[])`;
      return true;
    });
  },

  async snapshot(projectId: string, appId: string, subject: AccessSubject | null): Promise<AiProjectPromptSnapshot | null> {
    const project = await requireProject(projectId, appId, subject, "read");
    if (!project) return null;
    const [knowledge, files, references] = await Promise.all([
      this.listKnowledge(projectId, appId, subject),
      this.listFiles(projectId, appId, subject),
      this.listReferences(projectId, appId, subject),
    ]);
    const lines = [
      `Project: ${project.name} (${project.shortId}, revision ${project.revision})`,
      project.description ? `Description: ${project.description}` : null,
      knowledge.length ? `Knowledge entries:\n${knowledge.map((item) => `- ${item.title} [${item.shortId}]`).join("\n")}` : null,
      files.length
        ? `Files (read-only below /project):\n${files
            .map((file) => `- ${mountAiProjectFilePath(file.path)} (${file.mediaType}, ${file.size} bytes) [${file.shortId}]`)
            .join("\n")}`
        : null,
      references.length
        ? `Cloud references (metadata only; use authorized app capabilities to read the source):\n${references
            .map((reference) => `- ${reference.label || reference.ref.id}: ${reference.ref.type}/${reference.ref.id}`)
            .join("\n")}`
        : null,
    ].filter(Boolean);
    return {
      id: project.shortId,
      appId: project.appId,
      name: project.name,
      revision: project.revision,
      instructions: project.instructions,
      context: lines.join("\n").slice(0, AI_PROJECT_PROMPT_MANIFEST_MAX_CHARS),
      references: references.map((reference) => reference.ref),
      defaultModelProfileId: project.defaultModelProfileId,
    };
  },

  async listAccess(projectId: string, appId: string, subject: AccessSubject | null): Promise<AiProjectAccess[] | null> {
    if (!(await requireProject(projectId, appId, subject, "admin"))) return null;
    const rows = await sql<
      {
        short_id: string;
        user_id: string | null;
        group_id: string | null;
        service_account_id: string | null;
        authenticated_only: boolean;
        permission: AiProjectPermission;
        created_at: Date | string;
        display_name: string | null;
      }[]
    >`
      SELECT project_access.short_id, access.user_id, access.group_id, access.service_account_id, access.authenticated_only,
             access.permission, access.created_at,
             COALESCE(users.display_name, groups.name, service_accounts.name,
               CASE WHEN access.authenticated_only THEN 'All authenticated users' ELSE 'Public' END) AS display_name
      FROM ai.project_access project_access
      JOIN auth.access access ON access.id = project_access.access_id
      LEFT JOIN auth.users users ON users.id = access.user_id
      LEFT JOIN auth.groups groups ON groups.id = access.group_id
      LEFT JOIN auth.service_accounts service_accounts ON service_accounts.id = access.service_account_id
      WHERE project_access.project_id = ${projectId}::uuid
      ORDER BY access.created_at, access.id
    `;
    return rows.map((row) => ({
      id: row.short_id,
      shortId: row.short_id,
      principal: row.user_id
        ? { type: "user", userId: row.user_id }
        : row.group_id
          ? { type: "group", groupId: row.group_id }
          : row.service_account_id
            ? { type: "service_account", serviceAccountId: row.service_account_id }
            : row.authenticated_only
              ? { type: "authenticated" }
              : { type: "public" },
      permission: row.permission,
      displayName: row.display_name ?? undefined,
      createdAt: iso(row.created_at),
    }));
  },

  async grantAccess(
    projectId: string,
    appId: string,
    subject: AccessSubject | null,
    input: { principal: Principal; permission: AiProjectPermission },
  ): Promise<AiProjectAccess | null> {
    return sql.begin(async (tx) => {
      const [row] = await tx<ProjectRow[]>`
        SELECT * FROM ai.projects WHERE id = ${projectId}::uuid AND app_id = ${appId} FOR UPDATE
      `;
      if (!row || !hasPermission(await permissionFor(row, subject, tx), "admin")) return null;
      const created = await createAccess(input, tx);
      if (!created.ok) throw new Error(created.error.message);
      let shortId = "";
      await withAiShortIdForDb(tx, "idx_ai_project_access_short_id", (attempt, candidate) => {
        shortId = candidate;
        return attempt`
            INSERT INTO ai.project_access (project_id, access_id, short_id)
            VALUES (${projectId}::uuid, ${created.data.id}::uuid, ${candidate})
          `;
      });
      const [entry] = await tx<
        {
          user_id: string | null;
          group_id: string | null;
          service_account_id: string | null;
          authenticated_only: boolean;
          permission: AiProjectPermission;
          created_at: Date | string;
          display_name: string | null;
        }[]
      >`
        SELECT access.user_id, access.group_id, access.service_account_id, access.authenticated_only,
               access.permission, access.created_at,
               COALESCE(users.display_name, groups.name, service_accounts.name,
                 CASE WHEN access.authenticated_only THEN 'All authenticated users' ELSE 'Public' END) AS display_name
        FROM ai.project_access project_access
        JOIN auth.access access ON access.id = project_access.access_id
        LEFT JOIN auth.users users ON users.id = access.user_id
        LEFT JOIN auth.groups groups ON groups.id = access.group_id
        LEFT JOIN auth.service_accounts service_accounts ON service_accounts.id = access.service_account_id
        WHERE project_access.project_id = ${projectId}::uuid AND project_access.short_id = ${shortId}
      `;
      if (!entry) throw new Error("Failed to read the created Project access entry.");
      return {
        id: shortId,
        shortId,
        principal: entry.user_id
          ? { type: "user" as const, userId: entry.user_id }
          : entry.group_id
            ? { type: "group" as const, groupId: entry.group_id }
            : entry.service_account_id
              ? { type: "service_account" as const, serviceAccountId: entry.service_account_id }
              : entry.authenticated_only
                ? { type: "authenticated" as const }
                : { type: "public" as const },
        permission: entry.permission,
        displayName: entry.display_name ?? undefined,
        createdAt: iso(entry.created_at),
      };
    });
  },

  async updateAccess(
    projectId: string,
    appId: string,
    accessId: string,
    subject: AccessSubject | null,
    permission: AiProjectPermission,
  ): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [project] = await tx<ProjectRow[]>`
        SELECT * FROM ai.projects WHERE id = ${projectId}::uuid AND app_id = ${appId} FOR UPDATE
      `;
      if (!project || !hasPermission(await permissionFor(project, subject, tx), "admin")) return false;
      const [bound] = await tx<{ id: string; permission: AiProjectPermission }[]>`
        SELECT access.id, access.permission
        FROM ai.project_access project_access
        JOIN auth.access access ON access.id = project_access.access_id
        WHERE project_access.project_id = ${projectId}::uuid AND project_access.short_id = ${accessId}
      `;
      if (!bound) return false;
      if (bound.permission === "admin" && permission !== "admin") {
        const [admins] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM ai.project_access project_access
          JOIN auth.access access ON access.id = project_access.access_id
          WHERE project_access.project_id = ${projectId}::uuid AND access.permission = 'admin'
        `;
        if ((admins?.count ?? 0) <= 1) throw new AiProjectLastAdminError();
      }
      const result = await tx`
        UPDATE auth.access SET permission = ${permission}::auth.permission_level WHERE id = ${bound.id}::uuid
      `;
      return result.count === 1;
    });
  },

  async revokeAccess(projectId: string, appId: string, accessId: string, subject: AccessSubject | null): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [project] = await tx<ProjectRow[]>`
        SELECT * FROM ai.projects WHERE id = ${projectId}::uuid AND app_id = ${appId} FOR UPDATE
      `;
      if (!project || !hasPermission(await permissionFor(project, subject, tx), "admin")) return false;
      const [bound] = await tx<{ access_id: string; permission: AiProjectPermission }[]>`
        SELECT project_access.access_id, access.permission
        FROM ai.project_access project_access
        JOIN auth.access access ON access.id = project_access.access_id
        WHERE project_access.project_id = ${projectId}::uuid AND project_access.short_id = ${accessId}
      `;
      if (!bound) return false;
      if (bound.permission === "admin") {
        const [admins] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM ai.project_access project_access
          JOIN auth.access access ON access.id = project_access.access_id
          WHERE project_access.project_id = ${projectId}::uuid AND access.permission = 'admin'
        `;
        if ((admins?.count ?? 0) <= 1) throw new AiProjectLastAdminError();
      }
      const deleted = await deleteAccess({ id: bound.access_id }, tx);
      if (!deleted.ok) throw new Error(deleted.error.message);
      return true;
    });
  },

  async listKnowledge(projectId: string, appId: string, subject: AccessSubject | null, query?: string): Promise<AiProjectKnowledge[]> {
    if (!(await requireProject(projectId, appId, subject, "read"))) return [];
    const q = query?.trim() || null;
    const pattern = q ? `%${q.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
    const rows = await sql<KnowledgeRow[]>`
      SELECT * FROM ai.project_knowledge
      WHERE project_id = ${projectId}::uuid
        AND (${q}::text IS NULL OR lower(title) LIKE ${pattern} ESCAPE '\\' OR lower(content) LIKE ${pattern} ESCAPE '\\'
          OR search_document @@ websearch_to_tsquery('simple', ${q ?? ""}))
      ORDER BY updated_at DESC, id
      LIMIT 100
    `;
    return rows.map(toKnowledge);
  },

  async createKnowledge(
    projectId: string,
    appId: string,
    subject: AccessSubject | null,
    input: { title: string; content: string },
  ): Promise<AiProjectKnowledge | null> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return null;
    return sql.begin(async (tx) => {
      const rows = await withAiShortIdForDb(
        tx,
        "idx_ai_project_knowledge_short_id",
        (attempt, shortId) => attempt<KnowledgeRow[]>`
        INSERT INTO ai.project_knowledge (short_id, project_id, title, content, created_by_user_id)
        VALUES (${shortId}, ${projectId}::uuid, ${input.title.trim()}, ${input.content.trim()}, ${actorUserId(subject)}::uuid)
        RETURNING *
      `,
      );
      await touchProject(tx, projectId);
      return toKnowledge(rows[0]!);
    });
  },

  async updateKnowledge(
    projectId: string,
    appId: string,
    knowledgeId: string,
    subject: AccessSubject | null,
    input: { title?: string; content?: string },
  ): Promise<AiProjectKnowledge | null> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return null;
    return sql.begin(async (tx) => {
      const rows = await tx<KnowledgeRow[]>`
        UPDATE ai.project_knowledge
        SET title = COALESCE(${input.title?.trim() ?? null}, title), content = COALESCE(${input.content?.trim() ?? null}, content), updated_at = now()
        WHERE short_id = ${knowledgeId} AND project_id = ${projectId}::uuid
        RETURNING *
      `;
      if (rows[0]) await touchProject(tx, projectId);
      return rows[0] ? toKnowledge(rows[0]) : null;
    });
  },

  async deleteKnowledge(projectId: string, appId: string, knowledgeId: string, subject: AccessSubject | null): Promise<boolean> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return false;
    return sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM ai.project_knowledge WHERE short_id = ${knowledgeId} AND project_id = ${projectId}::uuid RETURNING id
      `;
      if (rows[0]) await touchProject(tx, projectId);
      return Boolean(rows[0]);
    });
  },

  async listFiles(projectId: string, appId: string, subject: AccessSubject | null): Promise<AiProjectFile[]> {
    if (!(await requireProject(projectId, appId, subject, "read"))) return [];
    return (
      await sql<
        FileRow[]
      >`SELECT id, short_id, project_id, path, media_type, size, updated_at FROM ai.project_files WHERE project_id = ${projectId}::uuid ORDER BY path LIMIT 500`
    ).map(toFile);
  },

  async writeFile(
    projectId: string,
    appId: string,
    subject: AccessSubject | null,
    input: { path: string; mediaType: string; bytes: Uint8Array },
  ): Promise<AiProjectFile | null> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return null;
    if (input.bytes.byteLength > AI_PROJECT_FILE_MAX_BYTES) throw new Error("Project file exceeds the size limit.");
    const path = normalizeProjectPath(input.path);
    return sql.begin(async (tx) => {
      const rows = await withAiShortIdForDb(
        tx,
        "idx_ai_project_files_short_id",
        (attempt, shortId) => attempt<FileRow[]>`
        INSERT INTO ai.project_files (short_id, project_id, path, media_type, bytes, size, created_by_user_id)
        VALUES (${shortId}, ${projectId}::uuid, ${path}, ${input.mediaType.trim() || "application/octet-stream"}, ${input.bytes}, ${input.bytes.byteLength}, ${actorUserId(subject)}::uuid)
        ON CONFLICT (project_id, path) DO UPDATE SET
          media_type = EXCLUDED.media_type, bytes = EXCLUDED.bytes, size = EXCLUDED.size, updated_at = now()
        RETURNING id, short_id, project_id, path, media_type, size, updated_at
      `,
      );
      await touchProject(tx, projectId);
      return toFile(rows[0]!);
    });
  },

  async readFile(
    projectId: string,
    appId: string,
    fileId: string,
    subject: AccessSubject | null,
  ): Promise<(AiProjectFile & { bytes: Uint8Array }) | null> {
    if (!(await requireProject(projectId, appId, subject, "read"))) return null;
    const rows = await sql<(FileRow & { bytes: Uint8Array })[]>`
      SELECT id, short_id, project_id, path, media_type, size, updated_at, bytes FROM ai.project_files
      WHERE short_id = ${fileId} AND project_id = ${projectId}::uuid
    `;
    return rows[0] ? { ...toFile(rows[0]), bytes: rows[0].bytes } : null;
  },

  async readFileByPath(
    projectId: string,
    appId: string,
    path: string,
    subject: AccessSubject | null,
  ): Promise<(AiProjectFile & { bytes: Uint8Array }) | null> {
    if (!(await requireProject(projectId, appId, subject, "read"))) return null;
    const normalized = normalizeProjectPath(path);
    const rows = await sql<(FileRow & { bytes: Uint8Array })[]>`
      SELECT id, short_id, project_id, path, media_type, size, updated_at, bytes FROM ai.project_files
      WHERE path = ${normalized} AND project_id = ${projectId}::uuid
    `;
    return rows[0] ? { ...toFile(rows[0]), bytes: rows[0].bytes } : null;
  },

  async deleteFile(projectId: string, appId: string, fileId: string, subject: AccessSubject | null): Promise<boolean> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return false;
    return sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM ai.project_files WHERE short_id = ${fileId} AND project_id = ${projectId}::uuid RETURNING id
      `;
      if (rows[0]) await touchProject(tx, projectId);
      return Boolean(rows[0]);
    });
  },

  async listReferences(projectId: string, appId: string, subject: AccessSubject | null): Promise<AiProjectReference[]> {
    if (!(await requireProject(projectId, appId, subject, "read"))) return [];
    return (
      await sql<
        ReferenceRow[]
      >`SELECT * FROM ai.project_resource_refs WHERE project_id = ${projectId}::uuid ORDER BY created_at, id LIMIT 500`
    ).map(toReference);
  },

  async createReference(
    projectId: string,
    appId: string,
    subject: AccessSubject | null,
    input: { ref: CloudResourceRef; label?: string },
  ): Promise<AiProjectReference | null> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return null;
    return sql.begin(async (tx) => {
      const rows = await withAiShortIdForDb(
        tx,
        "idx_ai_project_resource_refs_short_id",
        (attempt, shortId) => attempt<ReferenceRow[]>`
        INSERT INTO ai.project_resource_refs (short_id, project_id, resource_type, resource_id, label)
        VALUES (${shortId}, ${projectId}::uuid, ${input.ref.type}, ${input.ref.id}, ${input.label?.trim() ?? ""})
        RETURNING *
      `,
      );
      await touchProject(tx, projectId);
      return toReference(rows[0]!);
    });
  },

  async deleteReference(projectId: string, appId: string, referenceId: string, subject: AccessSubject | null): Promise<boolean> {
    if (!(await requireProject(projectId, appId, subject, "write"))) return false;
    return sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM ai.project_resource_refs WHERE short_id = ${referenceId} AND project_id = ${projectId}::uuid RETURNING id
      `;
      if (rows[0]) await touchProject(tx, projectId);
      return Boolean(rows[0]);
    });
  },
};
