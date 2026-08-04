import { sql } from "bun";

export const AI_SKILL_NAME_MAX_CHARS = 80;
export const AI_SKILL_DESCRIPTION_MAX_CHARS = 500;
export const AI_SKILL_INSTRUCTIONS_MAX_CHARS = 16_000;

export type AiSkillScope = "personal" | "workspace";

export type AiSkillSummary = {
  id: string;
  name: string;
  description: string;
  scope: AiSkillScope;
  ownerUserId: string | null;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AiSkill = AiSkillSummary & {
  instructions: string;
};

type SkillRow = {
  id: string;
  name: string;
  description: string;
  instructions?: string;
  scope: AiSkillScope;
  owner_user_id: string | null;
  enabled: boolean;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const toSummary = (row: SkillRow): AiSkillSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  scope: row.scope,
  ownerUserId: row.owner_user_id,
  enabled: row.enabled,
  revision: Number(row.revision),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const toSkill = (row: SkillRow): AiSkill => ({ ...toSummary(row), instructions: row.instructions ?? "" });

export const aiSkillStore = {
  async create(input: {
    name: string;
    description: string;
    instructions: string;
    scope: AiSkillScope;
    ownerUserId: string | null;
  }): Promise<AiSkill> {
    const rows = await sql<SkillRow[]>`
      INSERT INTO ai.skills (name, description, instructions, scope, owner_user_id)
      VALUES (${input.name}, ${input.description}, ${input.instructions}, ${input.scope}, ${input.ownerUserId})
      RETURNING *
    `;
    return toSkill(rows[0]!);
  },

  async get(skillId: string): Promise<AiSkill | null> {
    const rows = await sql<SkillRow[]>`SELECT * FROM ai.skills WHERE id = ${skillId}`;
    return rows[0] ? toSkill(rows[0]) : null;
  },

  async getVisible(input: { skillId: string; userId: string }): Promise<AiSkill | null> {
    const rows = await sql<SkillRow[]>`
      SELECT *
      FROM ai.skills
      WHERE id = ${input.skillId}
        AND ((scope = 'personal' AND owner_user_id = ${input.userId}) OR (scope = 'workspace' AND enabled))
    `;
    return rows[0] ? toSkill(rows[0]) : null;
  },

  async listVisible(input: { userId: string }): Promise<AiSkillSummary[]> {
    const rows = await sql<SkillRow[]>`
      SELECT id, name, description, scope, owner_user_id, enabled, revision, created_at, updated_at
      FROM ai.skills
      WHERE (scope = 'personal' AND owner_user_id = ${input.userId}) OR (scope = 'workspace' AND enabled)
      ORDER BY scope ASC, lower(name) ASC, id ASC
      LIMIT 200
    `;
    return rows.map(toSummary);
  },

  async listWorkspace(): Promise<AiSkillSummary[]> {
    const rows = await sql<SkillRow[]>`
      SELECT id, name, description, scope, owner_user_id, enabled, revision, created_at, updated_at
      FROM ai.skills
      WHERE scope = 'workspace'
      ORDER BY lower(name) ASC, id ASC
      LIMIT 200
    `;
    return rows.map(toSummary);
  },

  async update(input: {
    skillId: string;
    name?: string;
    description?: string;
    instructions?: string;
    enabled?: boolean;
  }): Promise<AiSkill | null> {
    const rows = await sql<SkillRow[]>`
      UPDATE ai.skills
      SET name = COALESCE(${input.name ?? null}, name),
          description = COALESCE(${input.description ?? null}, description),
          instructions = COALESCE(${input.instructions ?? null}, instructions),
          enabled = COALESCE(${input.enabled ?? null}, enabled),
          revision = revision + 1,
          updated_at = now()
      WHERE id = ${input.skillId}
      RETURNING *
    `;
    return rows[0] ? toSkill(rows[0]) : null;
  },

  async delete(skillId: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`DELETE FROM ai.skills WHERE id = ${skillId} RETURNING id`;
    return rows.length > 0;
  },
};
