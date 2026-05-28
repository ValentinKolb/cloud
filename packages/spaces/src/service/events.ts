export type SpaceServiceEvent = {
  type: "item.created" | "item.updated" | "item.deleted" | "item.moved" | "item.completed";
  spaceId: string;
  itemId: string;
  at: string;
};

type Listener = (event: SpaceServiceEvent) => void;

const listeners = new Set<Listener>();

export const publishSpaceEvent = (event: Omit<SpaceServiceEvent, "at">) => {
  const payload: SpaceServiceEvent = { ...event, at: new Date().toISOString() };
  for (const listener of listeners) listener(payload);
};

export const subscribeSpaceEvents = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
