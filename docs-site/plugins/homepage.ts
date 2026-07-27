import type { FibelPlugin } from "@k2b/fibel";

export function homepagePlugin(): FibelPlugin {
  return {
    name: "cloud-site",
    setup(context) {
      const stylesheet = `${context.config.routing.basePath}${context.config.routing.assetsPath}/homepage.css`;
      context.headTags.push(() => `<link rel="stylesheet" href="${stylesheet}">`);
    },
  };
}
