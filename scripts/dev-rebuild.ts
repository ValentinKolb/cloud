#!/usr/bin/env bun
/**
 * dev:rebuild <app...> — rebuild image(s) and restart the apps.
 *
 * `compose up --build` is the one-shot version: builds the new image,
 * recreates the container, brings it up. Compose builds the services
 * in parallel by default so multiple apps spin up at once.
 *
 * Use this after a Dockerfile change or when you suspect the image is
 * stale. For code changes alone, the container's `--watch` flag
 * already picks them up via the bind mount — no rebuild needed.
 */
import { color, compose, helpFor, resolveApps } from "./dev-cli";

const inputs = process.argv.slice(2);

if (inputs.length === 0) {
  helpFor("bun run dev:rebuild <app...>", [
    "Rebuild image(s) and restart one or more apps.",
    "Most code changes hot-reload via --watch and don't need this.",
    "Use it after a Dockerfile / package.json change.",
    "",
    "Examples:",
    "  bun run dev:rebuild notebooks",
    "  bun run dev:rebuild notebooks files grids",
    "",
    "For a full stack rebuild: bun run dev:rebuild:all",
  ]);
  process.exit(0);
}

const services = await resolveApps(inputs);

await compose(["up", "--build", "-d", ...services]);

for (const s of services) {
  console.log(`${color.green}✓${color.reset} ${s} rebuilt and up`);
}
