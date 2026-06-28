import { dailyNotesTemplate } from "./daily";
import { gardenPlannerTemplate } from "./garden";
import { readingListTemplate } from "./reading";
import { recipeCollectorTemplate } from "./recipe";
import type { NotebookTemplate } from "./types";

export type {
  MaterializedTemplateNote,
  NotebookTemplate,
  TemplateContent,
  TemplateContext,
  TemplateNote,
  TemplateNoteContentContext,
} from "./types";
export { materializeTemplate, noteLink } from "./types";

export const templates: NotebookTemplate[] = [dailyNotesTemplate, gardenPlannerTemplate, recipeCollectorTemplate, readingListTemplate];

export const getTemplate = (id: string): NotebookTemplate | null => templates.find((template) => template.id === id) ?? null;
