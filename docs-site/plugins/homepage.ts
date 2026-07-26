import type { FibelPlugin } from "@valentinkolb/fibel";

export function homepagePlugin(): FibelPlugin {
  return {
    name: "cloud-site",
    setup(context) {
      const stylesheet = `${context.config.routing.basePath}${context.config.routing.assetsPath}/homepage.css`;
      context.headTags.push(() => `<link rel="stylesheet" href="${stylesheet}">`);

      const renderPage = context.services.renderPage;
      context.services.renderPage = (page, request, currentContext) => {
        const html = renderPage(page, request, currentContext);
        return html.replace('<body class="', '<body class="cloud-site ');
      };
    },
  };
}
