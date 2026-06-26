import { readFile } from "node:fs/promises";
import { type CloudCliContext, type CloudCliFlags, defineCloudCliModule } from "@valentinkolb/cloud/cli";
import type {
  CalendarItem,
  ItemListResult,
  ItemStatus,
  ItemType,
  OverlapItem,
  Priority,
  Space,
  SpaceComment,
  SpaceDetail,
  SpaceItem,
} from "./contracts";

const SPACE_DEFAULT_KEY = "spaces.space";

const help = () => `cld spaces

Usage:
  cld spaces list [--q <query>]
  cld spaces use <space>
  cld spaces current
  cld spaces get [<space>] [--space <space>]
  cld spaces create <name> [--description <text>] [--color <hex>] [--use]
  cld spaces items [<space>] [--space <space>] [--q <query>] [--status active|completed|all] [--type all|task|event] [--page <n>] [--page-size <n>]
  cld spaces item [<space>] <item> [--space <space>]
  cld spaces add-item [<space>] <title> [--space <space>] --column <column> [--description <markdown>] [--file <path>|--stdin] [--deadline <iso|date>] [--starts-at <iso|date>] [--ends-at <iso|date>] [--priority low|medium|high|urgent] [--tag <name-or-id>] [--assignee <user-id>]
  cld spaces update-item [<space>] <item> [--space <space>] [--title <title>] [--description <markdown>] [--file <path>|--stdin] [--column <column>] [--deadline <iso|date>] [--starts-at <iso|date>] [--ends-at <iso|date>] [--priority low|medium|high|urgent] [--tag <name-or-id>] [--assignee <user-id>]
  cld spaces done [<space>] <item> [--space <space>]
  cld spaces reopen [<space>] <item> [--space <space>]
  cld spaces comments [<space>] <item> [--space <space>]
  cld spaces comment [<space>] <item> [--space <space>] --content <text>|--file <path>|--stdin
  cld spaces calendar [--space <space>] --from <iso|date> --to <iso|date>
  cld spaces overlap [--space <space>] --from <iso|date> --to <iso|date> [--exclude-item <id>]

Date options accept full ISO datetimes or YYYY-MM-DD. Date-only starts use 00:00:00.000Z; date-only ends and deadlines use 23:59:59.999Z.
`;

const stringFlag = (flags: CloudCliFlags, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.at(-1);
  }
  return undefined;
};

const stringFlags = (flags: CloudCliFlags, name: string): string[] => {
  const value = flags[name];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
};

const booleanFlag = (flags: CloudCliFlags, ...names: string[]): boolean => names.some((name) => flags[name] === true);

const requireArg = (args: string[], index: number, label: string): string => {
  const value = args[index];
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const parsePositiveInt = (value: string | undefined, fallback: number, label: string): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
};

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const readInputContent = async (ctx: CloudCliContext, flagName = "content", required = true): Promise<string | undefined> => {
  const literal = stringFlag(ctx.flags, flagName);
  const file = stringFlag(ctx.flags, "file", "f");
  const stdin = booleanFlag(ctx.flags, "stdin");
  const sources = [literal !== undefined, file !== undefined, stdin].filter(Boolean).length;
  if (sources > 1) throw new Error(`Pass only one of --${flagName}, --file, or --stdin.`);
  if (literal !== undefined) return literal;
  if (file) return readFile(file, "utf8");
  if (stdin) return Bun.stdin.text();
  if (required) throw new Error(`Missing content. Pass --${flagName}, --file, or --stdin.`);
  return undefined;
};

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.table(rows, columns);
};

const apiPath = (path = "") => `/api/spaces${path === "/" ? "" : path}`;

const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));

const jsonRequest = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

const listSpaces = async (ctx: CloudCliContext): Promise<Space[]> => {
  const spaces = await readApi<Space[]>(ctx, "/");
  const query = stringFlag(ctx.flags, "q", "query")?.toLowerCase();
  if (!query) return spaces;
  return spaces.filter((space) => space.name.toLowerCase().includes(query) || space.description?.toLowerCase().includes(query));
};

