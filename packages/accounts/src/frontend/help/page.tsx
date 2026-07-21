import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { accountsHelp } from "../../help";
import AccountsLayoutHelp from "../AccountsLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = accountsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Accounts help";
  return () => <AccountsLayoutHelp documents={accountsHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
