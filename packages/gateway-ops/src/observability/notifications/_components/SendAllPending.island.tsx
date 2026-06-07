import { createSignal, onMount } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "../api-client";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";

type SendResult = {
  sent: number;
  failed: number;
  errors: { id: string; recipient: string; error: string }[];
};

const SendAllPending = () => {
  const [pendingCount, setPendingCount] = createSignal<number | null>(0);

  // Fetch pending count on mount
  onMount(async () => {
    try {
      const res = await apiClient["pending-system"].count.$get();
      if (res.ok) {
        const data = await res.json();
        setPendingCount(data.count);
      }
    } catch {
      // Ignore errors
    }
  });

  const sendAllMutation = mutations.create<SendResult, void>({
    mutation: async () => {
      const res = await apiClient["pending-system"]["send-all"].$post();
      const data = await res.json();
      if (!res.ok) {
        throw new Error("message" in data ? data.message : "Failed to send notifications.");
      }
      return data as SendResult;
    },
    onSuccess: async (result) => {
      setPendingCount(0);

      if (result.failed === 0) {
        await prompts.alert(`Successfully sent ${result.sent} notification${result.sent !== 1 ? "s" : ""}.`);
      } else {
        const errorList = result.errors.map((e) => `${e.recipient}: ${e.error}`).join("\n");
        await prompts.alert(`Sent: ${result.sent}, Failed: ${result.failed}\n\nErrors:\n${errorList}`);
      }
      refreshCurrentPath();
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = async () => {
    const count = pendingCount();
    if (count === null || count === 0) return;

    const confirmed = await prompts.confirm(
      `This will send ${count} pending system notification${
        count !== 1 ? "s" : ""
      } (welcome emails, etc.).\n\nThis action cannot be undone.`,
      {
        title: "Send All Pending System Notifications?",
        icon: "ti ti-send",
        confirmText: `Send ${count} Notification${count !== 1 ? "s" : ""}`,
        cancelText: "Cancel",
      },
    );

    if (confirmed) {
      await sendAllMutation.mutate();
    }
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleClick} disabled={sendAllMutation.loading() || pendingCount() === 0}>
      {sendAllMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-send" />}
      <span>Send {pendingCount()} Pending</span>
    </button>
  );
};

export default SendAllPending;
