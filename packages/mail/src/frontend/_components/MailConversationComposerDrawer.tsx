import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import type { DraftIntent, MailDraft, SenderIdentity } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import MailComposer from "./MailComposer";
import { deriveReplyIdentityId, deriveReplyRecipients } from "./mail-compose-derivation";
import type { MailComposerNavigationHandoff } from "./mail-composer-navigation";

export type MailConversationComposerRequest = {
  intent: DraftIntent;
  message: MessageDetail;
  quotedBody?: string;
};

export type MailConversationActiveComposer = MailConversationComposerRequest & {
  initialDraft?: MailDraft;
};

const replySubject = (subject: string): string => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);
const forwardSubject = (subject: string): string => (/^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`);

export default function MailConversationComposerDrawer(props: {
  active: MailConversationActiveComposer;
  mailboxId: string;
  requestUrl: string;
  subject: string;
  selectedConversationId: string | null;
  identities: SenderIdentity[];
  canAdmin: boolean;
  dateConfig: DateContext;
  onClose: () => void;
  onQueued: () => Promise<void>;
  registerNavigationHandoff: (handoff: MailComposerNavigationHandoff) => () => void;
}) {
  const recipients =
    props.active.initialDraft || (props.active.intent !== "reply" && props.active.intent !== "reply_all")
      ? null
      : deriveReplyRecipients(props.active.message, props.active.intent, props.identities);
  const seed = props.active.initialDraft
    ? undefined
    : {
        intent: props.active.intent,
        senderIdentityId: deriveReplyIdentityId(props.active.message, props.identities),
        conversationId: props.selectedConversationId,
        sourceMessageId: props.active.message.id,
        to: recipients?.to ?? [],
        cc: recipients?.cc ?? [],
        subject: props.active.intent === "forward" ? forwardSubject(props.subject) : replySubject(props.subject),
        body: props.active.quotedBody ?? "",
        sourceAttachmentCount: props.active.intent === "forward" ? props.active.message.attachments.length : 0,
      };

  return (
    <AppWorkspace.BottomDrawer id="mail-composer" open height="lg" minHeight={288} maxHeight={640} resizable class="bg-[var(--ui-surface)]">
      <MailComposer
        mailboxId={props.mailboxId}
        identities={props.identities}
        initialDraft={props.active.initialDraft}
        surface="compact"
        returnHref={props.requestUrl}
        dateConfig={props.dateConfig}
        canShareAttachments={props.canAdmin}
        onClose={props.onClose}
        onQueued={props.onQueued}
        registerNavigationHandoff={props.registerNavigationHandoff}
        seed={seed}
      />
    </AppWorkspace.BottomDrawer>
  );
}
