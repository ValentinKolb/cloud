import { ipa } from "@valentinkolb/cloud/core/services";
import { paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import type { BaseGroup, GroupMember } from "@/accounts/contracts";
import { fromMutationResult, paginateItems } from "./shared";

export const groupsService = {
  /**
   * Resolves mixed user/group search results for membership and manager dialogs.
   */
  search: async (config: {
    query: string;
    includeUsers?: boolean;
    includeGroups?: boolean;
    excludeUserIds?: string[];
    excludeGroups?: string[];
    onlyUserGroups?: string[];
    onlyPosixGroups?: boolean;
    usersInGroups?: string[];
  }) =>
    ipa.search(config.query, {
      users: config.includeUsers ?? true,
      groups: config.includeGroups ?? false,
      excludeUserIds: config.excludeUserIds ?? [],
      excludeGroups: config.excludeGroups ?? [],
      onlyUserGroups: config.onlyUserGroups,
      onlyPosixGroups: config.onlyPosixGroups ?? false,
      usersInGroups: config.usersInGroups,
    }),
  /**
   * Lists groups with optional user scoping and search.
   */
  list: async (config: {
    pagination?: PageParams;
    filter?: { search?: string };
    scope?: { userId?: string; cns?: string[] };
  }): Promise<Paginated<BaseGroup>> => {
    const { page, perPage } = paginate(config.pagination);
    const result = await ipa.groups.list({
      page,
      perPage,
      search: config.filter?.search,
      userId: config.scope?.userId,
      cns: config.scope?.cns,
    });

    return {
      items: result.groups,
      page,
      perPage,
      total: result.total,
      hasNext: result.pagination.hasNext,
    };
  },
  /**
   * Returns one group by CN, or null when missing.
   */
  get: async (config: { cn: string }) => ipa.groups.get({ cn: config.cn }),
  member: {
    /**
     * Lists members for one group with optional type/query filtering.
     */
    list: async (config: {
      cn: string;
      recursive?: boolean;
      pagination?: PageParams;
      filter?: { query?: string; type?: GroupMember["type"] };
    }): Promise<Paginated<GroupMember>> => {
      const members = await ipa.groups.getMembers({
        cn: config.cn,
        recursive: config.recursive,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const type = config.filter?.type;
      const filtered = members.filter((member) => {
        if (type && member.type !== type) return false;
        if (!query) return true;

        const id = member.id.toLowerCase();
        const displayName = (member.displayName ?? "").toLowerCase();
        return id.includes(query) || displayName.includes(query);
      });
      return paginateItems(filtered, config.pagination);
    },
    /**
     * Adds a user/group member to a group.
     */
    add: async (config: { ipaSession: string; cn: string; userId?: string; groupCn?: string }) =>
      fromMutationResult(
        await ipa.groups.addMember({
          ipaSession: config.ipaSession,
          cn: config.cn,
          user: config.userId,
          group: config.groupCn,
        }),
      ),
    /**
     * Removes a user/group member from a group.
     */
    remove: async (config: { ipaSession: string; cn: string; userId?: string; groupCn?: string }) =>
      fromMutationResult(
        await ipa.groups.removeMember({
          ipaSession: config.ipaSession,
          cn: config.cn,
          user: config.userId,
          group: config.groupCn,
        }),
      ),
  },
  manager: {
    /**
     * Lists manager assignments for one group with optional type/query filtering.
     */
    list: async (config: {
      cn: string;
      pagination?: PageParams;
      filter?: { query?: string; type?: GroupMember["type"] };
    }): Promise<Paginated<GroupMember>> => {
      const managers = await ipa.groups.getManagers({ cn: config.cn });
      const query = config.filter?.query?.trim().toLowerCase();
      const type = config.filter?.type;
      const filtered = managers.filter((manager) => {
        if (type && manager.type !== type) return false;
        if (!query) return true;

        const id = manager.id.toLowerCase();
        const displayName = (manager.displayName ?? "").toLowerCase();
        return id.includes(query) || displayName.includes(query);
      });
      return paginateItems(filtered, config.pagination);
    },
    /**
     * Adds a user/group manager assignment.
     */
    add: async (config: { ipaSession: string; cn: string; userId?: string; groupCn?: string }) =>
      fromMutationResult(
        await ipa.groups.addManager({
          ipaSession: config.ipaSession,
          cn: config.cn,
          user: config.userId,
          group: config.groupCn,
        }),
      ),
    /**
     * Removes a user/group manager assignment.
     */
    remove: async (config: { ipaSession: string; cn: string; userId?: string; groupCn?: string }) =>
      fromMutationResult(
        await ipa.groups.removeManager({
          ipaSession: config.ipaSession,
          cn: config.cn,
          user: config.userId,
          group: config.groupCn,
        }),
      ),
  },
  parent: {
    /**
     * Lists parent groups for a group (direct or recursive).
     */
    list: async (config: {
      cn: string;
      recursive?: boolean;
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<string>> => {
      const groups = await ipa.groups.getParents({
        cn: config.cn,
        recursive: config.recursive,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? groups.filter((groupCn) => groupCn.toLowerCase().includes(query)) : groups;
      return paginateItems(filtered, config.pagination);
    },
  },
  managedGroup: {
    /**
     * Lists groups managed by the given group.
     */
    list: async (config: { cn: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<string>> => {
      const groups = await ipa.groups.getManagedGroups({ cn: config.cn });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? groups.filter((groupCn) => groupCn.toLowerCase().includes(query)) : groups;
      return paginateItems(filtered, config.pagination);
    },
  },
  /**
   * Creates a new group in IPA.
   */
  create: async (config: { ipaSession: string; name: string; description?: string; posix?: boolean }) =>
    fromMutationResult(
      await ipa.groups.add({
        ipaSession: config.ipaSession,
        cn: config.name,
        description: config.description,
        posix: config.posix,
      }),
    ),
  /**
   * Updates mutable group fields.
   */
  update: async (config: { ipaSession: string; cn: string; description: string }) =>
    fromMutationResult(
      await ipa.groups.update({
        ipaSession: config.ipaSession,
        cn: config.cn,
        description: config.description,
      }),
    ),
  /**
   * Deletes a group from IPA.
   */
  remove: async (config: { ipaSession: string; cn: string }) =>
    fromMutationResult(
      await ipa.groups.delete({
        ipaSession: config.ipaSession,
        cn: config.cn,
      }),
    ),
  /**
   * Converts a group to POSIX mode.
   */
  makePosix: async (config: { ipaSession: string; cn: string }) =>
    fromMutationResult(
      await ipa.groups.makePosix({
        ipaSession: config.ipaSession,
        cn: config.cn,
      }),
    ),
};

export type GroupsService = typeof groupsService;
