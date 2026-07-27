const requiredMeta = ["title", "navTitle", "section", "order", "description", "tags", "updated"] as const;

export const metadataErrors = (meta: Record<string, string>): string[] => {
  const errors: string[] = [];

  for (const field of requiredMeta) {
    if (!meta[field]?.trim()) {
      errors.push(`missing frontmatter field '${field}'`);
    }
  }

  if (meta.order && !/^[1-9]\d*$/.test(meta.order)) {
    errors.push("order must be a positive integer");
  }

  if (meta.tags) {
    const match = meta.tags.match(/^\[(.*)\]$/);
    const tags = match?.[1]
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!tags?.length) {
      errors.push("tags must be a non-empty inline list");
    }
  }

  if (meta.updated) {
    const match = meta.updated.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || !parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== meta.updated) {
      errors.push("updated must be a valid YYYY-MM-DD date");
    }
  }

  return errors;
};

export const headingContractErrors = (prose: string, title: string | undefined): string[] => {
  const headings = [...prose.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
    level: match[1].length,
    text: match[2].trim(),
  }));
  const h1s = headings.filter((heading) => heading.level === 1);
  const errors: string[] = [];

  if (h1s.length === 0) {
    errors.push("missing H1");
    return errors;
  }
  if (h1s.length > 1) {
    errors.push("must contain exactly one H1");
  }
  if (headings[0]?.level !== 1) {
    errors.push("H1 must be the first heading");
  }
  if (title && h1s[0].text !== title) {
    errors.push(`H1 '${h1s[0].text}' does not match title '${title}'`);
  }

  return errors;
};
