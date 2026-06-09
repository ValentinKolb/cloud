import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { venueService } from "../service";
import VenueLayoutHelp from "./_components/help/VenueLayoutHelp.island";
import VenueOverview from "./_components/VenueOverview.island";

export default ssr<AuthContext>(async (c) => {
  const venues = await venueService.venues.list(c.get("user"));
  const templates = venueService.venueTemplates.list();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Venues" }]}>
      <VenueLayoutHelp />
      <VenueOverview venues={venues} templates={templates} />
    </Layout>
  );
});
