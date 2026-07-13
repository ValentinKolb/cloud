import { coreSettings } from "@valentinkolb/cloud/services";
import { ssr } from "../../../config";
import { venueService } from "../../../service";
import PublicVenuePage from "./PublicVenuePage.island";
import {
  buildPublicVenueFeedbackUrl,
  parseVenuePublicDisplayHeight,
  parseVenuePublicRefresh,
  resolveVenuePublicOrigin,
} from "../../public-runtime";

export default ssr(async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const slug = c.req.param("slug") ?? "";
  const status = slug ? await venueService.publicStatus(slug) : null;
  c.get("page").title = status?.venue.name ?? "Venue";

  const requestOrigin = new URL(c.req.raw.url).origin;
  const appUrl = await coreSettings.get<string>("app.url").catch(() => "");
  const origin = resolveVenuePublicOrigin(appUrl, requestOrigin);

  return () => (
    <PublicVenuePage
      slug={slug}
      initialStatus={status}
      displayHeight={parseVenuePublicDisplayHeight(c.req.query("height"))}
      feedbackUrl={buildPublicVenueFeedbackUrl(origin, slug)}
      refresh={parseVenuePublicRefresh(c.req.query("refresh"))}
    />
  );
});
