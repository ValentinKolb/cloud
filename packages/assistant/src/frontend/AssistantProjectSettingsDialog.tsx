import { refreshCurrentPath } from "@k2b/ssr/nav";
import { Button, Placeholder, prompts, TextInput, toast } from "@k2b/ui";
import type { AiProject, AiProjectAccess } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { createResource, createSignal, For, Show } from "solid-js";

const readError = async (response: Response, fallback: string) => {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
};

function ProjectSettings(props: { project: AiProject; close: () => void }) {
  const [name, setName] = createSignal(props.project.name);
  const [description, setDescription] = createSignal(props.project.description);
  const [instructions, setInstructions] = createSignal(props.project.instructions);
  const [saving, setSaving] = createSignal(false);
  const [access] = createResource(
    () => (props.project.permission === "admin" ? props.project.id : null),
    async (projectId) => {
      const response = await coreClient.ai.projects[":projectId"].access.$get({ param: { projectId } });
      if (!response.ok) throw new Error(await readError(response, "Failed to load Project access"));
      return (await response.json()).access as AiProjectAccess[];
    },
  );
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await coreClient.ai.projects[":projectId"].$patch({
        param: { projectId: props.project.id },
        json: { name: name().trim(), description: description().trim(), instructions: instructions().trim() },
      });
      if (!response.ok) throw new Error(await readError(response, "Failed to save Project"));
      toast.success("Project saved");
      props.close();
      refreshCurrentPath();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div class="flex flex-col gap-6">
      <form class="flex flex-col gap-3" onSubmit={save}>
        <TextInput label="Name" value={name} onValueChange={setName} maxLength={120} />
        <TextInput label="Description" multiline lines={2} value={description} onValueChange={setDescription} maxLength={500} />
        <TextInput label="Instructions" multiline lines={7} value={instructions} onValueChange={setInstructions} maxLength={16_000} />
        <div class="flex justify-end">
          <Button type="submit" loading={saving()}>
            Save changes
          </Button>
        </div>
      </form>
      <Show when={props.project.permission === "admin"}>
        <section>
          <h2 class="font-semibold text-primary">Access</h2>
          <Show
            when={access()}
            fallback={
              <Placeholder state={access.error ? "error" : "loading"} title={access.error ? "Could not load access" : "Loading access"} />
            }
          >
            <ul class="mt-2 flex flex-col gap-2">
              <For each={access()}>
                {(entry) => (
                  <li class="flex items-center justify-between text-sm">
                    <span>{entry.displayName || entry.principal.type}</span>
                    <span class="text-dimmed">{entry.permission}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>
    </div>
  );
}

export const openAssistantProjectSettingsDialog = (project: AiProject) =>
  prompts.dialog<void>((close) => <ProjectSettings project={project} close={() => close()} />, {
    title: "Project settings",
    icon: "ti ti-settings",
    size: "large",
  });
