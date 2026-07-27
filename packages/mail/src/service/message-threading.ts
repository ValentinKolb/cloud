export const normalizeMailSubject = (subject: string): string => {
  let value = subject.trim().toLowerCase().replace(/\s+/g, " ");
  for (let index = 0; index < 8; index += 1) {
    const next = value.replace(/^(?:(?:re|fw|fwd|aw|wg)(?:\[\d+\])?:\s*)/i, "").trim();
    if (next === value) break;
    value = next;
  }
  return value.slice(0, 2_000);
};
