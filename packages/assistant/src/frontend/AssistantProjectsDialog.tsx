import { Button, Placeholder, prompts, TextInput, toast } from "@k2b/ui";
import type { AiProject } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { createResource, createSignal, For, Show } from "solid-js";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : fallback;
};

const listProjects = async (): Promise<AiProject[]> => {
  const response = await coreClient.ai.projects.$get();
  if (!response.ok) throw new Error(await readError(response, "Failed to load Projects"));
  return (await response.json()).projects;
};

function ProjectsDialogBody(props: { close: () => void; startChat: (project: AiProject) => Promise<void> }) {
  const [projects, { refetch }] = createResource(listProjects);
  const [creating, setCreating] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<AiProject | null>(null);
  const [name, setName] = createSignal("");
  const [instructions, setInstructions] = createSignal("");

  const createProject = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!name().trim() || creating()) return;
    setCreating(true);
    try {
      const editing = editingProject();
      const response = editing
        ? await coreClient.ai.projects[":projectId"].$patch({
            param: { projectId: editing.shortId },
            json: { name: name().trim(), instructions: instructions().trim() },
          })
        : await coreClient.ai.projects.$post({
            json: { name: name().trim(), instructions: instructions().trim(), description: "", icon: "ti ti-folders" },
          });
      if (!response.ok) throw new Error(await readError(response, editing ? "Failed to save Project" : "Failed to create Project"));
      setEditingProject(null);
      setName("");
      setInstructions("");
      await refetch();
      toast.success(editing ? "Project saved" : "Project created");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to create Project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="flex flex-col gap-5">
      <form class="flex flex-col gap-3 rounded-lg border p-3" onSubmit={createProject}>
        <TextInput label="Name" value={name} onValueChange={setName} maxLength={120} placeholder="IT support" />
        <TextInput
          label="Instructions"
          value={instructions}
          onValueChange={setInstructions}
          multiline
          lines={4}
          maxLength={16_000}
          placeholder="How should Assistant work in this Project?"
        />
        <div class="flex justify-end gap-2">
          <Show when={editingProject()}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingProject(null);
                setName("");
                setInstructions("");
              }}
            >
              Cancel
            </Button>
          </Show>
          <Button type="submit" size="sm" loading={creating()} disabled={!name().trim()}>
            {editingProject() ? "Save Project" : "Create Project"}
          </Button>
        </div>
      </form>

      <Show when={projects.loading}>
        <Placeholder state="loading" title="Loading Projects" />
      </Show>
      <Show when={projects.error}>
        <Placeholder state="error" title="Could not load Projects" description={projects.error.message} />
      </Show>
      <Show when={!projects.loading && !projects.error && (projects()?.length ?? 0) === 0}>
        <Placeholder title="No Projects yet" description="Create one to share instructions and context across private chats." />
      </Show>
      <Show when={(projects()?.length ?? 0) > 0}>
        <ul class="divide-y overflow-hidden rounded-lg border">
          <For each={projects()}>
            {(project) => (
              <li class="flex items-center gap-3 p-3">
                <i class={`${project.icon || "ti ti-folders"} text-lg text-secondary`} aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-primary">{project.name}</p>
                  <p class="truncate text-xs text-secondary">{project.description || `${project.permission} access`}</p>
                </div>
                <Show when={project.permission !== "read"}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setEditingProject(project);
                      setName(project.name);
                      setInstructions(project.instructions);
                    }}
                  >
                    Edit
                  </Button>
                </Show>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={async () => {
                    await props.startChat(project);
                    props.close();
                  }}
                >
                  New chat
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export const openAssistantProjectsDialog = (startChat: (project: AiProject) => Promise<void>): Promise<void> =>
  prompts.dialog<void>((close) => <ProjectsDialogBody close={() => close()} startChat={startChat} />, {
    title: "Projects",
    icon: "ti ti-folders",
    size: "medium",
  });
