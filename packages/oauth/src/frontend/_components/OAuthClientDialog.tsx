import { createSignal, For, Show } from "solid-js";
import { CheckboxCard, EntitySearch, type EntitySearchPrincipal, PanelDialog, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import type { CreateOAuthClient, OAuthClient, UpdateOAuthClient } from "@/contracts";

type AccessChoice = "user" | "everybody" | "specific";

type SelectedUser = {
  id: string;
  label: string;
  mail: string | null;
  provider: "local" | "ipa";
};

type SelectedGroup = {
  id: string;
  label: string;
  description: string | null;
  provider: "local" | "ipa";
};

type OAuthClientDialogProps =
  | {
      mode: "create";
      close: () => void;
      loading: () => boolean;
      onSubmit: (data: CreateOAuthClient) => Promise<void>;
    }
  | {
      mode: "edit";
      client: OAuthClient;
      close: () => void;
      loading: () => boolean;
      onSubmit: (data: UpdateOAuthClient) => Promise<void>;
    };

const accessChoiceOptions = [
  {
    id: "user",
    label: "Full Users Only",
    description: "Only full user accounts can use this client.",
    icon: "ti ti-user",
  },
  {
    id: "everybody",
    label: "Everybody",
    description: "Full users and guests can use this client.",
    icon: "ti ti-users",
  },
  {
    id: "specific",
    label: "Specific users and groups",
    description: "Only selected users and recursive group members can use this client.",
    icon: "ti ti-user-check",
  },
];

const accessChoiceFromClient = (client?: OAuthClient): AccessChoice => {
  if (client?.accessMode === "specific") return "specific";
  return client?.allowedProfiles.includes("guest") ? "everybody" : "user";
};

const selectedUsersFromClient = (client?: OAuthClient): SelectedUser[] =>
  client?.accessUsers.map((user) => ({
    id: user.id,
    label: user.displayName || user.uid,
    mail: user.mail,
    provider: user.provider,
  })) ?? [];

const selectedGroupsFromClient = (client?: OAuthClient): SelectedGroup[] =>
  client?.accessGroups.map((group) => ({
    id: group.id,
    label: group.name,
    description: group.description,
    provider: group.provider,
  })) ?? [];

const removeById = <T extends { id: string }>(id: string, values: T[]) => values.filter((item) => item.id !== id);

export default function OAuthClientDialog(props: OAuthClientDialogProps) {
  const client = () => (props.mode === "edit" ? props.client : undefined);
  const [name, setName] = createSignal(client()?.name ?? "");
  const [description, setDescription] = createSignal(client()?.description ?? "");
  const [redirectUri, setRedirectUri] = createSignal(client()?.redirectUris[0] ?? "");
  const [logoutUri, setLogoutUri] = createSignal(client()?.logoutUri ?? "");
  const [accessChoice, setAccessChoice] = createSignal<AccessChoice>(accessChoiceFromClient(client()));
  const [scopeProfile, setScopeProfile] = createSignal(client()?.scopes.includes("profile") ?? true);
  const [scopeEmail, setScopeEmail] = createSignal(client()?.scopes.includes("email") ?? true);
  const [scopeGroups, setScopeGroups] = createSignal(client()?.scopes.includes("groups") ?? false);
  const [isPublic, setIsPublic] = createSignal(client()?.isPublic ?? false);
  const [users, setUsers] = createSignal<SelectedUser[]>(selectedUsersFromClient(client()));
  const [groups, setGroups] = createSignal<SelectedGroup[]>(selectedGroupsFromClient(client()));

  const selectedLabel = () => accessChoiceOptions.find((option) => option.id === accessChoice())?.label;
  const hasSpecificSelection = () => users().length > 0 || groups().length > 0;
  const canSubmit = () =>
    (props.mode === "edit" || name().trim().length > 0) &&
    redirectUri().trim().length > 0 &&
    (accessChoice() !== "specific" || hasSpecificSelection());

  const addEntity = (principal: EntitySearchPrincipal) => {
    if (principal.type === "user") {
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
      return;
    }

    if (principal.type === "group") {
      setGroups((current) =>
        current.some((group) => group.id === principal.groupId)
          ? current
          : [
              ...current,
              {
                id: principal.groupId,
                label: principal.name,
                description: principal.description,
                provider: principal.provider,
              },
            ],
      );
    }
  };

  const buildScopes = (): ("openid" | "profile" | "email" | "groups")[] => {
    const scopes: ("openid" | "profile" | "email" | "groups")[] = ["openid"];
    if (scopeProfile()) scopes.push("profile");
    if (scopeEmail()) scopes.push("email");
    if (scopeGroups()) scopes.push("groups");
    return scopes;
  };

  const buildAccessPayload = () => {
    const specific = accessChoice() === "specific";
    return {
      allowedProfiles: accessChoice() === "user" ? (["user"] as ("user" | "guest")[]) : (["user", "guest"] as ("user" | "guest")[]),
      accessMode: specific ? ("specific" as const) : ("profiles" as const),
      allowedUserIds: specific ? users().map((user) => user.id) : [],
      allowedGroupIds: specific ? groups().map((group) => group.id) : [],
    };
  };

  const submit = async () => {
    if (!canSubmit()) return;
    const cleanRedirectUri = redirectUri()
      .trim()
      .replace(/^["']|["']$/g, "");
    const cleanLogoutUri = logoutUri().trim();
    const common = {
      description: description().trim() || undefined,
      redirectUris: [cleanRedirectUri],
      logoutUri: cleanLogoutUri || undefined,
      scopes: buildScopes(),
      ...buildAccessPayload(),
    };

    if (props.mode === "create") {
      await props.onSubmit({
        ...common,
        name: name().trim(),
        audiences: ["cloud"],
        isPublic: isPublic(),
      });
      return;
    }

    await props.onSubmit({
      ...common,
      description: common.description ?? null,
      logoutUri: cleanLogoutUri || null,
    });
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.mode === "create" ? "New OAuth Client" : `Edit: ${props.client.name}`}
        subtitle="Configure OAuth/OIDC login access for this client."
        icon={props.mode === "create" ? "ti ti-plus" : "ti ti-pencil"}
        close={props.close}
      />

      <PanelDialog.Body>
        <div class="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <PanelDialog.Section title="Client" subtitle="Application metadata and redirect endpoints." icon="ti ti-key">
            <Show
              when={props.mode === "create"}
              fallback={
                <div class="info-block-info text-xs">
                  Client ID: <code>{props.mode === "edit" ? props.client.clientId : ""}</code>
                </div>
              }
            >
              <TextInput label="Name" placeholder="My Application" icon="ti ti-tag" value={name} onInput={setName} required />
            </Show>
            <TextInput
              label="Description"
              placeholder="Optional description for this client"
              icon="ti ti-file-description"
              value={description}
              onInput={setDescription}
            />
            <TextInput
              label="Redirect URI"
              description="Callback URL used by the OAuth client."
              placeholder="https://myapp.example.com/callback"
              icon="ti ti-link"
              value={redirectUri}
              onInput={setRedirectUri}
              required
            />
            <TextInput
              label="Logout URI"
              description="Optional post-logout redirect URL."
              placeholder="https://myapp.example.com/logout-callback"
              icon="ti ti-logout"
              value={logoutUri}
              onInput={setLogoutUri}
            />
            <Show when={props.mode === "create"}>
              <CheckboxCard
                label="Public client"
                description="Browser apps without backend. PKCE is required."
                icon="ti ti-world"
                variant="input"
                value={isPublic}
                onChange={setIsPublic}
              />
            </Show>
          </PanelDialog.Section>

          <aside class="flex min-w-0 flex-col gap-3">
            <PanelDialog.Section title="Access" subtitle="Choose who can sign in with this client." icon="ti ti-user-check">
              <SelectInput
                label="Who can use this client?"
                value={accessChoice}
                onChange={(value) => setAccessChoice(value as AccessChoice)}
                selectedLabel={selectedLabel}
                options={accessChoiceOptions}
                required
              />

              <Show when={accessChoice() === "specific"}>
                <div class="info-block-info flex items-start gap-2 text-xs">
                  <i class="ti ti-info-circle mt-0.5 shrink-0" />
                  <span>Selected groups include users from nested child groups recursively.</span>
                </div>
                <EntitySearch
                  includeUsers
                  includeGroups
                  excludeUserIds={users().map((user) => user.id)}
                  excludeGroupIds={groups().map((group) => group.id)}
                  placeholder="Search users or groups..."
                  resultsHeightClass="h-56"
                  onSelect={addEntity}
                />
                <SelectedAccessList users={users()} groups={groups()} setUsers={setUsers} setGroups={setGroups} />
              </Show>
            </PanelDialog.Section>

            <PanelDialog.Section title="Scopes" subtitle="Claims this client can request." icon="ti ti-checklist">
              <ScopeToggle
                label="Profile"
                description="Name and display name claims."
                icon="ti ti-id-badge-2"
                checked={scopeProfile}
                onChange={setScopeProfile}
              />
              <ScopeToggle
                label="Email"
                description="Email address claim."
                icon="ti ti-mail"
                checked={scopeEmail}
                onChange={setScopeEmail}
              />
              <ScopeToggle
                label="Groups"
                description="Recursive group membership claim."
                icon="ti ti-users-group"
                checked={scopeGroups}
                onChange={setScopeGroups}
              />
            </PanelDialog.Section>
          </aside>
        </div>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <div class="min-w-0 text-xs text-dimmed">
          <Show when={accessChoice() !== "specific" || hasSpecificSelection()} fallback="Select at least one user or group.">
            {accessChoice() === "specific"
              ? `${users().length} users and ${groups().length} groups selected.`
              : "Profile-based access is active."}
          </Show>
        </div>
        <div class="ml-auto flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={props.loading()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => void submit()} disabled={props.loading() || !canSubmit()}>
            <i class={props.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
            <span>{props.loading() ? "Saving..." : props.mode === "create" ? "Create" : "Save"}</span>
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function ScopeToggle(props: {
  label: string;
  description: string;
  icon: string;
  checked: () => boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxCard
      label={props.label}
      description={props.description}
      icon={props.icon}
      variant="input"
      value={props.checked}
      onChange={props.onChange}
    />
  );
}

function SelectedAccessList(props: {
  users: SelectedUser[];
  groups: SelectedGroup[];
  setUsers: (fn: (current: SelectedUser[]) => SelectedUser[]) => void;
  setGroups: (fn: (current: SelectedGroup[]) => SelectedGroup[]) => void;
}) {
  return (
    <div class="flex flex-col gap-2">
      <Show
        when={props.users.length > 0 || props.groups.length > 0}
        fallback={<p class="text-xs text-dimmed">No users or groups selected yet.</p>}
      >
        <For each={props.users}>
          {(user) => (
            <button
              type="button"
              class="btn-input btn-input-sm justify-start"
              onClick={() => props.setUsers((current) => removeById(user.id, current))}
            >
              <i class="ti ti-user" />
              <span class="min-w-0 flex-1 truncate text-left">{user.label}</span>
              <span class="text-[10px] uppercase text-dimmed">{user.provider}</span>
              <i class="ti ti-x text-dimmed" />
            </button>
          )}
        </For>
        <For each={props.groups}>
          {(group) => (
            <button
              type="button"
              class="btn-input btn-input-sm justify-start"
              onClick={() => props.setGroups((current) => removeById(group.id, current))}
            >
              <i class="ti ti-users-group" />
              <span class="min-w-0 flex-1 truncate text-left">{group.label}</span>
              <span class="text-[10px] uppercase text-dimmed">{group.provider}</span>
              <i class="ti ti-x text-dimmed" />
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
