import { Layout } from "@valentinkolb/cloud/ssr";
import { NotFoundState } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import { coreHelp } from "../help";
import CoreLayoutHelp from "./CoreLayoutHelp.island";

/** 404 Not Found page. */
export default ssr((c) => {
  c.status(404);
  return () => (
    <Layout c={c} title="Page Not Found">
      <CoreLayoutHelp documents={coreHelp.manifest} />
      <NotFoundState
        code="404"
        title="Oops, nothing here!"
        description="This page took a wrong turn somewhere."
        action={{ label: "Take me home", href: "/" }}
      />
    </Layout>
  );
});
