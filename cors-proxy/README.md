# CORS proxy for Apps Script JSON API

Google Apps Script web apps do not send `Access-Control-Allow-Origin` for JSON responses, so a browser app on another domain cannot `fetch()` the script URL directly.

This **Cloudflare Worker** forwards POST (and GET) to your deployed **Web app URL** and adds permissive CORS headers. Your API token still authenticates to Apps Script in the JSON body.

## Deploy

1. Create a Worker on [Cloudflare Workers](https://workers.cloudflare.com/).
2. Paste `worker.js` into the Worker editor.
3. Add a **Worker secret** or variable `GAS_WEBAPP_URL` = your full Apps Script deployment URL (e.g. `https://script.google.com/macros/s/.../exec`).
4. Save and deploy. Use the Worker’s `workers.dev` URL (or custom domain) as the **base URL** your browser client calls for API requests (same place you’d put the Apps Script URL if CORS allowed it).

## Environment

| Binding | Value |
|---------|--------|
| `GAS_WEBAPP_URL` | Apps Script Web app URL (must end with `/exec` for deployments) |

## Wrangler (optional)

Advanced: deploy with [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) if you use it. The dashboard steps above are enough for most setups.
