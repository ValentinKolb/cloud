import { Checkbox, CopyButton, prompts, SegmentedControl, TextInput } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { dates } from "@valentinkolb/stdlib";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { type CreateUserResponse, CreateUserResponseSchema, ErrorResponseSchema } from "@/contracts";

type PrefillData = {
  requestId: string;
  email: string;
  givenname: string;
  sn: string;
  displayName?: string;
  firstName: string;
};

type ProviderChoice = "ipa" | "local";
type LocalProfile = "user" | "guest";

type CreateUserPayload =
  | {
      provider: "ipa";
      email: string;
      givenname: string;
      sn: string;
      displayName?: string;
      autoSendNotification: boolean;
      requestId?: string;
    }
  | {
      provider: "local";
      profile: LocalProfile;
      admin?: boolean;
      email: string;
      givenname: string;
      sn: string;
      displayName?: string;
      autoSendNotification: boolean;
      requestId?: string;
    };

type CreateFlowResult = {
  payload: CreateUserPayload;
  data: CreateUserResponse;
};

type Props = {
  prefill?: PrefillData;
  buttonLabel?: string;
  buttonIcon?: string;
  buttonClass?: string;
  autoOpen?: boolean;
  hideButton?: boolean;
  freeIpaEnabled?: boolean;
};

const PROVIDER_CARDS: Array<{
  value: ProviderChoice;
  title: string;
  eyebrow: string;
  description: string;
  icon: string;
}> = [
  {
    value: "ipa",
    title: "Managed by FreeIPA",
    eyebrow: "Directory",
    description: "Use this for centrally managed accounts. Access is derived from FreeIPA group membership after creation.",
    icon: "ti ti-building-fortress",
  },
  {
    value: "local",
    title: "Managed locally",
    eyebrow: "App-managed",
    description: "Use this for app-managed accounts. New users receive a welcome email and later sign in through email links.",
    icon: "ti ti-home-spark",
  },
];

const PROVIDER_CARD_CLASS =
  "group flex min-h-40 flex-col items-start gap-3 rounded-xl bg-zinc-50/85 px-4 py-4 text-left transition hover:bg-blue-50/45 dark:bg-zinc-900/70 dark:hover:bg-blue-950/20";
const PROVIDER_CARD_ICON_CLASS =
  "flex h-10 w-10 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm shadow-zinc-950/[0.04] transition group-hover:text-blue-600 dark:bg-zinc-950/75 dark:text-zinc-300 dark:shadow-none dark:group-hover:text-blue-300";

const PROFILE_OPTIONS = [
  { value: "user", label: "Full account", icon: "ti ti-user-check" },
  { value: "guest", label: "Guest account", icon: "ti ti-user-exclamation" },
] as const;

const buildPayloadSummary = (payload: CreateUserPayload) => {
  const lines: Array<[string, string]> = [["Managed by", payload.provider === "ipa" ? "FreeIPA" : "Local"]];

  if (payload.provider === "local") {
    lines.push(["Access level", payload.profile === "user" ? "Full account" : "Guest account"]);
    if (payload.profile === "user") {
      lines.push(["Privileges", payload.admin ? "Admin" : "Standard"]);
    }
  } else {
    lines.push(["Access level", "Derived from FreeIPA groups"]);
  }

  lines.push(["Email", payload.email]);
  lines.push(["Name", `${payload.givenname} ${payload.sn}`]);
  lines.push(["Display name", payload.displayName || `${payload.givenname} ${payload.sn}`]);
  lines.push(["Onboarding", payload.provider === "ipa" ? "Welcome email / password flow" : "Welcome email / email sign-in"]);

  return lines;
};

