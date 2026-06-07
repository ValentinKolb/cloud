import { Dropdown } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "../api-client";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";

type NotificationActionsProps = {
  id: string;
  status: "sent" | "pending" | "error";
  subject: string;
  content: string;
  recipient: string;
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
          ],
        },
      ]}
    />
  );
};

export default NotificationActions;
