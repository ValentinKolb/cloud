import { createSignal, For, Show } from "solid-js";
import { cookies } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { gradients } from "@valentinkolb/stdlib";
import { prompts, SegmentedControl } from "@valentinkolb/cloud/ui";
import type { UserProfile, UserProvider, WidgetData } from "@valentinkolb/cloud/contracts";
import { apiClient } from "@valentinkolb/cloud/clients/core";

type Props = {
  provider: UserProvider;
  profile: UserProfile;
  availableWidgets: WidgetData[];
  freeIpaEnabled: boolean;
};

// ── Toggle Button Group ──

function ToggleGroup(props: {
  label: string;
  description: string;
  options: { value: string; label: string; icon: string }[];
  value: () => string;
  onChange: (value: string) => void;
}) {
  return (
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <span class="text-sm text-primary">{props.label}</span>
        <p class="text-xs text-dimmed">{props.description}</p>
      </div>
      <div class="w-56 max-w-full shrink-0">
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
      class={`flex items-center gap-3 p-3 -mx-1 transition-colors text-left w-full ${
        props.variant === "danger" ? "hover:bg-red-50 dark:hover:bg-red-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <i class={`ti ${props.icon} text-base shrink-0 ${props.variant === "danger" ? "text-red-500" : "text-dimmed"}`} />
      <div class="flex-1 min-w-0">
        <span class={`text-sm block ${props.variant === "danger" ? "text-red-600 dark:text-red-400" : "text-primary"}`}>{props.label}</span>
        <span class="text-xs text-dimmed block">{props.description}</span>
      </div>
      <i class="ti ti-chevron-right text-xs text-dimmed shrink-0" />
    </button>
  );
}

// ── Main Component ──

export default function ProfileSettings(props: Props) {
  // ── Appearance state ──
  const [theme, setTheme] = createSignal(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  const handleTheme = (value: string) => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(value);
    cookies.writeCookie("theme", value);
    setTheme(value);
  };

  const [nameGradient, setNameGradient] = createSignal(
    typeof document !== "undefined" ? (cookies.readCookie("nameGradient") ?? "default") : "default",
  );

  const handleGradient = (id: string) => {
    cookies.writeCookie("nameGradient", id);
    setNameGradient(id);
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
    const result = await prompts.form({
      title: "Change Password",
      icon: "ti ti-lock",
      confirmText: "Change",
      fields: {
        currentPassword: {
          type: "text" as const,
          label: "Current Password",
          placeholder: "Current password...",
          icon: "ti ti-lock",
          password: true,
          required: true,
        },
        newPassword: {
          type: "text" as const,
          label: "New Password",
          placeholder: "New password...",
          icon: "ti ti-lock-open",
          password: true,
          required: true,
        },
        confirmPassword: {
          type: "text" as const,
          label: "Confirm Password",
          placeholder: "Confirm new password...",
          icon: "ti ti-lock-check",
          password: true,
          required: true,
        },
      },
    });
    if (result) {
      if (result.newPassword !== result.confirmPassword) {
        prompts.error("Passwords do not match.");
        return;
      }
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

  // ── Widget visibility state ──
  const [hiddenWidgets, setHiddenWidgets] = createSignal<string[]>(
    (() => {
      if (typeof document === "undefined") return [];
      try {
        const raw = cookies.readCookie("hiddenWidgets");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    })(),
  );

  const toggleWidget = (id: string) => {
    const current = hiddenWidgets();
    const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
    setHiddenWidgets(next);
    cookies.writeJsonCookie("hiddenWidgets", next);
  };

  const isIpa = props.provider === "ipa" && props.freeIpaEnabled;
  const isGuest = props.profile === "guest";

  return (
    <>
      {/* Appearance */}
      <div class="paper p-6 flex flex-col gap-5">
        <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
          <i class="ti ti-palette text-sm" />
          Appearance
        </h2>

        <ToggleGroup
          label="Color Mode"
          description="Switch between light and dark"
          value={theme}
          onChange={handleTheme}
          options={[
            { value: "light", label: "Light", icon: "ti-sun" },
            { value: "dark", label: "Dark", icon: "ti-moon" },
          ]}
        />

        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <span class="text-sm text-primary">Name Color</span>
            <p class="text-xs text-dimmed">Color of your name on the home page</p>
          </div>
          <div class="flex gap-1.5 shrink-0 flex-wrap justify-end">
            {gradients.gradientPresets.map((preset) => (
              <button
                type="button"
                title={preset.label}
                onClick={() => handleGradient(preset.id)}
                class={`w-6 h-6 rounded-full transition-all ${
                  nameGradient() === preset.id ? "ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-zinc-900" : "hover:scale-110"
                }`}
                style={`background:${preset.preview}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Widgets */}
      <Show when={props.availableWidgets.length > 0}>
        <div class="paper p-6 flex flex-col gap-4">
          <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
            <i class="ti ti-layout-dashboard text-sm" />
            Widgets
          </h2>

          <div class="flex flex-col gap-3">
            <For each={props.availableWidgets}>
              {(widget) => (
                <div
                  class="flex items-center justify-between gap-4 p-2 -mx-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                  onClick={() => toggleWidget(widget.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleWidget(widget.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <i class={`ti ti-${widget.icon} text-sm text-dimmed`} />
                    <span class="text-sm text-primary">{widget.title}</span>
                  </div>
                  <span
                    class={`relative shrink-0 transition-colors w-9 h-5 rounded-full ${
                      !hiddenWidgets().includes(widget.id) ? "bg-blue-500 " : "bg-zinc-200 dark:bg-zinc-600/40"
                    }`}
                  >
                    <span
                      class={`absolute transition-transform top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm ${
                        !hiddenWidgets().includes(widget.id) ? "translate-x-4 " : ""
                      }`}
                    />
                  </span>
                </div>
              )}
            </For>
          </div>

          <p class="text-xs text-dimmed">Changes apply on the home page.</p>
        </div>
      </Show>

      {/* Account */}
      <div class="paper p-6 flex flex-col gap-1">
        <h2 class="text-sm font-semibold text-primary flex items-center gap-1 mb-2">
          <i class="ti ti-user-cog text-sm" />
          Account
        </h2>

        <Show when={isIpa}>
          <ActionRow icon="ti-lock" label="Change Password" description="Update your FreeIPA password" onClick={handleChangePassword} />
        </Show>

        <div class="border-t border-zinc-200 dark:border-zinc-700 my-2" />

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
    </>
  );
}
