import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { venueService } from "../service";
import VenueOverview from "./_components/VenueOverview.island";

export default ssr<AuthContext>(async (c) => {
  const venues = await venueService.venues.list(expectUserBackedActor(c));
  const templates = venueService.venueTemplates.list();
  const initialQuery = (c.req.query("q") ?? "").trim();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Venues" }]}>
      <VenueOverview venues={venues} templates={templates} initialQuery={initialQuery} />
    </Layout>
  );
});
