import { prompts, toast } from "@k2b/ui";
import type { AiProject } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : fallback;
};

export const openAssistantCreateProjectDialog = async (): Promise<AiProject | null> => {
  const values = await prompts.form({
    title: "Create Project",
    icon: "ti ti-folder-plus",
    confirmText: "Create Project",
    fields: {
      name: {
        type: "text",
        label: "Name",
        placeholder: "IT support",
        required: true,
        maxLength: 120,
      },
      instructions: {
        type: "text",
        label: "Instructions",
        placeholder: "How should Assistant work in this Project?",
        multiline: true,
        lines: 5,
        maxLength: 16_000,
      },
    },
  });
  if (!values) return null;

  const response = await coreClient.ai.projects.$post({
    json: {
      name: values.name.trim(),
      instructions: values.instructions?.trim() ?? "",
      description: "",
      icon: "ti ti-folders",
    },
  });
  if (!response.ok) {
    await prompts.error(await readError(response, "Failed to create Project"), { title: "Could not create Project" });
    return null;
  }

  const project = (await response.json()).project as AiProject;
  toast.success("Project created");
  return project;
};