const formatSpaceCandidates = (items: Space[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.name} (${item.id})`)
    .join(", ");

const formatItemCandidates = (items: SpaceItem[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.title} (${item.id})`)
    .join(", ");

const resolveSpaceRef = async (ctx: CloudCliContext, ref: string): Promise<SpaceDetail> => {
  if (isUuid(ref)) {
    return readApi<SpaceDetail>(ctx, `/${ref}`);
  }

  const spaces = await readApi<Space[]>(ctx, "/");
  const matches = spaces.filter((space) => space.name === ref);
  if (matches.length === 1) return readApi<SpaceDetail>(ctx, `/${matches[0]!.id}`);
  if (matches.length > 1) throw new Error(`Space "${ref}" is ambiguous. Use one of: ${formatSpaceCandidates(matches)}`);
  const candidates = formatSpaceCandidates(spaces.filter((space) => space.name.toLowerCase().includes(ref.toLowerCase())).slice(0, 5));
  throw new Error(
    candidates
      ? `Space "${ref}" was not found by id or exact name. Similar matches: ${candidates}`
      : `Space "${ref}" was not found by id or exact name.`,
  );
};

const requireDefaultSpaceRef = async (ctx: CloudCliContext): Promise<string> => {
  const ref = await ctx.getDefault(SPACE_DEFAULT_KEY);
  if (!ref) throw new Error("Missing space. Pass --space <space> or run `cld spaces use <space>`.");
  return ref;
};

const resolveSpaceArg = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ spaceRef: string; rest: string[] }> => {
  const flagged = stringFlag(ctx.flags, "space");
  if (flagged) return { spaceRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { spaceRef: requireArg(args, 0, "space"), rest: args.slice(1) };
  return { spaceRef: await requireDefaultSpaceRef(ctx), rest: args };
};

const resolveItemRef = async (ctx: CloudCliContext, spaceId: string, ref: string): Promise<SpaceItem> => {
  if (isUuid(ref)) {
    return readApi<SpaceItem>(ctx, `/${spaceId}/items/${ref}`);
  }

  const payload = await readApi<ItemListResult>(
    ctx,
    `/${spaceId}/items/filter`,
    jsonRequest("POST", {
      type: "all",
      status: "all",
      search: ref,
      sort: "updated",
      sortDesc: true,
      groupBy: "none",
      page: 1,
      pageSize: 50,
    }),
  );
  const matches = payload.items.filter((item) => item.title === ref);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Item "${ref}" is ambiguous. Use one of: ${formatItemCandidates(matches)}`);
  const candidates = formatItemCandidates(payload.items);
  throw new Error(
    candidates
      ? `Item "${ref}" was not found by id or exact title. Similar matches: ${candidates}`
      : `Item "${ref}" was not found by id or exact title.`,
  );
};

const resolveColumnId = (space: SpaceDetail, ref: string): string => {
  if (isUuid(ref)) return ref;
  const matches = space.columns.filter((column) => column.name === ref);
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1)
    throw new Error(`Column "${ref}" is ambiguous. Use one of: ${matches.map((column) => `${column.name} (${column.id})`).join(", ")}`);
  throw new Error(`Column "${ref}" was not found in ${space.name}.`);
};

const resolveTagIds = (space: SpaceDetail, refs: string[]): string[] =>
  refs.map((ref) => {
    if (isUuid(ref)) return ref;
    const matches = space.tags.filter((tag) => tag.name === ref);
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1)
      throw new Error(`Tag "${ref}" is ambiguous. Use one of: ${matches.map((tag) => `${tag.name} (${tag.id})`).join(", ")}`);
    throw new Error(`Tag "${ref}" was not found in ${space.name}.`);
  });

const itemRows = (items: SpaceItem[], space?: SpaceDetail) =>
  items.map((item) => ({
    id: item.id,
    title: item.title,
    column: space?.columns.find((column) => column.id === item.columnId)?.name ?? item.columnId,
    status: item.completedAt ? "completed" : "active",
    priority: item.priority ?? "",
    deadline: item.deadline ?? "",
    updatedAt: item.updatedAt,
  }));

const spaceRows = (items: Space[]) =>
  items.map((space) => ({
    id: space.id,
    name: space.name,
    color: space.color,
    updatedAt: space.updatedAt,
  }));

const commentRows = (items: SpaceComment[]) =>
  items.map((comment) => ({
    id: comment.id,
    author: comment.userName ?? comment.userId ?? "",
    content: comment.content.replace(/\s+/g, " ").slice(0, 80),
    createdAt: comment.createdAt,
  }));

const calendarRows = (items: CalendarItem[]) =>
  items.map((item) => ({
    id: item.id,
    space: item.spaceName,
    title: item.title,
    startsAt: item.startsAt ?? "",
    endsAt: item.endsAt ?? "",
    deadline: item.deadline ?? "",
  }));

const overlapRows = (items: OverlapItem[]) =>
  items.map((item) => ({
    id: item.itemId,
    space: item.spaceName,
    title: item.title,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
  }));

const itemType = (value: string | undefined): ItemType => {
  if (value === "task" || value === "event" || value === "all") return value;
  if (value) throw new Error("--type must be all, task, or event.");
  return "all";
};

const itemStatus = (value: string | undefined): ItemStatus => {
  if (value === "active" || value === "completed" || value === "all") return value;
  if (value) throw new Error("--status must be active, completed, or all.");
  return "active";
};

const priority = (value: string | undefined): Priority | undefined => {
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "urgent") return value;
  throw new Error("--priority must be low, medium, high, or urgent.");
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDateTime = (value: string | undefined, label: string, endOfDay = false): string | undefined => {
  if (!value) return undefined;
  if (DATE_ONLY_PATTERN.test(value)) return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO datetime or YYYY-MM-DD date.`);
  return date.toISOString();
};

