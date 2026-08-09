import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";

const root = mkdtempSync(join(tmpdir(), "contacts-ssr-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());

process.once("exit", () => rmSync(root, { recursive: true, force: true }));
