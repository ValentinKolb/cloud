import { readFile, writeFile } from "node:fs/promises";
import { type CloudCliContext, type CloudCliFlags, defineCloudCliModule } from "@valentinkolb/cloud/cli";
import type {
  Contact,
  ContactBook,
  ContactNote,
  ContactTag,
  CreateBookInput,
  CreateContactInput,
  CreateContactNoteInput,
  CreateContactTagInput,
  UpdateBookInput,
  UpdateContactInput,
  UpdateContactNoteInput,
  UpdateContactTagInput,
} from "./service/types";
import { resolveContactName } from "./shared";

type Pagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
};

type Page<T> = {
  data: T[];
  pagination: Pagination;
};

type ImportPreviewResponse = {
  candidates: unknown[];
};

type ContactTreeNode = {
  id: string;
  label?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  children?: ContactTreeNode[];
};

type ContactTree = {
  root: ContactTreeNode;
  selectedId: string;
};

const CONTACTS_BOOK_DEFAULT_KEY = "contacts.book";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const help = () => `cld contacts

Usage:
  cld contacts books [--q <query>] [--page <n>] [--per-page <n>]
  cld contacts use <book>
  cld contacts current
  cld contacts book [<book>] [--book <book>]
  cld contacts create-book <name> [--description <text>] [--use]
  cld contacts update-book [<book>] [--book <book>] [--name <name>] [--description <text>]
  cld contacts delete-book [<book>] [--book <book>]

  cld contacts list [<book>] [--book <book>] [--q <query>] [--tag <tag-or-id>] [--page <n>] [--per-page <n>]
  cld contacts get [<book>] <contact> [--book <book>] [--contact <contact>]
  cld contacts search <query> [--include-system] [--page <n>] [--per-page <n>]
  cld contacts create [<book>] [--book <book>] [--json-input <path>|--stdin] [field flags]
  cld contacts update [<book>] <contact> [--book <book>] [--contact <contact>] [--json-input <path>|--stdin] [field flags]
  cld contacts delete [<book>] <contact> [--book <book>] [--contact <contact>]
  cld contacts move [<book>] <contact> --target-book <book> [--book <book>] [--contact <contact>]
  cld contacts tree [<book>] <contact> [--book <book>] [--contact <contact>]

  cld contacts notes [<book>] <contact> [--book <book>] [--contact <contact>]
  cld contacts note [<book>] <contact> [--book <book>] [--contact <contact>] --content <text>|--file <path>|--stdin
  cld contacts update-note [<book>] <contact> <note> [--book <book>] [--contact <contact>] --content <text>|--file <path>|--stdin
  cld contacts delete-note [<book>] <contact> <note> [--book <book>] [--contact <contact>]

  cld contacts tags [<book>] [--book <book>]
  cld contacts create-tag [<book>] <name> --color <#RRGGBB> [--book <book>]
  cld contacts update-tag [<book>] <tag> [--name <name>] [--color <#RRGGBB>] [--book <book>]
  cld contacts delete-tag [<book>] <tag> [--book <book>]

  cld contacts export [<book>] --format vcf|csv [--out <path>] [--book <book>]
  cld contacts import-preview [<book>] --file <path>|--stdin [--book <book>]

Contact field flags:
  --label <text> --first-name <text> --last-name <text> --company-name <text>
  --department <text> --job-title <text> --vat-id <text> --birthday <YYYY-MM-DD>
  --salutation <text> --pronouns <text> --preferred-language <tag> --source <text>
  --email <email|label=email>        Repeatable. Replaces emails when used on update.
  --phone <phone|label=phone>        Repeatable. Replaces phones when used on update.
  --tag <tag-or-id>                  Repeatable. Replaces tags when used on update.
  --parent <contact-or-id>           Use "none" to clear on update.

Reference notes:
  Quote multi-word book, contact, and tag names. Prefer --book and --contact for unambiguous agent calls.
  JSON input accepts the API CreateContactInput/UpdateContactInput shape and can be combined with scalar flags.
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

const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

const apiPath = (path = "") => `/api/contacts${path === "/" ? "" : path}`;

const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));

const jsonRequest = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

const readTextResponse = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const message = (() => {
      try {
        const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
        return String(payload.message ?? payload.error ?? (text.trim() || response.statusText));
      } catch {
        return text.trim() || response.statusText;
      }
    })();
    throw new Error(`${response.status} ${message}`);
  }
  return text;
};

const parsePositiveInt = (value: string | undefined, fallback: number, label: string): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
};

const paginationQuery = (ctx: CloudCliContext): Record<string, string> => ({
  page: String(parsePositiveInt(stringFlag(ctx.flags, "page"), 1, "--page")),
  per_page: String(parsePositiveInt(stringFlag(ctx.flags, "per-page", "per_page"), 50, "--per-page")),
});

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.table(rows, columns);
};

const readInputContent = async (ctx: CloudCliContext, required = true): Promise<string | undefined> => {
  const literal = stringFlag(ctx.flags, "content");
  const file = stringFlag(ctx.flags, "file", "f");
  const stdin = booleanFlag(ctx.flags, "stdin");
  const sources = [literal !== undefined, file !== undefined, stdin].filter(Boolean).length;
  if (sources > 1) throw new Error("Pass only one of --content, --file, or --stdin.");
  if (literal !== undefined) return literal;
  if (file) return readFile(file, "utf8");
  if (stdin) return Bun.stdin.text();
  if (required) throw new Error("Missing content. Pass --content, --file, or --stdin.");
  return undefined;
};

const readJsonInput = async <T>(ctx: CloudCliContext): Promise<T | undefined> => {
  const file = stringFlag(ctx.flags, "json-input");
  const stdin = booleanFlag(ctx.flags, "stdin");
  const sources = [file !== undefined, stdin].filter(Boolean).length;
  if (sources > 1) throw new Error("Pass only one of --json-input or --stdin.");
  if (!file && !stdin) return undefined;
  const text = file ? await readFile(file, "utf8") : await Bun.stdin.text();
  return JSON.parse(text) as T;
};

const parsePairValue = (value: string, valueKey: "email" | "phone") => {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex === -1) return { [valueKey]: value };
  return {
    label: value.slice(0, equalsIndex) || null,
    [valueKey]: value.slice(equalsIndex + 1),
  };
};

const formatBookCandidates = (items: ContactBook[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.name} (${item.id})`)
    .join(", ");

