import type { SoftNavigationResult } from "../../../lib/soft-navigation";

export type NoteNavigationTarget = {
  noteShortId: string;
  canonicalHref: string;
};

type PendingNavigation = {
  source: string;
  push: boolean;
  resolve: (result: SoftNavigationResult) => void;
};

type Options = {
  initialSource: string;
  currentNoteShortId: () => string;
  currentHref: () => string;
  setSource: (source: string) => void;
  pushHistory: (href: string) => void;
};

export const createNoteNavigationCoordinator = (options: Options) => {
  let committedSource = options.initialSource;
  let pending: PendingNavigation | undefined;

  const navigate = (target: NoteNavigationTarget, push: boolean): Promise<SoftNavigationResult> => {
    if (target.noteShortId === options.currentNoteShortId()) {
      if (pending) {
        pending.resolve({ kind: "superseded" });
        pending = undefined;
        options.setSource(committedSource);
      }
      if (push && options.currentHref() !== target.canonicalHref) options.pushHistory(target.canonicalHref);
      return Promise.resolve({ kind: "applied", href: target.canonicalHref });
    }

    pending?.resolve({ kind: "superseded" });
    return new Promise<SoftNavigationResult>((resolve) => {
      pending = { source: target.canonicalHref, push, resolve };
      options.setSource(target.canonicalHref);
    });
  };

  const apply = (source: string, href: string, applyState: () => void): boolean => {
    const request = pending;
    if (!request || request.source !== source) return false;
    pending = undefined;
    committedSource = href;
    applyState();
    if (request.push) options.pushHistory(href);
    request.resolve({ kind: "applied", href });
    return true;
  };

  const fail = (source: string): boolean => {
    const request = pending;
    if (!request || request.source !== source) return false;
    pending = undefined;
    options.setSource(committedSource);
    request.resolve({ kind: "fallback" });
    return true;
  };

  const dispose = () => {
    pending?.resolve({ kind: "superseded" });
    pending = undefined;
  };

  return { navigate, apply, fail, dispose };
};
