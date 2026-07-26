import type { FibelPlugin } from "@valentinkolb/fibel";

const homepageStylesheet = "/assets/homepage.css";
const homepageScript = "/assets/homepage.js";
const humans = `/* PROJECT */
Name: Cloud
Purpose: An open-source, on-premises application platform.
Source: https://github.com/ValentinKolb/cloud

/* SITE */
Runtime: Bun
Documentation: Fibel
Interface: HTML, CSS, and JavaScript

/* HELLO */
You found the human-readable endpoint.
The machines get /llms.txt.
`;

export function homepagePlugin(): FibelPlugin {
  return {
    name: "cloud-homepage",
    setup(context) {
      context.headTags.push(() =>
        `<link rel="stylesheet" href="${homepageStylesheet}">
    <script type="module" src="${homepageScript}"></script>`,
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
    routes() {
      return [
        {
          path: "/humans.txt",
          handler: () =>
            new Response(humans, {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        },
      ];
    },
  };
}
