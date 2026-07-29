import { ssr } from "./config";
import Demo from "./StandaloneUi.island";

export default ssr((context) => {
  context.get("page").title = "@k2b/ui standalone fixture";
  return () => <Demo />;
});
