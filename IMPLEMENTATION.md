# Implementation guide (end-to-end)

You have three main pieces:

1. **Google Sheet** — stores sign-ups (`Sign Up Form` tab), matches (`Matches` tab), optional survey tabs.
2. **Google Apps Script** — `Code.gs` + HTML files; deployed as a **Web app**; exposes the JSON API and the legacy dashboard + public profiles.
3. **Lovable** — new UI that calls the API (usually via a **CORS proxy** URL).

Supporting docs: [`API.md`](API.md) (API contract), [`LOVABLE_PROMPT.md`](LOVABLE_PROMPT.md) (paste into Lovable), [`cors-proxy/README.md`](cors-proxy/README.md) (proxy).

---

## Phase 1 — Prepare the Google Sheet

1. Open **Google Sheets** and create or open the spreadsheet you will use.
2. Ensure you have a tab named **`Sign Up Form`** (exact name). Row **1** must be **headers** (from your Google Form or manual columns). Data starts row **2**. Each person’s **`id` in the app is the row number** (row 2 → `"2"`).
3. (Optional) Add tabs **`Pre-Survey Results`** and **`Post Survey Results`** if you want the Insights charts; headers in row 1, data below.
4. The **`Matches`** tab can be missing — the script will create it the first time it needs it.

---

## Phase 2 — Create the Apps Script project

