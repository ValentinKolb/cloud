import * as notebooks from "./notebooks";
import * as notes from "./notes";
import * as access from "./access";
import { yjsSnapshotWorker } from "./yjs-snapshot-worker";
import { paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";

const pageFromPagination = (pagination?: PageParams) => {
  if (!pagination) return null;
  const { page, perPage, offset } = paginate(pagination);
  return {
    page,
    perPage,
    offset,
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
      const pageInfo = pageFromPagination(config.pagination);
      const result = await notebooks.list({
        userId: config.userId,
        groups: config.groups,
        query: config.filter?.query,
        pagination: pageInfo ? { limit: pageInfo.perPage, offset: pageInfo.offset } : undefined,
      });
      const page = pageInfo?.page ?? 1;
      const perPage = pageInfo?.perPage ?? result.items.length;
      return {
        items: result.items,
        page,
        perPage,
        total: result.total,
        hasNext: page * perPage < result.total,
      };
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
        const pageInfo = pageFromPagination(config.pagination);
        const result = await access.listNotebookAccessPage({
          notebookId: config.notebookId,
          query: config.filter?.query,
          principalType: config.filter?.principalType,
          pagination: pageInfo ? { limit: pageInfo.perPage, offset: pageInfo.offset } : undefined,
        });
        const page = pageInfo?.page ?? 1;
        const perPage = pageInfo?.perPage ?? result.items.length;
        return {
          items: result.items,
          page,
          perPage,
          total: result.total,
          hasNext: page * perPage < result.total,
        };
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
      const pageInfo = pageFromPagination(config.pagination);
      const result = await notes.listPaged({
        notebookId: config.notebookId,
        query: config.filter?.query,
        parentId: config.filter?.parentId,
        pagination: pageInfo ? { limit: pageInfo.perPage, offset: pageInfo.offset } : undefined,
      });
      const page = pageInfo?.page ?? 1;
      const perPage = pageInfo?.perPage ?? result.items.length;
      return {
        items: result.items,
        page,
        perPage,
        total: result.total,
        hasNext: page * perPage < result.total,
      };
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
    getYjsStateWithCursor: notes.getYjsStateWithCursor,
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

export { notebooks, notes, access, yjsSnapshotWorker };

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
