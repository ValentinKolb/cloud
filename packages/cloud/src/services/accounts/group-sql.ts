import { sql, type SQLQuery } from "bun";

type SqlFragment = SQLQuery;
type SqlValue = SQLQuery | string;

export const recursiveUserGroupsSubquery = (params: { userId: SqlValue; select: SqlFragment }) => sql`
  WITH RECURSIVE user_all_groups AS (
    SELECT ug.group_id, g.provider
    FROM auth.user_groups_v2 ug
    JOIN auth.groups g ON g.id = ug.group_id
    WHERE ug.user_id = ${params.userId}::uuid
    UNION
    SELECT gg.parent_group_id, g_parent.provider
    FROM auth.group_groups_v2 gg
    JOIN auth.groups g_parent ON g_parent.id = gg.parent_group_id
    JOIN user_all_groups ag ON gg.child_group_id = ag.group_id
    WHERE g_parent.provider = ag.provider
  )
  ${params.select}
`;

export const managedGroupsNamesSubquery = (userId: SqlValue) =>
  recursiveUserGroupsSubquery({
    userId,
    select: sql`
      SELECT DISTINCT g.name
      FROM auth.groups g
      LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = ${userId}::uuid
      LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
      LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id AND ug.provider = g.provider
      WHERE gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL
      ORDER BY g.name
    `,
  });

export const managedGroupIdsSubquery = (userId: SqlValue) =>
  recursiveUserGroupsSubquery({
    userId,
    select: sql`
      SELECT managed.id
      FROM (
        SELECT DISTINCT g.id, g.name
        FROM auth.groups g
        LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = ${userId}::uuid
        LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
        LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id AND ug.provider = g.provider
        WHERE gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL
      ) managed
      ORDER BY managed.name
    `,
  });

export const recursiveGroupNamesSubquery = (userId: SqlValue) =>
  recursiveUserGroupsSubquery({
    userId,
    select: sql`
      SELECT DISTINCT g.name
      FROM user_all_groups ag
      JOIN auth.groups g ON g.id = ag.group_id
      ORDER BY g.name
    `,
  });

export const recursiveGroupIdsSubquery = (userId: SqlValue) =>
  recursiveUserGroupsSubquery({
    userId,
    select: sql`
      SELECT group_ids.group_id
      FROM (
        SELECT DISTINCT g.id AS group_id, g.name
        FROM user_all_groups ag
        JOIN auth.groups g ON g.id = ag.group_id
      ) group_ids
      ORDER BY group_ids.name
    `,
  });

export const buildMemberGroupScopeCondition = (params: { userId: SqlValue; groupProvider: SqlFragment }) => sql`
  g.id IN (
    ${recursiveUserGroupsSubquery({
      userId: params.userId,
      select: sql`
        SELECT DISTINCT ug.group_id
        FROM user_all_groups ug
        WHERE ug.provider = ${params.groupProvider}
      `,
    })}
  )
`;

export const buildManagedGroupScopeCondition = (params: { userId: SqlValue; groupProvider: SqlFragment }) => sql`
  g.id IN (
    ${recursiveUserGroupsSubquery({
      userId: params.userId,
      select: sql`
        SELECT DISTINCT g_manage.id
        FROM auth.groups g_manage
        LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g_manage.id AND gmu.user_id = ${params.userId}::uuid
        LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g_manage.id
        LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id AND ug.provider = g_manage.provider
        WHERE g_manage.provider = ${params.groupProvider}
          AND (gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL)
      `,
    })}
  )
`;
