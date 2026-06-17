import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import {
  CheckboxCardInput,
  ColorInput,
  dialogCore,
  IconInput,
  ImageInput,
  PermissionEditor,
  Placeholder,
  panelDialogOptions,
  prompts,
  type ResourceApiKey,
  ResourceApiKeys,
  SettingsModal,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  DateOverride,
  DateOverrideInput,
  OpeningRule,
  OpeningRuleInput,
  ShiftTemplate,
  ShiftTemplateInput,
  Venue,
  VenueDashboard,
} from "../../../contracts";
import { weekdays } from "./constants";
import { ClosedDayDialog, OpeningRuleDialog, ScheduleActionButton, ShiftTemplateDialog } from "./schedule";
import { bannerTransform, canAdmin, readError, sortOpeningRules, sortOverrides, sortShiftTemplates } from "./utils";

function VenueDangerZone(props: { venue: Venue }) {
  const remove = mutation.create<void, void>({
    mutation: async () => {
      const res = await apiClient.venues[":id"].$delete({
        param: { id: props.venue.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete venue."));
    },
    onSuccess: () => navigateTo("/app/venue"),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.venue.name}" and all venue data? This cannot be undone.`, {
      title: "Delete venue",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) remove.mutate();
  };

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed">
        This removes opening hours, shifts, public sections, feedback, access grants, and API keys. It cannot be undone.
      </p>
      <button type="button" onClick={handleDelete} disabled={remove.loading()} class="btn-danger btn-md self-start">
        {remove.loading() ? (
          <>
            <i class="ti ti-loader-2 animate-spin" />
            Deleting
          </>
        ) : (
          <>
            <i class="ti ti-trash" />
            Delete venue
          </>
        )}
      </button>
    </div>
  );
}

export function SettingsDialog(props: {
  dashboard: VenueDashboard;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  icalToken: string;
  close: () => void;
}) {
  const venue = props.dashboard.venue;
  const [name, setName] = createSignal(venue.name);
  const [icon, setIcon] = createSignal(venue.icon || "ti ti-building-carousel");
  const [slug, setSlug] = createSignal(venue.slug);
  const [description, setDescription] = createSignal(venue.description ?? "");
  const [accentColor, setAccentColor] = createSignal(venue.accentColor);
  const [feedbackEnabled, setFeedbackEnabled] = createSignal(venue.feedbackEnabled);
  const [logo, setLogo] = createSignal(venue.logoBase64);
  const [banner, setBanner] = createSignal(venue.bannerBase64);
  const [openingRules, setOpeningRules] = createSignal<OpeningRule[]>(props.dashboard.openingRules);
  const [overrides, setOverrides] = createSignal<DateOverride[]>(props.dashboard.overrides);
  const [shiftTemplates, setShiftTemplates] = createSignal<ShiftTemplate[]>(props.dashboard.templates);

  const save = mutation.create<void, void>({
    mutation: async () => {
      const res = await apiClient.venues[":id"].$patch({
        param: { id: venue.id },
        json: {
          name: name(),
          icon: icon(),
          slug: slug(),
          description: description().trim() || null,
          timezone: venue.timezone,
          openMode: venue.openMode,
          signupMode: venue.signupMode,
          publicEnabled: venue.publicEnabled,
          feedbackEnabled: feedbackEnabled(),
          accentColor: accentColor(),
          logoBase64: logo(),
          bannerBase64: banner(),
        },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to save venue."));
    },
    onSuccess: () => {
      toast.success("Venue saved");
      props.close();
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const createOpening = mutation.create<OpeningRule | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<OpeningRuleInput | null>((close) => <OpeningRuleDialog close={close} />, panelDialogOptions);
      if (!input) return null;
      const res = await apiClient.venues[":id"]["opening-rules"].$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add opening hours."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setOpeningRules((current) => sortOpeningRules([...current, created]));
      toast.success("Opening hours added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editOpening = mutation.create<OpeningRule | null, OpeningRule>({
    mutation: async (rule) => {
      const input = await dialogCore.open<OpeningRuleInput | null>(
        (close) => <OpeningRuleDialog close={close} initial={rule} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$patch({
        param: { id: venue.id, resourceId: rule.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update opening hours."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setOpeningRules((current) => sortOpeningRules(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Opening hours updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteOpening = mutation.create<void, OpeningRule>({
    mutation: async (rule) => {
      const confirmed = await prompts.confirm(`Delete opening hours for ${weekdays[rule.weekday]} ${rule.startTime}-${rule.endTime}?`, {
        title: "Delete opening hours",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$delete({
        param: { id: venue.id, resourceId: rule.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete opening hours."));
      setOpeningRules((current) => current.filter((entry) => entry.id !== rule.id));
      toast.success("Opening hours deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  const addHoliday = mutation.create<DateOverride | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<DateOverrideInput | null>(
        (close) => <ClosedDayDialog close={close} timeZone={venue.timezone} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].overrides.$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add closed day."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setOverrides((current) => sortOverrides([...current.filter((entry) => entry.date !== created.date), created]));
      toast.success("Closed day added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editHoliday = mutation.create<DateOverride | null, DateOverride>({
    mutation: async (entry) => {
      const input = await dialogCore.open<DateOverrideInput | null>(
        (close) => <ClosedDayDialog close={close} timeZone={venue.timezone} initial={entry} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$patch({
        param: { id: venue.id, resourceId: entry.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update closed day."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setOverrides((current) => sortOverrides(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Closed day updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteHoliday = mutation.create<void, DateOverride>({
    mutation: async (entry) => {
      const confirmed = await prompts.confirm(`Delete closed day "${entry.date}"?`, {
        title: "Delete closed day",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$delete({
        param: { id: venue.id, resourceId: entry.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete closed day."));
      setOverrides((current) => current.filter((candidate) => candidate.id !== entry.id));
      toast.success("Closed day deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  const createShift = mutation.create<ShiftTemplate | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<ShiftTemplateInput | null>((close) => <ShiftTemplateDialog close={close} />, panelDialogOptions);
      if (!input) return null;
      const res = await apiClient.venues[":id"].templates.$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add shift."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setShiftTemplates((current) => sortShiftTemplates([...current, created]));
      toast.success("Shift added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editShift = mutation.create<ShiftTemplate | null, ShiftTemplate>({
    mutation: async (shift) => {
      const input = await dialogCore.open<ShiftTemplateInput | null>(
        (close) => <ShiftTemplateDialog close={close} initial={shift} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].templates[":resourceId"].$patch({
        param: { id: venue.id, resourceId: shift.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update shift."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setShiftTemplates((current) => sortShiftTemplates(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Shift updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteShift = mutation.create<void, ShiftTemplate>({
    mutation: async (shift) => {
      const confirmed = await prompts.confirm(`Delete shift "${shift.title}"?`, {
        title: "Delete shift",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"].templates[":resourceId"].$delete({
        param: { id: venue.id, resourceId: shift.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete shift."));
      setShiftTemplates((current) => current.filter((entry) => entry.id !== shift.id));
      toast.success("Shift deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Venue settings" subtitle={venue.name} icon={icon()} onClose={props.close} closeLabel="Close settings">
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, public page branding, and feedback.">
          <div class="grid gap-3">
            <TextInput label="Name" description="Shown in the app and on the public page." value={name} onInput={setName} required />
            <TextInput label="Slug" description="Used in the public page URL." value={slug} onInput={setSlug} required />
            <TextInput
              label="Description"
              description="Short public summary shown below the venue name."
              value={description}
              onInput={setDescription}
              multiline
              lines={3}
            />
            <div class="grid gap-3 md:grid-cols-2">
              <IconInput
                label="Icon"
                description="Used as fallback logo and venue symbol."
                value={icon}
                onChange={setIcon}
                clearable={false}
              />
              <ColorInput label="Theme color" description="Used for public page accents." value={accentColor} onChange={setAccentColor} />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <ImageInput
                label="Logo"
                description="Optional image shown next to the venue name."
                value={logo}
                onChange={setLogo}
                variant="small"
              />
              <ImageInput
                label="Banner image"
                description="Optional wide image for the public page header."
                value={banner}
                onChange={setBanner}
                variant="small"
                transform={bannerTransform}
              />
            </div>
            <CheckboxCardInput
              label="Feedback activated"
              description="Allow visitors to leave anonymous ratings and comments on the public page."
              icon="ti ti-message-star"
              value={feedbackEnabled}
              onChange={setFeedbackEnabled}
              variant="input"
            />
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" class="btn-primary btn-sm" disabled={save.loading()} onClick={() => save.mutate()}>
                Save
              </button>
            </div>
          </div>
        </SettingsModal.Tab>

        {canAdmin(venue) && (
          <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
            <div class="grid gap-5">
              <PermissionEditor
                initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
                canEdit
                allowedLevels={[
                  { level: "read", label: "Read" },
                  { level: "write", label: "Staff" },
                  { level: "admin", label: "Admin" },
                ]}
                grantAccess={async (principal: Principal, permission: Exclude<PermissionLevel, "none">): Promise<AccessEntry> => {
                  const response = await apiClient.venues[":id"].access.$post({
                    param: { id: venue.id },
                    json: { principal, permission },
                  });
                  if (!response.ok) throw new Error(await readError(response, "Failed to grant access."));
                  return await response.json();
                }}
                updateAccess={async (accessId, permission) => {
                  const response = await apiClient.venues[":id"].access[":accessId"].$patch({
                    param: { id: venue.id, accessId },
                    json: { permission },
                  });
                  if (!response.ok) throw new Error(await readError(response, "Failed to update access."));
                }}
                revokeAccess={async (accessId) => {
                  const response = await apiClient.venues[":id"].access[":accessId"].$delete({ param: { id: venue.id, accessId } });
                  if (!response.ok) throw new Error(await readError(response, "Failed to revoke access."));
                }}
              />
              <div>
                <ResourceApiKeys
                  title="API keys"
                  description="Resource-bound keys for integrations that need access to this venue."
                  initialKeys={props.apiKeys}
                  createKey={async (input) => {
                    const response = await apiClient.venues[":id"]["api-keys"].$post({
                      param: { id: venue.id },
                      json: input,
                    });
                    if (!response.ok) throw new Error(await readError(response, "Failed to create API key."));
                    return (await response.json()) as { credential: ResourceApiKey; token: string };
                  }}
                  revokeKey={async (credentialId) => {
                    const response = await apiClient.venues[":id"]["api-keys"][":credentialId"].$delete({
                      param: { id: venue.id, credentialId },
                    });
                    if (!response.ok) throw new Error(await readError(response, "Failed to revoke API key."));
                  }}
                />
              </div>
            </div>
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab
          id="schedule"
          title="Schedule"
          icon="ti ti-calendar-time"
          description="Regular hours, closed days, and staffing targets."
        >
          <div class="grid gap-5">
            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Regular hours</h4>
                <Show when={canAdmin(venue)}>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    disabled={createOpening.loading()}
                    onClick={() => createOpening.mutate()}
                  >
                    <i class={createOpening.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={openingRules()}
                  fallback={
                    <Placeholder align="left" class="px-0 py-2 sm:col-span-2">
                      No regular hours.
                    </Placeholder>
                  }
                >
                  {(rule) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{weekdays[rule.weekday]}</p>
                          <p class="text-dimmed">
                            {rule.startTime}-{rule.endTime}
                            {rule.note ? ` · ${rule.note}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit opening hours"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editOpening.loading()}
                              onClick={() => editOpening.mutate(rule)}
                            />
                            <ScheduleActionButton
                              label="Delete opening hours"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteOpening.loading()}
                              onClick={() => deleteOpening.mutate(rule)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Closed days</h4>
                <Show when={canAdmin(venue)}>
                  <button type="button" class="btn-secondary btn-sm" disabled={addHoliday.loading()} onClick={() => addHoliday.mutate()}>
                    <i class={addHoliday.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={overrides()}
                  fallback={
                    <Placeholder align="left" class="px-0 py-2 sm:col-span-2">
                      No closed days.
                    </Placeholder>
                  }
                >
                  {(entry) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{entry.date}</p>
                          <p class="text-dimmed">
                            {entry.kind}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit closed day"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editHoliday.loading()}
                              onClick={() => editHoliday.mutate(entry)}
                            />
                            <ScheduleActionButton
                              label="Delete closed day"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteHoliday.loading()}
                              onClick={() => deleteHoliday.mutate(entry)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Shifts</h4>
                <Show when={canAdmin(venue)}>
                  <button type="button" class="btn-secondary btn-sm" disabled={createShift.loading()} onClick={() => createShift.mutate()}>
                    <i class={createShift.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={shiftTemplates()}
                  fallback={
                    <Placeholder align="left" class="px-0 py-2 sm:col-span-2">
                      No shifts configured.
                    </Placeholder>
                  }
                >
                  {(shift) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{shift.title}</p>
                          <p class="text-dimmed">
                            {weekdays[shift.weekday]} · {shift.startTime}-{shift.endTime}
                          </p>
                          <p class="mt-2 text-xs text-dimmed">
                            Target {shift.minPeople}
                            {shift.maxPeople ? ` · max ${shift.maxPeople}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit shift"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editShift.loading()}
                              onClick={() => editShift.mutate(shift)}
                            />
                            <ScheduleActionButton
                              label="Delete shift"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteShift.loading()}
                              onClick={() => deleteShift.mutate(shift)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="links" title="Links" icon="ti ti-link" description="Public page and personal calendar subscription.">
          <div class="flex flex-wrap gap-2">
            <a class="btn-secondary btn-sm" href={`/app/venue/public/${venue.slug}`} target="_blank" rel="noreferrer">
              <i class="ti ti-external-link" />
              Public page
            </a>
            <a class="btn-secondary btn-sm" href={`/api/venue/calendar/${props.icalToken}.ics`}>
              <i class="ti ti-calendar-down" />
              iCal
            </a>
          </div>
        </SettingsModal.Tab>

        {canAdmin(venue) && (
          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Permanently delete this venue and all of its data."
            tone="danger"
          >
            <VenueDangerZone venue={venue} />
          </SettingsModal.Tab>
        )}
      </SettingsModal>
    </div>
  );
}
