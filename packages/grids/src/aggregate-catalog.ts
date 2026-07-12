export const AGGREGATE_KINDS = ["count", "countEmpty", "countUnique", "sum", "avg", "min", "max", "median", "earliest", "latest"] as const;

export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

const AGGREGATE_KIND_SET: ReadonlySet<string> = new Set(AGGREGATE_KINDS);

export const isAggregateKind = (value: string): value is AggregateKind => AGGREGATE_KIND_SET.has(value);

export const aggregateKindPattern = (): RegExp => new RegExp(`\\b(?:${AGGREGATE_KINDS.join("|")})\\b`, "i");
