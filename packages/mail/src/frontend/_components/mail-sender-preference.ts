import type { SenderIdentity } from "../../contracts";

const SENDER_PREFERENCE_PREFIX = "cloud:mail:last-sender:";

const preferenceKey = (mailboxId: string): string => `${SENDER_PREFERENCE_PREFIX}${mailboxId}`;

export const readMailSenderPreference = (storage: Storage, mailboxId: string): string | null => {
  try {
    const value = storage.getItem(preferenceKey(mailboxId));
    return value && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
};

export const writeMailSenderPreference = (storage: Storage, mailboxId: string, identityId: string): void => {
  try {
    storage.setItem(preferenceKey(mailboxId), identityId);
  } catch {
    // Sender preferences are optional and must never block composing mail.
  }
};

export const selectComposeSenderIdentity = (
  identities: SenderIdentity[],
  preferredIdentityId: string | null,
  fallbackToFirst: boolean,
): SenderIdentity | null => {
  const verified = identities.filter((identity) => identity.status === "verified");
  return (
    verified.find((identity) => identity.id === preferredIdentityId) ??
    verified.find((identity) => identity.isDefault) ??
    (fallbackToFirst || verified.length === 1 ? (verified[0] ?? null) : null)
  );
};
