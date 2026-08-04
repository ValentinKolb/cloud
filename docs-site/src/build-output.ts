import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const isSsrAsset = (name: string): boolean => name.endsWith(".js") || name.endsWith(".js.map");

export async function carryForwardSsrAssets(previousDist: string, nextDist: string): Promise<void> {
  const previousRoot = join(previousDist, "_ssr");
  const nextRoot = join(nextDist, "_ssr");

  const carry = async (relativeDirectory = ""): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(previousRoot, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await carry(relativePath);
        continue;
      }
      if (!entry.isFile() || !isSsrAsset(entry.name)) continue;

      const target = join(nextRoot, relativePath);
      await mkdir(dirname(target), { recursive: true });
      try {
        await copyFile(join(previousRoot, relativePath), target, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  };

  await carry();
}
