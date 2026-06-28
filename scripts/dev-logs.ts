#!/usr/bin/env bun
/**
 * dev:logs <app> — tail one app's logs.
 *
 * Single-app on purpose: multiplexing N apps interleaves their output
 * and makes filtering harder. For multiple apps, open multiple shells
 * or use `docker compose logs -f a b c` directly.
 */
import { compose, helpFor, resolveApps } from "./dev-cli";

const inputs = process.argv.slice(2);

if (inputs.length === 0) {
  helpFor("bun run dev:logs <app>", ["Follow the logs of one app. Ctrl-C exits.", "", "Example:", "  bun run dev:logs notebooks"]);
  process.exit(0);
}

if (inputs.length > 1) {
  console.error("dev:logs takes a single app. For multiple, use separate shells.");
  console.error(`Example: bun run dev:logs ${inputs[0]}`);
  process.exit(1);
}

const [service] = await resolveApps(inputs);

await compose(["logs", "-f", service!]);
