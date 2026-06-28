import { createMemo, createSignal, type Accessor } from "solid-js";
import { prompts, TextInput } from "@valentinkolb/cloud/ui";
import { password } from "@valentinkolb/stdlib";
import { clipboard } from "@valentinkolb/stdlib/solid";

type PasswordSetupFieldsProps = {
  newPassword: Accessor<string>;
  confirmPassword: Accessor<string>;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
};

function GeneratedPasswordDialog(props: { password: string; close: () => void }) {
  const { copy, wasCopied } = clipboard.create(2500);
  const [copiedOnce, setCopiedOnce] = createSignal(false);

  const copyPassword = async () => {
    await copy(props.password);
    setCopiedOnce(true);
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs font-medium uppercase tracking-wide text-dimmed">Generated password</p>
        <p class="mt-2 break-all font-mono text-sm text-primary">{props.password}</p>
      </div>

      <p class="text-sm text-dimmed">
        The generated password was filled into both password fields. Copy it now if you want to store it in a password manager.
      </p>

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => void copyPassword()}>
          <i class={wasCopied() ? "ti ti-clipboard-check" : "ti ti-copy"} />
          {wasCopied() ? "Copied" : "Copy password"}
        </button>
        {copiedOnce() && (
          <button type="button" class="btn-primary btn-sm" onClick={props.close}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

/** Reusable new-password fields for expired-password and reset-token flows. */
export function PasswordSetupFields(props: PasswordSetupFieldsProps) {
  const [generatedPassword, setGeneratedPassword] = createSignal(false);

  const strength = createMemo(() => password.strength(props.newPassword()));
  const strengthPercent = () => (props.newPassword().length === 0 ? 0 : ((strength().score + 1) / 5) * 100);
  const strengthColor = () => {
    const score = strength().score;
    if (score <= 1) return "bg-red-500";
    if (score === 2) return "bg-amber-500";
    if (score === 3) return "bg-emerald-500";
    return "bg-green-600";
  };
  const strengthTextColor = () => {
    const score = strength().score;
    if (score <= 1) return "text-red-600 dark:text-red-400";
    if (score === 2) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
  };

  const generatePassword = async () => {
    const next = password.random({
      length: 24,
      uppercase: true,
      numbers: true,
      symbols: false,
    });
    props.onNewPasswordChange(next);
    props.onConfirmPasswordChange(next);
    setGeneratedPassword(true);
    await prompts.dialog<void>((close) => <GeneratedPasswordDialog password={next} close={close} />, {
      title: "Password generated",
      icon: "ti ti-sparkles",
      size: "small",
    });
  };

  const updateNewPassword = (value: string) => {
    props.onNewPasswordChange(value);
    setGeneratedPassword(false);
  };

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-primary">New password</p>
          <p class="text-xs text-dimmed">Choose a strong password or generate one automatically.</p>
        </div>
        <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => void generatePassword()}>
          <i class="ti ti-sparkles" />
          Generate
        </button>
      </div>

      <TextInput
        placeholder="New password"
        icon="ti ti-lock-open"
        password
        value={props.newPassword}
        onChange={updateNewPassword}
        onInput={updateNewPassword}
        autocomplete="new-password"
        ariaLabel="New password"
      />

      <div class="flex flex-col gap-1.5">
        <div class="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
          <div
            class={`h-full rounded-full transition-[width,background-color] ${strengthColor()}`}
            style={{ width: `${strengthPercent()}%` }}
          />
        </div>
        <div class="flex items-start justify-between gap-3 text-xs">
          <p class={`font-medium capitalize ${props.newPassword().length === 0 ? "text-dimmed" : strengthTextColor()}`}>
            {props.newPassword().length === 0 ? "No password yet" : strength().label}
          </p>
          <p class="text-right text-dimmed">
            {props.newPassword().length === 0 ? "Use at least 12 characters." : `Estimated crack time: ${strength().crackTime}`}
          </p>
        </div>
        {generatedPassword() && (
          <p class="text-xs text-dimmed">
            Generated password filled into both password fields. Use the eye icon to review it before saving.
          </p>
        )}
        {!generatedPassword() && props.newPassword().length > 0 && strength().feedback.length > 0 && (
          <p class="text-xs text-dimmed">{strength().feedback.slice(0, 2).join(". ")}.</p>
        )}
      </div>

      <TextInput
        label="Confirm new password"
        description="Repeat the new password to avoid typos."
        placeholder="Confirm new password"
        icon="ti ti-lock-check"
        password
        value={props.confirmPassword}
        onChange={props.onConfirmPasswordChange}
        onInput={props.onConfirmPasswordChange}
        autocomplete="new-password"
      />
    </div>
  );
}
