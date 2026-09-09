---
name: Clinical Pharmacy Unit
description: The ward medication chart, digitized — a calm, clinical Arabic RTL tool for the morning dose round.
colors:
  green-50: "#eef6f1"
  green-100: "#d9ece1"
  green-200: "#b2d8c6"
  green-300: "#7fbfa4"
  green-400: "#3f9c78"
  green-500: "#087c54"
  green-600: "#0a6b4a"
  green-700: "#08543b"
  green-800: "#064d3e"
  green-900: "#053a2f"
  bg: "#f5f8f6"
  surface: "#ffffff"
  surface-alt: "#f0f5f2"
  border: "#dbe6df"
  border-strong: "#b9cdc2"
  text: "#132a27"
  text-muted: "#4f6b63"
  heading: "#064d3e"
  primary: "#087c54"
  primary-hover: "#08543b"
  primary-tint: "#087c541f"
  danger: "#c92a33"
  danger-tint: "#c92a3316"
  success: "#0a7d51"
  success-tint: "#0a7d5116"
  warning: "#a86400"
  warning-tint: "#a8640016"
typography:
  display:
    fontFamily: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif"
    fontSize: "clamp(24px, 3vw, 28px)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
  caption:
    fontFamily: "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "40px"
  "8": "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.green-50}"
    textColor: "{colors.primary-hover}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  status-pill:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.warning}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "40px"
    width: "min(100%, 420px)"
---

# Design System: Clinical Pharmacy Unit

## Overview

**Creative North Star: "The Ward Clipboard"**

This is the paper medication chart, digitized — and it earns its place by being faster than paper, never by being prettier than it. The whole system is calm and clinical: a soft green-tinted ground, one 10-step green ramp doing almost all the work, hairline borders, and text that stays legible for a tired pharmacist reading a shared tablet at 6am under ward lighting, sometimes through a glove. Nothing is decorative. Every surface is either a control, a value, or the structure that holds them.

Density is moderate, not cramped: generous line-height on running text (1.65), real gaps between groups, touch targets sized for a gloved thumb (44px on anything you press). The palette is quiet by design — the strong greens (500–800) are reserved for headings, primary actions, and the one "do this next" button per card; everything else lives in the 50–200 tints and the neutral surfaces. Colour never carries meaning alone: a status is always a word or an icon first (بدأت / لم تبدأ / اكتملت), with hue as a second channel.

The interface is bilingual-script but Arabic-first and fully RTL. It uses logical properties throughout (`margin-inline-start`, `padding-inline`) so the one place a physical direction appears — the progress-bar fill origin — is a deliberate, commented exception. There is a full dark theme, toggled on `<html data-theme="dark">`, that overrides only the semantic tokens (surfaces, text, intents, the top three green steps, shadows) and leaves structure untouched.

**Key Characteristics:**
- One brand hue (Pharmacy Green `#087c54`) with a 10-step ramp; no secondary or tertiary accent.
- Flat by default; a raised shadow is a *response* to interaction, not a resting state.
- Worded status over colour-coded status, always — a shared-device / glare / gloves constraint.
- Restrained components: 6–14px radii, 1px borders, quiet state changes (colour, border, a 1px press).
- Arabic RTL, IBM Plex Sans Arabic, logical properties, full dark theme.
- The printed A4 chart is a first-class output; its `@media print` CSS is frozen.

## Colors

A single clinical green does nearly everything; the rest is warm-grey neutrals and three tightly-scoped intent colours.

### Primary
- **Pharmacy Green** (`#087c54`, `green-500`): the brand hue and the one accent. As a solid fill it marks the single primary action in a group ("open the chart", "save"). Its darker steps carry weight: `green-700` (`#08543b`) is `primary-hover` and the text colour on secondary/tint buttons; `green-800` (`#064d3e`) is every heading (`--heading`).
- **Green ramp** (`green-50 #eef6f1` → `green-900 #053a2f`): a 10-step tonal scale. The 50–200 tints are the working range — icon badges (`green-100`), secondary-button grounds (`green-50`), the "partial / in progress" status pill (`green-100`), the special-ward card badge (`green-200`), skeleton shimmer. `green-300` is the hover border on interactive cards.

