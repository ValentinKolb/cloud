import { type PageParams, type Paginated, paginate } from "@valentinkolb/stdlib";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { Expedition, Waypoint } from "@/contracts";
import * as expeditions from "./expeditions";
import * as waypoints from "./waypoints";
import * as access from "./access";

/**
 * Service facade for the expeditions app.
 *
 * One exported object per app, with a nested namespace per entity type:
 *
 *   expeditionsService.expedition.{list,get,create,...}
 *   expeditionsService.expedition.permission.{canAccess,get}
 *   expeditionsService.expedition.admin.{list,summary}
 *   expeditionsService.waypoint.{list,get,create,setDone,remove}
 *   expeditionsService.access.{list,grant,remove,...}
 *
 * Same shape as `spacesService` and `notebooksService` — pick whichever you
 * find most readable; both are valid templates.
 *
 * The `Paginated<T>` envelope here is small but consistent with the rest of
 * the platform: `items + page + perPage + total + hasNext`. The list query
 * is in-memory paginated because the dataset is small; for larger datasets
 * push pagination down into SQL (see notebooks for that pattern).
 */

const paginateItems = <T>(rows: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items: rows,
      page: 1,
      perPage: rows.length,
      total: rows.length,
      hasNext: false,
    };
  }
  const { page, perPage, offset } = paginate(pagination);
  return {
    items: rows.slice(offset, offset + perPage),
    page,
    perPage,
    total: rows.length,
    hasNext: page * perPage < rows.length,
  };
};

export const expeditionsService = {
  expedition: {
    list: async (config: {
      userId: string | null;
      groups: string[];
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<Expedition>> => {
      const items = await expeditions.list({
        userId: config.userId,
        groups: config.groups,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? items.filter((e) => {
              const title = e.title.toLowerCase();
              const description = (e.description ?? "").toLowerCase();
              return title.includes(query) || description.includes(query);
            })
          : items;
      return paginateItems(filtered, config.pagination);
    },
    get: expeditions.get,
    create: expeditions.create,
    update: expeditions.update,
    remove: expeditions.remove,

    permission: {
      canAccess: expeditions.canAccess,
      get: expeditions.getPermission,
    },

    admin: {
      list: async (config: {
        pagination?: PageParams;
        filter?: { query?: string };
      }): Promise<Paginated<expeditions.ExpeditionAdminListItem>> => {
        const { page, perPage, offset } = paginate(config.pagination);
        const result = await expeditions.listAdmin({
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
      summary: async (config: { filter?: { query?: string } }) =>
        expeditions.adminSummary({ search: config.filter?.query }),
    },
  },

  waypoint: {
    list: async (config: {
      expeditionId: string;
    }): Promise<Waypoint[]> => waypoints.list(config),
    get: waypoints.get,
    create: waypoints.create,
    setDone: waypoints.setDone,
    remove: waypoints.remove,
  },

  access: {
    list: async (config: {
      expeditionId: string;
      pagination?: PageParams;
    }): Promise<Paginated<AccessEntry>> => {
      const entries = await access.listExpeditionAccess(config.expeditionId);
      return paginateItems(entries, config.pagination);
    },
    grant: access.grantExpeditionAccess,
    remove: (config: { expeditionId: string; accessId: string }) =>
      access.removeExpeditionAccess(config.expeditionId, config.accessId),
    count: (config: { expeditionId: string }) =>
      access.countExpeditionAccess(config.expeditionId),
  },
};

// Re-export types that the API layer needs without reaching into ./expeditions.
export type { ExpeditionAdminListItem } from "./expeditions";