1. In the spreadsheet: **Extensions → Apps Script** (or go to [script.google.com](https://script.google.com) and create a standalone project, then bind it to the sheet if you prefer).
2. **Rename the project** (e.g. “Companionship Matching”).
3. **Replace default `Code.gs`** with the contents of this repo’s **`Code.gs`** (copy the whole file).
4. **Add HTML files** (same names as in the script):
   - Click **+** next to “Files” → **HTML**.
   - Name it **`App`** → paste contents of **`App.html`** from this repo.
   - Add another HTML file **`PublicProfile`** → paste **`PublicProfile.html`**.
5. **Save** (disk icon or Ctrl/Cmd-S).

---

## Phase 3 — API token (Script properties)

1. In the Apps Script editor: **Project Settings** (gear) → **Script properties**.
2. **Add row**: Property = **`LOVABLE_API_TOKEN`**, Value = a **long random secret** (e.g. 32+ characters; you can use a password generator). **Copy and store it safely** — Lovable will need it.
3. Save.

---

## Phase 4 — Deploy the Web app

1. Click **Deploy** → **New deployment**.
2. Type: **Web app**.
3. **Execute as:** *Me* (your account).
4. **Who has access:** *Anyone* (the real protection is **`LOVABLE_API_TOKEN`**, not “who can open the URL”).
5. **Deploy**. Authorize when prompted (Google will ask for spreadsheet and possibly Gmail if you use mail features).
6. **Copy the Web app URL** (ends with `/exec`). This is your **Apps Script API base URL** for POST requests.

**After every code change:** **Deploy** → **Manage deployments** → edit the deployment → **New version** → **Deploy** so the live URL updates.

### If the browser shows a Google sign-in page (or a redirect) instead of JSON

The Web app is not anonymous yet, or the wrong URL is in the frontend.

1. **Who has access** on the **Web app** deployment must be **Anyone** (anonymous invocations). If it is **Only myself** or only people in your Google Workspace, browsers that are not already signed in as you will get a sign-in or access screen — `fetch` will not see `{ "ok": true, ... }`.
2. **Use the Web app URL from** **Deploy → Manage deployments** (ends with `/exec`). Do not use a “Test” or editor preview URL, and do not use a link that opens the script project.
3. **Re-deploy a new version** after changing this setting, then copy the URL again in case it changed.
4. **Quick check (no browser session):** in a terminal, replace `YOUR_URL` and `YOUR_TOKEN` and run:
   `curl -sS "YOUR_URL?api=1&action=health&token=YOUR_TOKEN"`
   You should see JSON. If you see HTML or a login page, fix the deployment (step 1) or the URL (step 2).
5. On some **Google Workspace** domains, an admin may need to allow deploying web apps as **Anyone**; otherwise the option may be missing or requests may still be blocked.

**Note:** Visiting the base URL with **no** query string serves the legacy **HTML** dashboard (`App.html`), not JSON. API calls must include `payload=...` (Lovable GET) or `api=1&...` or a POST body, as in [`API.md`](API.md).

---

## Phase 5 — CORS proxy (optional; see GET + browser CORS)

Browsers usually **block** `fetch()` from your Lovable domain to `script.google.com` (no CORS headers). So the Lovable app should call a **proxy** that forwards POST to your Web app URL and adds CORS.

**Cloudflare Workers (no terminal required):**

1. Sign in at [Cloudflare Workers](https://workers.cloudflare.com/).
2. **Create a Worker** → paste the contents of **`cors-proxy/worker.js`** from this repo into the editor.
3. **Settings → Variables** (or **Secrets**): add **`GAS_WEBAPP_URL`** = your full Web app URL from Phase 4 (must include `/exec`).
4. **Save and deploy** the Worker.
5. Copy the Worker’s public URL (e.g. `https://your-worker.workers.dev`).

**In Lovable:** configure your API **base URL** to this **Worker URL**, **not** the raw Apps Script URL, when making `fetch` calls from the browser.

The JSON body is unchanged: every request still includes `"token": "<your LOVABLE_API_TOKEN>"`.

---

## Phase 6 — Build the app in Lovable

1. Open your Lovable project.
2. Open **`LOVABLE_PROMPT.md`** from this repo. Copy everything **from** the project description (“Rebuild the Companionship Connections…”) **through** the end (or follow the file’s “paste below the line” instruction). Paste into Lovable’s project chat / instructions so the UI matches: Directory, Matches, Insights, Reminders, Criteria, Display, public PDF/link behavior, etc.
3. Give Lovable the **technical wiring** (from [`API.md`](API.md)):
   - **POST** to your **proxy URL** (or Apps Script URL if you ever use server-side only).
   - **Content-Type:** `application/json`.
   - Body shape: `{ "action": "<name>", "token": "<LOVABLE_API_TOKEN>", ...parameters }`.
   - Success: `{ "ok": true, "result": ... }`; failure: `{ "ok": false, "error": "..." }`.
4. **Secrets in Lovable:** store **`LOVABLE_API_TOKEN`** (and if needed the **proxy base URL**) in Lovable’s environment / secrets UI — **do not** commit the token in public code.
5. Implement `fetch` (or Lovable’s HTTP helper) so each screen calls the right **`action`** (`getData` on load, `createMatchesBatch` when creating matches, etc.). Use the table in **`API.md`**.

---

## Phase 7 — Smoke test (before training users)

1. **Health:** POST `{ "action": "health", "token": "YOUR_TOKEN" }` — expect `{ "ok": true, "result": { ... } }`. You can use an HTTP tool in the browser or Postman if you use one.
2. **Data:** POST `{ "action": "getData", "token": "YOUR_TOKEN" }` — expect `companions`, `matches`, `criteria`, `visibility`.
3. In **Lovable**: open the app, confirm the directory loads and one update works (e.g. change a match status).
4. **Public link:** open the Web app URL with `?view=public&row=2` (use a real data row) — should show **`PublicProfile`** without contact fields.
5. **Legacy dashboard (optional):** visiting the Web app URL **without** `view=public` still serves **`App.html`** (original embedded dashboard) if you need it during transition.

---

## Phase 8 — Forms and operations (ongoing)

- **New responses:** Keep linking your Google Form to the **`Sign Up Form`** sheet (or paste rows) so row numbers stay consistent with **`id`**.
- **Matching criteria & display settings:** Saved in **Script properties** (`MATCHING_CRITERIA`, `UI_VISIBILITY_SETTINGS`) when users click Save in Criteria / Display — whether they use Lovable or the legacy `App.html`.
- **6‑month reminders:** Need **Gmail** authorization for `MailApp` when staff run reminder sends from the app.

---

## Troubleshooting (short)

| Issue | What to check |
|--------|----------------|
| `401` / Unauthorized from API | `LOVABLE_API_TOKEN` in Script properties matches the token in Lovable; redeploy Web app after code changes. |
| CORS error in browser | Use the **Cloudflare Worker URL** as base, not raw `script.google.com`. |
| Empty companions | Tab name **`Sign Up Form`**, headers row 1, data from row 2; script bound to the correct spreadsheet. |
| Old behavior after edit | **New version** deployment of the Web app. |

---

## Files in this repo (what each is for)

| File | Role |
|------|------|
| `Code.gs` | All backend: sheet I/O, API router, PDF, public profile, reminders |
| `App.html` | Legacy full dashboard (still served at Web app root) |
| `PublicProfile.html` | Public share page (`?view=public&row=`) |
| `API.md` | JSON API reference |
| `LOVABLE_PROMPT.md` | Product spec for Lovable |
| `cors-proxy/worker.js` | Paste into Cloudflare for CORS |
| `IMPLEMENTATION.md` | This checklist |
