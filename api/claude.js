export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const isStream = !!body.stream;

    // Sonnet 5.5는 thinking이 기본 ON → 기존(Sonnet 4) 동작 유지를 위해 끔.
    // 작은 max_tokens가 thinking에 소모되거나 content[0]이 thinking 블록이 되는 문제 방지.
    // ({type:'disabled'}는 Sonnet 5.5에서 400 → 'between_tools' 사용)
    if (body.model === 'claude-sonnet-5-5' && !body.thinking) {
      body.thinking = { type: 'between_tools' };
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      return new Response(JSON.stringify(err), {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 스트리밍 — SSE 그대로 전달
    if (isStream) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // 일반 — JSON 반환
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
