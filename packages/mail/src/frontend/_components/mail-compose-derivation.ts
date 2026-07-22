import type { DraftIntent, SenderIdentity } from "../../contracts";
import { deriveReplyAddressObjects } from "../../reply-recipients";
import type { MessageDetail } from "../../service/messages";

type RecipientSeed = { to: string[]; cc: string[] };

export const deriveReplyRecipients = (
  message: MessageDetail,
  intent: Extract<DraftIntent, "reply" | "reply_all">,
  identities: SenderIdentity[],
): RecipientSeed => {
  const recipients = deriveReplyAddressObjects(message, intent, identities);
  return {
    to: recipients.to.map((item) => item.address),
    cc: recipients.cc.map((item) => item.address),
  };
};
