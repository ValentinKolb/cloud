# Cloud visual design system

This page defines the visual and interaction rules for Cloud core UI and built-in apps. Read it before changing shared styles, layout primitives, or an app surface.

## Scope

Use this page for visual decisions: hierarchy, spacing, surfaces, colour roles, interaction states, responsive behaviour, and design review. Use `app-ui-patterns.md` to choose a shell and `frontend.md` for component APIs.

The system serves people who move between many Cloud apps in one session. Every app must feel like Cloud while remaining identifiable at a glance.

## Design thesis

Cloud uses a quiet coloured canvas with a small number of soft work surfaces. Content stays neutral and readable; app identity is strongest near the rail and outer canvas and becomes quieter toward the main work area.

The interface follows five rules:

1. **Less, but better.** Remove decoration before reducing clarity. Each visible element needs one job.
2. **Structure carries hierarchy.** Spacing, grouping, type weight, and surface placement come before borders and colour.
3. **Colour carries meaning.** App identity, actions, status, and data use separate colour roles.
4. **Density follows the task.** Navigation and workspaces stay compact; forms and reading surfaces get more breathing room.
5. **The whole flow is designed.** Desktop, mobile, empty, loading, error, hover, focus, selected, and dark states belong to the same component contract.

## Visual signature

The app canvas is the signature element. A restrained edge-to-neutral-to-edge tint identifies the active app without colouring the content surface. Papers remain neutral. The active rail item and workspace identity icon repeat the app accent at a smaller scale.

```text
app colour          neutral work area          app colour
██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒██████
 rail       [ quiet nav | neutral main | quiet detail ]
                         one workbench frame
```

Do not add gradients inside ordinary cards, tables, kanban columns, or form fields. Assistant-specific AI surfaces may use the shared AI treatment when the gradient communicates an AI action.

## Semantic colour roles

Keep these roles independent:

- **Canvas:** the app-level background and optional gradient from `defineApp({ appearance })`.
- **Identity accent:** active rail item, workspace identity icon, active sidebar marker, and launchpad icon.
- **Action hierarchy:** primary actions, links, focus, and selection stay platform-consistent and independent from app identity. They may use different treatments when their interaction roles differ.
- **Status:** success, warning, danger, and information. Status colour never identifies an app.
- **Data:** categories, series, severity, and other domain values. Data colour must remain legible without relying on colour alone.

An app accent must not recolour every primary button. A red app accent must not make normal navigation look destructive. Status and data colours must not leak into the page canvas.

## Tokens

Shared components consume semantic tokens instead of hard-coded neutral colours, radii, or shadows. Token names describe purpose, not the current colour value.

### Surfaces

- `--ui-canvas`: neutral page fallback below the app canvas.
- `--ui-surface`: primary paper surface.
- `--ui-surface-subtle`: sidebar, header well, and quiet grouped content.
- `--ui-surface-raised`: floating or emphasized surface.
- `--ui-border`: default surface boundary.
- `--ui-border-strong`: functional dividers and emphasized boundaries.

### Geometry

- `--ui-radius-frame`: workspace, large dialog, and major shell radius.
- `--ui-radius-surface`: paper, panel, and card radius.
- `--ui-radius-control`: button, field, tab, and compact action radius.
- `--ui-control-sm` and `--ui-control-md`: shared control heights.
- `--ui-space-shell`, `--ui-space-section`, and `--ui-space-control`: the three layout spacing levels.

Use one radius family. A child may use the same radius as its parent only when they do not visually nest. Nested elements step down from frame to surface to control.

### Interaction

- `--ui-hover`: neutral hover tint.
- `--ui-active`: neutral pressed tint.
- `--ui-selected`: selected-row or active-tab tint.
- `--ui-focus`: visible keyboard focus ring.
- `--ui-shadow-surface`: subtle in-flow depth.
- `--ui-shadow-frame`: restrained depth reserved for unified workspace frames.
- `--ui-shadow-float`: dialogs, popovers, menus, and toasts.

### Actions, fields, and compact controls

- `--ui-action-primary-*`: surface, text, border, hover, and active roles for the main forward or write action. The soft system uses a high-contrast neutral treatment so app and status colours keep their meaning.
- `--ui-field`, `--ui-field-border`: resting field well.
- `--ui-field-hover`, `--ui-field-hover-border`: pointer hover without implying focus.
- `--ui-field-focus`, `--ui-field-focus-border`: focused editing surface; combine with `--ui-focus` for keyboard visibility.
- `--ui-divider`: functional separators inside compound controls such as editor toolbars.
- `--ui-control-recess`: shared field depth; the soft system may set it to `none`.
- `--ui-check-*`: checkbox surface, boundary, depth, and hover movement.

