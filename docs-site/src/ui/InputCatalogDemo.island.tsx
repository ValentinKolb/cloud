import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/input";

export default function InputCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
