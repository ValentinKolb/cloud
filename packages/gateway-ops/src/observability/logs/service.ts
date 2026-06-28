import { logging } from "@valentinkolb/cloud/services";
import { err, type PageParams, type Paginated, paginate, tryCatch } from "@valentinkolb/stdlib";

type LogEntry = Awaited<ReturnType<typeof logging.list>>["entries"][number];

/**
 * Builds the shared paginated response shape from logging service list results.
 */
const toPaginated = <T>(items: T[], total: number, pagination: { page: number; perPage: number }): Paginated<T> => ({
  items,
  page: pagination.page,
  perPage: pagination.perPage,
  total,
  hasNext: pagination.page * pagination.perPage < total,
});

export const loggingService = {
  entry: {
    list: async (config: {
      pagination?: PageParams;
      filter?: { source?: string; sources?: string[]; level?: string; search?: string; sinceHours?: number };
    }) => {
      const { page, perPage, offset } = paginate(config.pagination);
      const result = await logging.list(
        { page, perPage, offset },
        {
          source: config.filter?.source,
          sources: config.filter?.sources,
          level: config.filter?.level,
          search: config.filter?.search,
          sinceHours: config.filter?.sinceHours,
        },
      );
      return toPaginated<LogEntry>(result.entries, result.total, { page, perPage });
    },
    cleanup: async (config: { days: number }) =>
      tryCatch(
        () => logging.cleanup(config.days),
        (error) => err.internal(error instanceof Error ? error.message : String(error)),
      ),
    get: async (config: { id: string }) => logging.getById(config.id),
  },
  source: {
    list: async () => logging.getSources(),
  },
  stats: {
    summary: async () => logging.summary(),
  },
};

export type LoggingService = typeof loggingService;