Inputs, autocomplete surfaces, and editors must consume the same field roles. Component-specific error, syntax, AI, and checked states may layer meaning on top; they must not redefine the resting neutral state.

### Data and floating layers

- `--ui-data-header`, `--ui-data-divider`, `--ui-data-row-divider`: table structure without decorative grid chrome.
- `--ui-data-row-hover`, `--ui-data-row-selected`, `--ui-data-column-hover`: independent interactive states; selection must remain distinguishable while scanning.
- `--ui-dialog-*`: panel surface, boundary, internal divider, section well, icon well, and frame radius.
- `--ui-context-menu-*`, `--ui-dropdown-menu-*`: floating menu surface, geometry, and depth.
- `--ui-menu-border`, `--ui-menu-hover`, `--ui-menu-divider`: shared menu interaction and grouping roles.

Data colour belongs inside cells and charts, never in the structural table roles. Floating layers may use stronger depth than in-flow papers, but their menus and dialogs still share the same radius family and spacing rhythm.

### State feedback

- `--ui-state-icon-*`: the quiet icon well used by panel-sized empty, loading, and error states.
- `--ui-state-error-icon-*`: error emphasis inside that well; text and iconography still carry the meaning without colour.
- `--ui-progress-track`, `--ui-progress-track-shadow`: the neutral progress channel.
- `--ui-progress-primary`, `--ui-progress-success`, `--ui-progress-danger`: action and status fills kept separate from app identity.
- `--ui-tooltip-*`: compact, high-contrast top-layer surface, boundary, type colour, radius, and depth.

### Compact navigation

- `--ui-segment-*`: grouped radio surface, internal divider, hover, active surface, radius, and depth.
- `--ui-pagination-*`: page hover and current-page surface, border, and text roles.

Segmented controls and pagination share density and focus rhythm, not semantics. A segmented control changes one local mode; pagination navigates to another resource page.

## Surfaces and borders

Use surfaces to group content. Use borders only when they explain structure.

- `paper` is the default in-flow surface.
- A workspace is one clipped workbench frame. Sidebar, main, and detail are internal sibling regions, not three adjacent papers.
- Detail panels use a transparent `detail-stack` containing separate `detail-section` papers.
- Inputs are quiet wells. They need a clear focus state, not a permanently strong outline.
- Floating layers use one outer shadow and a boundary that remains visible in dark mode.
- Data-table row separators and key-value dividers are functional and may remain visible.

Do not stack papers to manufacture hierarchy. In-flow papers use a boundary without an outer shadow; reserve frame depth for unified workspaces and floating depth for overlays. Do not add a border and shadow when either one already separates the surface. Do not place a full-page paper inside another full-page paper.

## Spacing and density

Spacing is part of component behaviour. Do not tune it independently in each app.

- Use the shell gap between major sibling regions.
- Use the section gap between cards or logical content groups.
- Use the control gap between icons, labels, fields, and toolbar actions.
- Keep workspace navigation compact enough to scan without feeling cramped.
- Give forms enough vertical space for labels, descriptions, errors, and touch targets.
- Align title baselines, icon centres, and control heights. Optical alignment wins when mathematical centring looks wrong.

Avoid generic `p-4` wrappers inside `AppWorkspace.Main`. The shell owns outer spacing. Components own their inner spacing.

## Typography

Use IBM Plex Sans for interface text, IBM Plex Mono for code and technical identifiers, and IBM Plex Sans Condensed only for dense labels that need it.

- Page titles establish the current task, not the product brand.
- Workspace names use a compact semibold treatment.
- Section labels are quiet and short; uppercase is reserved for dense factual group labels.
- Body text uses normal weight. Do not make every navigation label semibold.
- Numbers use tabular figures. Right-align comparable numeric table columns.
- Truncation requires a discoverable full value through an accessible label, tooltip, or detail view.

## Platform shell

### Rail

The rail shares the canvas background. It must not introduce a subtly different tint. Icons are centred in the rail's actual width, independent of content margins.

The active app uses an accent-coloured icon and a quiet boundary or low-tint state. Avoid a large dark filled tile. Search, help, theme, and launchpad actions remain neutral until hover or focus.

### Breadcrumb header

The breadcrumb header is compact, neutral, and clearly separated from the canvas. It does not repeat the app icon. Desktop padding balances the rail; mobile keeps a smaller touch-safe layout.

