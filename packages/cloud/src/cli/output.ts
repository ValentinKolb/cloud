/**
 * Output helpers for app CLI commands.
 *
 * Every command has to honour `ctx.options.output`, and hand-writing that
 * branch is where it goes wrong: several apps checked only for "json" and then
 * printed a text table under `--jsonl`, which silently breaks the machine
 * -readable contract agents rely on.
 *
 * Both helpers emit the *full* value in structured modes, not the table
 * projection — a table drops fields on purpose, a JSON consumer wants them.
 */

import type { CloudCliContext, CloudCliTableColumn } from "./index";

/**
 * Render a list: full payload as JSON, one object per line as JSONL, or a
 * table in text mode.
 *
 * `value` is what structured consumers get. `rows`/`columns` are the text
 * projection, and may be a narrower shape than `value`.
 */
export const printRows = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: CloudCliTableColumn<TRow>[],
): void => {
  if (ctx.options.output === "json") {
    ctx.json(value);
    return;
  }
  if (ctx.options.output === "jsonl") {
    for (const item of Array.isArray(value) ? value : [value]) ctx.jsonLine(item);
    return;
  }
  ctx.table(rows, columns);
};

/**
 * Handle the structured modes for a single value and report whether anything
 * was printed. Use it to guard bespoke text rendering:
 *
 * ```ts
 * if (printStructured(ctx, mailbox)) return;
 * ctx.print(`${mailbox.name} — ${mailbox.address}`);
 * ```
 */
export const printStructured = (ctx: CloudCliContext, value: unknown): boolean => {
  if (ctx.options.output === "json") {
    ctx.json(value);
    return true;
  }
  if (ctx.options.output === "jsonl") {
    ctx.jsonLine(value);
    return true;
  }
  return false;
};
