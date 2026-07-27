import { ssr } from "./config";
import Demo from "./Demo.island";

export default ssr((context) => {
  context.get("page").title = "@k2b/ui SSR fixture";
  return () => <Demo />;
});
