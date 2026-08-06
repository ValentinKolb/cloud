import { resolve } from "path";
import { buildAssets } from "./build-assets";

const uiBuildComplete = resolve(import.meta.dir, "../../packages/ui/dist/.build-complete");
const uiBuildDeadline = Date.now() + 600_000;

while (!(await Bun.file(uiBuildComplete).exists())) {
  if (Date.now() >= uiBuildDeadline) {
    throw new Error("Timed out waiting for the @k2b/ui build to finish");
  }
  await Bun.sleep(50);
}

await buildAssets();

const { default: server } = await import("./server");

try {
  Bun.serve(server);
} catch (error) {
  console.error(error);
  process.exit(1);
}
