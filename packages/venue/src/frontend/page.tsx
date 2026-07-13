import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../config";
import { venueService } from "../service";
import VenueLayoutHelp from "./_components/help/VenueLayoutHelp.island";
import VenueOverview from "./_components/VenueOverview.island";

export default ssr<AuthContext>(async (c) => {
  const venues = await venueService.venues.list(expectUserBackedActor(c));
  const templates = venueService.venueTemplates.list();
  const initialQuery = (c.req.query("q") ?? "").trim();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Venues" }]}>
      <VenueLayoutHelp />
      <VenueOverview venues={venues} templates={templates} initialQuery={initialQuery} />
    </Layout>
  );
});
