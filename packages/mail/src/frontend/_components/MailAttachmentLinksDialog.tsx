import { dialogCore, PanelDialog, panelDialogFixedOptions } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@k2b/stdlib";
import MailAttachmentLinksSettings from "./MailAttachmentLinksSettings";

function MailAttachmentLinksDialog(props: { mailboxId: string; dateConfig: DateContext; close: () => void }) {
  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Shared links"
        subtitle="Public attachment downloads, limits, and revocation"
        icon="ti ti-link"
        close={props.close}
      />
      <PanelDialog.Body>
        <MailAttachmentLinksSettings mailboxId={props.mailboxId} dateConfig={props.dateConfig} />
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openMailAttachmentLinksDialog = async (params: { mailboxId: string; dateConfig?: DateContext }): Promise<void> => {
  await dialogCore.open<void>(
    (close) => <MailAttachmentLinksDialog mailboxId={params.mailboxId} dateConfig={params.dateConfig ?? {}} close={() => close()} />,
    panelDialogFixedOptions,
  );
};
