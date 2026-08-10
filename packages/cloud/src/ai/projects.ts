import { type SQLQuery, sql } from "bun";
import type { AccessSubject } from "../server";
import {
  buildAccessPrincipalCondition,
  createAccess,
  deleteAccess,
  getEffectivePermission,
  hasPermission,
  type PermissionLevel,
  type Principal,
  updateAccess as updateAccessEntry,
} from "../server/services/access";
import { toPgUuidArray } from "../services/postgres";
import type { AiProjectPromptSnapshot } from "./types";

export const AI_PROJECT_NAME_MAX_CHARS = 120;
export const AI_PROJECT_DESCRIPTION_MAX_CHARS = 500;
export const AI_PROJECT_INSTRUCTIONS_MAX_CHARS = 16_000;
export const AI_PROJECT_KNOWLEDGE_MAX_CHARS = 100_000;
export const AI_PROJECT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const AI_PROJECT_PROMPT_MANIFEST_MAX_CHARS = 20_000;

export type AiProjectPermission = Exclude<PermissionLevel, "none">;

export type AiProject = {
  id: string;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  defaultModelProfileId: string | null;
  ownerUserId: string;
  permission: AiProjectPermission;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AiProjectKnowledge = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type AiProjectFile = {
  id: string;
  projectId: string;
  path: string;
  mediaType: string;
  size: number;
  updatedAt: string;
};

export type AiProjectReference = {
  id: string;
  projectId: string;
  appId: string;
  resourceType: string;
  resourceId: string;
  label: string;
  createdAt: string;
};

export type AiProjectAccess = {
  id: string;
  principal: Principal;
  permission: AiProjectPermission;
  displayName?: string;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  default_model_profile_id: string | null;
  owner_user_id: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type KnowledgeRow = {
  id: string;
  project_id: string;
  title: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type FileRow = {
  id: string;
  project_id: string;
  path: string;
  media_type: string;
  size: number;
  updated_at: Date | string;
};

type ReferenceRow = {
  id: string;
  project_id: string;
  app_id: string;
  resource_type: string;
  resource_id: string;
  label: string;
  created_at: Date | string;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const ownerUserId = (subject: AccessSubject): string | null => (subject.type === "user" ? subject.userId : null);

const accessMatch = (subject: AccessSubject): SQLQuery =>
  buildAccessPrincipalCondition({
    subject,
    columns: {
      userId: sql`access.user_id`,
      groupId: sql`access.group_id`,
      serviceAccountId: sql`access.service_account_id`,
      authenticatedOnly: sql`access.authenticated_only`,
    },
  });

const projectAccessIds = async (projectId: string): Promise<string[]> =>
  (await sql<{ access_id: string }[]>`SELECT access_id FROM ai.project_access WHERE project_id = ${projectId}::uuid`).map(
    (row) => row.access_id,
  );

const permissionFor = async (row: ProjectRow, subject: AccessSubject): Promise<AiProjectPermission | "none"> => {
  if (subject.type === "user" && row.owner_user_id === subject.userId) return "admin";
  return getEffectivePermission({ accessIds: await projectAccessIds(row.id), subject });
};

const toProject = async (row: ProjectRow, subject: AccessSubject): Promise<AiProject | null> => {
  const permission = await permissionFor(row, subject);
  if (permission === "none") return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    instructions: row.instructions,
    defaultModelProfileId: row.default_model_profile_id,
    ownerUserId: row.owner_user_id,
    permission,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

const toKnowledge = (row: KnowledgeRow): AiProjectKnowledge => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  content: row.content,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const toFile = (row: FileRow): AiProjectFile => ({
  id: row.id,
  projectId: row.project_id,
  path: row.path,
  mediaType: row.media_type,
  size: Number(row.size),
  updatedAt: iso(row.updated_at),
});

const toReference = (row: ReferenceRow): AiProjectReference => ({
  id: row.id,
  projectId: row.project_id,
  appId: row.app_id,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  label: row.label,
  createdAt: iso(row.created_at),
});

const getRow = async (projectId: string): Promise<ProjectRow | null> => {
  const rows = await sql<ProjectRow[]>`SELECT * FROM ai.projects WHERE id = ${projectId}::uuid`;
  return rows[0] ?? null;
};

const requireProject = async (
  projectId: string,
  subject: AccessSubject,
  permission: AiProjectPermission = "read",
): Promise<AiProject | null> => {
  const row = await getRow(projectId);
  if (!row) return null;
  const project = await toProject(row, subject);
  return project && hasPermission(project.permission, permission) ? project : null;
};

const touchProject = async (projectId: string): Promise<void> => {
  await sql`UPDATE ai.projects SET revision = revision + 1, updated_at = now() WHERE id = ${projectId}::uuid`;
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
    subject: AccessSubject;
    name: string;
    description?: string;
    icon?: string;
    instructions?: string;
    defaultModelProfileId?: string | null;
  }): Promise<AiProject> {
    const userId = ownerUserId(input.subject);
    if (!userId) throw new Error("Projects require a user-backed actor.");
    const rows = await sql<ProjectRow[]>`
      INSERT INTO ai.projects (name, description, icon, instructions, default_model_profile_id, owner_user_id)
      VALUES (
        ${input.name.trim()}, ${input.description?.trim() ?? ""}, ${input.icon?.trim() || "ti ti-folders"},
        ${input.instructions?.trim() ?? ""}, ${input.defaultModelProfileId?.trim() || null}, ${userId}::uuid
      )
      RETURNING *
    `;
    return (await toProject(rows[0]!, input.subject))!;
  },

  async list(subject: AccessSubject): Promise<AiProject[]> {
    const userId = ownerUserId(subject);
    const match = accessMatch(subject);
    const rows = await sql<ProjectRow[]>`
      SELECT DISTINCT project.*
      FROM ai.projects project
      LEFT JOIN ai.project_access project_access ON project_access.project_id = project.id
      LEFT JOIN auth.access access ON access.id = project_access.access_id
      WHERE project.owner_user_id = ${userId}::uuid OR ${match}
      ORDER BY lower(project.name), project.id
      LIMIT 200
    `;
    return (await Promise.all(rows.map((row) => toProject(row, subject)))).filter((project): project is AiProject => Boolean(project));
  },

  get: requireProject,

  async update(
    projectId: string,
    subject: AccessSubject,
    input: Partial<Pick<AiProject, "name" | "description" | "icon" | "instructions" | "defaultModelProfileId">>,
  ): Promise<AiProject | null> {
    if (!(await requireProject(projectId, subject, "write"))) return null;
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
      WHERE id = ${projectId}::uuid
      RETURNING *
    `;
    return rows[0] ? toProject(rows[0], subject) : null;
  },

  async delete(projectId: string, subject: AccessSubject): Promise<boolean> {
    const project = await requireProject(projectId, subject, "admin");
    if (!project) return false;
    const accessIds = await projectAccessIds(projectId);
    await sql.begin(async (tx) => {
      await tx`DELETE FROM ai.projects WHERE id = ${projectId}::uuid`;
      if (accessIds.length) await tx`DELETE FROM auth.access WHERE id = ANY(${toPgUuidArray(accessIds)}::uuid[])`;
    });
    return true;
  },

  async snapshot(projectId: string, subject: AccessSubject): Promise<AiProjectPromptSnapshot | null> {
    const project = await requireProject(projectId, subject, "read");
    if (!project) return null;
    const [knowledge, files, references] = await Promise.all([
      this.listKnowledge(projectId, subject),
      this.listFiles(projectId, subject),
      this.listReferences(projectId, subject),
    ]);
    const lines = [
      `Project: ${project.name} (${project.id}, revision ${project.revision})`,
      project.description ? `Description: ${project.description}` : null,
      knowledge.length ? `Knowledge entries:\n${knowledge.map((item) => `- ${item.title} [${item.id}]`).join("\n")}` : null,
      files.length
        ? `Files:\n${files.map((file) => `- ${file.path} (${file.mediaType}, ${file.size} bytes) [${file.id}]`).join("\n")}`
        : null,
      references.length
        ? `Cloud references (metadata only; use authorized app capabilities to read the source):\n${references
            .map(
              (reference) =>
                `- ${reference.label || reference.resourceId}: ${reference.appId}/${reference.resourceType}/${reference.resourceId}`,
            )
            .join("\n")}`
        : null,
    ].filter(Boolean);
    return {
      id: project.id,
      name: project.name,
      revision: project.revision,
      instructions: project.instructions,
      context: lines.join("\n").slice(0, AI_PROJECT_PROMPT_MANIFEST_MAX_CHARS),
      defaultModelProfileId: project.defaultModelProfileId,
    };
  },

  async listAccess(projectId: string, subject: AccessSubject): Promise<AiProjectAccess[] | null> {
    if (!(await requireProject(projectId, subject, "admin"))) return null;
    const rows = await sql<
      {
        id: string;
        user_id: string | null;
        group_id: string | null;
        service_account_id: string | null;
        authenticated_only: boolean;
        permission: AiProjectPermission;
        created_at: Date | string;
        display_name: string | null;
      }[]
    >`
      SELECT access.id, access.user_id, access.group_id, access.service_account_id, access.authenticated_only,
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
      id: row.id,
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
    subject: AccessSubject,
    input: { principal: Principal; permission: AiProjectPermission },
  ): Promise<AiProjectAccess | null> {
    if (!(await requireProject(projectId, subject, "admin"))) return null;
    const created = await createAccess(input);
    if (!created.ok) throw new Error(created.error.message);
    try {
      await sql`INSERT INTO ai.project_access (project_id, access_id) VALUES (${projectId}::uuid, ${created.data.id}::uuid)`;
      const entries = await this.listAccess(projectId, subject);
      return entries?.find((entry) => entry.id === created.data.id) ?? null;
    } catch (error) {
      await deleteAccess({ id: created.data.id }).catch(() => undefined);
      throw error;
    }
  },

  async updateAccess(projectId: string, accessId: string, subject: AccessSubject, permission: AiProjectPermission): Promise<boolean> {
    if (!(await requireProject(projectId, subject, "admin"))) return false;
    const bound = await sql<{ id: string }[]>`
      SELECT access_id AS id FROM ai.project_access WHERE project_id = ${projectId}::uuid AND access_id = ${accessId}::uuid
    `;
    if (!bound[0]) return false;
    const result = await updateAccessEntry({ id: accessId, permission });
    return result.ok;
  },

  async revokeAccess(projectId: string, accessId: string, subject: AccessSubject): Promise<boolean> {
    if (!(await requireProject(projectId, subject, "admin"))) return false;
    const rows = await sql<{ access_id: string }[]>`
      DELETE FROM ai.project_access WHERE project_id = ${projectId}::uuid AND access_id = ${accessId}::uuid RETURNING access_id
    `;
    if (!rows[0]) return false;
    await deleteAccess({ id: accessId });
    return true;
  },

  async listKnowledge(projectId: string, subject: AccessSubject, query?: string): Promise<AiProjectKnowledge[]> {
    if (!(await requireProject(projectId, subject, "read"))) return [];
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
    subject: AccessSubject,
    input: { title: string; content: string },
  ): Promise<AiProjectKnowledge | null> {
    if (!(await requireProject(projectId, subject, "write"))) return null;
    const rows = await sql<KnowledgeRow[]>`
      INSERT INTO ai.project_knowledge (project_id, title, content, created_by_user_id)
      VALUES (${projectId}::uuid, ${input.title.trim()}, ${input.content.trim()}, ${ownerUserId(subject)}::uuid)
      RETURNING *
    `;
    await touchProject(projectId);
    return toKnowledge(rows[0]!);
  },

  async updateKnowledge(
    projectId: string,
    knowledgeId: string,
    subject: AccessSubject,
    input: { title?: string; content?: string },
  ): Promise<AiProjectKnowledge | null> {
    if (!(await requireProject(projectId, subject, "write"))) return null;
    const rows = await sql<KnowledgeRow[]>`
      UPDATE ai.project_knowledge
      SET title = COALESCE(${input.title?.trim() ?? null}, title), content = COALESCE(${input.content?.trim() ?? null}, content), updated_at = now()
      WHERE id = ${knowledgeId}::uuid AND project_id = ${projectId}::uuid
      RETURNING *
    `;
    if (rows[0]) await touchProject(projectId);
    return rows[0] ? toKnowledge(rows[0]) : null;
  },

  async deleteKnowledge(projectId: string, knowledgeId: string, subject: AccessSubject): Promise<boolean> {
    if (!(await requireProject(projectId, subject, "write"))) return false;
    const rows = await sql<{ id: string }[]>`
      DELETE FROM ai.project_knowledge WHERE id = ${knowledgeId}::uuid AND project_id = ${projectId}::uuid RETURNING id
    `;
    if (rows[0]) await touchProject(projectId);
    return Boolean(rows[0]);
  },

  async listFiles(projectId: string, subject: AccessSubject): Promise<AiProjectFile[]> {
    if (!(await requireProject(projectId, subject, "read"))) return [];
    return (
      await sql<
        FileRow[]
      >`SELECT id, project_id, path, media_type, size, updated_at FROM ai.project_files WHERE project_id = ${projectId}::uuid ORDER BY path LIMIT 500`
    ).map(toFile);
  },

  async writeFile(
    projectId: string,
    subject: AccessSubject,
    input: { path: string; mediaType: string; bytes: Uint8Array },
  ): Promise<AiProjectFile | null> {
    if (!(await requireProject(projectId, subject, "write"))) return null;
    if (input.bytes.byteLength > AI_PROJECT_FILE_MAX_BYTES) throw new Error("Project file exceeds the size limit.");
    const path = normalizeProjectPath(input.path);
    const rows = await sql<FileRow[]>`
      INSERT INTO ai.project_files (project_id, path, media_type, bytes, size, created_by_user_id)
      VALUES (${projectId}::uuid, ${path}, ${input.mediaType.trim() || "application/octet-stream"}, ${input.bytes}, ${input.bytes.byteLength}, ${ownerUserId(subject)}::uuid)
      ON CONFLICT (project_id, path) DO UPDATE SET
        media_type = EXCLUDED.media_type, bytes = EXCLUDED.bytes, size = EXCLUDED.size, updated_at = now()
      RETURNING id, project_id, path, media_type, size, updated_at
    `;
    await touchProject(projectId);
    return toFile(rows[0]!);
  },

  async readFile(projectId: string, fileId: string, subject: AccessSubject): Promise<(AiProjectFile & { bytes: Uint8Array }) | null> {
    if (!(await requireProject(projectId, subject, "read"))) return null;
    const rows = await sql<(FileRow & { bytes: Uint8Array })[]>`
      SELECT id, project_id, path, media_type, size, updated_at, bytes FROM ai.project_files
      WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid
    `;
    return rows[0] ? { ...toFile(rows[0]), bytes: rows[0].bytes } : null;
  },

  async deleteFile(projectId: string, fileId: string, subject: AccessSubject): Promise<boolean> {
    if (!(await requireProject(projectId, subject, "write"))) return false;
    const rows = await sql<{ id: string }[]>`
      DELETE FROM ai.project_files WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid RETURNING id
    `;
    if (rows[0]) await touchProject(projectId);
    return Boolean(rows[0]);
  },

  async listReferences(projectId: string, subject: AccessSubject): Promise<AiProjectReference[]> {
    if (!(await requireProject(projectId, subject, "read"))) return [];
    return (
      await sql<ReferenceRow[]>`SELECT * FROM ai.project_references WHERE project_id = ${projectId}::uuid ORDER BY created_at, id LIMIT 500`
    ).map(toReference);
  },

  async createReference(
    projectId: string,
    subject: AccessSubject,
    input: { appId: string; resourceType: string; resourceId: string; label?: string },
  ): Promise<AiProjectReference | null> {
    if (!(await requireProject(projectId, subject, "write"))) return null;
    const rows = await sql<ReferenceRow[]>`
      INSERT INTO ai.project_references (project_id, app_id, resource_type, resource_id, label, created_by_user_id)
      VALUES (${projectId}::uuid, ${input.appId.trim()}, ${input.resourceType.trim()}, ${input.resourceId.trim()}, ${input.label?.trim() ?? ""}, ${ownerUserId(subject)}::uuid)
      RETURNING *
    `;
    await touchProject(projectId);
    return toReference(rows[0]!);
  },

  async deleteReference(projectId: string, referenceId: string, subject: AccessSubject): Promise<boolean> {
    if (!(await requireProject(projectId, subject, "write"))) return false;
    const rows = await sql<{ id: string }[]>`
      DELETE FROM ai.project_references WHERE id = ${referenceId}::uuid AND project_id = ${projectId}::uuid RETURNING id
    `;
    if (rows[0]) await touchProject(projectId);
    return Boolean(rows[0]);
  },
};
