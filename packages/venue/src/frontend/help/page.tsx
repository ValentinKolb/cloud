import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { venueHelp } from "../../help";
import VenueLayoutHelp from "../_components/help/VenueLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = venueHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Venues help";
  return () => <VenueLayoutHelp documents={venueHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