Breadcrumbs communicate location. Hide intermediate crumbs on narrow screens before truncating the current page title.

### App canvas

App appearance is defined once in `defineApp({ appearance })`. Prefer a three-stop colour-to-neutral-to-colour gradient when both edge colours matter. Keep the middle content region close to neutral.

Dark mode mixes appearance colours into the dark canvas; it does not invert a light gradient or use white as the middle stop.

## App workspace

`AppWorkspace` is the standard full-height work shell.

- The workspace root owns the outer radius, clipping, surface, and depth.
- Sidebar, main, and detail are siblings inside that single frame; they do not have independent outer radii or shadows.
- Sidebar and detail use the quiet surface role while main remains neutral. This tone change replaces decorative dividers between regions.
- Shell spacing separates the workspace from the platform chrome. Section spacing organizes content inside its regions; there is no shell gap between the regions themselves.
- The sidebar owns navigation scrolling.
- Main owns the primary work scroll unless the screen contains independent panes or tables.
- Detail selection is URL-backed when it must survive reload, sharing, and browser history.

### Workspace header

The header identifies the current resource, not the app twice.

- Resource-based apps show the resource name and a small identity icon.
- Single-view apps may set `showDesktop={false}` when the app title would be redundant.
- The identity icon uses a low-tint accent surface with an accent glyph. Avoid a large solid square.
- Secondary settings actions are compact and quiet. Show stronger emphasis on hover and focus.
- Do not add a divider below the header unless content can scroll independently beneath it and the boundary clarifies that behaviour.

### Sidebar navigation

- Active items combine a quiet selected surface with a small identity marker.
- Hover is neutral; danger and success tones are reserved for actions with those meanings.
- Row actions use progressive disclosure but remain keyboard accessible.
- Section labels organize real groups. Do not add a label above one self-explanatory item.
- Counts align and use tabular figures.

## Controls

### Buttons

- Primary buttons represent the main write or forward action.
- Secondary buttons support the primary action.
- Ghost buttons suit toolbars and progressive actions.
- Danger buttons appear only for destructive actions.
- Icon-only buttons need an accessible name and a shared tooltip.

The soft system uses a high-contrast neutral primary button instead of app colour. Success and danger treatments remain reserved for their semantic meanings; a normal save or create action is neither green nor red.

Buttons should feel responsive through colour and a small pressed-state change. Avoid glossy bevels, dramatic scaling, and multiple competing shadows.

### Inputs

Use Cloud input components, including `Select`; do not substitute native controls for convenience.

- Labels describe the value. Descriptions explain consequences or format.
- Fields share height, radius, padding, focus, disabled, and error treatment.
- A focused field shows one continuous focus indicator. Do not combine differently coloured borders and rings on the same edge.
- Prefixes and suffixes stay visually secondary to the value.
- Search keeps focus while results update.
- Error text states what needs correction.

## Data surfaces

### Tables

Use `DataTable` for tabular data.

- Left-align text and right-align comparable numbers.
- Use chips for bounded categories and status when they improve scanning.
- Keep row hover and selection distinct.
- Put rare row actions behind hover, focus, or an overflow menu.
- Preserve horizontal scrolling on narrow screens instead of compressing columns beyond recognition.
- Use timelines for events where sequence and elapsed time matter more than field comparison.

### Detail panels

- Render only sections that contain data.
- Put identity and primary actions in the first section.
- Group contact rows, facts, activity, and metadata into separate sections.
- Inside the unified workspace, detail sections separate through surface tone and spacing rather than repeated outer shadows.
- Use `StructuredDataPreview` for small JSON-like values.
- Close controls and contextual actions stay reachable on mobile.

## Floating layers

Dialogs, popovers, dropdowns, tooltips, and toasts share one geometry and depth language.

- Use the smallest dialog shell that fits the task.
- Keep one visible outer frame; avoid nested modal papers.
- Headers and footers stay fixed only when the body scrolls.
- Popovers align with their trigger and flip before overflowing the viewport.
- Tooltips explain unfamiliar icon actions. They do not repeat visible labels.
- Use `Tooltip` for short, non-interactive hints. Keep the control's accessible name on the control itself; the tooltip supplements it through `aria-describedby`.
- Tooltips open from hover and keyboard focus, stay inside the viewport, and close on Escape, blur, pointerdown, scroll, or resize.
- If the hint needs an action, form field, or selectable content, use a popover or dialog instead.
- Menu triggers expose `aria-expanded`; Arrow keys, Home, and End move between menu items without entering the page tab order.
- Escape closes the top floating layer and returns focus to its trigger.

