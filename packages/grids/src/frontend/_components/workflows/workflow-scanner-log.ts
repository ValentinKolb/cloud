type ScannerLogEntry = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
};

const isActive = (entry: ScannerLogEntry): boolean => entry.status === "queued" || entry.status === "running";

export const retainVisibleScannerLogs = <T extends ScannerLogEntry>(entries: T[], limit: number): T[] => {
  const activeCount = entries.filter(isActive).length;
  const terminalBudget = Math.max(limit - activeCount, 0);
  let terminals = 0;
  return entries.filter((entry) => {
    if (isActive(entry)) return true;
    if (terminals >= terminalBudget) return false;
    terminals++;
    return true;
  });
};
