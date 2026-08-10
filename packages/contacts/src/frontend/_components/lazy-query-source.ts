export type SourceTagged<T> = {
  source: string;
  value: T;
};

export const currentSourceValue = <T>(source: string, result: SourceTagged<T> | undefined): T | undefined =>
  result?.source === source ? result.value : undefined;

export const currentDebouncedSourceValue = <T>(
  draft: string,
  committed: string,
  source: string,
  result: SourceTagged<T> | undefined,
): T | undefined => (draft === committed ? currentSourceValue(source, result) : undefined);
