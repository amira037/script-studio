// Vercel Cron이 하루 한 번 호출 — Supabase 무료 플랜 7일 미사용 자동 일시정지 방지
export default async function handler(req, res) {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/projects?select=id&limit=1`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
