export const recordCountText = (count: number, kind: "record" | "group", hasMore: boolean): string => {
  const plural = kind === "record" ? "records" : "groups";
  if (count === 0) return kind === "record" ? "No records" : "No groups";
  if (count === 1) return `1 ${kind}${hasMore ? " loaded" : ""}`;
  return `${count} ${plural}${hasMore ? " loaded" : ""}`;
};
