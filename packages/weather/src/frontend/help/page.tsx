import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { weatherHelp } from "../../help";
import WeatherLayoutHelp from "../_components/help/WeatherLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = weatherHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Weather help";
  return () => <WeatherLayoutHelp documents={weatherHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
