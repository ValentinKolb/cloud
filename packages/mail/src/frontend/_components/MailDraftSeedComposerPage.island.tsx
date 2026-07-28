import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal, onMount, Show } from "solid-js";
import type { MailDraftSeed, SenderIdentity } from "../../contracts";
import MailComposerPage from "./MailComposerPage.island";
import { readMailDraftSeed } from "./mail-draft-seed-store";

export default function MailDraftSeedComposerPage(props: {
  mailboxId: string;
  seedId: string;
  identities: SenderIdentity[];
  returnHref: string;
  popout?: boolean;
  dateConfig: DateContext;
  canShareAttachments: boolean;
}) {
  const [seed, setSeed] = createSignal<MailDraftSeed | null>();

  onMount(() => setSeed(readMailDraftSeed(localStorage, props.mailboxId, props.seedId)));

  return (
    <Show
      when={seed() !== undefined}
      fallback={<div class="flex h-full items-center justify-center text-sm text-dimmed">Preparing message...</div>}
    >
      <Show
        when={seed()}
        fallback={
          <div class="flex h-full items-center justify-center p-6">
            <Placeholder
              state="error"
              title="This message is no longer available"
              description="The temporary composer data expired or was removed. Start the message again."
              action={
                <a class="btn-secondary btn-sm" href={props.returnHref}>
                  Back to mailbox
                </a>
              }
            />
          </div>
        }
      >
        {(value) => (
          <MailComposerPage
            mailboxId={props.mailboxId}
            identities={props.identities}
            initialSeed={value()}
            returnHref={props.returnHref}
            popout={props.popout}
            dateConfig={props.dateConfig}
            canShareAttachments={props.canShareAttachments}
          />
        )}
      </Show>
    </Show>
  );
}
