export const filterChatCommands = <T extends { name: string }>(
  value: string,
  commands: readonly T[],
): T[] => {
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(query));
};

export const isChatNearBottom = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 96,
): boolean => scrollHeight - scrollTop - clientHeight <= threshold;

export const restoredChatScrollTop = (
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number => Math.max(0, previousScrollTop + nextScrollHeight - previousScrollHeight);