const formatContactCandidates = (items: Contact[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${resolveContactName(item)} (${item.id})`)
    .join(", ");

const formatTagCandidates = (items: ContactTag[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.name} (${item.id})`)
    .join(", ");

const bookRows = (items: ContactBook[]) =>
  items.map((book) => ({
    id: book.id,
    name: book.name,
    system: book.isSystem ? "yes" : "no",
    updatedAt: book.updatedAt ?? "",
  }));

const contactRows = (items: Contact[]) =>
  items.map((contact) => ({
    id: contact.id,
    name: resolveContactName(contact),
    email: contact.emails[0]?.email ?? "",
    phone: contact.phones[0]?.phone ?? "",
    company: contact.companyName ?? "",
    updatedAt: contact.updatedAt,
  }));

const tagRows = (items: ContactTag[]) =>
  items.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
  }));

const noteRows = (items: ContactNote[]) =>
  items.map((note) => ({
    id: note.id,
    author: note.authorDisplayName,
    content: note.content.replace(/\s+/g, " ").slice(0, 80),
    createdAt: note.createdAt,
  }));

const listBooks = async (ctx: CloudCliContext, query?: string): Promise<Page<ContactBook>> =>
  readApi<Page<ContactBook>>(
    ctx,
    `/books?${new URLSearchParams({
      ...paginationQuery(ctx),
      ...(query ? { q: query } : {}),
    }).toString()}`,
  );

