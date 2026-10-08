import { gunzipSync } from 'zlib';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, Authorization, Prefer, X-Body-Encoding');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const path = req.query.path || '';
  const url = `${SUPABASE_URL}/rest/v1/${path}`;

  const params = new URLSearchParams(req.query);
  params.delete('path');
  const fullUrl = params.toString() ? `${url}?${params}` : url;

  try {
    // 클라이언트가 gzip으로 압축해 보낸 본문 (application/octet-stream → req.body는 Buffer)
    let body;
    if (req.method !== 'GET') {
      if (req.headers['x-body-encoding'] === 'gzip') {
        const raw = Buffer.isBuffer(req.body) ? req.body : await readRawBody(req);
        body = gunzipSync(raw).toString('utf8');
      } else {
        body = JSON.stringify(req.body);
      }
    }
    const response = await fetch(fullUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': req.headers['prefer'] || '',
      },
      body,
    });

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return res.status(response.status).end();
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