### Neutral
- **Ward Ground** (`bg #f5f8f6`): the page background — an almost-white green-grey, calmer than pure white.
- **Surface** (`#ffffff`): cards, the top bar, modals, inputs — anything that should read as "a thing on the ground".
- **Surface Alt** (`surface-alt #f0f5f2`): recessed / inset areas — announcement items, the "no loud button" ward-card ground, the data-unavailable status pill, close-button hover.
- **Ink** (`text #132a27`): body text. **Muted Ink** (`text-muted #4f6b63`): meta, timestamps, secondary labels, ghost-button text, `<small>`.
- **Hairline** (`border #dbe6df`) and **Strong Hairline** (`border-strong #b9cdc2`): the 1px borders that do the structural work shadows don't. Strong hairline is for inputs and table cells; plain hairline for cards and dividers.

### Intent (each tightly scoped)
- **Alarm Red** (`danger #c92a33`, `danger-tint #c92a3316`): genuine errors and destructive actions only — form errors, the delete button, the "حذف" affordance. It was deliberately removed from the context/eyebrow role once (`.modal-kicker` replaced `.eyebrow`); it does not do emphasis.
- **Confirm Green** (`success #0a7d51`, `success-tint`): a completed state — "اكتملت", the all-wards-done band, a saved confirmation. Distinct from Pharmacy Green in role: `success` says *finished*, `primary` says *act here*.
- **Attention Amber** (`warning #a86400`, `warning-tint`): "not started yet" and unresolved states — the pending status pill, pending ward chips, the cross-device merge frame. Never an error; a to-do.

### Named Rules
**The One Hue Rule.** There is exactly one brand colour. If a screen seems to need a second accent, it needs better hierarchy in the green ramp instead — not a new hue.

