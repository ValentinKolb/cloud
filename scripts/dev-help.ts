#!/usr/bin/env bun
/**
 * dev:help — catalog of all dev commands + every app the project ships.
 *
 * Designed to be the first thing an agent (or a new human) runs to get
 * oriented. One call returns:
 *   - every verb, what it does, an example
 *   - every app short-name that can be passed as <app>
 *
 * Output stays plain text — stable section headers ("Stack-level",
 * "Per-app", "Apps in this project", "Examples") so a downstream
 * consumer (LLM or grep) has anchors to lock onto.
 */
import { color, listAppServices, shortName } from "./dev-cli";

const apps = await listAppServices();
const shorts = apps.map(shortName);

const lines: string[] = [];
const p = (s = "") => lines.push(s);

p(`${color.bold}Dev commands${color.reset}`);
p("");
p(`${color.bold}Stack-level${color.reset} (whole compose project)`);
p(`  ${color.cyan}bun run dev${color.reset}                  start the whole stack (light: core 7)`);
p(`  ${color.cyan}bun run dev:full${color.reset}             start stack + extras (~20 containers)`);
p(`  ${color.cyan}bun run dev:down${color.reset}             stop everything`);
p(`  ${color.cyan}bun run dev:rebuild:all${color.reset}      rebuild the whole stack`);
p("");
p(`${color.bold}Per-app${color.reset} (one or more apps, space-separated)`);
p(`  ${color.cyan}bun run dev:start <app...>${color.reset}   start app(s) — joins running stack`);
p(`  ${color.cyan}bun run dev:stop <app...>${color.reset}    stop app(s)`);
p(`  ${color.cyan}bun run dev:rebuild <app...>${color.reset} rebuild image(s) + restart`);
p(`  ${color.cyan}bun run dev:logs <app>${color.reset}       follow one app's logs`);
p(`  ${color.cyan}bun run dev:status${color.reset}           list all apps + state`);
p(`  ${color.cyan}bun run dev:status <app>${color.reset}     detail + recent logs for one app`);
p(`  ${color.cyan}bun run dev:help${color.reset}             this catalog`);
p("");
p(`${color.bold}Apps in this project${color.reset}`);
// Wrap at ~70 chars for readability without breaking grep-ability.
let row = "  ";
for (const s of shorts) {
  if (row.length + s.length + 1 > 70) {
    p(row);
    row = "  ";
  }
  row += `${s} `;
}
if (row.trim().length > 0) p(row.trimEnd());
p("");
p(`${color.bold}Examples${color.reset}`);
p(`  bun run dev:start notebooks`);
p(`  bun run dev:rebuild notebooks files grids   # parallel`);
p(`  bun run dev:logs notebooks`);
p(`  bun run dev:status notebooks`);

console.log(lines.join("\n"));
