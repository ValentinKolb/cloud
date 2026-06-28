import type { Notebook } from "../service/notebooks";
import type { Note } from "../service/notes";

export type TemplateContext = {
  now: Date;
};

export type TemplateNoteContentContext = TemplateContext & {
  notebook: Notebook;
  notes: Map<string, Note>;
  link: (key: string, label?: string) => string;
  noteId: (key: string) => string;
};

export type TemplateContent = string | ((ctx: TemplateNoteContentContext) => string);

export type TemplateNote = {
  key: string;
  title: string | ((ctx: TemplateContext) => string);
  content?: TemplateContent;
  children?: TemplateNote[];
};

export type NotebookTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  notebookName: string | ((ctx: TemplateContext) => string);
  notebookDescription?: string | ((ctx: TemplateContext) => string);
  scriptsEnabled?: boolean;
  homepageNoteKey?: string;
  notes: (ctx: TemplateContext) => TemplateNote[];
};

export type MaterializedTemplateNote = {
  key: string;
  title: string;
  content?: TemplateContent;
  parentKey: string | null;
  position: number;
};

const resolveText = (value: string | ((ctx: TemplateContext) => string) | undefined, ctx: TemplateContext): string | undefined =>
  typeof value === "function" ? value(ctx) : value;

const walkNotes = (notes: TemplateNote[], ctx: TemplateContext, parentKey: string | null, out: MaterializedTemplateNote[]) => {
  notes.forEach((note, position) => {
    out.push({
      key: note.key,
      title: resolveText(note.title, ctx) ?? "Untitled",
      content: note.content,
      parentKey,
      position,
    });
    if (note.children) walkNotes(note.children, ctx, note.key, out);
  });
};

export const materializeTemplate = (template: NotebookTemplate, now = new Date()) => {
  const ctx: TemplateContext = { now };
  const notes: MaterializedTemplateNote[] = [];
  walkNotes(template.notes(ctx), ctx, null, notes);

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
    notebookName: resolveText(template.notebookName, ctx) ?? template.name,
    notebookDescription: resolveText(template.notebookDescription, ctx) ?? template.description,
    scriptsEnabled: template.scriptsEnabled ?? false,
    homepageNoteKey: template.homepageNoteKey,
    notes,
  };
};

export const noteLink = (ctx: TemplateNoteContentContext, key: string, label?: string): string => {
  const note = ctx.notes.get(key);
  if (!note) throw new Error(`template note not found: ${key}`);
  return `[${label ?? note.title}](note://${note.shortId})`;
};