export default defineCloudCliModule({
  name: "spaces",
  summary: "Inspect and update Spaces through the Spaces REST API.",
  help,
  async run(ctx) {
    const [command, ...args] = ctx.args;

    if (!command || command === "help") {
      ctx.print(help());
      return 0;
    }

    if (command === "list") {
      const spaces = await listSpaces(ctx);
      printJsonOrTable(ctx, spaces, spaceRows(spaces), [
        { key: "name", label: "NAME" },
        { key: "color", label: "COLOR" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "use") {
      const space = await resolveSpaceRef(ctx, requireArg(args, 0, "space"));
      await ctx.setDefault(SPACE_DEFAULT_KEY, space.id);
      if (ctx.options.output === "json") ctx.json({ space, defaultSpace: space.id });
      else ctx.print(`Using space ${space.name} (${space.id}).`);
      return 0;
    }

    if (command === "current") {
      const spaceRef = await ctx.getDefault(SPACE_DEFAULT_KEY);
      if (!spaceRef) throw new Error("No default space configured. Run `cld spaces use <space>`.");
      const space = await resolveSpaceRef(ctx, spaceRef);
      if (ctx.options.output === "json") ctx.json({ space, defaultSpace: space.id });
      else ctx.print(`${space.name} (${space.id})`);
      return 0;
    }

    if (command === "get") {
      const { spaceRef } = await resolveSpaceArg(ctx, args, 0);
      const space = await resolveSpaceRef(ctx, spaceRef);
      if (ctx.options.output === "json") ctx.json(space);
      else {
        ctx.print(`${space.name} (${space.id})`);
        if (space.description) ctx.print(space.description);
        ctx.print(`columns: ${space.columns.map((column) => column.name).join(", ") || "none"}`);
        ctx.print(`tags: ${space.tags.map((tag) => tag.name).join(", ") || "none"}`);
      }
      return 0;
    }

    if (command === "create") {
      const space = await readApi<Space>(
        ctx,
        "/",
        jsonRequest("POST", {
          name: requireArg(args, 0, "space name"),
          description: stringFlag(ctx.flags, "description"),
          color: stringFlag(ctx.flags, "color") ?? "#3b82f6",
        }),
      );
      if (booleanFlag(ctx.flags, "use")) await ctx.setDefault(SPACE_DEFAULT_KEY, space.id);
      if (ctx.options.output === "json") ctx.json(space);
      else ctx.print(`Created ${space.name} (${space.id}).${booleanFlag(ctx.flags, "use") ? " Using it as default." : ""}`);
      return 0;
    }

    if (command === "items") {
      const { spaceRef } = await resolveSpaceArg(ctx, args, 0);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const payload = await readApi<ItemListResult>(
        ctx,
        `/${space.id}/items/filter`,
        jsonRequest("POST", {
          type: itemType(stringFlag(ctx.flags, "type")),
          status: itemStatus(stringFlag(ctx.flags, "status")),
          search: stringFlag(ctx.flags, "q", "query"),
          sort: "updated",
          sortDesc: true,
          groupBy: "none",
          page: parsePositiveInt(stringFlag(ctx.flags, "page"), 1, "--page"),
          pageSize: parsePositiveInt(stringFlag(ctx.flags, "page-size", "page_size"), 50, "--page-size"),
        }),
      );
      printJsonOrTable(ctx, payload, itemRows(payload.items, space), [
        { key: "title", label: "TITLE" },
        { key: "column", label: "COLUMN" },
        { key: "status", label: "STATUS" },
        { key: "priority", label: "PRIORITY" },
        { key: "deadline", label: "DEADLINE" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "item") {
      const { spaceRef, rest } = await resolveSpaceArg(ctx, args, 1);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const item = await resolveItemRef(ctx, space.id, requireArg(rest, 0, "item"));
      if (ctx.options.output === "json") ctx.json(item);
      else {
        ctx.print(`${item.title} (${item.id})`);
        if (item.description) ctx.print(item.description);
        ctx.print(`column: ${space.columns.find((column) => column.id === item.columnId)?.name ?? item.columnId}`);
        ctx.print(`status: ${item.completedAt ? "completed" : "active"}`);
      }
      return 0;
    }

    if (command === "add-item") {
      const { spaceRef, rest } = await resolveSpaceArg(ctx, args, 1);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const column = stringFlag(ctx.flags, "column");
      if (!column) throw new Error("Missing column. Pass --column <column>.");
      const columnId = resolveColumnId(space, column);
      const item = await readApi<SpaceItem>(
        ctx,
        `/${space.id}/items`,
        jsonRequest("POST", {
          columnId,
          title: requireArg(rest, 0, "item title"),
          description: await readInputContent(ctx, "description", false),
          startsAt: normalizeDateTime(stringFlag(ctx.flags, "starts-at", "startsAt"), "--starts-at"),
          endsAt: normalizeDateTime(stringFlag(ctx.flags, "ends-at", "endsAt"), "--ends-at", true),
          deadline: normalizeDateTime(stringFlag(ctx.flags, "deadline"), "--deadline", true),
          priority: priority(stringFlag(ctx.flags, "priority")),
          assigneeIds: stringFlags(ctx.flags, "assignee"),
          tagIds: resolveTagIds(space, stringFlags(ctx.flags, "tag")),
        }),
      );
      if (ctx.options.output === "json") ctx.json(item);
      else ctx.print(`Created ${item.title} (${item.id}).`);
      return 0;
    }

    if (command === "update-item") {
      const { spaceRef, rest } = await resolveSpaceArg(ctx, args, 1);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const item = await resolveItemRef(ctx, space.id, requireArg(rest, 0, "item"));
      const nextPriority = priority(stringFlag(ctx.flags, "priority"));
      const payload: Record<string, unknown> = {
        title: stringFlag(ctx.flags, "title"),
        description: await readInputContent(ctx, "description", false),
        startsAt: normalizeDateTime(stringFlag(ctx.flags, "starts-at", "startsAt"), "--starts-at"),
        endsAt: normalizeDateTime(stringFlag(ctx.flags, "ends-at", "endsAt"), "--ends-at", true),
        deadline: normalizeDateTime(stringFlag(ctx.flags, "deadline"), "--deadline", true),
        priority: nextPriority,
      };
      const column = stringFlag(ctx.flags, "column");
      if (column) payload.columnId = resolveColumnId(space, column);
      const assignees = stringFlags(ctx.flags, "assignee");
      if (assignees.length > 0) payload.assigneeIds = assignees;
      const tags = stringFlags(ctx.flags, "tag");
      if (tags.length > 0) payload.tagIds = resolveTagIds(space, tags);

      const json = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
      if (Object.keys(json).length === 0) throw new Error("No item fields to update.");

      const updated = await readApi<SpaceItem>(ctx, `/${space.id}/items/${item.id}`, jsonRequest("PATCH", json));
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Updated ${updated.title} (${updated.id}).`);
      return 0;
    }

    if (command === "done" || command === "reopen") {
      const { spaceRef, rest } = await resolveSpaceArg(ctx, args, 1);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const item = await resolveItemRef(ctx, space.id, requireArg(rest, 0, "item"));
      const updated = await readApi<SpaceItem>(
        ctx,
        `/${space.id}/items/${item.id}/completed`,
        jsonRequest("POST", { completed: command === "done" }),
      );
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`${command === "done" ? "Completed" : "Reopened"} ${updated.title} (${updated.id}).`);
      return 0;
    }

    if (command === "comments" || command === "comment") {
      const { spaceRef, rest } = await resolveSpaceArg(ctx, args, 1);
      const space = await resolveSpaceRef(ctx, spaceRef);
      const item = await resolveItemRef(ctx, space.id, requireArg(rest, 0, "item"));

      if (command === "comments") {
        const comments = await readApi<SpaceComment[]>(ctx, `/${space.id}/items/${item.id}/comments`);
        printJsonOrTable(ctx, comments, commentRows(comments), [
          { key: "author", label: "AUTHOR" },
          { key: "content", label: "CONTENT" },
          { key: "createdAt", label: "CREATED" },
          { key: "id", label: "ID" },
        ]);
        return 0;
      }

      const content = await readInputContent(ctx);
      const comment = await readApi<SpaceComment>(
        ctx,
        `/${space.id}/items/${item.id}/comments`,
        jsonRequest("POST", { content: content ?? "" }),
      );
      if (ctx.options.output === "json") ctx.json(comment);
      else ctx.print(`Created comment ${comment.id}.`);
      return 0;
    }

    if (command === "calendar") {
      const from = normalizeDateTime(stringFlag(ctx.flags, "from"), "--from");
      const to = normalizeDateTime(stringFlag(ctx.flags, "to"), "--to", true);
      if (!from || !to) throw new Error("Pass --from <iso|date> and --to <iso|date>.");
      const spaceRef = stringFlag(ctx.flags, "space") ?? (await ctx.getDefault(SPACE_DEFAULT_KEY));
      const space = spaceRef ? await resolveSpaceRef(ctx, spaceRef) : null;
      const items = await readApi<CalendarItem[]>(ctx, `/calendar?${new URLSearchParams({ from, to }).toString()}`);
      const filtered = space ? items.filter((item) => item.spaceId === space.id) : items;
      printJsonOrTable(ctx, filtered, calendarRows(filtered), [
        { key: "space", label: "SPACE" },
        { key: "title", label: "TITLE" },
        { key: "startsAt", label: "START" },
        { key: "endsAt", label: "END" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "overlap") {
      const from = normalizeDateTime(stringFlag(ctx.flags, "from"), "--from");
      const to = normalizeDateTime(stringFlag(ctx.flags, "to"), "--to", true);
      if (!from || !to) throw new Error("Pass --from <iso|date> and --to <iso|date>.");
      const spaceRef = stringFlag(ctx.flags, "space") ?? (await ctx.getDefault(SPACE_DEFAULT_KEY));
      const space = spaceRef ? await resolveSpaceRef(ctx, spaceRef) : null;
      const query = new URLSearchParams({ from, to });
      const excludeItemId = stringFlag(ctx.flags, "exclude-item", "excludeItemId");
      if (excludeItemId) query.set("excludeItemId", excludeItemId);
      const items = await readApi<OverlapItem[]>(ctx, `/calendar/overlap?${query.toString()}`);
      const filtered = space ? items.filter((item) => item.spaceId === space.id) : items;
      printJsonOrTable(ctx, filtered, overlapRows(filtered), [
        { key: "space", label: "SPACE" },
        { key: "title", label: "TITLE" },
        { key: "startsAt", label: "START" },
        { key: "endsAt", label: "END" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    throw new Error(`Unknown spaces command "${command}". Run \`cld spaces help\`.`);
  },
});
