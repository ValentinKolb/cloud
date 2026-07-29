export const isInCodeZone = (text: string, position: number): boolean => {
  const before = text.slice(0, position);
  const fences = before.match(/^```/gm);
  if (fences && fences.length % 2 !== 0) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`/g) ?? []).length % 2 !== 0;
};
