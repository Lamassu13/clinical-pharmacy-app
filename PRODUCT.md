# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: ward pharmacists on the morning dose round.** Each is assigned to exactly one floor (or one set of special wards) and works a shared ward tablet during the early-morning round — often a gloved hand, variable ward lighting, time pressure.
- **Unit managers / supervisors:** check which wards have started today's chart, and post / edit / delete team announcements.
- **Admins:** manage user accounts and roles, floor/ward assignment, the medicine registry, floor/ward configuration, and registration requests.
- Roles in the system: `admin` (مدير), `supervisor` (مسؤول), `user` (مستخدم).

## Product Purpose

Replaces the per-ward paper medication chart ("جارت"). A pharmacist opens the day's chart for their ward, records patients and medication quantities across the dose grid, and prints an A4 sheet. A good day is every ward's chart completed for the date, legible, and printable, before the round ends.

## Positioning

Built around the specific artifact and ritual of this teaching-hospital pharmacy round — the ward "جارت" as staff actually keep it: a fixed 41 patient-row × 51 column grid, weekday-keyed, one main chart plus an optional same-day second chart ("الجارت الإضافي"), in Arabic, on a shared ward device. It is not a general EHR, e-prescribing system, or inventory module; it digitizes one paper form and the round that produces it.

## Operating Context

- **Device / scene:** shared tablet used on the ward during the early-morning dose round. Gloved hand, glare, haste are the normal conditions, not edge cases.
- **Devices are mixed and not all new:** iPads (including older ones on iPadOS 14/15), Android tablets, and phones. Everything must work on all of them — the build targets Safari 14 / Chrome 87, and newer CSS such as `:has()` may only enhance, never be required.
- **Building:** 8 numbered floors (2–6, 8, 9, 10 — there is no floor 1 or 7), each with 2–3 sub-wards ("أروقة فرعية"), plus 3 independent special wards ("ردهة مستقلة"): dialysis (الديلزة), ICU (العناية المركزة), neonatal (الخدج). ~26 wards total.
- **Assignment:** one pharmacist ↔ one floor (or one set of special wards); the hub hides every card outside their assignment. Managers see the whole unit.
- **Core flow:** log in → floor/ward hub → pick floor → pick ward → open its "جارت" (main slot or "الجارت الإضافي" second slot) or its pill form ("الحبوب").
- **Charts:** per ward / date / slot, weekday-keyed, autosaved, versioned with conflict resolution; a chart can be copied forward to the next day.
- **Output:** a printed A4 sheet. Print layout is a fixed, separately-maintained concern.
- **Manager surface:** a "which wards have started today" status view (ward-granularity) plus the announcements feed.
- **Infrastructure:** React + Vite SPA, Express + external Postgres (Neon), deployed on Render, installable PWA. Requires an authenticated session.
- **Offline:** ward signal drops. The app opens offline as the last signed-in user, and charts, pill forms and «استمارة الحبوب الإضافي» keep working: edits are saved on the device and sent automatically when the signal returns. A chart this device never downloaded opens blank offline; on reconnect its patients are *added* to the server's chart (matched by patient ID, else name, else the first empty row), never overlaid on it. «الطلبية», «متابعة الميروبينيم», reports and the dashboard need a connection.

## Capabilities and Constraints