const resolveBookRef = async (ctx: CloudCliContext, ref: string): Promise<ContactBook> => {
  if (isUuid(ref)) return readApi<ContactBook>(ctx, `/books/${ref}`);

  const page = await listBooks(ctx, ref);
  const matches = page.data.filter((book) => book.name === ref);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Book "${ref}" is ambiguous. Use one of: ${formatBookCandidates(matches)}`);
  const candidates = formatBookCandidates(page.data);
  throw new Error(
    candidates
      ? `Book "${ref}" was not found by id or exact name. Similar matches: ${candidates}`
      : `Book "${ref}" was not found by id or exact name.`,
  );
};

const requireDefaultBookRef = async (ctx: CloudCliContext): Promise<string> => {
  const ref = await ctx.getDefault(CONTACTS_BOOK_DEFAULT_KEY);
  if (!ref) throw new Error("Missing book. Pass --book <book> or run `cld contacts use <book>`.");
  return ref;
};

const resolveBookArg = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ bookRef: string; rest: string[] }> => {
  const flagged = stringFlag(ctx.flags, "book");
  if (flagged) return { bookRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { bookRef: requireArg(args, 0, "book"), rest: args.slice(1) };
  return { bookRef: await requireDefaultBookRef(ctx), rest: args };
};

const resolveTagRefFromList = (tags: ContactTag[], ref: string): ContactTag => {
  if (isUuid(ref)) {
    const tag = tags.find((item) => item.id === ref);
    if (tag) return tag;
  }
  const matches = tags.filter((item) => item.name === ref);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Tag "${ref}" is ambiguous. Use one of: ${formatTagCandidates(matches)}`);
  const candidates = formatTagCandidates(tags.filter((item) => item.name.toLowerCase().includes(ref.toLowerCase())));
  throw new Error(candidates ? `Tag "${ref}" was not found. Similar matches: ${candidates}` : `Tag "${ref}" was not found.`);
};

const resolveTagRef = async (ctx: CloudCliContext, bookId: string, ref: string): Promise<ContactTag> => {
  const tags = await readApi<ContactTag[]>(ctx, `/books/${bookId}/tags`);
  return resolveTagRefFromList(tags, ref);
};

const resolveTagIds = async (ctx: CloudCliContext, bookId: string, refs: string[]): Promise<string[]> => {
  const tags = await readApi<ContactTag[]>(ctx, `/books/${bookId}/tags`);
  const ids = refs.map((ref) => resolveTagRefFromList(tags, ref).id);
  return Array.from(new Set(ids));
};

