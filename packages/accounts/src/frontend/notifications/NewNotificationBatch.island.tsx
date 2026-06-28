import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import {
  dialogCore,
  EntitySearch,
  type EntitySearchPrincipal,
  MultiSelectInput,
  type MultiSelectOption,
  PanelDialog,
  panelDialogOptions,
  prompts,
  SegmentedControl,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

type AudienceMode = "specific" | "rules";
type RuleId = "account_manager" | "local" | "ipa" | "guest" | "user";

type SelectedUser = {
  id: string;
  label: string;
  mail: string | null;
  provider: "local" | "ipa";
};

type SelectedGroup = {
  id: string;
  label: string;
  provider: "local" | "ipa";
};

type SelectionPayload = {
  mode: AudienceMode;
  userIds?: string[];
  groupIds?: string[];
  rules?: RuleId[];
  includeGroupMembers?: boolean;
};

type PreviewState = {
  targetCount: number;
  deliverableCount: number;
  skippedNoEmailCount: number;
  recipientHash: string;
};

const RULE_OPTIONS: MultiSelectOption[] = [
  {
    id: "account_manager",
    label: "Account managers",
    description: "Users who manage at least one group in the selected scope.",
    icon: "ti ti-shield-check",
    color: "#2563eb",
  },
  {
    id: "ipa",
    label: "FreeIPA accounts",
    description: "Only users from FreeIPA.",
    icon: "ti ti-server",
    color: "#7c3aed",
  },
  {
    id: "local",
    label: "Local accounts",
    description: "Only local cloud users.",
    icon: "ti ti-device-desktop",
    color: "#059669",
  },
  {
    id: "guest",
    label: "Guests",
    description: "Only guest profile accounts.",
    icon: "ti ti-user-question",
    color: "#f59e0b",
  },
  {
    id: "user",
    label: "Full users",
    description: "Only regular full user accounts.",
    icon: "ti ti-user",
    color: "#0ea5e9",
  },
];

const MODE_OPTIONS = [
  { value: "specific", label: "Specific users", icon: "ti ti-user-plus" },
  { value: "rules", label: "Rule based", icon: "ti ti-filter" },
] satisfies { value: AudienceMode; label: string; icon: string }[];

const notificationBatchDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(96vw,72rem)]"),
};

const isRuleId = (value: string): value is RuleId =>
  value === "account_manager" || value === "local" || value === "ipa" || value === "guest" || value === "user";

const readError = async (res: Response, fallback: string) => {
  try {
    const data = await res.json();
    return data.message ?? data.error?.message ?? fallback;
  } catch {
    return fallback;
  }
};

