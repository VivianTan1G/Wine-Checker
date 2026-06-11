// api/proxy.js — Vercel Serverless Function
// Proxies all Google Sheets read/write calls for the Wine Inventory Checker
// Bypasses CORS restriction that blocks direct browser fetch to Google services

const SHEET_CSV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTqzffmBo4hZPajLyl7ephLcBn26uqgcEaE-rQ2u1vNdrZdMG8-pvTK9nh6ABxeJN6sFC8tTxOqminN/pub?output=csv';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyMXUK3TEboHO6EV9CW8ILXWR8_BhQA205_8FqaaYpFjwmy9qJ0QK8X5Ur75Mu6lJf-/exec';

export default async function handler(req, res) {
  // Allow all origins (the HTML tool is static — no secret data here)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, tab, data } = req.query;

  // ── READ: forward to Apps Script which reads the sheet ────────────────────
  if (action === 'read') {
    if (!tab) {
      return res.status(400).json({ status: 'error', msg: 'Missing tab parameter' });
    }
    try {
      const url = APPS_SCRIPT_URL + '?action=read&tab=' + encodeURIComponent(tab);
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const text = await response.text();
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (err) {
      return res.status(500).json({ status: 'error', msg: err.message });
    }
  }

  // ── WRITE: forward payload to Apps Script ──────────────────────────────────
  if (data) {
    try {
      // payload already has {tab, mappings:[{invoice_name, inventory_name, conversion_factor}]}
      // matching beer & spirits format exactly
      const payload = JSON.parse(decodeURIComponent(data));
      const jsonStr = JSON.stringify(payload);

      // Method 1: GET with ?data= (mirrors what worked in direct browser test)
      const url = APPS_SCRIPT_URL + '?data=' + encodeURIComponent(jsonStr);
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const text = await response.text();
      console.log('Apps Script response:', text.substring(0, 200));

      // Try to parse JSON response
      let json;
      try { json = JSON.parse(text); } catch {}

      if (json?.status === 'ok') {
        return res.status(200).json({ status: 'ok', written: json.written || payload.rows?.length || 0 });
      }
      if (text.toLowerCase().includes('"ok"') || text.toLowerCase().includes("'ok'")) {
        return res.status(200).json({ status: 'ok', written: payload.rows?.length || 0 });
      }

      // Method 2: POST form-encoded with data in body
      const body = 'data=' + encodeURIComponent(jsonStr);
      const response2 = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'follow',
      });
      const text2 = await response2.text();
      console.log('Apps Script POST response:', text2.substring(0, 200));

      let json2;
      try { json2 = JSON.parse(text2); } catch {}

      if (json2?.status === 'ok') {
        return res.status(200).json({ status: 'ok', written: json2.written || payload.rows?.length || 0 });
      }
      if (text2.toLowerCase().includes('ok')) {
        return res.status(200).json({ status: 'ok', written: payload.rows?.length || 0 });
      }

      // Return whatever we got so client can debug
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

  return res.status(400).json({ status: 'error', msg: 'Unknown action — use ?action=read&tab=... or ?data=...' });
}

// ── Parse CSV into mappings array ──────────────────────────────────────────
// Returns [{invoice_name, inventory_name, conversion_factor}, ...]
// Works for both _mappings tabs and _serving_sizes tabs (different column names,
// same positions: col0=key, col1=value, col2=extra)
function parseCsvToMappings(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const mappings = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]);
    if (!cols[0] || !cols[0].trim()) continue;
    mappings.push({
      invoice_name:      cols[0]?.trim() || '',
      inventory_name:    cols[1]?.trim() || '',
      conversion_factor: cols[2]?.trim() || '',
    });
  }
  return mappings;
}

function splitCsv(line) {
  const res = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; }
    else if (c === ',' && !q) { res.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  res.push(cur.trim());
  return res;
}