function ProviderSelectionDialog(props: { close: (provider?: ProviderChoice) => void; requestPrefill: boolean }) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium text-primary">Where should this account be managed?</p>
        <p class="text-xs text-dimmed">Choose the provider first. Only local accounts expose a direct profile choice during creation.</p>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        {PROVIDER_CARDS.map((provider) => (
          <button type="button" class={PROVIDER_CARD_CLASS} onClick={() => props.close(provider.value)}>
            <div class="flex items-center gap-3">
              <div class={PROVIDER_CARD_ICON_CLASS}>
                <i class={`${provider.icon} text-lg`} />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-dimmed">{provider.eyebrow}</span>
                <span class="text-sm font-semibold text-primary">{provider.title}</span>
              </div>
            </div>
            <p class="text-sm leading-6 text-secondary">{provider.description}</p>
            <Show when={props.requestPrefill && provider.value === "ipa"}>
              <div class="info-block-success mt-auto text-xs">Recommended for this request.</div>
            </Show>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateUserDialog(props: { provider: ProviderChoice; prefill?: PrefillData; close: (payload?: CreateUserPayload) => void }) {
  const [profile, setProfile] = createSignal<LocalProfile>("user");
  const [admin, setAdmin] = createSignal(false);
  const [email, setEmail] = createSignal(props.prefill?.email ?? "");
  const [givenname, setGivenname] = createSignal(props.prefill?.givenname ?? "");
  const [sn, setSn] = createSignal(props.prefill?.sn ?? "");
  const [displayName, setDisplayName] = createSignal(props.prefill?.displayName ?? "");
  const [autoSendNotification, setAutoSendNotification] = createSignal(true);
  const [displayNameTouched, setDisplayNameTouched] = createSignal(!!props.prefill?.displayName);
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  createEffect(() => {
    if (!displayNameTouched()) {
      setDisplayName([givenname(), sn()].filter(Boolean).join(" "));
    }
  });

  createEffect(() => {
    if (props.provider !== "local" || profile() !== "user") {
      setAdmin(false);
    }
  });

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!email().trim()) nextErrors.email = "Email is required.";
    if (!givenname().trim()) nextErrors.givenname = "First name is required.";
    if (!sn().trim()) nextErrors.sn = "Last name is required.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (props.provider === "ipa") {
      props.close({
        provider: "ipa",
        email: email().trim(),
        givenname: givenname().trim(),
        sn: sn().trim(),
        displayName: displayName().trim() || undefined,
        autoSendNotification: autoSendNotification(),
        requestId: props.prefill?.requestId,
      });
      return;
    }

    props.close({
      provider: "local",
      profile: profile(),
      admin: profile() === "user" ? admin() : false,
      email: email().trim(),
      givenname: givenname().trim(),
      sn: sn().trim(),
      displayName: displayName().trim() || undefined,
      autoSendNotification: autoSendNotification(),
      requestId: props.prefill?.requestId,
    });
  };

  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium text-primary">{props.provider === "ipa" ? "Create FreeIPA account" : "Create local account"}</p>
        <p class="text-xs text-dimmed">
          {props.provider === "ipa"
            ? "The effective access level will be determined after creation through FreeIPA group membership."
            : "Choose the access level directly for this local account. Users receive a welcome email and sign in by email."}
        </p>
      </div>

      <Show when={props.prefill}>
        <div class="info-block-success text-sm">
          <div class="flex items-center gap-2">
            <i class="ti ti-sparkles text-base" />
            <span class="font-medium">Prefilled from a pending FreeIPA access request.</span>
          </div>
        </div>
      </Show>

      <Show when={props.provider === "ipa"}>
        <div class="info-block-info text-sm">
          <div class="flex items-start gap-3">
            <i class="ti ti-info-circle mt-0.5 text-base" />
            <div class="flex flex-col gap-1">
              <span class="font-medium">FreeIPA decides the effective access level.</span>
              <span class="text-xs text-blue-700/90 dark:text-blue-200/80">
                The new account starts managed by FreeIPA. Whether it behaves like a full or guest account depends on the assigned directory
                groups.
              </span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={props.provider === "local"}>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-dimmed">Access level</p>
            <span class="text-[11px] text-dimmed">Only local accounts choose this directly.</span>
          </div>
          <SegmentedControl
            ariaLabel="Local account profile"
            options={PROFILE_OPTIONS.map((option) => ({ value: option.value, label: option.label, icon: option.icon }))}
            value={profile}
            onChange={(value) => setProfile(value as LocalProfile)}
          />
        </div>
      </Show>

      <Show when={props.provider === "local" && profile() === "user"}>
        <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-muted)] px-4 py-3">
          <Checkbox
            label="Grant admin access"
            description="Only local full accounts can be admins. FreeIPA admin access is managed through FreeIPA groups."
            value={admin}
            onChange={setAdmin}
          />
        </div>
      </Show>

      <div class="grid gap-4 md:grid-cols-2">
        <TextInput
          label="Email"
          required
          icon="ti ti-mail"
          value={email}
          onChange={setEmail}
          error={() => errors().email}
          placeholder="name@example.com"
        />
        <TextInput
          label="Display name"
          icon="ti ti-id-badge-2"
          value={displayName}
          onChange={(value) => {
            setDisplayNameTouched(true);
            setDisplayName(value);
          }}
          placeholder="Visible name in the app"
        />
        <TextInput
          label="First name"
          required
          icon="ti ti-user"
          value={givenname}
          onChange={setGivenname}
          error={() => errors().givenname}
          placeholder="First name"
        />
        <TextInput
          label="Last name"
          required
          icon="ti ti-user"
          value={sn}
          onChange={setSn}
          error={() => errors().sn}
          placeholder="Last name"
        />
      </div>

      <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-muted)] px-4 py-3 text-xs text-dimmed">
        The username and UID are generated automatically from the provided name and email data.
      </div>

      <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-muted)] px-4 py-3">
        <Checkbox
          label="Send welcome email automatically"
          description={
            props.provider === "ipa"
              ? "If enabled, the created user receives the onboarding email immediately."
              : "If enabled, the created user receives the local onboarding email immediately."
          }
          value={autoSendNotification}
          onChange={setAutoSendNotification}
        />
      </div>

      <div class="flex justify-end">
        <button type="button" class="btn-primary btn-sm" onClick={handleSubmit}>
          Continue
        </button>
      </div>
    </div>
  );
}

