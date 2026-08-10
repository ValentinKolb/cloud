import type { Mailbox } from "../../contracts";
import { mailboxHealthPresentation } from "./mail-health-presentation";

export const mailboxOverviewSubtitle = (
  mailbox: Pick<Mailbox, "health" | "healthReason"> & { receivingAddress: string | null },
): string => {
  const address = mailbox.receivingAddress ?? "No receiving address configured";
  const health = mailboxHealthPresentation(mailbox);
  return health ? `${address} · ${health.title}` : address;
};
