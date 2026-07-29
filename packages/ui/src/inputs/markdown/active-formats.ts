const inOpenCode = (before: string): boolean => (before.match(/`/g) ?? []).length % 2 !== 0;

const inLinkUrl = (before: string): boolean => {
  const open = before.lastIndexOf("](");
  return open !== -1 && !before.slice(open + 2).includes(")");
};

const scrub = (value: string): string =>
  value
    .replace(/(?<!`)(`+)(?!`)([^\n]+?)\1(?!`)/g, (match) => " ".repeat(match.length))
    .replace(/\]\(([^)\n]*?)\)/g, (match) => " ".repeat(match.length));

export const computeActiveFormats = (textarea: HTMLTextAreaElement): Set<string> => {
  const { value, selectionStart } = textarea;
  const active = new Set<string>();
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextNewline = value.indexOf("\n", selectionStart);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  const line = value.slice(lineStart, lineEnd);
  const before = value.slice(lineStart, selectionStart);

  const heading = /^(#{1,3})\s/.exec(line);
  if (heading) active.add(`h${heading[1]!.length}`);
  else if (/^\s*[-*+]\s/.test(line)) active.add("bullet");
  else if (/^\s*\d+\.\s/.test(line)) active.add("ordered");
  else if (/^>\s/.test(line)) active.add("quote");

  if (inOpenCode(before)) {
    active.add("code");
    return active;
  }
  if (inLinkUrl(before)) return active;

  const clean = scrub(before);
  if ((clean.match(/\*\*/g) ?? []).length % 2 !== 0) active.add("bold");
  if ((clean.replace(/\*\*/g, "").match(/\*/g) ?? []).length % 2 !== 0) {
    active.add("italic");
  }
  if ((clean.match(/__/g) ?? []).length % 2 !== 0) active.add("bold");
  if ((clean.replace(/__/g, "").match(/_/g) ?? []).length % 2 !== 0) {
    active.add("italic");
  }
  return active;
};
