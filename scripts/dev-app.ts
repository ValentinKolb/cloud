#!/usr/bin/env bun
/**
 * dev-app — start, stop, or tail a single app container in the running dev stack.
 *
 * The dev stack (`bun run dev`) and this script share the same Docker Compose
 * project (project name = folder name = "cloud"), so any container started
 * here joins the existing default network and is discovered by the gateway
 * via the Redis app registry within ~5 seconds.
 *
 * Usage:
 *   bun run dev:app <name>         # up (default), --build, detached
 *   bun run dev:app up <name>      # same as above
 *   bun run dev:app stop <name>
 *   bun run dev:app logs <name>    # follow logs
 */
import { $ } from "bun";

const COMMANDS = ["up", "stop", "logs"] as const;
type Command = (typeof COMMANDS)[number];

const args = process.argv.slice(2);
let cmd: Command = "up";
let name: string | undefined;

if (args.length === 1) {
  name = args[0];
} else if (args.length === 2 && (COMMANDS as readonly string[]).includes(args[0]!)) {
  cmd = args[0] as Command;
  name = args[1];
}

if (!name) {
  console.error("Usage: bun run dev:app [up|stop|logs] <app-name>");
  console.error("Example: bun run dev:app files");
  process.exit(1);
}

const service = `app-${name}`;

// Validate: the service must be defined in compose.dev.yml. `config --services`
// only lists services in the active profile set, so include `--profile extra`
// to also see profile-gated services (otherwise dev:app couldn't start them).
const services = (await $`docker compose -f compose.dev.yml --profile extra config --services`.text()).trim().split("\n");
if (!services.includes(service)) {
  console.error(`Unknown service: ${service}`);
  console.error(`Available: ${services.filter((s) => s.startsWith("app-")).join(", ")}`);
  process.exit(1);
}

switch (cmd) {
  case "up":
    // `up -d` joins the existing network without taking down anything else.
    // Explicitly pass the service name so Compose only considers that one —
    // otherwise it would try to start every non-profile service too.
    await $`docker compose -f compose.dev.yml up --build -d ${service}`;
    console.log(`\n✓ ${service} is up. Gateway discovers it within ~5s.`);
    console.log(`  tail logs: bun run dev:app logs ${name}`);
    console.log(`  stop:      bun run dev:app stop ${name}`);
    break;
  case "stop":
    await $`docker compose -f compose.dev.yml stop ${service}`;
    break;
  case "logs":
    await $`docker compose -f compose.dev.yml logs -f ${service}`;
    break;
}
