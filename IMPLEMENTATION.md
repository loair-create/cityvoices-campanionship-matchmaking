# Manual setup (step by step)

Follow these phases **in order**. You need a Google account and access to create or edit a spreadsheet.

**Two ways to work:**

- **Spreadsheet-first (recommended for many teams):** use the sheet’s **Companion tools** menu, **Match Queue** tab, and optional **Volunteers** sync—no separate web UI required for daily work.
- **Dashboard:** deploy the same script as a **Web app** and use the built-in **App.html** dashboard (or call the JSON API from another client).

---

## Phase 1 — Google Sheet

Do this in **Google Sheets** (browser).

1. Create a new spreadsheet **or** open the one your Google Form writes to.
2. Rename or add a tab named **`Sign Up Form`** (exact spelling and spacing).
3. **Row 1** = column headers (from your Form or typed manually). **Row 2+** = one person per row.
4. Know this rule: each person’s **`id`** in the app is their **sheet row number** (row 2 → `"2"`). Do not delete rows in the middle if you rely on stable IDs.
5. (Optional) Add tabs **`Pre-Survey Results`** and **`Post Survey Results`** with headers in row 1 if you want Insights charts later.
6. You do **not** need to create **`Matches`** or **`Volunteers`** tabs manually—the script can create them when needed.

---

## Phase 2 — Apps Script project

Do this once per spreadsheet (unless you use a standalone script project linked to the sheet).

1. With the spreadsheet open, click **Extensions → Apps Script**.
2. Click **Untitled project** at the top and rename it (e.g. `Companionship Matching`).
3. **Remove** the default empty `myFunction` / starter code in `Code.gs` if present—you will replace the whole file.

### 2a — Add backend and feature scripts (`.gs`)

For **each** file below: in Apps Script, click **+** next to **Files** → **Script** → name it exactly as shown (the editor shows `Name.gs`).

| Order | File in this repo | Name in Apps Script editor |
|-------|-------------------|----------------------------|
| 1 | `Code.gs` | `Code` (the default main script) |
| 2 | `VolunteersSync.gs` | `VolunteersSync` |
| 3 | `CompanionsSync.gs` | `CompanionsSync` |
| 4 | `SheetCompanionTools.gs` | `SheetCompanionTools` |
| 5 | `MatchQueue.gs` | `MatchQueue` |

**Notes:**

- **CompanionsSync** depends on helpers in **VolunteersSync** — keep **VolunteersSync** in the project if you use **CompanionsSync**.
- If you skip **VolunteersSync**, you lose **Volunteers** sync and must remove **CompanionsSync** too (or duplicate helpers).
- **SheetCompanionTools** + **MatchQueue** provide the **Companion tools** menu and **Match Queue** workflow.

### 2b — Add HTML files

Click **+** → **HTML**. The **filename** you type must match what the code expects (no `.html` in the editor title).

| File in this repo | Name in Apps Script (HTML) |
|-------------------|----------------------------|
| `App.html` | `App` |
| `PublicProfile.html` | `PublicProfile` |
| `SheetCompanionSidebar.html` | `SheetCompanionSidebar` |

Paste the full file contents from this repo into each.

### 2c — Save

Press **Ctrl/Cmd-S** or click **Save project**.

---

## Phase 3 — Script property for API access (optional but common)

Required if you use **curl**, Postman, or any client that calls `action` + `token`.

1. In Apps Script: **Project Settings** (gear) → **Script properties**.
2. Click **Add script property**.
3. Property: **`LOVABLE_API_TOKEN`**  
   Value: a **long random secret** (32+ characters). Store it safely—you will send it as `token` in API requests.
4. Save.

If you **only** use the spreadsheet UI and never call the JSON API, you can skip this—the token is still safe to set if you might use the API later.

---

## Phase 4 — Deploy as Web app

Required for:

- Public profile links (`?view=public&row=…`)
- PDF generation from the sidebar
- **App.html** dashboard URL
- JSON API (`POST` / `GET` with token)

Steps:

1. Click **Deploy** → **New deployment**.
2. Click the gear → choose type **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** **Anyone** (anonymous), unless you intentionally restrict invokers. If access is too strict, browsers may show a Google sign-in page instead of JSON or the HTML app.
4. Click **Deploy**.
5. **Authorize** when Google prompts (spreadsheet access, external requests, etc.).
6. **Copy the Web app URL** (ends with `/exec`). Save it—this is your deployment URL.
7. If **Copy public link** in the sidebar builds a bad URL or visitors see errors, set a **Script property** in Apps Script → Project Settings → **Script properties**: name **`WEB_APP_PUBLIC_BASE_URL`**, value = your full Web app URL (same as `/exec`, no trailing `#`). Redeploy after adding it.

