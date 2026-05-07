# Copy this into Lovable (product + data spec)

Paste everything **below the line** into Lovable’s project chat / instructions. Technical API details (actions, JSON shape, token setup) are in [`API.md`](API.md) in this same folder—you can paste relevant sections into Lovable separately if needed.

---

**Project:** Rebuild the “Companionship Connections” matchmaking dashboard as a Lovable web app. **Backend data lives in a Google Spreadsheet** accessed through **Google Apps Script** (JSON API). Reproduce the same **information architecture**, **privacy rules**, and **workflows** as the legacy HtmlService app.

### Spreadsheet structure

1. **Tab `Sign Up Form`**
   - Row 1 = column headers (Google Form responses or manual columns).
   - Each **participant row** is identified by **`id` = the sheet row number** (row 2 → `"2"`), not a separate UUID column.
   - **Known semantic columns** are found by **header substring** (not fixed column letters). Examples the parser expects include:
     - Identity / contact: First Name, Last Name, Email, Phone Number, Borough, neighborhood, willing to travel, age, pronouns, race/s, gender, LGBTQ, committed relationship.
     - Lived experience (typically Yes/No style): domestic violence, incarcerated, homelessness, mental health / substance use (current and history), veteran, accessibility needs.
     - Essays / long text: hobbies, expectations, shared experiences, motivation (“Why are you interested”), creativity.
     - Availability: columns whose headers contain **`[monday]` … `[sunday]`**; empty cells are treated as **“Unavailable”** in the UI when building the availability object.
     - Staff: **INTERNAL NOTES** (textarea in app); optional columns for volunteer/participant, enrollment date, **internal status** (Active / Quit / Unresponsive), **last contact date** (per person, on the sign-up sheet—column added automatically if missing when saving).
   - **`allQuestions`:** array of `{ question, answer }` for **every** column in that row (full form dump for directory detail and optional restricted display).

2. **Tab `Matches`** (auto-created if missing)
   - Columns: Match ID, Companion 1 ID, Companion 2 ID, Status, Notes, Created At, C1 Name, C2 Name, Last Contact Date (pair-level follow-up).
   - **Duplicate prevention:** same pair (A,B) cannot be stored twice regardless of order.

3. **Optional tabs for Insights**
   - `Pre-Survey Results`, `Post Survey Results`: arbitrary columns; app shows **frequency tables** per question.

4. **Script Properties (not in cells)**
   - Matching criteria JSON (`MATCHING_CRITERIA`): weighted toggles for borough, travel, availability overlap, age, pronouns, race, gender, LGBTQ, lived-experience flags, veteran, etc.
   - Display / privacy JSON (`UI_VISIBILITY_SETTINGS`): directory toggles, match-picker toggles, **public** profile toggles (show last name on public link, restrict which questions appear, etc.).
   - Reminder email copy and logs for the 6‑month job.

### Core domain objects (API shape)

**Companion (from `getData`):** includes structured fields above, nested `essays`, `availability` (7 days), `volunteer`, `enrollmentDate`, `internalStatus`, `internalNotes`, `lastContactDate`, and **`allQuestions`**.

**Match:** `{ id, companion1Id, companion2Id, status, notes, createdAt, lastContactDate }` (names may exist in the sheet but UI primarily resolves people via companion list).

**Matching score (client-side):** weighted heuristic—not authoritative; staff can match anyone. Uses overlapping availability days (non-“Unavailable” on both sides), borough/travel, identity fields, shared lived experience where both are “Yes”, etc.

### Pages / navigation (must exist)

1. **Directory**
   - Search by name; optional filters on non–lived-experience criteria keys (same keys as structured fields).
   - **Card (“thumbnail”) content:** circular avatar = **first initial**; **full name**; **borough**; chips: **Volunteer** (only if volunteer-like answer), **Enrolled {date}**, **internal status** or “No internal status”, **Matched** vs **Needs match** (person appears in **any** match whose status is **not** `Canceled`), **Contact due** if **per-person** last contact is **more than 14 days** ago or missing (stale styling + red dot on avatar).
   - Footer strip: **age**; “View profile →”.
   - Click opens **profile modal**.

