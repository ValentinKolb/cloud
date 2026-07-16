import type { MailDraft, SenderIdentity } from "../../contracts";
import MailComposer from "./MailComposer";

export default function MailComposerPage(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft | null;
  returnHref: string;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ui-surface)]">
      <MailComposer
        mailboxId={props.mailboxId}
        identities={props.identities}
        initialDraft={props.initialDraft}
        seed={props.initialDraft ? undefined : { intent: "new" }}
        surface="full"
        returnHref={props.returnHref}
      />
    </div>
  );
}
