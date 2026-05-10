/**
 * Records page scoped to a saved view —
 * `/app/grids/<base>/table/<table>/view/<view>`. Re-exports the base
 * page.tsx handler; Hono populates `tableId` AND `viewId` from the
 * path-segment names and the handler reads them via
 * `c.req.param("tableId" / "viewId")`. See ../../page.tsx for the
 * single-source rationale.
 */
export { default } from "../../../../page";
