export type MailComposerNavigationHandoff = () => Promise<boolean>;

export const createMailComposerNavigation = () => {
  let active: MailComposerNavigationHandoff | null = null;
  let preparing = false;

  return {
    register(handoff: MailComposerNavigationHandoff): () => void {
      active = handoff;
      return () => {
        if (active === handoff) active = null;
      };
    },
    async prepare(): Promise<boolean> {
      if (!active) return true;
      if (preparing) return false;
      const handoff = active;
      preparing = true;
      try {
        return (await handoff()) && active === handoff;
      } finally {
        preparing = false;
      }
    },
  };
};