const buildSuccessDialog = (payload: CreateUserPayload, data: CreateUserResponse) => {
  const nfsCommands = `sudo nfsctl useradd ${data.uid}`;
  const isIpa = payload.provider === "ipa";
  const notificationMessage = data.notificationSent
    ? isIpa
      ? "Welcome email with the initial FreeIPA instructions was sent."
      : "Welcome email with the local sign-in instructions was sent."
    : isIpa
      ? "Welcome email was not sent automatically."
      : "Welcome email was not sent automatically.";

  return prompts.dialog<void>(
    (close) => (
      <div class="flex flex-col gap-4">
        <div class="info-block-success text-sm">
          <div class="flex items-start gap-3">
            <i class="ti ti-check text-base" />
            <div class="flex flex-col gap-1">
              <span class="font-medium">
                {payload.provider === "ipa" ? "FreeIPA-backed account" : "Local account"} created successfully.
              </span>
              <span class="text-xs">{notificationMessage}</span>
            </div>
          </div>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-dimmed">UID</dt>
          <dd class="font-mono">{data.uid}</dd>
          <dt class="text-dimmed">Managed by</dt>
          <dd>{payload.provider === "ipa" ? "FreeIPA" : "Local"}</dd>
          <Show when={payload.provider === "local"}>
            {(() => {
              const localPayload = payload.provider === "local" ? payload : null;
              return (
                <>
                  <dt class="text-dimmed">Access level</dt>
                  <dd>{localPayload?.profile === "user" ? "Full account" : "Guest account"}</dd>
                </>
              );
            })()}
          </Show>
          <Show when={data.accountExpires}>
            <dt class="text-dimmed">Account expires</dt>
            <dd>{dates.formatDate(data.accountExpires!)}</dd>
          </Show>
        </dl>

        <Show when={isIpa}>
          <div class="info-block-info flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col">
                <span class="text-sm font-medium text-primary">NFS follow-up</span>
                <span class="text-xs text-dimmed">Only needed if your team manages NFS home directories manually.</span>
              </div>
              <CopyButton text={nfsCommands} label="Copy" />
            </div>
            <pre class="overflow-x-auto whitespace-pre rounded-xl bg-white/80 px-3 py-3 text-xs font-mono text-secondary dark:bg-zinc-950/80">
              {nfsCommands}
            </pre>
          </div>
        </Show>

        <div class="flex justify-end gap-3">
          <button type="button" class="btn-secondary btn-sm" onClick={() => close()}>
            Close
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => {
              close();
              navigateTo(`/app/accounts/users/${data.id}`);
            }}
          >
            View account
          </button>
        </div>
      </div>
    ),
    { title: "Account created", icon: "ti ti-user-check", size: "large" },
  );
};

