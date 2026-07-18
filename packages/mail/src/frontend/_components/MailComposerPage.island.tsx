import type { DateContext } from "@valentinkolb/stdlib";
import type { MailDraft, SenderIdentity } from "../../contracts";
import MailComposer from "./MailComposer";

export default function MailComposerPage(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft | null;
  returnHref: string;
  popout?: boolean;
  dateConfig: DateContext;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        classList={{ "paper rounded-[var(--ui-radius-frame)]": !props.popout }}
      >
        <MailComposer
          mailboxId={props.mailboxId}
          identities={props.identities}
          initialDraft={props.initialDraft}
          seed={props.initialDraft ? undefined : { intent: "new" }}
          surface="full"
          popout={props.popout}
          returnHref={props.returnHref}
          dateConfig={props.dateConfig}
        />
      </div>
    </div>
  );
}
