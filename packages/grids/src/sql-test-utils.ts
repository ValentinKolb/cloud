export const normalizedSqlParts = (query: unknown): { text: string; values: unknown[] } => {
  const target = query as Record<symbol, unknown>;
  const symbols = Object.getOwnPropertySymbols(query as object);
  const symbol = (name: string) => symbols.find((item) => item.description === name);
  const strings = symbol("strings");
  const values = symbol("values");
  const adapter = symbol("adapter");
  const normalizeQuery = (adapter ? target[adapter] : null) as {
    normalizeQuery: (strings: unknown, values: unknown) => [string, unknown[]];
  } | null;
  if (!strings || !values || !normalizeQuery) throw new Error("Bun SQL query internals changed");
  const [text, params] = normalizeQuery.normalizeQuery(target[strings], target[values]);
  return { text, values: params };
};

export const normalizedSql = (query: unknown): string => normalizedSqlParts(query).text;
