import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { ipaHostsHelp } from "../../help";
import HostsLayoutHelp from "../HostsLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = ipaHostsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "IPA Hosts help";
  return () => <HostsLayoutHelp documents={ipaHostsHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
