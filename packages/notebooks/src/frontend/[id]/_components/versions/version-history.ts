export type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
};

export type DiffRow = {
  kind: "added" | "removed" | "unchanged";
  value: string;
  oldLine: number | null;
  newLine: number | null;
};

type VersionRef = {
  id: string;
  createdAt: string;
};

const splitLines = (value: string): string[] => {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

export const buildDiffRows = (parts: DiffPart[]): DiffRow[] => {
  let oldLine = 1;
  let newLine = 1;
  const rows: DiffRow[] = [];

  for (const part of parts) {
    const kind = part.added ? "added" : part.removed ? "removed" : "unchanged";
    for (const value of splitLines(part.value)) {
      rows.push({
        kind,
        value,
        oldLine: kind === "added" ? null : oldLine,
        newLine: kind === "removed" ? null : newLine,
      });
      if (kind !== "added") oldLine += 1;
      if (kind !== "removed") newLine += 1;
    }
  }

  return rows;
};

export const summarizeDiff = (rows: DiffRow[]): { added: number; removed: number; hasChanges: boolean } => {
  const added = rows.filter((row) => row.kind === "added").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  return { added, removed, hasChanges: added > 0 || removed > 0 };
};

export const orderComparison = (
  selectedId: string,
  comparisonId: string,
  versions: VersionRef[],
  currentId: string,
): { fromId: string; toId: string } => {
  if (comparisonId === currentId) return { fromId: selectedId, toId: currentId };

  const selected = versions.find((version) => version.id === selectedId);
  const comparison = versions.find((version) => version.id === comparisonId);
  if (!selected || !comparison) return { fromId: selectedId, toId: comparisonId };

  return Date.parse(selected.createdAt) <= Date.parse(comparison.createdAt)
    ? { fromId: selectedId, toId: comparisonId }
    : { fromId: comparisonId, toId: selectedId };
};
