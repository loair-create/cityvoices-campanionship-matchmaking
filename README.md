# City Voices — Companionship Matchmaking

**Companionship Connections** is a Google Apps Script application that pairs volunteers with people seeking companionship. It reads companion signups from a Google Sheet (typically linked to a Google Form), helps staff score and match participants, records matches, sends check-in reminders, and exposes **shareable companion profiles** (first name and non-sensitive fields only—no contact details on the public view).

This repository holds the source for **version 3** of the app: server logic in `Code.gs` and a single HTML file, `App.html`, that powers both the **Companionship Matching Dashboard** and the **Companion Profile** page.

## What’s in this repo

| File | Purpose |
|------|--------|
| `Code.gs` | Apps Script backend: sheet access, matching, reminders, auth, profile data for public links |
| `App.html` | One HTML file in the script project (name it **App** in the editor): dashboard UI + profile template |
| `anonymize-pre-survey` | Optional **separate** Apps Script snippet for moving anonymous survey columns to another spreadsheet on form submit (configure IDs and column indices before use) |

## Requirements

- Google account with access to the spreadsheet that stores form responses  
- Google Sheets with a responses tab whose headers look like a typical Form export (e.g. Timestamp, First name, Email, etc.)  
- Optional: tabs for **Pre-Survey Results** and **Post Survey Results** for anonymous aggregate charts in the dashboard  

## Install into Google Sheets

1. Open the spreadsheet bound to your companionship program data.  
2. Go to **Extensions → Apps Script**.  
3. **Backend:** Replace or merge the default `.gs` file with the contents of `Code.gs` from this repo.  
4. **HTML:** Add an HTML file named **`App`** (exact name). Paste the **full** contents of `App.html` into it. The profile view is selected when the deployed URL includes `?page=profile&id=ROW_ID`; you do **not** need a second HTML file.  
5. Save the project (**Ctrl/Cmd + S**).  
6. **Web app deployment (dashboard URL + profile links):** **Deploy → New deployment → Web app**. Profile URLs look like:  
   `https://script.google.com/.../exec?page=profile&id=<rowId>`  
   For **security**, prefer **Who has access: Only people in [your domain]** (Workspace) or a tight group—not “Anyone on the internet.” See **Security without an email allowlist** below.  
7. **Optional script properties** (Project Settings → Script properties):  
   - **`FORM_RESPONSES_SHEET_NAME`** — exact tab name if auto-detection picks the wrong sheet.  
   - **`PRE_SURVEY_RESULTS_SHEET_NAME`** / **`POST_SURVEY_RESULTS_SHEET_NAME`** (or legacy **`POST_SURVEY_SHEET_NAME`**) — override tab names for analysis charts.  
8. **Email (reminders / test mail):** In the script editor, choose **`authorizeEmailPermission`** from the function dropdown, click **Run**, and complete the OAuth prompts once.  

From the spreadsheet, use the menu **Companionship Connections → Open Dashboard** to open the modal, or open the deployed web app URL in the browser for the full-page dashboard (copy the `/exec` link from **Deploy → Manage deployments** in the Apps Script editor).

## Security without an email allowlist

The app no longer checks `ALLOWED_DASHBOARD_EMAILS` (that pattern broke easily with Google’s web app identity behavior). Use layers Google already provides:

1. **Who has access (deployment)** — In **Deploy → Manage deployments → Edit**, set the web app so only people in your **Google Workspace organization** (or specific users) can open it. Avoid **Anyone** / public internet unless you accept that anyone with the URL can hit the script (especially risky if **Execute as: Me**).  
2. **Execute as: User accessing the web app** — Recommended for staff dashboards: the script runs as the signed-in user, so **Google Sheets sharing** applies. Only users who can open the spreadsheet see or change data.  
3. **Spreadsheet sharing** — Share the bound spreadsheet only with people who should see participant data (Viewer vs Editor as appropriate).  
4. **Keep URLs private** — Treat the `/exec` link like an internal tool; don’t post it on public pages.  
5. **Public profiles** — Links with `?page=profile&id=…` show the limited profile only; still avoid sharing row IDs widely if that’s sensitive.  
6. **Workspace admin** — Admins can restrict Apps Script / external sharing policies for your domain.

Opening the dashboard from the spreadsheet menu (**Extensions → Apps Script** or **Open Dashboard**) still requires a user who can open that file.

## Features (high level)

- **Companion list** from the linked responses sheet, with notes, internal status, and last-contact tracking  
- **Matching** with configurable criteria; matches stored on a **`Matches`** sheet (created if missing)  
- **Shareable profiles** via deployed web app (privacy-oriented: no email/phone on the public profile)  
- **Reminder workflow** and **Reminder Schedule** sheet support; optional **6‑month reminder** check from the spreadsheet menu  
- **Tester / reminder email** tools (after MailApp is authorized)  
- **Anonymous pre/post survey aggregates** when the expected analysis tabs exist  

Reserved tab names used by the app include **`Matches`** and **`Reminder Schedule`**; avoid using those names for unrelated data.

### Fixed columns on the responses sheet (e.g. Signup Form)

| Column | Use |
|--------|-----|
| **AP** | Internal status (Active / Unresponsive / Quit), edited in the app |
| **AQ** | Volunteer (`TRUE`/`FALSE`); from the Google Form or editable in the app (Enrollment section) |
| **AR** | Last staff contact date (edited in the app). If you previously stored last contact in **AQ**, move those values to **AR** after updating to this version. |

## Development notes

- The Apps Script project must contain exactly one HTML file named **`App`** matching `App.html`.  
- `doGet` in `Code.gs` serves either the dashboard or the profile page based on query parameters.  
- The optional `anonymize-pre-survey` file is **not** wired into `Code.gs`; it is a standalone pattern for splitting sensitive columns to another spreadsheet—edit constants and install as a separate trigger if you use it.

## License

If no `LICENSE` file is present in the repository, all rights are reserved unless the project owners specify otherwise.
