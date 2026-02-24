import * as settings from "@valentinkolb/cloud/core/services";
import { SETTINGS_MAP } from "@valentinkolb/cloud/core/services";
import { err, fail, paginate, tryCatch, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";

const paginateEntries = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
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
  const pagedItems = items.slice(offset, offset + perPage);
  return {
    items: pagedItems,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

export const settingsService = {
  entry: {
    list: async (config?: {
      pagination?: PageParams;
      filter?: { query?: string; group?: string };
    }): Promise<Paginated<settings.SettingEntry>> => {
      const entries = await settings.getAll();
      const query = config?.filter?.query?.trim().toLowerCase();
      const group = config?.filter?.group?.trim().toLowerCase();

      const filtered = entries.filter((entry) => {
        if (group && entry.group.toLowerCase() !== group) return false;
        if (!query) return true;
        return entry.key.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query);
      });

      return paginateEntries(filtered, config?.pagination);
    },
    update: async (config: { key: string; value: unknown }) => {
      if (!SETTINGS_MAP.has(config.key)) {
        return fail(err.badInput(`Unknown setting: ${config.key}`));
      }
      return tryCatch(
        async () => {
          await settings.set(config.key, config.value);
        },
        (error) => err.internal(`Failed to update setting: ${error instanceof Error ? error.message : String(error)}`),
      );
    },
    reset: async (config: { key: string }) => {
      if (!SETTINGS_MAP.has(config.key)) {
        return fail(err.badInput(`Unknown setting: ${config.key}`));
      }
      return tryCatch(
        async () => {
          await settings.remove(config.key);
        },
        (error) => err.internal(`Failed to reset setting: ${error instanceof Error ? error.message : String(error)}`),
      );
    },
  },
};

export type SettingsService = typeof settingsService;