const resolveContactRef = async (ctx: CloudCliContext, bookId: string, ref: string): Promise<Contact> => {
  if (isUuid(ref)) return readApi<Contact>(ctx, `/books/${bookId}/contacts/${ref}`);

  const page = await readApi<Page<Contact>>(
    ctx,
    `/books/${bookId}/contacts?${new URLSearchParams({ ...paginationQuery(ctx), q: ref }).toString()}`,
  );
  const matches = page.data.filter((contact) => resolveContactName(contact) === ref);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Contact "${ref}" is ambiguous. Use one of: ${formatContactCandidates(matches)}`);
  const candidates = formatContactCandidates(page.data);
  throw new Error(candidates ? `Contact "${ref}" was not found. Similar matches: ${candidates}` : `Contact "${ref}" was not found.`);
};

const resolveContactCommandArgs = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingAfterContact = 0,
): Promise<{ book: ContactBook; contact: Contact; rest: string[] }> => {
  const flaggedContact = stringFlag(ctx.flags, "contact");
  if (flaggedContact) {
    const { bookRef, rest } = await resolveBookArg(ctx, args, requiredTrailingAfterContact);
    const book = await resolveBookRef(ctx, bookRef);
    return { book, contact: await resolveContactRef(ctx, book.id, flaggedContact), rest };
  }

  const { bookRef, rest } = await resolveBookArg(ctx, args, requiredTrailingAfterContact + 1);
  const book = await resolveBookRef(ctx, bookRef);
  return { book, contact: await resolveContactRef(ctx, book.id, requireArg(rest, 0, "contact")), rest: rest.slice(1) };
};

const buildContactPayload = async <T extends CreateContactInput | UpdateContactInput>(ctx: CloudCliContext, bookId: string): Promise<T> => {
  const payload = ((await readJsonInput<T>(ctx)) ?? {}) as Record<string, unknown>;
  const setString = (field: keyof CreateContactInput, ...flags: string[]) => {
    const value = stringFlag(ctx.flags, ...flags);
    if (value !== undefined) payload[field] = value;
  };

  setString("label", "label");
  setString("firstName", "first-name", "firstName");
  setString("lastName", "last-name", "lastName");
  setString("companyName", "company-name", "companyName");
  setString("department", "department");
  setString("jobTitle", "job-title", "jobTitle");
  setString("vatId", "vat-id", "vatId");
  setString("birthday", "birthday");
  setString("salutation", "salutation");
  setString("pronouns", "pronouns");
  setString("preferredLanguage", "preferred-language", "preferredLanguage");
  setString("source", "source");

  const parent = stringFlag(ctx.flags, "parent", "parent-contact");
  if (parent !== undefined) payload.parentContactId = parent === "none" ? null : (await resolveContactRef(ctx, bookId, parent)).id;

  const emails = stringFlags(ctx.flags, "email");
  if (emails.length > 0) payload.emails = emails.map((email) => parsePairValue(email, "email"));

  const phones = stringFlags(ctx.flags, "phone");
  if (phones.length > 0) payload.phones = phones.map((phone) => parsePairValue(phone, "phone"));

  const tags = stringFlags(ctx.flags, "tag");
  if (tags.length > 0) payload.tagIds = await resolveTagIds(ctx, bookId, tags);

  return payload as T;
};

const assertHasPayload = (payload: Record<string, unknown>, command: string) => {
  if (Object.keys(payload).length === 0) throw new Error(`No contact fields to ${command}.`);
};

const contactTreeNodeName = (node: ContactTreeNode): string =>
  node.label || [node.firstName, node.lastName].filter(Boolean).join(" ") || node.companyName || node.id;

const formatContactTree = (tree: ContactTree): string => {
  const lines: string[] = [];
  const visit = (node: ContactTreeNode, depth: number) => {
    const marker = node.id === tree.selectedId ? "*" : "-";
    const suffix = node.jobTitle ? ` (${node.jobTitle})` : "";
    lines.push(`${"  ".repeat(depth)}${marker} ${contactTreeNodeName(node)}${suffix}`);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(tree.root, 0);
  return lines.join("\n");
};

export default defineCloudCliModule({
  name: "contacts",
  summary: "Manage contact books, contacts, notes, tags, and exports.",
  booleanFlags: ["include-system", "stdin", "use"],
  help,
  async run(ctx) {
    const [command, ...args] = ctx.args;

    if (!command || command === "help") {
      ctx.print(help());
      return 0;
    }

    if (command === "books") {
      const payload = await listBooks(ctx, stringFlag(ctx.flags, "q", "query"));
      printJsonOrTable(ctx, payload, bookRows(payload.data), [
        { key: "name", label: "NAME" },
        { key: "system", label: "SYSTEM" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "use") {
      const book = await resolveBookRef(ctx, requireArg(args, 0, "book"));
      await ctx.setDefault(CONTACTS_BOOK_DEFAULT_KEY, book.id);
      if (ctx.options.output === "json") ctx.json({ book, defaultBook: book.id });
      else ctx.print(`Using contact book ${book.name} (${book.id}).`);
      return 0;
    }

    if (command === "current") {
      const bookRef = await ctx.getDefault(CONTACTS_BOOK_DEFAULT_KEY);
      if (!bookRef) throw new Error("No default contact book configured. Run `cld contacts use <book>`.");
      const book = await resolveBookRef(ctx, bookRef);
      if (ctx.options.output === "json") ctx.json({ book, defaultBook: book.id });
      else ctx.print(`${book.name} (${book.id})`);
      return 0;
    }

    if (command === "book") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      if (ctx.options.output === "json") ctx.json(book);
      else {
        ctx.print(`${book.name} (${book.id})`);
        if (book.description) ctx.print(book.description);
        ctx.print(`system: ${book.isSystem ? "yes" : "no"}`);
      }
      return 0;
    }

    if (command === "create-book") {
      const data: CreateBookInput = {
        name: requireArg(args, 0, "book name"),
        ...(stringFlag(ctx.flags, "description") ? { description: stringFlag(ctx.flags, "description") } : {}),
      };
      const book = await readApi<ContactBook>(ctx, "/books", jsonRequest("POST", data));
      if (booleanFlag(ctx.flags, "use")) await ctx.setDefault(CONTACTS_BOOK_DEFAULT_KEY, book.id);
      if (ctx.options.output === "json") ctx.json(book);
      else ctx.print(`Created ${book.name} (${book.id}).${booleanFlag(ctx.flags, "use") ? " Using it as default." : ""}`);
      return 0;
    }

    if (command === "update-book") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const data: UpdateBookInput = {};
      const name = stringFlag(ctx.flags, "name");
      const description = stringFlag(ctx.flags, "description");
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (Object.keys(data).length === 0) throw new Error("No book fields to update.");
      const updated = await readApi<ContactBook>(ctx, `/books/${book.id}`, jsonRequest("PATCH", data));
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Updated ${updated.name} (${updated.id}).`);
      return 0;
    }

    if (command === "delete-book") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const payload = await readApi<unknown>(ctx, `/books/${book.id}`, { method: "DELETE" });
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Deleted ${book.name} (${book.id}).`);
      return 0;
    }

    if (command === "list") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const tagRefs = stringFlags(ctx.flags, "tag");
      const tagIds = await resolveTagIds(ctx, book.id, tagRefs);
      const query = new URLSearchParams({
        ...paginationQuery(ctx),
        ...(stringFlag(ctx.flags, "q", "query") ? { q: stringFlag(ctx.flags, "q", "query")! } : {}),
      });
      for (const tagId of tagIds) query.append("tag_id", tagId);
      const payload = await readApi<Page<Contact>>(ctx, `/books/${book.id}/contacts?${query.toString()}`);
      printJsonOrTable(ctx, payload, contactRows(payload.data), [
        { key: "name", label: "NAME" },
        { key: "email", label: "EMAIL" },
        { key: "phone", label: "PHONE" },
        { key: "company", label: "COMPANY" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "get") {
      const { contact } = await resolveContactCommandArgs(ctx, args);
      if (ctx.options.output === "json") ctx.json(contact);
      else {
        ctx.print(`${resolveContactName(contact)} (${contact.id})`);
        if (contact.jobTitle || contact.companyName) ctx.print([contact.jobTitle, contact.companyName].filter(Boolean).join(", "));
        if (contact.emails.length > 0) ctx.print(`email: ${contact.emails.map((email) => email.email).join(", ")}`);
        if (contact.phones.length > 0) ctx.print(`phone: ${contact.phones.map((phone) => phone.phone).join(", ")}`);
        if (contact.tags.length > 0) ctx.print(`tags: ${contact.tags.map((tag) => tag.name).join(", ")}`);
      }
      return 0;
    }

    if (command === "search") {
      const queryText = args.join(" ").trim() || stringFlag(ctx.flags, "q", "query");
      if (!queryText) throw new Error("Missing search query.");
      const payload = await readApi<Page<Contact>>(
        ctx,
        `/search?${new URLSearchParams({
          ...paginationQuery(ctx),
          q: queryText,
          ...(booleanFlag(ctx.flags, "include-system") ? { includeSystem: "true" } : {}),
        }).toString()}`,
      );
      printJsonOrTable(ctx, payload, contactRows(payload.data), [
        { key: "name", label: "NAME" },
        { key: "email", label: "EMAIL" },
        { key: "phone", label: "PHONE" },
        { key: "company", label: "COMPANY" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "create") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const data = await buildContactPayload<CreateContactInput>(ctx, book.id);
      assertHasPayload(data as Record<string, unknown>, "create");
      const contact = await readApi<Contact>(ctx, `/books/${book.id}/contacts`, jsonRequest("POST", data));
      if (ctx.options.output === "json") ctx.json(contact);
      else ctx.print(`Created ${resolveContactName(contact)} (${contact.id}).`);
      return 0;
    }

    if (command === "update") {
      const { book, contact } = await resolveContactCommandArgs(ctx, args);
      const data = await buildContactPayload<UpdateContactInput>(ctx, book.id);
      assertHasPayload(data as Record<string, unknown>, "update");
      const updated = await readApi<Contact>(ctx, `/books/${book.id}/contacts/${contact.id}`, jsonRequest("PATCH", data));
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Updated ${resolveContactName(updated)} (${updated.id}).`);
      return 0;
    }

    if (command === "delete") {
      const { book, contact } = await resolveContactCommandArgs(ctx, args);
      const payload = await readApi<unknown>(ctx, `/books/${book.id}/contacts/${contact.id}`, { method: "DELETE" });
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Deleted ${resolveContactName(contact)} (${contact.id}).`);
      return 0;
    }

    if (command === "move") {
      const { book, contact } = await resolveContactCommandArgs(ctx, args);
      const targetBookRef = stringFlag(ctx.flags, "target-book", "targetBookId");
      if (!targetBookRef) throw new Error("Missing target book. Pass --target-book <book>.");
      const targetBook = await resolveBookRef(ctx, targetBookRef);
      const moved = await readApi<Contact>(
        ctx,
        `/books/${book.id}/contacts/${contact.id}/move`,
        jsonRequest("POST", { targetBookId: targetBook.id }),
      );
      if (ctx.options.output === "json") ctx.json(moved);
      else ctx.print(`Moved ${resolveContactName(moved)} to ${targetBook.name}.`);
      return 0;
    }

    if (command === "tree") {
      const { book, contact } = await resolveContactCommandArgs(ctx, args);
      const tree = await readApi<ContactTree>(ctx, `/books/${book.id}/contacts/${contact.id}/tree`);
      if (ctx.options.output === "json") ctx.json(tree);
      else ctx.print(formatContactTree(tree));
      return 0;
    }

    if (command === "notes" || command === "note" || command === "update-note" || command === "delete-note") {
      const { book, contact, rest } = await resolveContactCommandArgs(
        ctx,
        args,
        command === "update-note" || command === "delete-note" ? 1 : 0,
      );

      if (command === "notes") {
        const notes = await readApi<ContactNote[]>(ctx, `/books/${book.id}/contacts/${contact.id}/notes`);
        printJsonOrTable(ctx, notes, noteRows(notes), [
          { key: "createdAt", label: "CREATED" },
          { key: "author", label: "AUTHOR" },
          { key: "content", label: "CONTENT" },
          { key: "id", label: "ID" },
        ]);
        return 0;
      }

      if (command === "note") {
        const content = await readInputContent(ctx);
        const data: CreateContactNoteInput = { content: content ?? "" };
        const note = await readApi<ContactNote>(ctx, `/books/${book.id}/contacts/${contact.id}/notes`, jsonRequest("POST", data));
        if (ctx.options.output === "json") ctx.json(note);
        else ctx.print(`Created note ${note.id}.`);
        return 0;
      }

      const noteId = requireArg(rest, 0, "note");
      if (command === "update-note") {
        const content = await readInputContent(ctx);
        const data: UpdateContactNoteInput = { content: content ?? "" };
        const note = await readApi<ContactNote>(
          ctx,
          `/books/${book.id}/contacts/${contact.id}/notes/${noteId}`,
          jsonRequest("PATCH", data),
        );
        if (ctx.options.output === "json") ctx.json(note);
        else ctx.print(`Updated note ${note.id}.`);
        return 0;
      }

      const payload = await readApi<unknown>(ctx, `/books/${book.id}/contacts/${contact.id}/notes/${noteId}`, { method: "DELETE" });
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Deleted note ${noteId}.`);
      return 0;
    }

    if (command === "tags" || command === "create-tag" || command === "update-tag" || command === "delete-tag") {
      const { bookRef, rest } = await resolveBookArg(
        ctx,
        args,
        command === "create-tag" || command === "update-tag" || command === "delete-tag" ? 1 : 0,
      );
      const book = await resolveBookRef(ctx, bookRef);

      if (command === "tags") {
        const tags = await readApi<ContactTag[]>(ctx, `/books/${book.id}/tags`);
        printJsonOrTable(ctx, tags, tagRows(tags), [
          { key: "name", label: "NAME" },
          { key: "color", label: "COLOR" },
          { key: "id", label: "ID" },
        ]);
        return 0;
      }

      if (command === "create-tag") {
        const color = stringFlag(ctx.flags, "color");
        if (!color) throw new Error("Missing color. Pass --color <#RRGGBB>.");
        const data: CreateContactTagInput = { name: requireArg(rest, 0, "tag name"), color };
        const tag = await readApi<ContactTag>(ctx, `/books/${book.id}/tags`, jsonRequest("POST", data));
        if (ctx.options.output === "json") ctx.json(tag);
        else ctx.print(`Created tag ${tag.name} (${tag.id}).`);
        return 0;
      }

      const tag = await resolveTagRef(ctx, book.id, requireArg(rest, 0, "tag"));
      if (command === "update-tag") {
        const data: UpdateContactTagInput = {};
        const name = stringFlag(ctx.flags, "name");
        const color = stringFlag(ctx.flags, "color");
        if (name !== undefined) data.name = name;
        if (color !== undefined) data.color = color;
        if (Object.keys(data).length === 0) throw new Error("No tag fields to update.");
        const updated = await readApi<ContactTag>(ctx, `/books/${book.id}/tags/${tag.id}`, jsonRequest("PATCH", data));
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Updated tag ${updated.name} (${updated.id}).`);
        return 0;
      }

      const payload = await readApi<unknown>(ctx, `/books/${book.id}/tags/${tag.id}`, { method: "DELETE" });
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Deleted tag ${tag.name} (${tag.id}).`);
      return 0;
    }

    if (command === "export") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const format = stringFlag(ctx.flags, "format") ?? "vcf";
      if (format !== "vcf" && format !== "csv") throw new Error("--format must be vcf or csv.");
      const body = await readTextResponse(await ctx.fetch(apiPath(`/books/${book.id}/export.${format}`)));
      const out = stringFlag(ctx.flags, "out", "output");
      if (out) {
        await writeFile(out, body);
        ctx.print(`Wrote ${out}.`);
      } else {
        ctx.print(body);
      }
      return 0;
    }

    if (command === "import-preview") {
      const { bookRef } = await resolveBookArg(ctx, args, 0);
      const book = await resolveBookRef(ctx, bookRef);
      const content = await readInputContent(ctx);
      const payload = await readApi<ImportPreviewResponse>(
        ctx,
        `/books/${book.id}/import/preview`,
        jsonRequest("POST", { format: "vcard", content }),
      );
      ctx.json(payload);
      return 0;
    }

    throw new Error(`Unknown contacts command "${command}". Run \`cld contacts help\`.`);
  },
});
