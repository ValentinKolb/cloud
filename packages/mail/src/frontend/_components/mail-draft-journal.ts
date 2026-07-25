import { z } from "zod";
import { type DraftEditableContent, draftEditableContentInputSchema } from "../../contracts";

export type MailDraftJournal = { revision: number; content: DraftEditableContent };

const mailDraftJournalSchema = z.object({
  revision: z.number().int().nonnegative(),
  content: draftEditableContentInputSchema,
});

type DraftJournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const readMailDraftJournal = (storage: DraftJournalStorage, key: string): MailDraftJournal | null => {
  const stored = storage.getItem(key);
  if (!stored) return null;
  try {
    return mailDraftJournalSchema.parse(JSON.parse(stored));
  } catch {
    storage.removeItem(key);
    return null;
  }
};

export const promoteMailDraftJournal = (config: {
  storage: DraftJournalStorage;
  pendingKey: string;
  draftKey: string;
  revision: number;
  fallbackContent: DraftEditableContent;
  serverContent: DraftEditableContent;
}): boolean => {
  const pending = readMailDraftJournal(config.storage, config.pendingKey);
  const content = pending?.content ?? config.fallbackContent;
  const differsFromServer = JSON.stringify(content) !== JSON.stringify(config.serverContent);
  if (differsFromServer) {
    config.storage.setItem(config.draftKey, JSON.stringify({ revision: config.revision, content } satisfies MailDraftJournal));
  }
  config.storage.removeItem(config.pendingKey);
  return differsFromServer;
};