export default function CreateUserForm(props: Props) {
  let opened = false;
  const freeIpaEnabled = props.freeIpaEnabled ?? true;

  const openProviderDialog = async (): Promise<ProviderChoice | undefined> => {
    if (!freeIpaEnabled) return "local";
    if (props.prefill) return "ipa";
    return prompts.dialog<ProviderChoice>((close) => <ProviderSelectionDialog close={close} requestPrefill={false} />, {
      title: "Choose account provider",
      icon: "ti ti-user-plus",
      size: "medium",
    });
  };

  const openCreateDialog = async (provider: ProviderChoice): Promise<CreateUserPayload | undefined> =>
    prompts.dialog<CreateUserPayload>((close) => <CreateUserDialog provider={provider} prefill={props.prefill} close={close} />, {
      title: provider === "ipa" ? "Create FreeIPA account" : "Create local account",
      icon: provider === "ipa" ? "ti ti-building-fortress" : "ti ti-home-spark",
      size: "large",
    });

  const createMutation = mutation.create<CreateFlowResult | undefined, void>({
    mutation: async () => {
      const provider = await openProviderDialog();
      if (!provider) return undefined;

      const payload = await openCreateDialog(provider);
      if (!payload) return undefined;

      const confirmed = await prompts.confirm(
        <div class="flex flex-col gap-4 text-sm">
          <p>Please confirm the new account.</p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {buildPayloadSummary(payload).map(([label, value]) => (
              <>
                <dt class="text-dimmed">{label}</dt>
                <dd class={label === "Email" ? "font-mono" : ""}>{value}</dd>
              </>
            ))}
          </dl>
          <Show when={payload.provider === "ipa"}>
            <div class="info-block-info text-xs">Effective FreeIPA access will still depend on the group assignments made afterwards.</div>
          </Show>
        </div>,
        {
          title: "Confirm account creation",
          icon: "ti ti-user-check",
          confirmText: "Create account",
          size: "large",
        },
      );

      if (!confirmed) return undefined;

      const res = await apiClient.users.$post({ json: payload });
      if (!res.ok) {
        const data = ErrorResponseSchema.safeParse(await res.json());
        throw new Error(data.success ? data.data.message : "Failed to create account.");
      }

      const data = CreateUserResponseSchema.parse(await res.json());
      return { payload, data };
    },
    onSuccess: async (result) => {
      if (!result) return;
      await buildSuccessDialog(result.payload, result.data);
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to create account."),
  });

  onMount(() => {
    if (!props.autoOpen || opened) return;
    opened = true;
    void createMutation.mutate(undefined);
  });

  return (
    <Show when={!props.hideButton}>
      <button
        type="button"
        class={props.buttonClass ?? "btn-input btn-input-sm"}
        onClick={() => void createMutation.mutate(undefined)}
        disabled={createMutation.loading()}
      >
        <i class={createMutation.loading() ? "ti ti-loader-2 animate-spin" : (props.buttonIcon ?? "ti ti-plus")} />
        <span>{createMutation.loading() ? "Working..." : (props.buttonLabel ?? "New User")}</span>
      </button>
    </Show>
  );
}
