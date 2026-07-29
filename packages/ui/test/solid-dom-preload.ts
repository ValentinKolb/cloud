import { transformAsync } from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import type { BunPlugin } from "bun";

const solidDomPlugin = (): BunPlugin => ({
  name: "k2b-ui-test-solid-dom",
  setup(build) {
    build.onLoad({ filter: /\.(tsx|jsx)$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const result = await transformAsync(source, {
        filename: path,
        presets: [
          [tsPreset, {}],
          [solidPreset, { generate: "dom", hydratable: false }],
        ],
      });
      if (!result?.code) throw new Error(`Solid DOM transform failed: ${path}`);
      return { contents: result.code, loader: "js" };
    });
  },
});

Bun.plugin(solidDomPlugin());
