import { coreSettings } from "@valentinkolb/cloud/services";
import { ssr } from "../../../config";
import { venueService } from "../../../service";
import {
  buildPublicVenueFeedbackUrl,
  parseVenuePublicDisplayHeight,
  parseVenuePublicRefresh,
  resolveVenuePublicOrigin,
} from "../../public-runtime";
import PublicVenuePage from "./PublicVenuePage.island";

export default ssr(async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const id = c.req.param("id") ?? "";
  const internalStatus = id ? await venueService.publicStatus(id) : null;
  const status = internalStatus ? await venueService.publicResources.projectPublicStatus(internalStatus) : null;
  c.get("page").title = status?.venue.name ?? "Venue";

  const requestOrigin = new URL(c.req.raw.url).origin;
  const appUrl = await coreSettings.get<string>("app.url").catch(() => "");
  const origin = resolveVenuePublicOrigin(appUrl, requestOrigin);

  return () => (
    <PublicVenuePage
      venueId={id}
      initialStatus={status}
      displayHeight={parseVenuePublicDisplayHeight(c.req.query("height"))}
      feedbackUrl={buildPublicVenueFeedbackUrl(origin, id)}
      refresh={parseVenuePublicRefresh(c.req.query("refresh"))}
    />
  );
});