- **Daily medication chart** per ward/date/slot: patient rows, medication columns (only names from the shared medicine registry), per-cell quantities, dose totals with unit / syringe / vial–amp accounting, print to A4/PDF.
- **Patient ID ("رقم الطبلة")** beside each patient name, digits only. Typing a name or an ID that was on yesterday's chart offers to copy that patient forward (name, ID, medicines, quantities). It prints beside the name on the A4/PDF chart.
- **«متابعة الميروبينيم» (Meropenem follow-up)** per ward: read-only, built from the charts — every patient on Meronem, their dose (from the vial strength × daily quantity, read as three doses a day, e.g. «2g × 3»), and one column per day with the course day (D1, D2 …). A Friday with no chart keeps counting; one missed charted day is forgiven and marked «؟»; a transfer (same patient ID on another ward) carries the count over. A status column shows مستمر / أُوقف / غادر / نُقل إلى; finished patients are hidden behind «إظهار المنتهين». Prints on one A4 landscape page. It finds the medicine by the words «Meronem» / «Meropenem» and the strength in its registry name.
- **«الطلبية» (requisition):** per ward/day, each medicine's total from the main chart, in numbers and Arabic words, doubled on Thursday unless the medicine is marked «لا يُضاعف يوم الخميس».
- **Patient search** by name or «رقم الطبلة» over one day's main and extra charts: a pharmacist searches their floor from its ward page; managers search the whole unit from the floor list. Each result shows the ward, chart, row and that day's medicines, and opens the chart. Needs a connection.
- **«التقارير» (reports):** per-floor reports over a date range for managers, printable to A4.
- **"الجارت الإضافي":** a second same-day chart for a ward, done after the main one.
- **Pill form ("الحبوب")** per ward/date: dose time, usage method, and note chosen from fixed Arabic option lists; syringe totals; editable medicine-name and pill-quantity working columns that are screen-only (kept off the chart and the print); paginates at 7 medicines per printed page; CCU pill-form medicine names are shown in English only.
- **Dashboard:** started-wards status (counted per ward, not per floor). Announcements (post / edit / delete for managers) sit at the bottom of the floor list for managers and special-ward-only pharmacists, and at the bottom of a single floor's page for floor pharmacists.
- **Admin:** user accounts + roles + floor/ward assignment; medicine registry (ships with a starter set); floor/ward configuration; registration requests.
- Session-expiry handling; light / dark theme.
- Fixed option lists (wards, dose times, usage methods) are duplicated in server-side validation and must stay in sync (`src/constants.js` ↔ `server/validation.js` / `server/index.js`).
- **Terminology (fixed staff vocabulary):** جارت = a ward's daily medication chart; الجارت الإضافي = a second same-day chart; الحبوب = the pill/tablet form; ردهة = ward; طابق = floor; أروقة فرعية = sub-wards; ردهة مستقلة = independent/special ward; بدأت / لم تبدأ / اكتملت = ward chart status.

## Brand Commitments

- Product name: **وحدة الصيدلة السريرية** (Clinical Pharmacy Unit).
- **Hospital identity is binding:** the hospital name (**مستشفى بغداد التعليمي**) and its logo (`src/assets/hospital-logo.png`) appear on screen and on every printed chart; do not remove, rename, or replace them.
- **The Arabic clinical vocabulary above is fixed** — never "correct", translate, abbreviate, or substitute it.
- UI language is Arabic, RTL throughout.

## Evidence on Hand

- Real domain data in the codebase: floor/ward structure (`src/constants.js`), dose-time / usage-method / note option lists, starter medicine list (`server/starter-medicines.js`).
- Brand asset: `src/assets/hospital-logo.png`; PWA icons in `public/icons/`.
- No public marketing site, testimonials, usage metrics, pricing, or case studies exist — this is an internal hospital tool. Future work must not fabricate any.

## Product Principles

1. **The ward's daily "جارت" is the unit of work.** Every screen serves getting one ward charted, or seeing which wards are not.
2. **The morning round sets the constraints:** fast, glanceable, gloved-hand touch targets, legible under ward lighting, on a device two people may share.
3. **One pharmacist, one floor.** A pharmacist's view collapses to their assigned world; the whole-unit view is the manager's.
4. **Speak the staff's Arabic.** The clinical vocabulary and the paper-chart mental model are fixed; the tool adapts to them, not the reverse.
5. **The printed A4 chart is a real deliverable.** Screen and print are both first-class; neither is an afterthought.

## Accessibility & Inclusion

No externally mandated standard was established. Product-specific needs, from the operating context: Arabic RTL throughout; status and meaning must never rely on colour alone (shared device, glare, gloves); touch targets sized for a gloved hand; controls labelled for an Arabic screen reader.
