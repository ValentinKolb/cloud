import { type Accessor, createMemo, createSignal } from "solid-js";

type Draft<T extends object> = {
  draft: Accessor<T>;
  set: (next: T) => void;
  patch: (partial: Partial<T>) => void;
  dirty: Accessor<boolean>;
  reset: () => void;
  markSaved: (snapshot: T) => void;
};

export const createDraft = <T extends object>(initial: T, options: { equals?: (a: T, b: T) => boolean } = {}): Draft<T> => {
  const equals = options.equals ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));
  const [snapshot, setSnapshot] = createSignal<T>(initial);
  const [draft, setDraft] = createSignal<T>(initial);
  const dirty = createMemo(() => !equals(draft(), snapshot()));

  return {
    draft,
    set: (next) => setDraft(() => next),
    patch: (partial) => setDraft((current) => ({ ...current, ...partial })),
    dirty,
    reset: () => setDraft(() => snapshot()),
    markSaved: (next) => {
      setSnapshot(() => next);
      setDraft(() => next);
    },
  };
};
