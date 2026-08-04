import { Button, dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, Switch, TextInput, toast } from "@k2b/ui";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { api } from "../server/api-client";
import type { AiSkillsRoutes } from "./skills-routes";
import type { AiSkill, AiSkillSummary } from "./skills-store";

const client = api.create<AiSkillsRoutes>({ baseUrl: "/api/ai/skills" });

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

type SkillFields = Pick<AiSkill, "name" | "description" | "instructions">;

export const aiSkillsApi = {
  list: async (): Promise<{ skills: AiSkillSummary[] }> => {
    const response = await client.index.$get();
    if (!response.ok) throw new Error(await readError(response, "Failed to load skills"));
    return response.json();
  },
  create: async (input: SkillFields): Promise<{ skill: AiSkill }> => {
    const response = await client.index.$post({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to create skill"));
    return response.json();
  },
  detail: async (skillId: string): Promise<{ skill: AiSkill }> => {
    const response = await client[":skillId"].$get({ param: { skillId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to load skill"));
    return response.json();
  },
  update: async (skillId: string, input: Partial<SkillFields>): Promise<{ skill: AiSkill }> => {
    const response = await client[":skillId"].$patch({ param: { skillId }, json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to save skill"));
    return response.json();
  },
  remove: async (skillId: string): Promise<{ deleted: boolean }> => {
    const response = await client[":skillId"].$delete({ param: { skillId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to delete skill"));
    return response.json();
  },
  adminList: async (): Promise<{ skills: AiSkillSummary[] }> => {
    const response = await client.admin.$get();
    if (!response.ok) throw new Error(await readError(response, "Failed to load workspace skills"));
    return response.json();
  },
  adminCreate: async (input: SkillFields): Promise<{ skill: AiSkill }> => {
    const response = await client.admin.$post({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to create workspace skill"));
    return response.json();
  },
  adminDetail: async (skillId: string): Promise<{ skill: AiSkill }> => {
    const response = await client.admin[":skillId"].$get({ param: { skillId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to load workspace skill"));
    return response.json();
  },
  adminUpdate: async (skillId: string, input: Partial<SkillFields> & { enabled?: boolean }): Promise<{ skill: AiSkill }> => {
    const response = await client.admin[":skillId"].$patch({ param: { skillId }, json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to save workspace skill"));
    return response.json();
  },
  adminRemove: async (skillId: string): Promise<{ deleted: boolean }> => {
    const response = await client.admin[":skillId"].$delete({ param: { skillId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to delete workspace skill"));
    return response.json();
  },
};

function SkillEditorDialog(props: { skill?: AiSkillSummary; isAdmin: boolean; readOnly: boolean; close: (changed?: boolean) => void }) {
  const [detail] = createResource(
    () => props.skill?.id,
    async (skillId) => (props.isAdmin ? aiSkillsApi.adminDetail(skillId) : aiSkillsApi.detail(skillId)).then((result) => result.skill),
  );
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [instructions, setInstructions] = createSignal("");
  const [enabled, setEnabled] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  let initialized = false;

  createEffect(() => {
    const skill = detail();
    if (!skill || initialized) return;
    initialized = true;
    setName(skill.name);
    setDescription(skill.description);
    setInstructions(skill.instructions);
    setEnabled(skill.enabled);
  });

  const save = async () => {
    if (props.readOnly || saving()) return;
    setSaving(true);
    try {
      const fields = { name: name().trim(), description: description().trim(), instructions: instructions().trim() };
      if (props.skill) {
        if (props.isAdmin) await aiSkillsApi.adminUpdate(props.skill.id, { ...fields, enabled: enabled() });
        else await aiSkillsApi.update(props.skill.id, fields);
      } else if (props.isAdmin) {
        await aiSkillsApi.adminCreate(fields);
      } else {
        await aiSkillsApi.create(fields);
      }
      toast.success(props.skill ? "Skill saved" : "Skill created");
      props.close(true);
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to save skill");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!props.skill || props.readOnly || saving()) return;
    const confirmed = await prompts.confirm(`Delete "${props.skill.name}"?`, {
      title: "Delete skill",
      confirmText: "Delete",
      cancelText: "Cancel",
      icon: "ti ti-trash",
      variant: "danger",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      if (props.isAdmin) await aiSkillsApi.adminRemove(props.skill.id);
      else await aiSkillsApi.remove(props.skill.id);
      toast.success("Skill deleted");
      props.close(true);
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to delete skill");
    } finally {
      setSaving(false);
    }
  };

  const loading = () => Boolean(props.skill && detail.loading && !detail());
  const loadError = () => (detail.error instanceof Error ? detail.error.message : detail.error ? "Failed to load skill" : null);

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.skill ? props.skill.name : props.isAdmin ? "New workspace skill" : "New skill"}
        subtitle={
          props.readOnly
            ? "Workspace skills are managed by administrators."
            : "Reusable instructions applied only when explicitly selected for a request."
        }
        icon="ti ti-wand"
        close={() => props.close()}
      />
      <PanelDialog.Body>
        <Show
          when={!loadError()}
          fallback={<Placeholder icon="ti ti-alert-circle" title="Failed to load skill" description={loadError() ?? undefined} />}
        >
          <Show when={!loading()} fallback={<Placeholder icon="ti ti-loader-2" title="Loading skill…" />}>
            <div class="flex flex-col gap-4">
              <TextInput
                label="Name"
                value={name}
                onValueChange={setName}
                maxLength={80}
                required
                readOnly={props.readOnly}
                placeholder="Meeting summary"
              />
              <TextInput
                label="Description"
                description="A short explanation of when this skill is useful."
                value={description}
                onValueChange={setDescription}
                maxLength={500}
                multiline
                lines={2}
                readOnly={props.readOnly}
              />
              <TextInput
                label="Instructions"
                description="Clear steps and output expectations. These instructions cannot override Cloud platform rules."
                value={instructions}
                onValueChange={setInstructions}
                maxLength={16_000}
                required
                multiline
                lines={12}
                readOnly={props.readOnly}
                placeholder="When this skill is selected…"
              />
              <Show when={props.isAdmin && !props.readOnly}>
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-sm font-medium text-primary">Available to users</p>
                    <p class="text-xs text-dimmed">Disabled workspace skills disappear from Assistant selection.</p>
                  </div>
                  <Switch value={enabled} onValueChange={setEnabled} disabled={saving()} />
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <Show when={props.skill && !props.readOnly} fallback={<span />}>
          <Button type="button" variant="danger" size="sm" disabled={saving()} onClick={() => void remove()}>
            <i class="ti ti-trash" aria-hidden="true" /> Delete
          </Button>
        </Show>
        <div class="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={saving()} onClick={() => props.close()}>
            {props.readOnly ? "Close" : "Cancel"}
          </Button>
          <Show when={!props.readOnly}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving() || loading() || Boolean(loadError()) || !name().trim() || !instructions().trim()}
              onClick={() => void save()}
            >
              <i class={saving() ? "ti ti-loader-2 k2b-spin" : "ti ti-check"} aria-hidden="true" />
              {props.skill ? "Save" : "Create"}
            </Button>
          </Show>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export type AiSkillsManagerBodyProps = {
  isAdmin: boolean;
  fixedHeight?: boolean;
};

export function AiSkillsManagerBody(props: AiSkillsManagerBodyProps) {
  const [query, setQuery] = createSignal("");
  const [skills, { refetch }] = createResource(async () =>
    props.isAdmin ? (await aiSkillsApi.adminList()).skills : (await aiSkillsApi.list()).skills,
  );
  const [togglingSkillId, setTogglingSkillId] = createSignal<string | null>(null);
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return (skills() ?? []).filter(
      (skill) => !needle || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle),
    );
  });

  const openEditor = (skill?: AiSkillSummary) => {
    const readOnly = Boolean(skill?.scope === "workspace" && !props.isAdmin);
    void dialogCore
      .open<boolean | undefined>(
        (close) => <SkillEditorDialog skill={skill} isAdmin={props.isAdmin} readOnly={readOnly} close={close} />,
        panelDialogOptions,
      )
      .then((changed) => {
        if (changed) void refetch();
      });
  };

  const setWorkspaceEnabled = async (skill: AiSkillSummary, enabled: boolean) => {
    if (togglingSkillId()) return;
    setTogglingSkillId(skill.id);
    try {
      await aiSkillsApi.adminUpdate(skill.id, { enabled });
      await refetch();
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to update skill");
    } finally {
      setTogglingSkillId(null);
    }
  };

  return (
    <div class={`flex min-h-0 flex-col gap-4 ${props.fixedHeight ? "h-[min(60vh,32rem)]" : ""}`}>
      <div class="flex items-end gap-2">
        <TextInput
          class="min-w-0 flex-1"
          type="search"
          icon="ti ti-search"
          label="Search"
          value={query}
          onValueChange={setQuery}
          placeholder="Search skills…"
        />
        <Button type="button" variant="secondary" size="md" class="h-9 shrink-0 whitespace-nowrap" onClick={() => openEditor()}>
          <i class="ti ti-plus" aria-hidden="true" /> New skill
        </Button>
      </div>

      <div class="min-h-0 overflow-y-auto">
        <Show
          when={!skills.error}
          fallback={
            <Placeholder
              icon="ti ti-alert-circle"
              title="Failed to load skills"
              description={skills.error instanceof Error ? skills.error.message : undefined}
            />
          }
        >
          <Show when={!skills.loading} fallback={<Placeholder icon="ti ti-loader-2" title="Loading skills…" />}>
            <Show
              when={filtered().length > 0}
              fallback={
                <Placeholder
                  icon={query().trim() ? "ti ti-search-off" : "ti ti-wand"}
                  title={query().trim() ? "No matching skills" : "No skills yet"}
                  description={query().trim() ? undefined : "Create concise reusable instructions for repeatable Assistant requests."}
                />
              }
            >
              <ul class="flex flex-col gap-2">
                <For each={filtered()}>
                  {(skill) => (
                    <li class="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 [box-shadow:var(--ui-control-bevel)] dark:bg-zinc-900">
                      <Button
                        type="button"
                        variant="ghost"
                        class="min-w-0 flex-1 justify-start gap-3 text-left"
                        onClick={() => openEditor(skill)}
                      >
                        <i class="ti ti-wand shrink-0 text-lg text-secondary" aria-hidden="true" />
                        <span class="min-w-0 flex-1">
                          <span class="flex items-center gap-2 text-sm font-medium text-primary">
                            <span class="truncate">{skill.name}</span>
                            <Show when={skill.scope === "workspace"}>
                              <span class="rounded px-1.5 py-0.5 text-[10px] font-medium text-dimmed [box-shadow:var(--ui-control-recess)]">
                                Workspace
                              </span>
                            </Show>
                          </span>
                          <span class="block truncate text-xs text-dimmed">{skill.description || "No description"}</span>
                        </span>
                      </Button>
                      <Show when={props.isAdmin}>
                        <Switch
                          value={() => skill.enabled}
                          onValueChange={(enabled) => void setWorkspaceEnabled(skill, enabled)}
                          disabled={togglingSkillId() !== null}
                        />
                      </Show>
                      <Show when={skill.scope === "workspace" && !props.isAdmin}>
                        <i class="ti ti-lock text-sm text-dimmed" title="Managed by administrators" aria-hidden="true" />
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function SkillsManagerDialog(props: { close: () => void }) {
  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Skills"
        subtitle="Personal reusable instructions and read-only workspace guidance."
        icon="ti ti-wand"
        close={props.close}
      />
      <PanelDialog.Body>
        <AiSkillsManagerBody isAdmin={false} fixedHeight />
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openAiSkillsManager = (): Promise<void> =>
  dialogCore.open<void>((close) => <SkillsManagerDialog close={() => close()} />, panelDialogOptions);
