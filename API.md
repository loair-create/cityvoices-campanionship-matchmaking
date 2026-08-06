# Companionship JSON API (Google Apps Script)

**Step-by-step setup (Sheet, Apps Script, deploy, proxy):** see [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

External apps (custom dashboards, scripts, or mobile clients) call the same backend as the legacy dashboard by **POSTing JSON** to your **Apps Script Web app URL** (Deploy → Manage deployments → Web app).

## Setup

1. In Apps Script: **Project Settings → Script properties** → add property **`LOVABLE_API_TOKEN`** with a long random secret.
2. **Deploy** the project as a **Web app** (new version after code changes).  
   - *Execute as:* you (owner).  
   - *Who has access:* **Anyone** (anonymous). The **token** is the real auth. If this is stricter, the URL will show a **Google sign-in** page and `fetch` will fail before any JSON is returned.
3. Copy the **Web app URL** from **Manage deployments** (ends with `/exec`) — that is your API base URL for POST requests.

**GET (URL-encoded `payload` or `api=1`)** and **POST (JSON body)** are supported. Example GET:  
`{WEBAPP_URL}?api=1&action=getData&token=YOUR_TOKEN`  
URL-encoded payload style: `{WEBAPP_URL}?payload=encodeURIComponent(JSON.stringify({action,token,...}))`

**CORS:** Browsers often cannot call the Google URL directly from JavaScript because of **CORS** (Google’s response may not include `Access-Control-Allow-Origin` for your origin). Use the included [cors-proxy](cors-proxy/) Worker, server-side `fetch`, or call the API from your **server** only. “Sign-in instead of JSON” is a **deployment** issue — see [IMPLEMENTATION.md](IMPLEMENTATION.md#if-the-browser-shows-a-google-sign-in-page-or-a-redirect-instead-of-json).

---

## Request format

**POST** `Content-Type: application/json`

```json
{
  "action": "getData",
  "token": "YOUR_LOVABLE_API_TOKEN"
}
```

Optional nested payload:

```json
{
  "action": "updateMatchData",
  "token": "YOUR_LOVABLE_API_TOKEN",
  "payload": {
    "matchId": "m-xxx",
    "field": "status",
    "value": "Active"
  }
}
```

You can also send parameters **flat** (same level as `action` / `token`).  
Token may be repeated as a query string: `POST ...?token=YOUR_TOKEN`

---

## Response format

Success:

```json
{ "ok": true, "result": { } }
```

Failure:

```json
{ "ok": false, "error": "message" }
```

---

## Actions reference

| `action` | Parameters | `result` type | Notes |
|----------|------------|---------------|--------|
| `health` | — | `{ service, time }` | Lightweight check |
| `getData` | — | `{ companions, matches, criteria, visibility }` | Full app payload |
| `getSignUpFormHeaders` | — | `string[]` | Row 1 headers, Sign Up Form |
| `getInsightsPageData` | — | `{ analysis, preSurvey, postSurvey }` | Insights tab |
| `getSixMonthReminderPageData` | — | `{ reminder, dailyReminderTriggerActive }` | Reminders tab |
| `getSurveyAnalysis` | — | analysis object only | Sign-up aggregates |
| `saveCriteriaSettings` | `settingsJson` (string) | `boolean` | Stored as `MATCHING_CRITERIA` |
| `saveVisibilitySettings` | `settingsJson` (string) | `boolean` | Stored as `UI_VISIBILITY_SETTINGS` |
| `saveReminderEmailSettings` | `ccEmail`, `subject`, `body`, `toEmail` | `boolean` | Same as legacy Reminders UI |
| `createMatch` | `matchObj` | `boolean` | Single match row |
| `createMatchesBatch` | `matchObjs` (array) | `{ created, skipped, reason, skippedDetails }` | Batch create; `skippedDetails[].reason` explains each skip |
| `updateMatchData` | `matchId`, `field` (`status`\|`notes`), `value` | `boolean` | |
| `updateMatchLastContactDate` | `matchId`, `isoDateOrEmpty` | `boolean` | Pair-level; YYYY-MM-DD or `""` |
| `deleteMatch` | `matchId` | `boolean` | |
| `deleteMatchesBatch` | `matchIds` | `{ deleted }` | |
| `updateMatchesStatusBatch` | `matchIds`, `status` | `{ updated }` | |
| `updateCompanionNote` | `companionId` (or legacy `rowNumber`), `note` | `boolean` | INTERNAL NOTES column |
| `updateCompanionInternalStatus` | `companionId` (or legacy `rowNumber`), `value` | `boolean` | Active / Quit / Unresponsive / blank |
| `updateCompanionLastContactDate` | `companionId` (or legacy `rowNumber`), `isoDateOrEmpty` | `boolean` | Per-person on sign-up sheet |
| `getPublicShareLink` | `rowId` (Companion ID or row number) | `{ ok, url, message }` | Returns a `?view=public&cid=…` link |
| `getProfilePdfBase64` | `rowId` (Companion ID or row number) | `{ base64, fileName }` | Public-safe PDF |

Companion IDs (`C-0001`, …) live in the **Companion ID** column on **Sign Up Form** and never change.
Sign-up row numbers are still accepted everywhere an ID is, so older integrations keep working.
| `previewSixMonthReminders` | — | array of preview rows | |
| `runSixMonthReminderJob` | — | `{ sent, skipped, errors }` | Sends staff emails |
| `sendSixMonthReminderTestEmail` | `testToEmail` | `{ ok, message?, error? }` | |
| `installDailySixMonthReminderTrigger` | — | `boolean` | Daily ~8 AM |
| `removeDailySixMonthReminderTriggers` | — | `boolean` | |

---

## Quick test (optional)

Use any HTTP client (Postman, Insomnia, etc.): **POST** to your Web app URL, `Content-Type: application/json`, body e.g. `{"action":"getData","token":"YOUR_TOKEN"}`.

If the browser cannot call the Apps Script URL directly (**CORS**), use the Worker in [`cors-proxy/`](cors-proxy/) (paste `worker.js` into the Cloudflare dashboard and set `GAS_WEBAPP_URL`, or another proxy you prefer).
