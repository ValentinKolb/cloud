import type { DateContext } from "@k2b/stdlib";
import type { MailDraft, MailDraftSeed, SenderIdentity } from "../../contracts";
import MailComposer from "./MailComposer";

export default function MailComposerPage(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft;
  initialSeed?: MailDraftSeed;
  returnHref: string;
  popout?: boolean;
  dateConfig: DateContext;
  canShareAttachments: boolean;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden" classList={{ "paper rounded-[var(--ui-radius-frame)]": !props.popout }}>
        <MailComposer
          mailboxId={props.mailboxId}
          identities={props.identities}
          initialDraft={props.initialDraft}
          initialSeed={props.initialSeed}
          popout={props.popout}
          returnHref={props.returnHref}
          dateConfig={props.dateConfig}
          canShareAttachments={props.canShareAttachments}
        />
      </div>
    </div>
  );
}
