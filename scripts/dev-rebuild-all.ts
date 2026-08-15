#!/usr/bin/env bun
import { color, composeUpAndWait, listDevServices } from "./dev-cli";

const services = await listDevServices();
await composeUpAndWait(["--build"], services);
console.log(`${color.green}✓${color.reset} ${services.length} services rebuilt and ready`);
