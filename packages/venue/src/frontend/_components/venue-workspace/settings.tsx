import { navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  ButtonLink,
  CheckboxCard,
  ColorInput,
  dialogCore,
  IconInput,
  ImageInput,
  Placeholder,
  panelDialogOptions,
  prompts,
  SegmentedControl,
  SettingsModal,
  TextInput,
  toast,
} from "@k2b/ui";
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
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
  VenueInput,
} from "../../../contracts";
import { createVenueSettingsQuery, settingsCloseBlocked, settingsInteractionBlocked, venueSettingsCanAdmin } from "../../settings-contract";
import { weekdays } from "./constants";
import { openVenuePublicDisplayDialog } from "./public-display";
import { ClosedDayDialog, OpeningRuleDialog, ScheduleActionButton, ShiftTemplateDialog } from "./schedule";
import { bannerTransform, readError, sortOpeningRules, sortOverrides, sortShiftTemplates } from "./utils";

export function VenueDangerZone(props: { venue: Venue; onPendingChange: (pending: boolean) => void }) {
  let disposed = false;
  let confirming = false;
  const remove = mutation.create<void, { venueId: string }>({
    mutation: async ({ venueId }, { abortSignal }) => {
      const res = await apiClient.venues[":id"].$delete({ param: { id: venueId } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete venue."));
    },
    onSuccess: () => navigateTo("/app/venue"),
    onError: (err) => prompts.error(err.message),
  });
  const handleDelete = async () => {
    if (confirming || remove.loading()) return;
    confirming = true;
    props.onPendingChange(true);
    try {
      const intent = { venueId: props.venue.id, venueName: props.venue.name };
      const confirmed = await prompts.confirm(`Delete "${intent.venueName}" and all venue data? This cannot be undone.`, {
        title: "Delete venue",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (disposed || !confirmed) return;
      await remove.mutate({ venueId: intent.venueId });
    } finally {
      confirming = false;
      if (!disposed) props.onPendingChange(false);
    }
  };

  onCleanup(() => {
    disposed = true;
    remove.abort();
    props.onPendingChange(false);
  });

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed">
        This removes opening hours, shifts, public sections, feedback, access grants, and API keys. It cannot be undone.
      </p>
      <Button type="button" variant="danger" onClick={handleDelete} disabled={remove.loading()} class="self-start">
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
      </Button>
    </div>
  );
}

export function SettingsDialog(props: {
  dashboard: VenueDashboard;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  icalToken: string;
  close: (changed: boolean) => void;
}) {
  const venue = props.dashboard.venue;
  const initialContext = {
    venue,
    openingRules: props.dashboard.openingRules,
    overrides: props.dashboard.overrides,
    templates: props.dashboard.templates,
    accessEntries: props.accessEntries,
    apiKeys: props.apiKeys,
  };
  const settingsQuery = createVenueSettingsQuery({
    venueId: venue.id,
    initial: initialContext,
    load: async (venueId, abortSignal) => {
      const response = await apiClient.venues[":id"]["settings-context"].$get(
        { param: { id: venueId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readError(response, "Failed to refresh venue settings."));
      return await response.json();
    },
  });
  const settings = () => settingsQuery.data() ?? initialContext;
  const currentVenue = () => settings().venue;
  const [workspaceChanged, setWorkspaceChanged] = createSignal(false);
  const [name, setName] = createSignal(venue.name);
  const [icon, setIcon] = createSignal(venue.icon || "ti ti-building-carousel");
  const [slug, setSlug] = createSignal(venue.slug);
  const [description, setDescription] = createSignal(venue.description ?? "");
  const [openMode, setOpenMode] = createSignal<Venue["openMode"]>(venue.openMode);
  const [accentColor, setAccentColor] = createSignal(venue.accentColor);
  const [feedbackEnabled, setFeedbackEnabled] = createSignal(venue.feedbackEnabled);
  const [logo, setLogo] = createSignal(venue.logoBase64);
  const [banner, setBanner] = createSignal(venue.bannerBase64);
  const [generalDirty, setGeneralDirty] = createSignal(false);
  const openingRules = () => sortOpeningRules(settings().openingRules);
  const overrides = () => sortOverrides(settings().overrides);
  const shiftTemplates = () => sortShiftTemplates(settings().templates);

  let disposed = false;
  const [settingsHydrated, setSettingsHydrated] = createSignal(false);
  const [prompting, setPrompting] = createSignal(false);
  const [writePending, setWritePending] = createSignal(false);
  const [reconciling, setReconciling] = createSignal(false);
  const [reconciliationFailed, setReconciliationFailed] = createSignal(false);
  const [dangerPending, setDangerPending] = createSignal(false);
  const [requestCount, setRequestCount] = createSignal(0);
  const [activeTab, setActiveTab] = createSignal("general");
  const requestControllers = new Set<AbortController>();
  const runRequest = async <T,>(request: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (writePending() || reconciling()) throw new Error("Wait for the current settings change to finish.");
    setWritePending(true);
    setRequestCount((count) => count + 1);
    const controller = new AbortController();
    requestControllers.add(controller);
    try {
      const result = await request(controller.signal);
      if (disposed) {
        const error = new Error("The settings dialog was closed.");
        error.name = "AbortError";
        throw error;
      }
      return result;
    } finally {
      requestControllers.delete(controller);
      setRequestCount((count) => Math.max(0, count - 1));
      setWritePending(false);
    }
  };
  const reconcileSettings = async (successMessage: string) => {
    try {
      await settingsQuery.invalidate();
      if (disposed) return;
      setReconciliationFailed(false);
      toast.success(successMessage);
    } catch {
      if (disposed) return;
      setReconciliationFailed(true);
      prompts.error("The change was saved, but settings could not be refreshed. Retry the settings read before making another change.");
    }
  };
  const retrySettingsRead = async () => {
    await settingsQuery.refresh();
    if (!settingsQuery.error()) setReconciliationFailed(false);
  };
  const finishSettingsChange = async (successMessage: string) => {
    setWorkspaceChanged(true);
    setReconciling(true);
    try {
      await reconcileSettings(successMessage);
    } finally {
      setReconciling(false);
    }
  };
  const settingsWriteBlocked = () =>
    writePending() || reconciling() || requestCount() > 0 || settingsQuery.refreshing() || Boolean(settingsQuery.error());
  const runReconciledMutation = async <V,>(
    control: { mutate: (value: V) => Promise<void>; error: () => Error | null | undefined },
    value: V,
    successMessage: string,
  ) => {
    if (settingsWriteBlocked()) return;
    setWritePending(true);
    try {
      await control.mutate(value);
      if (disposed || control.error()) return;
      await finishSettingsChange(successMessage);
    } finally {
      setWritePending(false);
    }
  };
  const runPromptedAction = async <T,>(readIntent: () => Promise<T>, applyIntent: (intent: T) => Promise<void>) => {
    if (prompting()) return;
    setPrompting(true);
    try {
      const intent = await readIntent();
      if (disposed) return;
      await applyIntent(intent);
    } finally {
      setPrompting(false);
    }
  };

  createEffect(() => {
    const fresh = settingsQuery.data();
    if (!fresh || fresh === initialContext) return;
    setSettingsHydrated(true);
    if (generalDirty()) return;
    const next = fresh.venue;
    setName(next.name);
    setIcon(next.icon || "ti ti-building-carousel");
    setSlug(next.slug);
    setDescription(next.description ?? "");
    setOpenMode(next.openMode);
    setAccentColor(next.accentColor);
    setFeedbackEnabled(next.feedbackEnabled);
    setLogo(next.logoBase64);
    setBanner(next.bannerBase64);
  });

  const venueInput = (): VenueInput => ({
    name: name(),
    icon: icon(),
    slug: slug(),
    description: description().trim() || null,
    timezone: currentVenue().timezone,
    openMode: openMode(),
    signupMode: currentVenue().signupMode,
    publicEnabled: currentVenue().publicEnabled,
    feedbackEnabled: feedbackEnabled(),
    accentColor: accentColor(),
    logoBase64: logo(),
    bannerBase64: banner(),
  });
  const save = mutation.create<void, VenueInput>({
    mutation: async (input, { abortSignal }) => {
      const res = await apiClient.venues[":id"].$patch(
        {
          param: { id: venue.id },
          json: input,
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to save venue."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const saveSettings = async () => {
    if (settingsWriteBlocked()) return;
    setWritePending(true);
    try {
      await save.mutate(venueInput());
      if (disposed || save.error()) return;
      setWorkspaceChanged(true);
      toast.success("Venue saved");
      props.close(true);
    } finally {
      setWritePending(false);
    }
  };

  const createOpening = mutation.create<void, OpeningRuleInput>({
    mutation: async (input, { abortSignal }) => {
      const res = await apiClient.venues[":id"]["opening-rules"].$post(
        { param: { id: venue.id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to add opening hours."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openCreateOpening = async () => {
    await runPromptedAction(
      () => dialogCore.open<OpeningRuleInput | null>((close) => <OpeningRuleDialog close={close} />, panelDialogOptions),
      async (input) => {
        if (input) await runReconciledMutation(createOpening, input, "Opening hours added");
      },
    );
  };

  const editOpening = mutation.create<void, { id: string; input: OpeningRuleInput }>({
    mutation: async ({ id, input }, { abortSignal }) => {
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$patch(
        { param: { id: venue.id, resourceId: id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to update opening hours."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openEditOpening = async (rule: OpeningRule) => {
    const target = { id: rule.id, initial: { ...rule } };
    await runPromptedAction(
      () =>
        dialogCore.open<OpeningRuleInput | null>(
          (close) => <OpeningRuleDialog close={close} initial={target.initial} />,
          panelDialogOptions,
        ),
      async (input) => {
        if (input) await runReconciledMutation(editOpening, { id: target.id, input }, "Opening hours updated");
      },
    );
  };

  const deleteOpening = mutation.create<void, string>({
    mutation: async (id, { abortSignal }) => {
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$delete(
        { param: { id: venue.id, resourceId: id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to delete opening hours."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const confirmDeleteOpening = async (rule: OpeningRule) => {
    const target = { id: rule.id, label: `${weekdays[rule.weekday]} ${rule.startTime}-${rule.endTime}` };
    await runPromptedAction(
      () =>
        prompts.confirm(`Delete opening hours for ${target.label}?`, {
          title: "Delete opening hours",
          variant: "danger",
          confirmText: "Delete",
        }),
      async (confirmed) => {
        if (confirmed) await runReconciledMutation(deleteOpening, target.id, "Opening hours deleted");
      },
    );
  };

  const addHoliday = mutation.create<void, DateOverrideInput>({
    mutation: async (input, { abortSignal }) => {
      const res = await apiClient.venues[":id"].overrides.$post(
        { param: { id: venue.id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to add closed day."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openAddHoliday = async () => {
    const timezone = currentVenue().timezone;
    await runPromptedAction(
      () => dialogCore.open<DateOverrideInput | null>((close) => <ClosedDayDialog close={close} timeZone={timezone} />, panelDialogOptions),
      async (input) => {
        if (input) await runReconciledMutation(addHoliday, input, "Closed day added");
      },
    );
  };

  const editHoliday = mutation.create<void, { id: string; input: DateOverrideInput }>({
    mutation: async ({ id, input }, { abortSignal }) => {
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$patch(
        { param: { id: venue.id, resourceId: id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to update closed day."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openEditHoliday = async (entry: DateOverride) => {
    const target = { id: entry.id, initial: { ...entry }, timezone: currentVenue().timezone };
    await runPromptedAction(
      () =>
        dialogCore.open<DateOverrideInput | null>(
          (close) => <ClosedDayDialog close={close} timeZone={target.timezone} initial={target.initial} />,
          panelDialogOptions,
        ),
      async (input) => {
        if (input) await runReconciledMutation(editHoliday, { id: target.id, input }, "Closed day updated");
      },
    );
  };

  const deleteHoliday = mutation.create<void, string>({
    mutation: async (id, { abortSignal }) => {
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$delete(
        { param: { id: venue.id, resourceId: id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to delete closed day."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const confirmDeleteHoliday = async (entry: DateOverride) => {
    const target = { id: entry.id, date: entry.date };
    await runPromptedAction(
      () =>
        prompts.confirm(`Delete closed day "${target.date}"?`, {
          title: "Delete closed day",
          variant: "danger",
          confirmText: "Delete",
        }),
      async (confirmed) => {
        if (confirmed) await runReconciledMutation(deleteHoliday, target.id, "Closed day deleted");
      },
    );
  };

  const createShift = mutation.create<void, ShiftTemplateInput>({
    mutation: async (input, { abortSignal }) => {
      const res = await apiClient.venues[":id"].templates.$post(
        { param: { id: venue.id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to add shift."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openCreateShift = async () => {
    await runPromptedAction(
      () => dialogCore.open<ShiftTemplateInput | null>((close) => <ShiftTemplateDialog close={close} />, panelDialogOptions),
      async (input) => {
        if (input) await runReconciledMutation(createShift, input, "Shift added");
      },
    );
  };

  const editShift = mutation.create<void, { id: string; input: ShiftTemplateInput }>({
    mutation: async ({ id, input }, { abortSignal }) => {
      const res = await apiClient.venues[":id"].templates[":resourceId"].$patch(
        { param: { id: venue.id, resourceId: id }, json: input },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to update shift."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const openEditShift = async (shift: ShiftTemplate) => {
    const target = { id: shift.id, initial: { ...shift } };
    await runPromptedAction(
      () =>
        dialogCore.open<ShiftTemplateInput | null>(
          (close) => <ShiftTemplateDialog close={close} initial={target.initial} />,
          panelDialogOptions,
        ),
      async (input) => {
        if (input) await runReconciledMutation(editShift, { id: target.id, input }, "Shift updated");
      },
    );
  };

  const deleteShift = mutation.create<void, string>({
    mutation: async (id, { abortSignal }) => {
      const res = await apiClient.venues[":id"].templates[":resourceId"].$delete(
        { param: { id: venue.id, resourceId: id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to delete shift."));
    },
    onError: (err) => prompts.error(err.message),
  });
  const confirmDeleteShift = async (shift: ShiftTemplate) => {
    const target = { id: shift.id, title: shift.title };
    await runPromptedAction(
      () =>
        prompts.confirm(`Delete shift "${target.title}"?`, {
          title: "Delete shift",
          variant: "danger",
          confirmText: "Delete",
        }),
      async (confirmed) => {
        if (confirmed) await runReconciledMutation(deleteShift, target.id, "Shift deleted");
      },
    );
  };

  const mutationPending = () =>
    save.loading() ||
    createOpening.loading() ||
    editOpening.loading() ||
    deleteOpening.loading() ||
    addHoliday.loading() ||
    editHoliday.loading() ||
    deleteHoliday.loading() ||
    createShift.loading() ||
    editShift.loading() ||
    deleteShift.loading();
  const interactionState = () => ({
    prompting: prompting(),
    writePending: writePending(),
    reconciling: reconciling(),
    coverageError: reconciliationFailed(),
    childPending: dangerPending(),
    requestCount: requestCount(),
    mutationPending: mutationPending(),
  });
  const settingsOperationBusy = () => settingsInteractionBlocked(interactionState());
  const closeBlocked = () => settingsCloseBlocked(interactionState());
  const scheduleBusy = () => settingsOperationBusy() || settingsQuery.refreshing() || Boolean(settingsQuery.error());

  onCleanup(() => {
    disposed = true;
    save.abort();
    createOpening.abort();
    editOpening.abort();
    deleteOpening.abort();
    addHoliday.abort();
    editHoliday.abort();
    deleteHoliday.abort();
    createShift.abort();
    editShift.abort();
    deleteShift.abort();
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
  });

  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Venue settings"
        subtitle={currentVenue().name}
        icon={icon()}
        activeTab={activeTab()}
        onTabChange={(tab) => {
          if (!settingsOperationBusy()) setActiveTab(tab);
        }}
        onClose={() => {
          if (!closeBlocked()) props.close(workspaceChanged());
        }}
        closeLabel="Close settings"
      >
        <Show when={settingsQuery.error()}>
          <div class="paper mx-4 mt-4 flex items-center justify-between gap-3 p-3 text-sm">
            <p class="text-danger">Venue settings could not be refreshed. The last confirmed data is still shown.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={settingsQuery.refreshing()}
              onClick={() => void retrySettingsRead()}
            >
              Retry
            </Button>
          </div>
        </Show>
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, public page branding, and feedback.">
          <fieldset disabled={!settingsHydrated() || settingsWriteBlocked()} class="grid gap-3">
            <TextInput
              label="Name"
              description="Shown in the app and on the public page."
              value={name}
              onValueChange={(value) => {
                setGeneralDirty(true);
                setName(value);
              }}
              required
            />
            <TextInput
              label="Slug"
              description="Used in the public page URL."
              value={slug}
              onValueChange={(value) => {
                setGeneralDirty(true);
                setSlug(value);
              }}
              required
            />
            <TextInput
              label="Description"
              description="Short public summary shown below the venue name."
              value={description}
              onValueChange={(value) => {
                setGeneralDirty(true);
                setDescription(value);
              }}
              multiline
              lines={3}
            />
            <div class="grid gap-3 md:grid-cols-2">
              <IconInput
                label="Icon"
                description="Used as fallback logo and venue symbol."
                value={icon}
                onValueChange={(value) => {
                  setGeneralDirty(true);
                  setIcon(value ?? "ti ti-building-carousel");
                }}
                clearable={false}
              />
              <ColorInput
                label="Theme color"
                description="Used for public page accents."
                value={accentColor}
                onValueChange={(value) => {
                  setGeneralDirty(true);
                  setAccentColor(value);
                }}
              />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <ImageInput
                label="Logo"
                description="Optional image shown next to the venue name."
                value={logo}
                onValueChange={(value) => {
                  setGeneralDirty(true);
                  setLogo(value);
                }}
                variant="small"
              />
              <ImageInput
                label="Banner image"
                description="Optional wide image for the public page header."
                value={banner}
                onValueChange={(value) => {
                  setGeneralDirty(true);
                  setBanner(value);
                }}
                variant="small"
                transform={bannerTransform}
              />
            </div>
            <CheckboxCard
              label="Feedback activated"
              description="Allow visitors to leave anonymous ratings and comments on the public page."
              icon="ti ti-message-star"
              value={feedbackEnabled}
              onValueChange={(value) => {
                setGeneralDirty(true);
                setFeedbackEnabled(value);
              }}
              variant="input"
            />
            <div class="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                disabled={save.loading() || settingsQuery.refreshing() || Boolean(settingsQuery.error())}
                onClick={() => void saveSettings()}
              >
                Save
              </Button>
            </div>
          </fieldset>
        </SettingsModal.Tab>

        {venueSettingsCanAdmin(settings()) && (
          <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
            <Show
              when={!settingsQuery.refreshing() && !settingsQuery.error()}
              fallback={<Placeholder align="left" description={<>Refresh venue settings before changing access or API keys.</>} />}
            >
              <div class="grid gap-5">
                <Show keyed when={settings().accessEntries}>
                  {(entries) => (
                    <PermissionEditor
                      initialEntries={entries.filter((entry) => entry.principal.type !== "service_account")}
                      canEdit
                      allowedLevels={[
                        { level: "read", label: "Read" },
                        { level: "write", label: "Staff" },
                        { level: "admin", label: "Admin" },
                      ]}
                      grantAccess={async (principal: Principal, permission: Exclude<PermissionLevel, "none">): Promise<AccessEntry> => {
                        const entry = await runRequest(async (abortSignal) => {
                          const response = await apiClient.venues[":id"].access.$post(
                            {
                              param: { id: venue.id },
                              json: { principal, permission },
                            },
                            { init: { signal: abortSignal } },
                          );
                          if (!response.ok) throw new Error(await readError(response, "Failed to grant access."));
                          return response.json();
                        });
                        await finishSettingsChange("Access granted");
                        return entry;
                      }}
                      updateAccess={async (accessId, permission) => {
                        await runRequest(async (abortSignal) => {
                          const response = await apiClient.venues[":id"].access[":accessId"].$patch(
                            {
                              param: { id: venue.id, accessId },
                              json: { permission },
                            },
                            { init: { signal: abortSignal } },
                          );
                          if (!response.ok) throw new Error(await readError(response, "Failed to update access."));
                        });
                        await finishSettingsChange("Access updated");
                      }}
                      revokeAccess={async (accessId) => {
                        await runRequest(async (abortSignal) => {
                          const response = await apiClient.venues[":id"].access[":accessId"].$delete(
                            { param: { id: venue.id, accessId } },
                            { init: { signal: abortSignal } },
                          );
                          if (!response.ok) throw new Error(await readError(response, "Failed to revoke access."));
                        });
                        await finishSettingsChange("Access revoked");
                      }}
                    />
                  )}
                </Show>
                <div>
                  <ResourceApiKeys
                    title="API keys"
                    description="Resource-bound keys for integrations that need access to this venue."
                    initialKeys={settings().apiKeys}
                    createKey={async (input) => {
                      const created = await runRequest(async (abortSignal) => {
                        const response = await apiClient.venues[":id"]["api-keys"].$post(
                          {
                            param: { id: venue.id },
                            json: input,
                          },
                          { init: { signal: abortSignal } },
                        );
                        if (!response.ok) throw new Error(await readError(response, "Failed to create API key."));
                        return (await response.json()) as { credential: ResourceApiKey; token: string };
                      });
                      await finishSettingsChange("API key created");
                      return created;
                    }}
                    revokeKey={async (credentialId) => {
                      await runRequest(async (abortSignal) => {
                        const response = await apiClient.venues[":id"]["api-keys"][":credentialId"].$delete(
                          {
                            param: { id: venue.id, credentialId },
                          },
                          { init: { signal: abortSignal } },
                        );
                        if (!response.ok) throw new Error(await readError(response, "Failed to revoke API key."));
                      });
                      await finishSettingsChange("API key revoked");
                    }}
                  />
                </div>
              </div>
            </Show>
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab
          id="schedule"
          title="Schedule"
          icon="ti ti-calendar-time"
          description="Regular hours, closed days, and staffing targets."
        >
          <div class="grid gap-5">
            <Show when={venueSettingsCanAdmin(settings())}>
              <section>
                <h4 class="text-sm font-semibold text-primary">Public opening logic</h4>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Choose whether the public status follows regular hours, confirmed staffed openings, or either source.
                </p>
                <div class="mt-3">
                  <SegmentedControl<Venue["openMode"]>
                    value={openMode}
                    onValueChange={(value) => {
                      setGeneralDirty(true);
                      setOpenMode(value);
                    }}
                    options={[
                      { value: "regular", label: "Regular", icon: "ti ti-clock" },
                      { value: "staffed", label: "Staffed", icon: "ti ti-users" },
                      { value: "combined", label: "Both", icon: "ti ti-arrows-join" },
                    ]}
                  />
                </div>
                <div class="mt-3 flex justify-end">
                  <Button type="button" size="sm" disabled={save.loading() || scheduleBusy()} onClick={() => void saveSettings()}>
                    Save opening logic
                  </Button>
                </div>
              </section>
            </Show>
            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Regular hours</h4>
                <Show when={venueSettingsCanAdmin(settings())}>
                  <Button type="button" variant="secondary" size="sm" disabled={scheduleBusy()} onClick={() => void openCreateOpening()}>
                    <i class={createOpening.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </Button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={openingRules()}
                  fallback={<Placeholder align="left" class="px-0 py-2 sm:col-span-2" description={<>No regular hours.</>} />}
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
                        <Show when={venueSettingsCanAdmin(settings())}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit opening hours"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={scheduleBusy()}
                              onClick={() => void openEditOpening(rule)}
                            />
                            <ScheduleActionButton
                              label="Delete opening hours"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={scheduleBusy()}
                              onClick={() => void confirmDeleteOpening(rule)}
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
                <Show when={venueSettingsCanAdmin(settings())}>
                  <Button type="button" variant="secondary" size="sm" disabled={scheduleBusy()} onClick={() => void openAddHoliday()}>
                    <i class={addHoliday.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </Button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={overrides()}
                  fallback={<Placeholder align="left" class="px-0 py-2 sm:col-span-2" description={<>No closed days.</>} />}
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
                        <Show when={venueSettingsCanAdmin(settings())}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit closed day"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={scheduleBusy()}
                              onClick={() => void openEditHoliday(entry)}
                            />
                            <ScheduleActionButton
                              label="Delete closed day"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={scheduleBusy()}
                              onClick={() => void confirmDeleteHoliday(entry)}
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
                <Show when={venueSettingsCanAdmin(settings())}>
                  <Button type="button" variant="secondary" size="sm" disabled={scheduleBusy()} onClick={() => void openCreateShift()}>
                    <i class={createShift.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </Button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For
                  each={shiftTemplates()}
                  fallback={<Placeholder align="left" class="px-0 py-2 sm:col-span-2" description={<>No shifts configured.</>} />}
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
                          <p class="mt-1 text-xs text-dimmed">
                            {shift.requireTargetForOpening ? "Opens after target is staffed" : "Opens after the first signup"}
                          </p>
                        </div>
                        <Show when={venueSettingsCanAdmin(settings())}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit shift"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={scheduleBusy()}
                              onClick={() => void openEditShift(shift)}
                            />
                            <ScheduleActionButton
                              label="Delete shift"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={scheduleBusy()}
                              onClick={() => void confirmDeleteShift(shift)}
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
            <Button type="button" variant="secondary" size="sm" onClick={() => openVenuePublicDisplayDialog(currentVenue().slug)}>
              <i class="ti ti-device-tv" />
              Public page
            </Button>
            <ButtonLink variant="secondary" size="sm" href={`/api/venue/calendar/${props.icalToken}.ics`}>
              <i class="ti ti-calendar-down" />
              iCal
            </ButtonLink>
          </div>
        </SettingsModal.Tab>

        {venueSettingsCanAdmin(settings()) && (
          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Permanently delete this venue and all of its data."
            tone="danger"
          >
            <VenueDangerZone venue={currentVenue()} onPendingChange={setDangerPending} />
          </SettingsModal.Tab>
        )}
      </SettingsModal>
    </div>
  );
}
