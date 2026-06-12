// api/proxy.js — Vercel Serverless Function
// Proxies all Google Sheets read/write calls for the Wine Inventory Checker

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyMXUK3TEboHO6EV9CW8ILXWR8_BhQA205_8FqaaYpFjwmy9qJ0QK8X5Ur75Mu6lJf-/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse query params using URL API to avoid url.parse() deprecation
  const baseUrl = 'https://placeholder.com';
  const { searchParams } = new URL(req.url, baseUrl);
  const action = searchParams.get('action');
  const tab    = searchParams.get('tab');
  const data   = searchParams.get('data');

  // ── READ ──────────────────────────────────────────────────────────────────
  if (action === 'read') {
    if (!tab) return res.status(400).json({ status: 'error', msg: 'Missing tab' });
    try {
      const url = `${APPS_SCRIPT_URL}?action=read&tab=${encodeURIComponent(tab)}`;
      const r = await fetch(url, { method: 'GET', redirect: 'follow' });
      const json = JSON.parse(await r.text());
      return res.status(200).json(json);
    } catch (err) {
      return res.status(500).json({ status: 'error', msg: err.message });
    }
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────
  if (data) {
    try {
      const payload = JSON.parse(decodeURIComponent(data));
      const jsonStr = JSON.stringify(payload);

      // Method 1: GET with ?data=
      const url = `${APPS_SCRIPT_URL}?data=${encodeURIComponent(jsonStr)}`;
      const r = await fetch(url, { method: 'GET', redirect: 'follow' });
      const text = await r.text();
      console.log('Apps Script GET response:', text.substring(0, 200));

      let json;
      try { json = JSON.parse(text); } catch {}
      if (json?.status === 'ok') {
        return res.status(200).json({ status: 'ok', written: json.written || payload.mappings?.length || 0 });
      }

      // Method 2: POST form-encoded
      const r2 = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(jsonStr),
        redirect: 'follow',
      });
      const text2 = await r2.text();
      console.log('Apps Script POST response:', text2.substring(0, 200));

      let json2;
      try { json2 = JSON.parse(text2); } catch {}
      if (json2?.status === 'ok') {
        return res.status(200).json({ status: 'ok', written: json2.written || payload.mappings?.length || 0 });
      }

      return res.status(200).json({
        status: 'error',
        msg: 'Apps Script did not return ok',
        get_response: text.substring(0, 200),
        post_response: text2.substring(0, 200),
      });

    } catch (err) {
      return res.status(500).json({ status: 'error', msg: err.message });
    }
  }

  return res.status(400).json({ status: 'error', msg: 'Unknown action' });
}
