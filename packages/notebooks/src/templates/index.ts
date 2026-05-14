import { dailyNotesTemplate } from "./daily";
import { gardenPlannerTemplate } from "./garden";
import { projectHubTemplate } from "./project";
import { topicWikiTemplate } from "./wiki";
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

export const templates: NotebookTemplate[] = [
  dailyNotesTemplate,
  gardenPlannerTemplate,
  topicWikiTemplate,
  projectHubTemplate,
];

export const getTemplate = (id: string): NotebookTemplate | null =>
  templates.find((template) => template.id === id) ?? null;