**After every code change:** **Deploy → Manage deployments** → pencil icon → **New version** → **Deploy**, or the live URL may keep running old code.

---

## Phase 5 — Reload the spreadsheet (menus)

1. Close and reopen the spreadsheet **or** refresh the browser tab.
2. Confirm the menu **Companion tools** appears in the menu bar.
3. Try **Companion tools → Open sidebar** and use **Public link & PDF** (row #) or **Match suggestions** (dropdown + scored list).  
   - If copy-link fails, set **`WEB_APP_PUBLIC_BASE_URL`** (Phase 4) or build `?view=public&row=ROW` manually on your `/exec` URL.

---

## Phase 6 — Match Queue (spreadsheet matching)

1. **Companion tools → Prepare Match Queue sheet** (creates the **Match Queue** tab).
2. Each row: **Companion 1 row** and **Companion 2 row** = row numbers on **`Sign Up Form`**. Optional **Status** and **Notes**. Leave **Processed** blank until you run the processor. Rows with **both** A and B empty are ignored.
3. **Companion tools → Process Match Queue** appends pairs to the **`Matches`** tab.

---

## Phase 7 — Volunteers tab (optional)

If you use **`VolunteersSync.gs`**:

1. On **Sign Up Form**, column **AQ** = volunteer (`TRUE`). The **Volunteers** tab lists those rows: **A–D** sync from the form; **E — Last Contact Date** and **F — Internal Notes** are **staff-only** on the Volunteers sheet. Editing E or F updates the matching columns on **Sign Up Form** (requires an **On edit** trigger on `onEditVolunteersStaffFields` — see `VolunteersSync.gs`).
2. Menu: **Companion tools → Sync Volunteers & Companions tabs** runs both Volunteers and Companions sync.
3. Triggers (Apps Script → clock → **Add trigger**):
   - **On change** → `onChangeVolunteersSync` (good for new Form rows)
   - Optional **On edit** (Sign Up Form) → `onEditVolunteersSync`
   - **On edit** (all sheets; handler only acts on **Volunteers**) → `onEditVolunteersStaffFields` — pushes E/F to Sign Up Form

See the comments at the bottom of **`VolunteersSync.gs`** for trigger details.

---

## Phase 8 — CORS proxy (only if a browser app calls the API)

Browsers often block direct `fetch()` to `script.google.com`. If a browser SPA or another frontend runs on a different origin:

1. Deploy the Worker in **`cors-proxy/worker.js`** (see **`cors-proxy/README.md`**).
2. Set the Worker secret **`GAS_WEBAPP_URL`** to your **Phase 4** `/exec` URL.
3. Point your frontend’s API base URL at the **Worker URL**, not the raw Apps Script URL.

---

## Smoke test checklist

| Step | What you do | Success |
|------|-------------|---------|
| 1 | Open Web app URL with no query string | Dashboard (**App.html**) loads |
| 2 | Open `YOUR_WEBAPP_URL?view=public&row=2` (real row) | Public profile; no contact fields |
| 3 | Companion sidebar → copy link for row 2 | Link uses your deployment URL |
| 4 | POST `health` + token (Postman/curl) | `{ "ok": true, ... }` |
| 5 | Match Queue → process one pair | New row on **Matches** |

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| No **Companion tools** menu | All `.gs` files saved; refresh sheet; **Code** contains `onOpen` → `sheetCompanionMenuOnOpen` |
| API returns Unauthorized | **`LOVABLE_API_TOKEN`** matches the client |
| Public link wrong or “unable to open” | **`WEB_APP_PUBLIC_BASE_URL`** script property; **Anyone** access; **`/exec`** URL; new deployment version |
| CORS in browser | Use **Phase 8** proxy as API base |
| Empty directory | Tab **`Sign Up Form`** exact name; data from row 2 |
| Old behavior after edit | **New version** deployment (**Phase 4**) |

---

## Files in this repo

| File | Role |
|------|------|
| `Code.gs` | Main backend: API, sheets, public profile, reminders, menu hook |
| `App.html` | Legacy dashboard (Web app root) |
| `PublicProfile.html` | Public share page template |
| `SheetCompanionTools.gs` | **Companion tools** menu + sidebar |
| `SheetCompanionSidebar.html` | Sidebar UI (public link, PDF, match suggestions) |
| `MatchQueue.gs` | **Match Queue** sheet + processor |
| `VolunteersSync.gs` | **Volunteers** tab sync (AQ = TRUE) |
| `CompanionsSync.gs` | **Companions** tab sync (AQ ≠ TRUE); uses helpers from VolunteersSync |
| `API.md` | JSON API reference |
| `cors-proxy/worker.js` | Cloudflare Worker for CORS |
| `IMPLEMENTATION.md` | This checklist |
