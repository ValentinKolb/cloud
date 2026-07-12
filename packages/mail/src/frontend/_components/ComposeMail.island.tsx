import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "../../api/client";
import type { MailCommand, MailDraft, SenderIdentity } from "../../contracts";
import { readApiError } from "./api-response";

const addresses = (values: string[]) => values.map((address) => ({ name: null, address: address.trim().toLowerCase() }));

export default function ComposeMail(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  label?: string;
  class?: string;
  conversationId?: string | null;
  initialTo?: string[];
  initialSubject?: string;
}) {
  const send = mutations.create<{ draft: MailDraft; command: MailCommand } | null, void>({
    mutation: async () => {
      const verified = props.identities.filter((identity) => identity.status === "verified");
      if (verified.length === 0) throw new Error("Configure and verify a sender identity before composing mail.");
      const values = await prompts.form({
        title: props.conversationId ? "Reply" : "New message",
        icon: "ti ti-pencil",
        size: "large",
        fields: {
          identity: {
            type: "select",
            label: "From",
            required: true,
            default: verified.find((identity) => identity.isDefault)?.id ?? verified[0]?.id,
            options: verified.map((identity) => ({
              id: identity.id,
              label: `${identity.displayName || identity.fromAddress} <${identity.fromAddress}>`,
            })),
          },
          to: { type: "tags", label: "To", description: "Press Enter after each address.", required: true, default: props.initialTo ?? [] },
          cc: { type: "tags", label: "Cc", default: [] },
          bcc: { type: "tags", label: "Bcc", default: [] },
          subject: { type: "text", label: "Subject", default: props.initialSubject ?? "", maxLength: 998 },
          body: { type: "text", label: "Message", multiline: true, lines: 14, markdown: true, required: true },
          format: {
            type: "select",
            label: "Format",
            default: "markdown",
            options: [
              { id: "markdown", label: "Markdown" },
              { id: "plain", label: "Plain text" },
            ],
          },
          undo: { type: "number", label: "Undo window", description: "Seconds before delivery begins.", default: 10, min: 0, max: 60 },
        },
        confirmText: "Send",
      });
      if (!values) return null;
      const draftResponse = await apiClient.mailboxes[":mailboxId"].drafts.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          conversationId: props.conversationId ?? null,
          senderIdentityId: values.identity,
          to: addresses(values.to),
          cc: addresses(values.cc ?? []),
          bcc: addresses(values.bcc ?? []),
          subject: values.subject,
          body: values.body,
          format: values.format === "plain" ? "plain" : "markdown",
        },
      });
      if (!draftResponse.ok) throw new Error(await readApiError(draftResponse, "Failed to save draft"));
      const draft = (await draftResponse.json()) as MailDraft;
      const commandResponse = await apiClient.mailboxes[":mailboxId"].commands.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          kind: "send",
          draftId: draft.id,
          senderIdentityId: values.identity,
          undoSeconds: values.undo,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (!commandResponse.ok) throw new Error(await readApiError(commandResponse, "Failed to queue message"));
      return { draft, command: (await commandResponse.json()) as MailCommand };
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success("Message queued");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <button type="button" class={props.class ?? "btn-primary btn-sm"} onClick={() => send.mutate()} disabled={send.loading()}>
      <i class="ti ti-pencil" />
      {props.label ?? "Compose"}
    </button>
  );
}
