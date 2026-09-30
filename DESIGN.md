# Concord Design System

## 1. Atmosphere & Identity

Concord is a focused local workbench for editing OpenAPI contracts. Its visual language is compact, calm, and utilitarian: clear hierarchy, quiet surfaces, and teal reserved for actions and navigation. The dark theme keeps that same information density while using cool charcoal layers so the editor remains readable during long sessions.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Background | `--bg` | `#f5f6f6` | `#151a1c` | Application canvas |
| Surface | `--surface` | `#ffffff` | `#20282b` | Main panels and controls |
| Surface secondary | `--surface-2` | `#fafbfb` | `#293336` | Headers, cards, code gutters |
| Sidebar | `--sidebar` | `#eef1f1` | `#1b2326` | Explorer background |
| Border | `--line` | `#e0e4e6` | `#354246` | Dividers and subtle outlines |
| Border strong | `--line-strong` | `#c9d0d3` | `#4b5a5f` | Inputs and explicit boundaries |
| Text | `--text` | `#1b2326` | `#edf3f2` | Primary content |
| Muted text | `--muted` | `#64727a` | `#a5b4b8` | Secondary content |
| Accent | `--accent` | `#0f766e` | `#39b8a9` | Primary actions, links, focus |
| Accent hover | `--accent-hover` | `#0b625b` | `#64d4c5` | Hovered primary actions |
| Accent soft | `--accent-soft` | `#e2f1ee` | `#183d3a` | Selected and active washes |
| Error | `--danger` | `#b42318` | `#ff8177` | Destructive and error states |
| Warning | `--warn` | `#9a5b07` | `#e9b35a` | Warning states |
| Success | `--ok` | `#1b7a3a` | `#62d58a` | Success states |

The dark palette uses tinted charcoal rather than pure black. Semantic status colors remain distinct and are paired with a soft background token where the existing component needs one.

## 3. Typography

- Primary: `Bahnschrift, "Segoe UI", system-ui, -apple-system, Arial, sans-serif`
- Mono: `Consolas, "Cascadia Mono", "Courier New", monospace`
- Body: 14px with 1.45 line height.
- Compact labels: 11.5-13px; code: 12.5-13px.

## 4. Spacing & Layout

- Base unit: 4px, with the existing 6/8/10/12/16/20/26px values retained where they express the current dense workbench rhythm.
- App shell: fixed toolbar, two-column workspace, independently scrolling editor panes, and a collapsible validation panel.
- Responsive breakpoint: 899px switches the explorer to a drawer; 480px compresses the toolbar.
- Theme control is available as a direct toolbar toggle for quick switching; the settings dialog also retains the System/Light/Dark preference selector.

## 5. Components

### Theme preference
- **Structure**: sun/moon toggle in the toolbar plus a select field inside the existing settings dialog.
- **Variants**: Light, Dark, System.
- **States**: default, hovered, focused, changed, persisted.
- **Accessibility**: labelled icon button and native select; the button label describes the destination theme and color contrast follows the palette above.
- **Motion**: no layout animation; color transitions are omitted to avoid a flash during startup.

### Example contracts preference
- **Structure**: checkbox inside the existing settings dialog.
- **Variants**: shown or hidden in the New, Open, and Compare entry points.
- **States**: enabled by default, disabled, persisted.
- **Accessibility**: native checkbox with an explicit label; hiding examples does not remove the active initial contract.

### Workbench surfaces
- **Structure**: toolbar, sidebar, main editor, dialogs, menus, validation panel.
- **Variants**: light and dark token sets selected by `data-theme`.
- **States**: default, hover, selected, focus-visible, disabled, error, success.
- **Accessibility**: existing keyboard navigation and focus-visible ring are preserved.
- **Layout**: shell/sidebar/stack primitives; editor and validation regions own their own scrolling.

## 6. Motion & Interaction

- Existing 100-200ms transitions remain for controls and drawer movement.
- Theme changes update immediately and do not animate layout.
- `prefers-reduced-motion` continues to disable nonessential transitions and animations.

## 7. Depth & Surface

Mixed strategy: 1px borders establish the dense editor grid, while tonal shifts distinguish the canvas, panels, sidebar, and elevated dialogs. Existing shadows remain reserved for menus, drawers, and dialogs.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA: 4.5:1 body text contrast, 3:1 large text, visible keyboard focus, native controls, and reduced-motion support.
- The interface remains Spanish-only, matching the existing product constraint.
- Browser visual QA is manual because the repository has no UI test harness; core behavior remains covered by the existing Node test suite.