2. **Profile modal (directory detail / “pop”)**
   - Header: name, optional Volunteer badge, email/phone if display settings allow.
   - Explainer: PDF and public link obey **Display** settings; contact columns never public.
   - Actions (if enabled): **Download PDF** (public-safe PDF), **Copy public link**, **Open public page** (see Public sharing).
   - **All sign-up Q&A** scrollable list (every question/answer), or **restricted** to selected headers if settings say so.
   - **Find Match** mode: lists **everyone else**; optional name filter; sort by match %; show **% (guide)** and top **reason chips** if enabled; multi-select **Add** then **Create matches** (batch). Match IDs generated client-side like `m-{base36time}-{idx}-{id1}-{id2}`.
   - Sidebar: **Internal status** dropdown (only **Active**, **Quit**, **Unresponsive** persist from list; other free-text values may display as “from sheet” until replaced); **Last contact date** (HTML date → stored YYYY-MM-DD in Apps Script); **Quick summary**; **Lived experience tags** (DV, incarceration, homelessness, MH services, substance use); **Availability** 7-day grid (Unavailable / Flexible / time text); **Internal notes** textarea (blur saves).

3. **Matches**
   - Title “Active Companions”; list of match cards.
   - Each card: overlapping avatars (initials), **“First1 & First2”** title, **match %** and reason tags, volunteer labels per person if any.
   - Row controls: checkbox (bulk), **status** pill dropdown, **notes** inline, **delete**.
   - **Match status values:** `Just Matched`, `Introduction Sent`, `First Meeting Set`, `Active`, `Canceled`.
   - **Per-pair last contact** date (Matches sheet column), with clear.
   - Bulk: select all, set status for selected, delete selected.
   - Click card opens **Match comparison** modal: side-by-side / merged view of both profiles and criteria.

4. **Insights**
   - KPI cards: total sign-ups, active match pairs (counts matches **excluding** `Canceled`), people in any non-canceled match, people not in a match.
   - Breakdown tables: borough, volunteer/participant bucket, age, gender, LGBTQ, race, internal status.
   - Lived experience **rates** (% of sign-ups answering Yes where applicable).
   - Sections for **Pre-Survey Results** and **Post Survey Results** tabs (frequency by column).

5. **Reminders (6‑month post-survey)**
   - Configure **To**, **Cc**, subject, body; placeholders `{{first1}}`, `{{last1}}`, `{{first2}}`, `{{last2}}`.
   - Preview eligible matches (~**180 days** since creation, non-canceled, not already logged sent).
   - Send batch, send test, install/remove **daily trigger** (~8 AM script TZ).

6. **Criteria**
   - Edit weights and enabled flags; **Save** persists JSON to Script Properties.

7. **Display**
   - Toggles for directory (show volunteer badge, contact, share actions, all Q&A vs column whitelist, quick summary, tags, availability, internal notes).
   - Match picker: show/hide **match %** and **reasons**.
   - Public: show/hide last name on public view; show/hide form responses; optional **question allowlist** for public link/PDF.

### Public sharing (no direct identifiers by default)

- **Public URL** (served by Apps Script): `?view=public&row={rowId}` with **display name** = first name only unless settings allow last name.
- **Strips:** email, phone, last name, internal notes/status, and other **contact/sensitive** headers; **First name** column also excluded from public Q&A list.
- Optional **question allowlist** when `restrictQuestions` is true.
- **PDF** = same content as public HTML, as PDF bytes (base64 download).

### API actions the Lovable client should call

- Read: `getData`, `getSignUpFormHeaders`, `getInsightsPageData`, `getSixMonthReminderPageData`, `previewSixMonthReminders`
- Write: `saveCriteriaSettings`, `saveVisibilitySettings`, `saveReminderEmailSettings`, `createMatchesBatch`, `updateMatchData`, `updateMatchLastContactDate`, `deleteMatch`, `deleteMatchesBatch`, `updateMatchesStatusBatch`, `updateCompanionNote`, `updateCompanionInternalStatus`, `updateCompanionLastContactDate`
- Public assets: `getPublicShareLink`, `getProfilePdfBase64`
- Reminders: `runSixMonthReminderJob`, `sendSixMonthReminderTestEmail`, `installDailySixMonthReminderTrigger`, `removeDailySixMonthReminderTriggers`

Exact JSON request/response shapes and authentication: see **`API.md`** in the repo (POST body includes `action`, `token`, and parameters; token matches Script property `LOVABLE_API_TOKEN`).

### Non-functional requirements

- Respect **stale contact** UX: **14 days** threshold for “Contact due” on directory cards and in modal.
- **Privacy:** treat **public link + PDF** as shareable externally; directory modal may show PII for staff per Display settings.
- **Auth:** Prefer storing the API **token** in Lovable secrets / server-side config, not hard-coding in client if possible. **CORS:** browsers may not call the raw Apps Script URL; use a small proxy (e.g. Cloudflare Worker in `cors-proxy/`) or server-side fetch—see `API.md`.

---

**Branding:** “Companionship Connections” / City Voices companion sign-ups; teal/emerald accent (brand palette similar to legacy dashboard).
