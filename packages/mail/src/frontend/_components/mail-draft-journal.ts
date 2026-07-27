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

export const advanceMailDraftJournalAfterSave = (config: {
  storage: DraftJournalStorage;
  key: string;
  revision: number;
  savedContent: DraftEditableContent;
}): boolean => {
  const journal = readMailDraftJournal(config.storage, config.key);
  if (!journal || JSON.stringify(journal.content) === JSON.stringify(config.savedContent)) {
    config.storage.removeItem(config.key);
    return false;
  }
  config.storage.setItem(config.key, JSON.stringify({ revision: config.revision, content: journal.content } satisfies MailDraftJournal));
  return true;
};

export const promoteMailDraftJournal = (config: {
  storage: DraftJournalStorage;
  pendingKey: string;
  draftKey: string;
  revision: number;
  submittedContent: DraftEditableContent;
  currentContent: DraftEditableContent;
  serverContent: DraftEditableContent;
}): boolean => {
  const content = config.currentContent;
  const changedSinceSubmission = JSON.stringify(content) !== JSON.stringify(config.submittedContent);
  const differsFromServer = JSON.stringify(content) !== JSON.stringify(config.serverContent);
  if (changedSinceSubmission && differsFromServer) {
    config.storage.setItem(config.draftKey, JSON.stringify({ revision: config.revision, content } satisfies MailDraftJournal));
  }
  config.storage.removeItem(config.pendingKey);
  return changedSinceSubmission && differsFromServer;
};
