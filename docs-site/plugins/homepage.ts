import type { FibelPlugin } from "@valentinkolb/fibel";

const homepageStylesheet = "/assets/homepage.css";

export function homepagePlugin(): FibelPlugin {
  return {
    name: "cloud-homepage",
    setup(context) {
      context.headTags.push(() =>
        `<link rel="stylesheet" href="${homepageStylesheet}">`,
      );

      const renderPage = context.services.renderPage;
      context.services.renderPage = (page, request, currentContext) => {
        const html = renderPage(page, request, currentContext);
        if (page.slug !== "/") {
          return html.replace('<body class="', '<body class="cloud-site ');
        }

        return html
          .replace(
            '<body class="',
            '<body class="cloud-site cloud-home-page ',
          )
          .replace(
            '<meta property="og:type" content="article">',
            '<meta property="og:type" content="website">',
          );
      };
    },
  };
}
