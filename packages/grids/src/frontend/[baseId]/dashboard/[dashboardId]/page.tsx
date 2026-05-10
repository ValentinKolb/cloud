/**
 * Dashboard render page —
 * `/app/grids/<base>/dashboard/<dashboard>`. Re-exports the base
 * page.tsx handler so the dashboard-vs-records-vs-default branching
 * stays in one place; Hono dispatches this file when the URL pins a
 * dashboard segment, and the handler reads `dashboardId` from
 * `c.req.param("dashboardId")` to render dashboard mode.
 */
export { default } from "../../page";
