/**
 * Cloudflare Worker: forwards to Google Apps Script web app and adds CORS.
 * Secret / variable: GAS_WEBAPP_URL = full https://script.google.com/macros/s/.../exec
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const target = env.GAS_WEBAPP_URL;
    if (!target || typeof target !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Worker misconfigured: set GAS_WEBAPP_URL to your Apps Script web app URL.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    if (request.method === 'GET') {
      const qs = url.searchParams.toString();
      const forwardUrl = qs ? `${target}?${qs}` : target;
      const res = await fetch(forwardUrl, { method: 'GET', redirect: 'follow' });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      });
    }

    if (request.method === 'POST') {
      const body = await request.text();
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
        body,
        redirect: 'follow',
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });
  },
};
