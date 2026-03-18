import * as spaces from "./spaces";
import * as columns from "./columns";
import * as tags from "./tags";
import * as items from "./items";
import * as comments from "./comments";
import * as access from "./access";
import * as ical from "./ical";
import { paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import type { AccessEntry, Space, SpaceColumn, SpaceComment, SpaceItem, SpaceTag } from "@/spaces/contracts";

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const sliced = items.slice(offset, offset + perPage);
  return {
    items: sliced,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

export const spacesService = {
  space: {
    list: async (config: {
      userId: string | null;
      groups: string[];
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<Space>> => {
      const items = await spaces.list({
        userId: config.userId,
        groups: config.groups,
      });

      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? items.filter((space) => {
              const name = space.name.toLowerCase();
              const description = (space.description ?? "").toLowerCase();
              return name.includes(query) || description.includes(query);
            })
          : items;

      return paginateItems(filtered, config.pagination);
    },
    get: spaces.get,
    getDetail: spaces.getDetail,
    create: spaces.create,
    update: spaces.update,
    remove: spaces.remove,
    regenerateICalToken: spaces.regenerateICalToken,
    getByICalToken: spaces.getByICalToken,
    permission: {
      canAccess: spaces.canAccess,
      get: spaces.getPermission,
    },
    admin: {
      list: async (config: { pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<spaces.SpaceAdminListItem>> => {
        const { page, perPage, offset } = paginate(config.pagination);
        const result = await spaces.listAdmin({
          search: config.filter?.query,
          pagination: { limit: perPage, offset },
        });
        return {
          items: result.items,
          page,
          perPage,
          total: result.total,
          hasNext: page * perPage < result.total,
        };
      },
    },
  },
  column: {
    list: async (config: { spaceId: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<SpaceColumn>> => {
      const items = await columns.list({ spaceId: config.spaceId });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? items.filter((column) => column.name.toLowerCase().includes(query)) : items;
      return paginateItems(filtered, config.pagination);
    },
    get: columns.get,
    create: columns.create,
    update: columns.update,
    remove: columns.remove,
    reorder: columns.reorder,
  },
  tag: {
    list: async (config: { spaceId: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<SpaceTag>> => {
      const items = await tags.list({ spaceId: config.spaceId });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? items.filter((tag) => tag.name.toLowerCase().includes(query)) : items;
      return paginateItems(filtered, config.pagination);
    },
    get: tags.get,
    create: tags.create,
    update: tags.update,
    remove: tags.remove,
  },
  item: {
    list: async (config: {
      spaceId: string;
      includeCompleted?: boolean;
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<SpaceItem>> => {
      const entries = await items.list({
        spaceId: config.spaceId,
        includeCompleted: config.includeCompleted,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? entries.filter((item) => {
              const title = item.title.toLowerCase();
              const description = (item.description ?? "").toLowerCase();
              return title.includes(query) || description.includes(query);
            })
          : entries;
      return paginateItems(filtered, config.pagination);
    },
    listFiltered: items.listFiltered,
    get: items.get,
    create: items.create,
    update: items.update,
    remove: items.remove,
    move: items.move,
    setCompleted: items.setCompleted,
    setAssignees: items.setAssignees,
    setTags: items.setTags,
    calendar: {
      list: items.listCalendar,
      checkOverlap: items.checkOverlap,
    },
    tasks: {
      listMine: items.listMyTasks,
    },
  },
  comment: {
    list: async (config: { itemId: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<SpaceComment>> => {
      const items = await comments.list({ itemId: config.itemId });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? items.filter((comment) => comment.content.toLowerCase().includes(query)) : items;
      return paginateItems(filtered, config.pagination);
    },
    get: comments.get,
    create: comments.create,
    update: comments.update,
    remove: comments.remove,
  },
  access: {
    list: async (config: {
      spaceId: string;
      pagination?: PageParams;
      filter?: {
        query?: string;
        principalType?: AccessEntry["principal"]["type"];
      };
    }): Promise<Paginated<AccessEntry>> => {
      const items = await access.listSpaceAccess(config.spaceId);
      const query = config.filter?.query?.trim().toLowerCase();
      const principalType = config.filter?.principalType;

      const filtered = items.filter((entry) => {
        if (principalType && entry.principal.type !== principalType) {
          return false;
        }
        if (!query) return true;

        const displayName = (entry.displayName ?? "").toLowerCase();
        if (displayName.includes(query)) return true;

        if (entry.principal.type === "user") {
          return entry.principal.userId.toLowerCase().includes(query);
        }
        if (entry.principal.type === "group") {
          return entry.principal.groupId.toLowerCase().includes(query);
        }
        if (entry.principal.type === "authenticated") {
          return "all signed-in users authenticated".includes(query);
        }
        return "public".includes(query);
      });

      return paginateItems(filtered, config.pagination);
    },
    grant: access.grantSpaceAccess,
    remove: (config: { spaceId: string; accessId: string }) => access.removeSpaceAccess(config.spaceId, config.accessId),
    add: (config: { spaceId: string; accessId: string }) => access.addSpaceAccess(config.spaceId, config.accessId),
    count: (config: { spaceId: string }) => access.countSpaceAccess(config.spaceId),
    guard: (config: { spaceId: string; accessId: string }) => access.getSpaceAccessGuard(config),
    getPermission: access.getSpacePermission,
  },
  ical: {
    getByToken: ical.getByToken,
    generate: ical.generate,
  },
};

export { spaces, columns, tags, items, comments, access, ical };

// Re-export types needed by widgets
export type { TaskItem } from "./items";
export type { SpaceAdminListItem } from "./spaces";
