type Fence = {
  marker: "`" | "~";
  length: number;
};

const openingFence = (line: string): Fence | null => {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return {
    marker: match[1][0] as Fence["marker"],
    length: match[1].length,
  };
};

const closesFence = (line: string, fence: Fence): boolean => {
  const match = line.match(/^\s{0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
};

export const mapOutsideFences = (source: string, transform: (line: string) => string): string => {
  let fence: Fence | null = null;

  return source
    .split("\n")
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        return line;
      }

      const nextFence = openingFence(line);
      if (nextFence) {
        fence = nextFence;
        return line;
      }

      return transform(line);
    })
    .join("\n");
};

export const withoutFencedCode = (source: string): string => {
  let fence: Fence | null = null;

  return source
    .split("\n")
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        return "";
      }

      const nextFence = openingFence(line);
      if (nextFence) {
        fence = nextFence;
        return "";
      }

      return line;
    })
    .join("\n");
};

export const replaceOutsideInlineCode = (line: string, transform: (text: string) => string): string => {
  const parts: string[] = [];
  let outsideStart = 0;
  let index = 0;

  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }

    let end = index;
    while (line[end] === "`") end += 1;
    const delimiter = line.slice(index, end);
    const closing = line.indexOf(delimiter, end);
    if (closing === -1) {
      index = end;
      continue;
    }

    parts.push(transform(line.slice(outsideStart, index)));
    parts.push(line.slice(index, closing + delimiter.length));
    index = closing + delimiter.length;
    outsideStart = index;
  }

  parts.push(transform(line.slice(outsideStart)));
  return parts.join("");
};

export const mapMarkdownProse = (source: string, transform: (text: string) => string): string =>
  mapOutsideFences(source, (line) => replaceOutsideInlineCode(line, transform));
