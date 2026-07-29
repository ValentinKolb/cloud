import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/ai";

export default function AiCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
