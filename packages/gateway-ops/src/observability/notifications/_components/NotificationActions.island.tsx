import { Dropdown, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "../api-client";

type NotificationActionsProps = {
  id: string;
  status: "sent" | "pending" | "error";
  subject: string;
  content: string;
  recipient: string;
  error: string | null;
  isAdmin?: boolean;
};

const NotificationActions = (props: NotificationActionsProps) => {
  const resendMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient[":id"].resend.$post({
        param: { id: props.id },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to resend notification.");
      }
      return data;
    },
    onSuccess: async (data) => {
      await prompts.alert(data.message);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMutation = mutations.create<{ message: string }, { subject: string; content: string; recipient: string }>({
    mutation: async (vars) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.id },
        json: vars,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to update notification.");
      }
      return data;
    },
    onSuccess: async (data) => {
      await prompts.alert(data.message);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleSend = async () => {
    const isPending = props.status === "pending";
    const confirmed = await prompts.confirm(`This will ${isPending ? "send" : "resend"} the notification to "${props.recipient}".`, {
      title: isPending ? "Send Notification?" : "Resend Notification?",
      icon: "ti ti-send",
      confirmText: isPending ? "Send" : "Resend",
      cancelText: "Cancel",
    });
    if (confirmed) {
      await resendMutation.mutate();
    }
  };

  const handleEdit = async () => {
    const result = await prompts.form({
      title: "Edit Notification",
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        recipient: {
          type: "text" as const,
          label: "Recipient",
          placeholder: "Email address...",
          icon: "ti ti-mail",
          required: true,
          default: props.recipient,
        },
        subject: {
          type: "text" as const,
          label: "Subject",
          placeholder: "Subject...",
          icon: "ti ti-heading",
          required: true,
          default: props.subject,
        },
        content: {
          type: "text" as const,
          label: "Content (HTML)",
          placeholder: "HTML content...",
          multiline: true,
          required: true,
          default: props.content,
        },
      },
    });

    if (result) {
      await updateMutation.mutate({
        recipient: result.recipient,
        subject: result.subject,
        content: result.content,
      });
    }
  };

  const showError = () => {
    if (!props.error) return;
    void prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-3">
          <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-100 px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary dark:bg-zinc-800">
            {props.error}
          </pre>
          <div class="flex justify-end">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close()}>
              Close
            </button>
          </div>
        </div>
      ),
      {
        title: "Notification Error",
        icon: "ti ti-alert-circle",
      },
    );
  };

  // Admins can always edit, non-admins only pending/error
  const canEdit = props.isAdmin || props.status !== "sent";
  const sendLabel = props.status === "pending" ? "Send" : "Resend";

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="Notification actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-40"
      elements={[
        {
          items: [
            {
              icon: "ti ti-send",
              label: sendLabel,
              action: handleSend,
            },
            ...(canEdit
              ? [
                  {
                    icon: "ti ti-pencil",
                    label: "Edit",
                    action: handleEdit,
                  },
                ]
              : []),
            ...(props.status === "error" && props.error
              ? [
                  {
                    icon: "ti ti-alert-circle",
                    label: "Show Error",
                    action: showError,
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
};

export default NotificationActions;
