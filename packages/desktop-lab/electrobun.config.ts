import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Cloud Desktop Lab",
    identifier: "dev.stuve.cloud.desktop-lab",
    version: "0.0.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/native/electrobun/index.ts",
    },
    mac: {
      icons: "src/native/icons/cloud.iconset",
    },
    linux: {
      icon: "src/native/icons/cloud.png",
    },
    views: {
      "desktop-bridge": {
        entrypoint: "src/native/electrobun/preload.ts",
      },
    },
    copy: {
      "dist/renderer/index.html": "views/desktop-lab/index.html",
      "dist/renderer/assets": "views/desktop-lab/assets",
    },
    watch: ["src", "../cloud/src/desktop", "../cloud/src/ui", "../cloud/src/styles"],
    watchIgnore: ["dist/**", ".local/**"],
  },
  scripts: {
    preBuild: "src/build.ts",
  },
} satisfies ElectrobunConfig;
