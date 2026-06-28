import { createSignal, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts, SegmentedControl, TextInput } from "@valentinkolb/cloud/ui";
import type { UserProfile, UserProvider } from "@valentinkolb/cloud/contracts";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import { getCurrentThemePreference, setThemePreference } from "@valentinkolb/cloud/shared";
import { PasswordSetupFields } from "../auth/PasswordSetupFields";

type Props = {
  provider: UserProvider;
  profile: UserProfile;
  freeIpaEnabled: boolean;
};

// ── Toggle Button Group ──

function ToggleGroup(props: {
  label: string;
  options: { value: string; label: string; icon: string }[];
  value: () => string;
  onChange: (value: string) => void;
}) {
  return (
    <div class="flex flex-col gap-2">
      <div>
        <span class="text-sm text-primary">{props.label}</span>
      </div>
      <div class="w-full">
        <SegmentedControl
          value={props.value}
          onChange={(value) => props.onChange(value)}
          options={props.options.map((opt) => ({
            value: opt.value,
            label: opt.label,
            icon: `ti ${opt.icon}`,
          }))}
          ariaLabel={props.label}
        />
      </div>
    </div>
  );
}

// ── Action Row ──

function ActionRow(props: { icon: string; label: string; description: string; onClick: () => void; variant?: "danger" }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        props.variant === "danger" ? "hover:bg-red-50 dark:hover:bg-red-950/30" : "hover:bg-blue-50/45 dark:hover:bg-blue-950/20"
      }`}
    >
      <i class={`ti ${props.icon} text-base shrink-0 ${props.variant === "danger" ? "text-red-500" : "text-dimmed"}`} />
      <div class="flex-1 min-w-0">
        <span class={`text-sm block ${props.variant === "danger" ? "text-red-600 dark:text-red-400" : "text-primary"}`}>{props.label}</span>
        <span class="text-xs text-dimmed block">{props.description}</span>
      </div>
      <i
        class={`ti ti-chevron-right shrink-0 text-xs text-dimmed transition-transform group-hover:translate-x-0.5 ${props.variant === "danger" ? "group-hover:text-red-500" : "group-hover:text-blue-600 dark:group-hover:text-blue-400"}`}
      />
    </button>
  );
}

type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function ChangePasswordDialog(props: { close: (value: ChangePasswordPayload | null) => void }) {
  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const submit = () => {
    setError(null);
    if (!currentPassword().trim() || !newPassword() || !confirmPassword()) {
      setError("Fill out all password fields.");
      return;
    }
    if (newPassword() !== confirmPassword()) {
      setError("Passwords do not match.");
      return;
    }
    props.close({
      currentPassword: currentPassword(),
      newPassword: newPassword(),
      confirmPassword: confirmPassword(),
    });
  };

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextInput
        label="Current Password"
        placeholder="Current password..."
        icon="ti ti-lock"
        password
        value={currentPassword}
        onChange={setCurrentPassword}
        onInput={setCurrentPassword}
        autocomplete="current-password"
      />

      <PasswordSetupFields
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
      />

      {error() && <div class="info-block-danger">{error()}</div>}

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(null)}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm">
          <i class="ti ti-lock-check" />
          Change
        </button>
      </div>
    </form>
  );
}

// ── Main Component ──

export default function ProfileSettings(props: Props) {
  // ── Appearance state ──
  const [theme, setTheme] = createSignal(getCurrentThemePreference());

  const handleTheme = (value: string) => {
    if (value !== "light" && value !== "dark") return;
    setTheme(setThemePreference(value));
  };

  // ── Account mutations ──
  const passwordMutation = mutations.create<void, { currentPassword: string; newPassword: string; confirmPassword: string }>({
    mutation: async (vars) => {
      const res = await apiClient.me.password.$post({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to change password.");
      }
    },
    onSuccess: () => prompts.alert("Password changed successfully."),
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.me.$delete({});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete account.");
      }
    },
    onSuccess: () => {
      window.location.href = "/auth/login";
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleChangePassword = async () => {
    const result = await prompts.dialog<ChangePasswordPayload | null>((close) => <ChangePasswordDialog close={close} />, {
      title: "Change Password",
      icon: "ti ti-lock",
      size: "medium",
    });
    if (result) {
      await passwordMutation.mutate({
        currentPassword: result.currentPassword,
        newPassword: result.newPassword,
        confirmPassword: result.confirmPassword,
      });
    }
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm("Are you sure you want to delete your account? This action cannot be undone.", {
      title: "Delete Account",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await deleteMutation.mutate();
    }
  };

  const handleLogout = async () => {
    await apiClient.auth.logout.$post();
    window.location.href = "/auth/login";
  };

  const isIpa = props.provider === "ipa" && props.freeIpaEnabled;
  const isGuest = props.profile === "guest";

  return (
    <section class="paper p-5">
      <div class="mb-5">
        <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <i class="ti ti-user-cog text-sm" />
          Account settings
        </h2>
        <p class="mt-1 text-xs text-dimmed">Appearance, password, and session controls.</p>
      </div>

      <div class="flex flex-col gap-4">
        <ToggleGroup
          label="Color mode"
          value={theme}
          onChange={handleTheme}
          options={[
            { value: "light", label: "Light", icon: "ti-sun" },
            { value: "dark", label: "Dark", icon: "ti-moon" },
          ]}
        />

        <div class="flex flex-col gap-1">
          <Show when={isIpa}>
            <ActionRow icon="ti-lock" label="Change Password" description="Update your FreeIPA password" onClick={handleChangePassword} />
          </Show>

          <ActionRow icon="ti-logout" label="Sign Out" description="Log out of your account" onClick={handleLogout} variant="danger" />

          <Show when={isGuest}>
            <ActionRow
              icon="ti-trash"
              label="Delete Account"
              description="Permanently delete your account and all data"
              onClick={handleDelete}
              variant="danger"
            />
          </Show>
        </div>
      </div>
    </section>
  );
}
