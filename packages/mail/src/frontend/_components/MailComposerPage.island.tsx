import type { MailDraft, SenderIdentity } from "../../contracts";
import MailComposer from "./MailComposer";

export default function MailComposerPage(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft | null;
  returnHref: string;
  popout?: boolean;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden" classList={{ "p-2": props.popout, "bg-[var(--ui-surface)]": !props.popout }}>
      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        classList={{ "paper rounded-[var(--ui-dialog-radius)] [box-shadow:var(--ui-shadow-float)]": props.popout }}
      >
        <MailComposer
          mailboxId={props.mailboxId}
          identities={props.identities}
          initialDraft={props.initialDraft}
          seed={props.initialDraft ? undefined : { intent: "new" }}
          surface="full"
          popout={props.popout}
          returnHref={props.returnHref}
        />
      </div>
    </div>
  );
}