## Progressive disclosure

Visibility follows frequency and risk:

- Primary actions remain visible.
- Frequent filters and view controls remain visible near the data they affect.
- Row-level edit, copy, remove, and overflow actions appear on hover and keyboard focus.
- Rare configuration belongs in popovers, settings, or detail panels.
- Destructive actions require clear wording and confirmation when reversal is not available.

Hidden actions must still be discoverable through focus, tooltips, menus, or conventional placement.

## Compact navigation

- Use `SegmentedControl` for a small set of mutually exclusive local modes. Arrow keys wrap; Home and End move both selection and focus.
- Use `Pagination` for server-backed result pages. The current page is not a link; previous and next remain explicit navigation targets.
- Desktop may show neighbouring pages and ellipses. Mobile keeps previous, first, current, last, and next so touch targets remain usable without squeezing.
- Keep pagination inside its own overflow boundary as a final safeguard; it must never widen the page.

## Empty, loading, and error states

Use `Placeholder` for state feedback instead of drawing app-local empty cards.

- Compact placeholders belong inside tables, sidebars, and small sections. Panel placeholders may identify a whole work area and contain one next action.
- Empty states explain what is absent and, when useful, what the user can do next.
- Loading states use `state="loading"`, expose polite status semantics, and avoid replacing stable content with a large spinner during background refreshes.
- Error states use `state="error"`, name what failed, and offer a recovery action when one exists. Colour supplements the alert icon and wording.
- Determinate work uses `ProgressBar` with a task-specific accessible `label`; the visible percentage remains the primary measure.

## Responsive behaviour

Mobile is a composed state, not a squeezed desktop layout.

- The desktop rail becomes the mobile app/menu trigger.
- Sidebar content moves into the shared mobile navigation surface.
- An open detail replaces the main view below the desktop breakpoint by default. Screens that deliberately stack detail and main must compose that mobile state explicitly; detail never becomes an unreadably narrow third column.
- Toolbars wrap by priority. Search expands before secondary icon actions.
- Tables scroll horizontally inside their own region.
- Touch targets remain usable even when desktop density is compact.
- Safe-area and viewport-height behaviour must work with mobile browser chrome.

## Dark mode

Dark mode preserves hierarchy rather than reversing colours.

- Surfaces separate through small luminance differences.
- Borders become quieter, not brighter.
- App identity remains recognizable without glowing.
- Focus, selection, status, and disabled states retain their relative emphasis.
- Shadows use lower spread and higher opacity only where needed to separate floating layers.

Every visual change is reviewed in light and dark mode together.

## Accessibility

- Keyboard focus is always visible.
- Icon-only actions have accessible names.
- Tooltips supplement labels; they never carry required information alone.
- Colour is never the only status or selection signal.
- Selected tabs, rows, and navigation expose semantic state.
- Reduced-motion users do not receive decorative transitions.
- Truncated content remains available through an accessible path.

## Preview and rollout

The redesign is initially scoped to UI Lab.

```tsx
<AppWorkspace class="cloud-ui-soft ...">
```

The shared canvas detects the marker and applies preview token values to the full shell:

```css
.cloud-app-canvas:has(.cloud-ui-soft) {
  /* Preview token overrides. */
}
```

Normal `:root` and `.dark` tokens keep the current production values. The preview must not add component props, app config flags, or app-specific style copies.

After visual and interaction review, promote the preview values to the normal tokens and remove `cloud-ui-soft`. That global activation is a separate change because every app inherits it.

## Parallel work rules

- Do not edit an app to make a core preview look correct.
- Do not touch files already modified by another active change.
- Keep public component APIs stable during token migration.
- Recheck `git status` before every slice and before staging.
- Stage exact owned paths.
- Review representative apps before global activation.

## Review checklist

Before accepting a component or screen:

- Does hierarchy work without decorative colour or extra borders?
- Are spacing, padding, radius, and control heights from shared roles?
- Is app identity visible but kept out of content surfaces?
- Are hover, focus, active, selected, disabled, loading, empty, and error states covered?
- Does progressive disclosure work with pointer and keyboard?
- Does the layout work on desktop and mobile without page-level overflow?
- Does dark mode preserve the same hierarchy?
- Are tooltips and accessible names present where icon meaning is not obvious?
- Does the component reuse the closest Cloud primitive instead of recreating it?
