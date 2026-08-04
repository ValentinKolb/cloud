export const combineCapabilitySignals = (first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined => {
  if (first && second) return AbortSignal.any([first, second]);
  return first ?? second;
};
