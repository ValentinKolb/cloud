import { navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  ButtonLink,
  CheckboxCard,
  ColorInput,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  ImageInput,
  NoticeCard,
  Placeholder,
  panelDialogOptions,
  prompts,
  SegmentedControl,
  SettingsCollection,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
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
  const generalChangeCount = () => {
    const draft = venueInput();
    const confirmed = currentVenue();
    return (
      Number(draft.name !== confirmed.name) +
      Number(draft.icon !== (confirmed.icon || "ti ti-building-carousel")) +
      Number(draft.slug !== confirmed.slug) +
      Number(draft.description !== (confirmed.description ?? null)) +
      Number(draft.openMode !== confirmed.openMode) +
      Number(draft.feedbackEnabled !== confirmed.feedbackEnabled) +
      Number(draft.accentColor !== confirmed.accentColor) +
      Number(draft.logoBase64 !== confirmed.logoBase64) +
      Number(draft.bannerBase64 !== confirmed.bannerBase64)
    );
  };
  const discardGeneral = () => {
    const confirmed = currentVenue();
    setName(confirmed.name);
    setIcon(confirmed.icon || "ti ti-building-carousel");
    setSlug(confirmed.slug);
    setDescription(confirmed.description ?? "");
    setOpenMode(confirmed.openMode);
    setAccentColor(confirmed.accentColor);
    setFeedbackEnabled(confirmed.feedbackEnabled);
    setLogo(confirmed.logoBase64);
    setBanner(confirmed.bannerBase64);
    setGeneralDirty(false);
  };
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
  const requestClose = () => {
    if (closeBlocked()) return;
    if (generalChangeCount() === 0) {
      props.close(workspaceChanged());
      return;
    }
    setPrompting(true);
    void confirmDiscardIfDirty(true)
      .then((confirmed) => {
        if (confirmed && !disposed) props.close(workspaceChanged());
      })
      .finally(() => {
        if (!disposed) setPrompting(false);
      });
  };
  const SettingsReadError = () => (
    <Show when={settingsQuery.error()}>
      <NoticeCard tone="danger" title="Venue settings could not be refreshed" detail="The last confirmed data is still shown.">
        <Button type="button" variant="secondary" size="sm" disabled={settingsQuery.refreshing()} onClick={() => void retrySettingsRead()}>
          Retry
        </Button>
      </NoticeCard>
    </Show>
  );

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
        onClose={requestClose}
        closeLabel="Close settings"
      >
        <SettingsModal.Group title="Venue">
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Identity, public branding, and feedback.">
            <SettingsReadError />
            <fieldset disabled={!settingsHydrated() || settingsWriteBlocked()} class="grid gap-6">
              <SettingsGroup title="Identity" description="Describe this venue wherever it appears in Cloud.">
                <div class="grid gap-4 md:grid-cols-2">
                  <SettingsField
                    label="Name"
                    description="Shown in the app and on the public page."
                    error={() => (!name().trim() ? "Name is required" : undefined)}
                    changed={() => name() !== currentVenue().name}
                  >
                    <TextInput
                      aria-label="Name"
                      value={name}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setName(value);
                      }}
                      required
                    />
                  </SettingsField>
                  <SettingsField
                    label="Slug"
                    description="Used in the public page URL."
                    error={() => (!slug().trim() ? "Slug is required" : undefined)}
                    changed={() => slug() !== currentVenue().slug}
                  >
                    <TextInput
                      aria-label="Slug"
                      value={slug}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setSlug(value);
                      }}
                      required
                    />
                  </SettingsField>
                </div>
                <SettingsField
                  label="Description"
                  description="Short public summary shown below the venue name."
                  error={() => undefined}
                  changed={() => description() !== (currentVenue().description ?? "")}
                >
                  <TextInput
                    aria-label="Description"
                    value={description}
                    onValueChange={(value) => {
                      setGeneralDirty(true);
                      setDescription(value);
                    }}
                    multiline
                    lines={3}
                  />
                </SettingsField>
              </SettingsGroup>

              <SettingsGroup title="Public branding" description="Choose the visual identity used on the public venue page.">
                <div class="grid gap-4 md:grid-cols-2">
                  <SettingsField
                    label="Icon"
                    description="Used as the fallback logo and venue symbol."
                    error={() => undefined}
                    changed={() => icon() !== (currentVenue().icon || "ti ti-building-carousel")}
                  >
                    <IconInput
                      aria-label="Icon"
                      value={icon}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setIcon(value ?? "ti ti-building-carousel");
                      }}
                      clearable={false}
                    />
                  </SettingsField>
                  <SettingsField
                    label="Theme color"
                    description="Used for public page accents."
                    error={() => undefined}
                    changed={() => accentColor() !== currentVenue().accentColor}
                  >
                    <ColorInput
                      aria-label="Theme color"
                      value={accentColor}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setAccentColor(value);
                      }}
                    />
                  </SettingsField>
                  <SettingsField
                    label="Logo"
                    description="Optional image shown next to the venue name."
                    error={() => undefined}
                    changed={() => logo() !== currentVenue().logoBase64}
                  >
                    <ImageInput
                      aria-label="Logo"
                      value={logo}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setLogo(value);
                      }}
                      variant="small"
                    />
                  </SettingsField>
                  <SettingsField
                    label="Banner image"
                    description="Optional wide image for the public page header."
                    error={() => undefined}
                    changed={() => banner() !== currentVenue().bannerBase64}
                  >
                    <ImageInput
                      aria-label="Banner image"
                      value={banner}
                      onValueChange={(value) => {
                        setGeneralDirty(true);
                        setBanner(value);
                      }}
                      variant="small"
                      transform={bannerTransform}
                    />
                  </SettingsField>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Visitor feedback" description="Control whether the public page accepts anonymous ratings and comments.">
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
              </SettingsGroup>
            </fieldset>
            <SettingsModal.Footer>
              <SettingsPanelFooter
                changeCount={generalChangeCount}
                loading={save.loading}
                onDiscard={discardGeneral}
                onSave={() => void saveSettings()}
              />
            </SettingsModal.Footer>
          </SettingsModal.Tab>
        </SettingsModal.Group>

        {venueSettingsCanAdmin(settings()) && (
          <SettingsModal.Group title="Sharing">
            <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
              <SettingsReadError />
              <Show
                when={!settingsQuery.refreshing() && !settingsQuery.error()}
                fallback={<Placeholder align="left" description={<>Refresh venue settings before changing access or API keys.</>} />}
              >
                <div class="grid gap-6">
                  <SettingsGroup title="People and groups" description="Grant read, staff, or admin access to this venue.">
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
                  </SettingsGroup>
                  <SettingsGroup
                    title="Integration access"
                    description="Create resource-bound credentials for services that need this venue."
                  >
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
                  </SettingsGroup>
                </div>
              </Show>
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}

        <SettingsModal.Group title="Operations">
          <SettingsModal.Tab
            id="schedule"
            title="Schedule"
            icon="ti ti-calendar-time"
            description="Regular hours, closed days, and staffing targets."
          >
            <SettingsReadError />
            <div class="grid gap-6">
              <Show when={venueSettingsCanAdmin(settings())}>
                <SettingsGroup title="Public opening logic" description="Choose which schedule determines the public open status.">
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
                </SettingsGroup>
              </Show>

              <SettingsCollection
                title="Regular hours"
                description="Weekly opening windows shown on the public page."
                empty="No regular hours yet."
              >
                <Show when={venueSettingsCanAdmin(settings())}>
                  <SettingsCollection.Action>
                    <Button type="button" size="sm" disabled={scheduleBusy()} onClick={() => void openCreateOpening()}>
                      <i class={createOpening.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> New hours
                    </Button>
                  </SettingsCollection.Action>
                </Show>
                <For each={openingRules()}>
                  {(rule) => (
                    <SettingsCollection.Item
                      title={weekdays[rule.weekday]}
                      description={`${rule.startTime}-${rule.endTime}${rule.note ? ` · ${rule.note}` : ""}`}
                      icon={<i class="ti ti-clock" aria-hidden="true" />}
                    >
                      <Show when={venueSettingsCanAdmin(settings())}>
                        <SettingsCollection.Item.Actions>
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
                        </SettingsCollection.Item.Actions>
                      </Show>
                    </SettingsCollection.Item>
                  )}
                </For>
              </SettingsCollection>

              <SettingsCollection
                title="Closed days"
                description="Date-specific exceptions to the regular schedule."
                empty="No closed days yet."
              >
                <Show when={venueSettingsCanAdmin(settings())}>
                  <SettingsCollection.Action>
                    <Button type="button" size="sm" disabled={scheduleBusy()} onClick={() => void openAddHoliday()}>
                      <i class={addHoliday.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> New closed day
                    </Button>
                  </SettingsCollection.Action>
                </Show>
                <For each={overrides()}>
                  {(entry) => (
                    <SettingsCollection.Item
                      title={entry.date}
                      description={`${entry.kind}${entry.note ? ` · ${entry.note}` : ""}`}
                      icon={<i class="ti ti-calendar-off" aria-hidden="true" />}
                    >
                      <Show when={venueSettingsCanAdmin(settings())}>
                        <SettingsCollection.Item.Actions>
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
                        </SettingsCollection.Item.Actions>
                      </Show>
                    </SettingsCollection.Item>
                  )}
                </For>
              </SettingsCollection>

              <SettingsCollection
                title="Shifts"
                description="Recurring staffing windows and opening targets."
                empty="No shifts configured yet."
              >
                <Show when={venueSettingsCanAdmin(settings())}>
                  <SettingsCollection.Action>
                    <Button type="button" size="sm" disabled={scheduleBusy()} onClick={() => void openCreateShift()}>
                      <i class={createShift.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> New shift
                    </Button>
                  </SettingsCollection.Action>
                </Show>
                <For each={shiftTemplates()}>
                  {(shift) => (
                    <SettingsCollection.Item
                      title={shift.title}
                      description={`${weekdays[shift.weekday]} · ${shift.startTime}-${shift.endTime} · target ${shift.minPeople}${shift.maxPeople ? `-${shift.maxPeople}` : "+"}`}
                      icon={<i class="ti ti-users" aria-hidden="true" />}
                    >
                      <Show when={venueSettingsCanAdmin(settings())}>
                        <SettingsCollection.Item.Actions>
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
                        </SettingsCollection.Item.Actions>
                      </Show>
                    </SettingsCollection.Item>
                  )}
                </For>
              </SettingsCollection>
            </div>
            <Show when={venueSettingsCanAdmin(settings())}>
              <SettingsModal.Footer>
                <SettingsPanelFooter
                  changeCount={generalChangeCount}
                  loading={save.loading}
                  onDiscard={discardGeneral}
                  onSave={() => void saveSettings()}
                />
              </SettingsModal.Footer>
            </Show>
          </SettingsModal.Tab>
        </SettingsModal.Group>

        <SettingsModal.Group title="Connections">
          <SettingsModal.Tab id="links" title="Links" icon="ti ti-link" description="Public page and personal calendar subscription.">
            <SettingsGroup title="Venue links" description="Open the public display or subscribe to the personal calendar feed.">
              <SettingsGroup.Action>
                <div class="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => openVenuePublicDisplayDialog(currentVenue().id)}>
                    <i class="ti ti-device-tv" />
                    Public page
                  </Button>
                  <ButtonLink variant="secondary" size="sm" href={`/api/venue/calendar/${props.icalToken}.ics`}>
                    <i class="ti ti-calendar-down" />
                    iCal
                  </ButtonLink>
                </div>
              </SettingsGroup.Action>
            </SettingsGroup>
          </SettingsModal.Tab>
        </SettingsModal.Group>

        {venueSettingsCanAdmin(settings()) && (
          <SettingsModal.Group title="Lifecycle">
            <SettingsModal.Tab
              id="danger"
              title="Danger zone"
              icon="ti ti-alert-triangle"
              description="Permanently delete this venue and all of its data."
              tone="danger"
            >
              <SettingsGroup
                title="Delete venue"
                description="Remove opening hours, shifts, public content, feedback, access, and API keys."
              >
                <SettingsGroup.Action>
                  <VenueDangerZone venue={currentVenue()} onPendingChange={setDangerPending} />
                </SettingsGroup.Action>
              </SettingsGroup>
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}
      </SettingsModal>
    </div>
  );
}
