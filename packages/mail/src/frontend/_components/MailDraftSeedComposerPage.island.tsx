import type { DateContext } from "@k2b/stdlib";
import type { PanesLayout } from "@k2b/ui";
import { ButtonLink, Placeholder } from "@k2b/ui";
import { createSignal, onMount, Show } from "solid-js";
import type { MailDraftSeed, SenderIdentity } from "../../contracts";
import MailComposerPage from "./MailComposerPage.island";
import { readMailDraftSeed } from "./mail-draft-seed-store";

export default function MailDraftSeedComposerPage(props: {
  mailboxId: string;
  seedId: string;
  identities: SenderIdentity[];
  initialPanes: PanesLayout;
  returnHref: string;
  popout?: boolean;
  dateConfig: DateContext;
  canShareAttachments: boolean;
  calendarIntegrationAvailable: boolean;
}) {
  const [seed, setSeed] = createSignal<MailDraftSeed | null>();

  onMount(() => setSeed(readMailDraftSeed(localStorage, props.mailboxId, props.seedId)));

  return (
    <Show
      when={seed() !== undefined}
      fallback={<Placeholder state="loading" variant="panel" class="h-full" title="Preparing message..." />}
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
                <ButtonLink variant="secondary" size="sm" href={props.returnHref}>
                  Back to mailbox
                </ButtonLink>
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
            initialPanes={props.initialPanes}
            returnHref={props.returnHref}
            popout={props.popout}
            dateConfig={props.dateConfig}
            canShareAttachments={props.canShareAttachments}
            calendarIntegrationAvailable={props.calendarIntegrationAvailable}
          />
        )}
      </Show>
    </Show>
  );
}
