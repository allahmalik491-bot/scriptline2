// This ONE file handles everything: serves your website's files (index.html etc.)
// AND answers /api/transcript requests. Cloudflare's current system wants a single
// script like this instead of the older separate "functions" folder approach.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/transcript') {
      return handleTranscript(url, request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleTranscript(url, request, env) {
  const videoId = url.searchParams.get('id');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: cors });
  }

  if (!env.TRANSCRIPT_API_KEY) {
    return new Response(JSON.stringify({ error: 'Server is missing TRANSCRIPT_API_KEY. Add it in Cloudflare → Settings → Variables and Secrets.' }), { status: 500, headers: cors });
  }

  try {
    // TranscriptAPI.com handles the YouTube side reliably (it doesn't get blocked
    // the way a direct scrape from a cloud IP does) — we just relay its response.
    const apiRes = await fetch(
      `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json&include_timestamp=true`,
      { headers: { Authorization: `Bearer ${env.TRANSCRIPT_API_KEY}` } }
    );
    const data = await apiRes.json();

    if (!apiRes.ok) {
      const msg = (data.detail && (data.detail.message || data.detail)) || `TranscriptAPI error (${apiRes.status})`;
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: cors });
    }

    const transcript = (data.transcript || []).map(seg => ({
      start: seg.start,
      dur: seg.duration,
      text: seg.text.trim(),
    }));

    if (!transcript.length) {
      return new Response(JSON.stringify({ error: 'No transcript available for this video.' }), { status: 404, headers: cors });
    }

    return new Response(JSON.stringify({ transcript }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 502, headers: cors });
  }
}