function BatchDialog(props: { close: () => void }) {
  const [subject, setSubject] = createSignal("");
  const [body, setBody] = createSignal("");
  const [audienceMode, setAudienceMode] = createSignal<AudienceMode>("specific");
  const [rules, setRules] = createSignal<RuleId[]>([]);
  const [users, setUsers] = createSignal<SelectedUser[]>([]);
  const [groups, setGroups] = createSignal<SelectedGroup[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [preview, setPreview] = createSignal<PreviewState | null>(null);

  const selection = createMemo<SelectionPayload>(() =>
    audienceMode() === "specific"
      ? {
          mode: "specific",
          userIds: users().map((user) => user.id),
          includeGroupMembers: true,
        }
      : {
          mode: "rules",
          rules: rules(),
          groupIds: groups().map((group) => group.id),
          includeGroupMembers: true,
        },
  );

  const hasAudience = () => audienceMode() === "rules" || users().length > 0;
  const canCreate = () => subject().trim().length > 0 && body().trim().length > 0 && hasAudience();

  const selectedRuleOptions = createMemo(() =>
    RULE_OPTIONS.filter((option) => typeof option !== "string" && rules().includes(option.id as RuleId)),
  );

  const addUser = (principal: EntitySearchPrincipal) => {
    if (principal.type !== "user") return;
    setUsers((current) =>
      current.some((user) => user.id === principal.userId)
        ? current
        : [
            ...current,
            {
              id: principal.userId,
              label: principal.displayName || principal.uid,
              mail: principal.mail,
              provider: principal.provider,
            },
          ],
    );
  };

  const addGroup = (principal: EntitySearchPrincipal) => {
    if (principal.type !== "group") return;
    setGroups((current) =>
      current.some((group) => group.id === principal.groupId)
        ? current
        : [...current, { id: principal.groupId, label: principal.name, provider: principal.provider }],
    );
  };

  const remove = <T extends { id: string }>(id: string, setter: (fn: (current: T[]) => T[]) => void) => {
    setter((current) => current.filter((item) => item.id !== id));
  };

  let previewRequest = 0;

  const runPreview = async (options?: { quiet?: boolean }) => {
    if (!hasAudience()) {
      setPreview(null);
      if (!options?.quiet) prompts.error("Select at least one user or switch to rule based targeting.");
      return null;
    }
    const requestId = ++previewRequest;
    setPreviewLoading(true);
    try {
      const res = await apiClient.notifications.batches.preview.$post({ json: { selection: selection() } });
      if (!res.ok) throw new Error(await readError(res, "Failed to preview recipients."));
      const data = await res.json();
      if (requestId === previewRequest) setPreview(data);
      return data;
    } catch (error) {
      if (!options?.quiet) prompts.error(error instanceof Error ? error.message : String(error));
      if (requestId === previewRequest) setPreview(null);
      return null;
    } finally {
      if (requestId === previewRequest) setPreviewLoading(false);
    }
  };

  createEffect(() => {
    const key = JSON.stringify(selection());
    if (!key || !hasAudience()) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      void runPreview({ quiet: true });
    }, 350);
    onCleanup(() => window.clearTimeout(timeout));
  });

  const createDraft = async () => {
    if (!canCreate()) {
      prompts.error("Subject, message, and audience are required.");
      return;
    }
    const latestPreview = preview() ?? (await runPreview());
    if (!latestPreview) return;
    if (latestPreview.deliverableCount === 0) {
      prompts.error("No deliverable recipients match this audience.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.notifications.batches.$post({
        json: { subject: subject(), bodyMarkdown: body(), selection: selection() },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to create notification batch."));
      const batch = await res.json();
      props.close();
      navigateTo(`/app/accounts/notifications/${batch.id}`);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const openUserPicker = () => {
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog>
          <PanelDialog.Header
            title="Add user"
            subtitle="Search one account and add it to this batch."
            icon="ti ti-user-plus"
            close={close}
          />
          <PanelDialog.Body>
            <EntitySearch
              includeUsers
              placeholder="Search users..."
              excludeUserIds={users().map((user) => user.id)}
              onSelect={(principal) => {
                addUser(principal);
                close();
              }}
              resultsHeightClass="h-72"
            />
          </PanelDialog.Body>
        </PanelDialog>
      ),
      panelDialogOptions,
    );
  };

  const openGroupPicker = () => {
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog>
          <PanelDialog.Header
            title="Add group scope"
            subtitle="Search one group. Members of nested child groups are included automatically."
            icon="ti ti-users-group"
            close={close}
          />
          <PanelDialog.Body>
            <EntitySearch
              includeGroups
              placeholder="Search groups..."
              excludeGroupIds={groups().map((group) => group.id)}
              onSelect={(principal) => {
                addGroup(principal);
                close();
              }}
              resultsHeightClass="h-72"
            />
          </PanelDialog.Body>
        </PanelDialog>
      ),
      panelDialogOptions,
    );
  };

  const previewLabel = () => {
    if (!hasAudience()) return "No audience selected.";
    if (previewLoading()) return "Resolving recipients...";
    const data = preview();
    if (!data) return "Recipient preview will update automatically.";
    return `${data.deliverableCount} deliverable of ${data.targetCount} matched users (${data.skippedNoEmailCount} without email).`;
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="New Notification Batch"
        subtitle="Create a draft, preview recipients, then finalize it from the detail page."
        icon="ti ti-mail-plus"
        close={props.close}
      />
      <PanelDialog.Body>
        <div class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <PanelDialog.Section title="Message" subtitle="Rendered through the standard system email template." icon="ti ti-message-2">
            <TextInput
              label="Subject"
              description="Email subject shown to every resolved recipient."
              placeholder="Maintenance window tonight"
              value={subject}
              onInput={setSubject}
              required
            />

            <TextInput
              label="Body"
              description="Markdown content for the notification email."
              placeholder="Write the notification body..."
              markdown
              lines={13}
              value={body}
              onInput={setBody}
              required
            />
          </PanelDialog.Section>

          <aside class="flex min-w-0 flex-col gap-3">
            <PanelDialog.Section title="Audience mode" subtitle="Choose how recipients are selected." icon="ti ti-target-arrow">
              <SegmentedControl<AudienceMode>
                options={MODE_OPTIONS}
                value={audienceMode}
                onChange={(mode) => {
                  setAudienceMode(mode);
                  setPreview(null);
                }}
                ariaLabel="Audience mode"
              />

              <Show
                when={audienceMode() === "specific"}
                fallback={
                  <div class="info-block-info flex items-start gap-2 text-xs">
                    <i class="ti ti-info-circle mt-0.5 shrink-0" />
                    <span>
                      Rule categories are combined. Multiple values inside one category are alternatives. If no group scope is selected,
                      rules are evaluated against all accounts.
                    </span>
                  </div>
                }
              >
                <div class="info-block-info flex items-start gap-2 text-xs">
                  <i class="ti ti-info-circle mt-0.5 shrink-0" />
                  <span>Use this mode when you know the exact people. Only users in the list below receive the notification.</span>
                </div>
              </Show>
            </PanelDialog.Section>

            <Show
              when={audienceMode() === "specific"}
              fallback={
                <>
                  <PanelDialog.Section
                    title="Required user properties"
                    subtitle="Categories are combined; values inside a category are alternatives."
                    icon="ti ti-checklist"
                  >
                    <MultiSelectInput
                      label="Properties"
                      description="Leave empty to include all accounts in the selected scope."
                      placeholder="Choose required properties..."
                      value={rules}
                      onChange={(value) => {
                        setRules(value.filter(isRuleId));
                        setPreview(null);
                      }}
                      options={RULE_OPTIONS}
                      selectedOptions={selectedRuleOptions}
                      clearable
                    />
                    <Show when={rules().length === 0}>
                      <div class={groups().length === 0 ? "info-block-warning text-xs" : "info-block-note text-xs"}>
                        No user properties are selected. The group scope below, or all accounts if no groups are selected, is used as-is.
                      </div>
                    </Show>
                  </PanelDialog.Section>

                  <PanelDialog.Section
                    title="Group scope"
                    subtitle="Optionally restrict the rules to users connected to specific groups."
                    icon="ti ti-users-group"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs text-dimmed">{groups().length} groups selected</span>
                      <button type="button" class="btn-input btn-input-sm" onClick={openGroupPicker}>
                        <i class="ti ti-plus" />
                        <span>Add group</span>
                      </button>
                    </div>
                    <Show
                      when={groups().length > 0}
                      fallback={
                        <div class={(rules().length === 0 ? "info-block-warning" : "info-block-info") + " flex items-start gap-2 text-xs"}>
                          <i class={(rules().length === 0 ? "ti ti-alert-triangle" : "ti ti-info-circle") + " mt-0.5 shrink-0"} />
                          <span>
                            No groups selected. The rules above are evaluated against all users. Group members are resolved recursively.
                          </span>
                        </div>
                      }
                    >
                      <div class="flex flex-col gap-2">
                        <For each={groups()}>
                          {(group) => (
                            <button
                              type="button"
                              class="btn-input btn-input-sm justify-start"
                              onClick={() => remove<SelectedGroup>(group.id, setGroups)}
                            >
                              <i class="ti ti-users-group" />
                              <span class="min-w-0 flex-1 truncate text-left">{group.label}</span>
                              <span class="text-[10px] uppercase text-dimmed">{group.provider}</span>
                              <i class="ti ti-x text-dimmed" />
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </PanelDialog.Section>
                </>
              }
            >
              <PanelDialog.Section title="Selected users" subtitle="Explicit recipients for this batch." icon="ti ti-users">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs text-dimmed">{users().length} users selected</span>
                  <button type="button" class="btn-input btn-input-sm" onClick={openUserPicker}>
                    <i class="ti ti-user-plus" />
                    <span>Add user</span>
                  </button>
                </div>
                <Show
                  when={users().length > 0}
                  fallback={<p class="text-xs text-dimmed">No users selected yet. Add at least one user to create a specific batch.</p>}
                >
                  <div class="flex flex-col gap-2">
                    <For each={users()}>
                      {(user) => (
                        <button
                          type="button"
                          class="btn-input btn-input-sm justify-start"
                          onClick={() => remove<SelectedUser>(user.id, setUsers)}
                        >
                          <i class="ti ti-user" />
                          <span class="min-w-0 flex-1 truncate text-left">{user.label}</span>
                          <span class="text-[10px] uppercase text-dimmed">{user.provider}</span>
                          <i class="ti ti-x text-dimmed" />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </PanelDialog.Section>
            </Show>

            <PanelDialog.Section
              title="Live preview"
              subtitle="Updated automatically from the current audience selection."
              icon="ti ti-eye"
            >
              <div
                class={
                  previewLoading() ? "info-block-info flex items-start gap-2 text-xs" : "info-block-note flex items-start gap-2 text-xs"
                }
              >
                <i class={previewLoading() ? "ti ti-loader-2 mt-0.5 shrink-0 animate-spin" : "ti ti-users mt-0.5 shrink-0"} />
                <span>{previewLabel()}</span>
              </div>
            </PanelDialog.Section>
          </aside>
        </div>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <div class="min-w-0 text-xs text-dimmed">{previewLabel()}</div>
        <div class="ml-auto flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={loading()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-input btn-input-sm"
            onClick={() => void runPreview()}
            disabled={previewLoading() || loading() || !hasAudience()}
          >
            <i class={previewLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
            <span>{previewLoading() ? "Previewing..." : "Refresh preview"}</span>
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={createDraft} disabled={loading() || !canCreate()}>
            <i class={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
            <span>{loading() ? "Creating..." : "Create draft"}</span>
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function NewNotificationBatch() {
  const open = () => {
    void dialogCore.open<void>((close) => <BatchDialog close={close} />, notificationBatchDialogOptions);
  };

  return (
    <button type="button" class="btn-primary btn-sm ml-auto max-w-full shrink-0 whitespace-nowrap" onClick={open}>
      <i class="ti ti-plus" />
      <span>New Notification</span>
    </button>
  );
}
