import * as notebooks from "./notebooks";
import * as notes from "./notes";
import * as access from "./access";
import * as yjsManager from "./yjs-manager";
import { paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";

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

export const notebooksService = {
  notebook: {
    list: async (config: {
      userId: string | null;
      groups: string[];
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<notebooks.Notebook>> => {
      const items = await notebooks.list({
        userId: config.userId,
        groups: config.groups,
      });

      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? items.filter((notebook) => {
              const name = notebook.name.toLowerCase();
              const description = (notebook.description ?? "").toLowerCase();
              return name.includes(query) || description.includes(query);
            })
          : items;

      return paginateItems(filtered, config.pagination);
    },
    get: notebooks.get,
    create: notebooks.create,
    update: notebooks.update,
    remove: notebooks.remove,
    permission: {
      get: notebooks.getPermission,
      canAccess: notebooks.canAccess,
    },
    admin: {
      list: async (config: {
        pagination?: PageParams;
        filter?: { query?: string };
      }): Promise<Paginated<notebooks.NotebookAdminListItem>> => {
        const { page, perPage, offset } = paginate(config.pagination);
        const result = await notebooks.listAdmin({
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
    access: {
      list: async (config: {
        notebookId: string;
        pagination?: PageParams;
        filter?: {
          query?: string;
          principalType?: AccessEntry["principal"]["type"];
        };
      }): Promise<Paginated<AccessEntry>> => {
        const items = await access.listNotebookAccess(config.notebookId);
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
            return entry.principal.groupCn.toLowerCase().includes(query);
          }
          if (entry.principal.type === "authenticated") {
            return "all signed-in users authenticated".includes(query);
          }
          return "public".includes(query);
        });

        return paginateItems(filtered, config.pagination);
      },
      grant: access.grantNotebookAccess,
      remove: (config: { notebookId: string; accessId: string }) => access.removeNotebookAccess(config.notebookId, config.accessId),
      add: (config: { notebookId: string; accessId: string }) => access.addNotebookAccess(config.notebookId, config.accessId),
      count: (config: { notebookId: string }) => access.countNotebookAccess(config.notebookId),
      guard: (config: { notebookId: string; accessId: string }) => access.getNotebookAccessGuard(config),
      getPermission: access.getNotebookPermission,
    },
  },
  note: {
    list: async (config: {
      notebookId: string;
      pagination?: PageParams;
      filter?: { query?: string; parentId?: string | null };
    }): Promise<Paginated<notes.Note>> => {
      const parentId = config.filter?.parentId;
      const items =
        parentId !== undefined
          ? await notes.listChildren({ notebookId: config.notebookId, parentId })
          : await notes.list({ notebookId: config.notebookId });

      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? items.filter((note) => {
              const title = note.title.toLowerCase();
              const content = (note.contentMd ?? "").toLowerCase();
              return title.includes(query) || content.includes(query);
            })
          : items;

      return paginateItems(filtered, config.pagination);
    },
    get: notes.get,
    getWithContent: notes.getWithContent,
    getTree: notes.getTree,
    create: notes.create,
    update: notes.update,
    remove: notes.remove,
    move: notes.move,
    save: notes.save,
    isLocked: notes.isLocked,
    lock: notes.lock,
    getYjsState: notes.getYjsState,
    versions: {
      list: notes.listVersions,
      getSnapshot: notes.getVersionSnapshot,
      getWithContent: notes.getVersionWithContent,
      restore: notes.restoreFromSnapshot,
    },
    copyToNotebook: notes.copyToNotebook,
    search: notes.search,
  },
};

export { notebooks, notes, access, yjsManager };

// Re-export commonly used types
export type { Notebook, CreateNotebook, UpdateNotebook } from "./notebooks";
export type { NotebookAdminListItem } from "./notebooks";
export type {
  Note,
  NoteWithContent,
  NoteTreeNode,
  CreateNote,
  UpdateNote,
  NoteVersion,
} from "./notes";