**The Worded-Status Rule.** Every status is a word or an icon first (`بدأت`, `لم تبدأ`, `اكتملت`, `تعذّر…`), with colour as reinforcement. A pill that would carry meaning by hue alone is incomplete. (Grounded in the product's shared-device / glare / gloves reality.)

**The Red-Means-Error Rule.** `danger` / red is reserved for real errors and destructive actions. Not counts, not emphasis, not "overdue".

## Typography

**Display / Body / Label Font:** IBM Plex Sans Arabic (self-hosted via `@fontsource`, Arabic + Latin, weights 400/500/600/700), falling back to `'IBM Plex Sans', 'Geeza Pro', 'Segoe UI', system-ui, sans-serif`.

**Character:** One family, four working sizes. Plex Sans Arabic is humanist, even-colour, and highly legible at small sizes in both scripts — which is the whole requirement. There is no display/serif voice; the tool has no "hero" moment. `font-synthesis: none` and `text-rendering: optimizeLegibility` are set globally so faux-bold never appears.

### Hierarchy
- **Display** (700, `clamp(24px, 3vw, 28px)`, line-height 1.25): the single `<h1>` per screen — "اختر الطابق أو الردهة", "الطابق ٣", a ward name on the chart. Colour `--heading` (`green-800`).
- **Title** (700, 18px / `--text-lg`, line-height ~1.3): `<h2>`, card names, the ward-status count. Also `--heading`.
- **Body** (400, 15px / `--text-base`, line-height 1.65): running text, dialog messages, announcement bodies. `--text` ink.
- **Label** (700, 13px / `--text-sm`): form labels (which are `display:grid` with an 8px gap above their control), button text, table headers, the date-chip value.
- **Caption** (700, 12px / `--text-xs`): status pills, chips, timestamps, `<small>` helper text, the widget period toggles. Almost always `--text-muted` unless it's a coloured pill.

### Named Rules
**The Bold-Label Rule.** Labels, buttons, chips and table headers are weight 700 even at 12–13px — small text in this tool is functional and must not recede. Body copy is the only thing set at 400.

## Layout

**Container.** Screen content sits in `width: min(100% - 40px, 1380px)` centred, with `56px` (`--space-8`) of vertical padding. The top bar spans full width with fluid inline padding (`clamp(16px, 5vw, 56px)`).

**Grids.**
- Picker cards: `repeat(auto-fit, minmax(min(100%, 245px), 1fr))` with a `12px` gap — one column on narrow screens, as many 245px+ cards as fit otherwise.
- Dashboard widgets: a fixed 2-column grid that collapses to 1 column at `max-width: 900px`.
- The medication chart is its own fixed 41×51 structure, outside this system's flow rules.

**Spacing rhythm.** An 8px-based scale with a deliberately non-linear top end: `4, 8, 12, 16, 24, 32, 40, 56`. Tight values (4–12) bind a control to its label or an icon to its text; 16–24 separates peers; 40–56 separates major regions (grid ↔ secondary widgets is `--space-8`). More space sits above a heading than below it.

**Direction.** RTL throughout. Layout uses logical properties (`margin-inline-*`, `padding-inline`, `inset-inline-*`, `text-align: start`) so the same CSS serves the script direction. `prefers-reduced-motion` collapses all animation/transition durations to ~0.

## Elevation & Depth

Flat by default. Surfaces rest on a **1px border** and, at most, a **hairline shadow** (`--shadow-xs`). Depth is mostly tonal — the green ramp and the `surface` / `surface-alt` / `bg` triad do the layering that shadows do elsewhere.

A stronger shadow is a **response to interaction, never a resting state**: `--shadow-sm` appears only when you hover or focus something you can act on (a floor card lifts `translateY(-3px)` and gains `--shadow-sm`; its chevron slides `-3px`). Modals are the one deliberate exception — they carry `--shadow-md` at rest because they must detach from an inert background.

### Shadow Vocabulary
- **Hairline** (`--shadow-xs`: `0 1px 2px #0f2f2410, 0 1px 1px #0f2f240a`): the resting shadow on cards, the top bar, the date chip, widgets. Barely-there; it separates a surface from the ground without announcing itself.
- **Lifted** (`--shadow-sm`: `0 2px 8px #12332612, 0 1px 3px #1233260f`): hover/focus on an interactive card only.
- **Floating** (`--shadow-md`: `0 12px 32px #12332618, 0 4px 12px #12332612`): modals and the confirm dialog, at rest.

Dark theme replaces all three with higher-opacity black-based values.

### Named Rules
**The Flat-By-Default Rule.** If an element has a shadow bigger than `--shadow-xs` and it is not a modal, it must be because the user is interacting with it *right now*. Remove the hover and the shadow goes back to hairline.

## Shapes

Gently rounded, never sharp, never pill-everything. Three container radii — `sm 6px` (inputs, table cells, small buttons-in-tables, badges), `md 10px` (buttons, cards, icon badges, the top bar's own hit areas), `lg 14px` (the ward-status band, modals, empty states, the login panel). Fully-round (`999px`) is reserved for genuinely pill-shaped things: status pills, chips, the progress track, the period toggles, the theme toggle.

Borders are the primary structural device: `1px solid` in `--border` for cards and dividers, `--border-strong` for inputs and data tables, `2px`–`2.5px` in `--warning` for the "something happened" frames (cross-device merge, conflict review). Dashed `1px --border-strong` marks an empty state.

Icons are drawn inline SVG in one family — `1.75` stroke width, round caps/joins, a soft `0.14`-opacity `currentColor` fill — shared across the ward glyph, the chevron, the check, and the dashboard-widget icons so the picker and the widgets read as one system.

### Named Rules
**The Radius-By-Size Rule.** Radius tracks the element's size, not its importance: small controls get `6px`, mid `10px`, large panels `14px`, and only truly pill-shaped elements get `999px`.

## Components

### Buttons
- **Shape:** gently rounded (`10px` / `--radius-md`); `padding: 10px 18px`; `font-weight: 700`, `13px`; `inline-flex` centred with an `8px` gap for an optional icon. `.compact` variants inside dense rows get `min-height: 44px` and `white-space: nowrap`.
- **Primary:** solid Pharmacy Green (`--primary`) with white text and `--shadow-xs`. Exactly one per card or action group — it means "do this next".
- **Secondary:** `green-50` ground, `green-200` border, `primary-hover` text. The default weight for "another thing you can do here".
- **Ghost** (`.chart-extra-button`): transparent, `border-strong` border, muted text — the quietest tier, for an optional/secondary path that shouldn't compete before it's relevant.
- **Text / Back** (`.text-button`, `.back-button`): no border/fill, `--primary` text, tints `green-50` on hover.
- **Danger** (`.danger-button`): `danger-tint` ground, `danger` text — destructive only.
- **Hover / Focus:** background/border shift over `--dur-fast` (`.14s`); `:active` nudges `translateY(1px)`. Global `:focus-visible` is a `2px --primary` outline at `2px` offset; inputs swap that for a `3px --primary-tint` ring.

### Cards / Containers
- **Corner:** `10px` (`--radius-md`); large panels `14px`.
- **Background:** `--surface` on `--bg`; recessed containers use `--surface-alt`.
- **Border:** `1px solid --border`. **Shadow:** `--shadow-xs` at rest (see Elevation).
- **Padding:** `16px 24px` (`--space-4 --space-5`).
- **Interactive card** (`.location-card--link`): whole card is a `<button>`; hover/focus lifts `translateY(-3px)` + `--shadow-sm`, border → `green-300`, and a trailing chevron slides `-3px`. A card that only *contains* actions (its buttons do the work) stays flat, takes a `--surface-alt` ground, and does **not** lift — the lift is a promise of a click the card body must honour.

### Inputs / Fields
- **Style:** `1px solid --border-strong`, `--surface` ground, `6px` radius, `padding: 9px 12px`, `13px` text. `<select>` gets a custom inline-SVG chevron on the inline-end side and `appearance: none`.
- **Focus:** border → `--primary`, plus a `3px --primary-tint` ring (`--ring`). No outline (the ring replaces it).
- **Label:** `display: grid` with an `8px` gap so the label always sits directly above its field, weight 700, colour `--heading`.
- **Error:** `.form-error` — `danger` text on `danger-tint`, `role="alert"`. **Success:** `.form-success` — `success` on `success-tint`, `role="status"`.

### Chips / Status Pills
- **Style:** fully round (`999px`), `4px 10px` padding, `12px` weight-700 text, an optional leading `14px` inline-SVG check.
- **Variants** (`.card-status--*`): `pending` = `warning-tint` / `warning` ("not started"); `partial` = `green-100` / `primary-hover` ("2/3 started"); `done` = `success-tint` / `success` + check ("اكتملت"); `muted` = `surface-alt` / `text-muted` ("data unavailable"). Interactive chips in the status band (`.ward-status-chip`) are the same shape at `min-height: 44px` with a transparent border that fills on hover/focus.

### Navigation
- **Top bar:** full-width `--surface` strip, `1px` bottom `--border`, fluid inline padding. The brand block is a `<button>` (title in `--heading` `15px` bold, subtitle `--text-muted` `12px`) that tints `green-50` on hover. Admin sections live behind a single `<details>` disclosure with Escape / outside-click / focus-return handling. There is no persistent side nav — navigation is the floor→ward→chart drill and a back button.

### Modal / Alert Dialog
- **Backdrop:** `position: fixed; inset: 0`, `#062b21a8` (deep green wash), `place-items: center`, `fade-in`.
- **Card:** `--surface`, `14px` radius, `--shadow-md`, `min(100%, 420px)`, `40px` padding, `modal-in` (opacity + `translateY(8px) scale(.98)`). Used for medicine registration and as the `window.confirm` replacement (`role="alertdialog"`, focus opens on Cancel, not the confirm).

### Signature: the medication chart
The 41-row × 51-column `<table>`-like grid is the product's reason to exist. It has its own dense rules (grid colour `--chart-grid`, sticky head, an inert "held" overlay with a `grayscale(.55)` backdrop-filter during cross-device merge) and a frozen `@media print` A4 layout. Treat it as a bounded sub-system, not an instance of the card/spacing rules above.

## Do's and Don'ts

### Do:
- **Do** build every new colour need out of the existing green ramp (`green-50`…`green-900`) plus the three intents. One hue.
- **Do** give every status a word or icon; use colour only to reinforce it (`.card-status` pattern).
- **Do** keep surfaces flat (`1px` border + `--shadow-xs`); add `--shadow-sm` only as a hover/focus response on something interactive.
- **Do** use exactly one solid `--primary` button per card or action group — the "do this next" control.
- **Do** use logical properties (`margin-inline-*`, `padding-inline`, `text-align: start`) so RTL is automatic; if you must use a physical direction, comment why.
- **Do** size anything pressable for a gloved thumb — `min-height: 44px` on buttons and chips in the working screens.
- **Do** carry the hospital identity (name + logo) on screens and every printed chart.
- **Do** provide a dark-theme value for any new *semantic* token (surface/text/intent), not for structural ones.

### Don't:
- **Don't** touch the `@media print` blocks for the chart or the pill form. That layout is frozen; change it only on explicit request and verify with headless Chrome.
- **Don't** use `danger` / red for anything that isn't a genuine error or a destructive action — not counts, not emphasis, not "overdue".
- **Don't** introduce a second accent hue, a gradient, or a display/serif typeface — there is no hero moment in this tool.
- **Don't** give a card a hover-lift unless the whole card is the click target.
- **Don't** translate, abbreviate, or "correct" the Arabic clinical vocabulary (جارت، الجارت الإضافي، ردهة، الحبوب، بدأت/لم تبدأ/اكتملت).
- **Don't** rely on shadows for depth where a border or a tonal step (`surface` vs `surface-alt`) will do.
