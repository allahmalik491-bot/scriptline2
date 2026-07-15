// This ONE file handles everything: serves your website's files (index.html etc.)
// AND answers /api/transcript requests. Cloudflare's current system wants a single
// script like this instead of the older separate "functions" folder approach.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only /api/transcript is handled here — everything else (index.html, etc.)
    // is served automatically from the "public" folder via the assets binding below.
    if (url.pathname === '/api/transcript') {
      return handleTranscript(url, request);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleTranscript(url, request) {
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

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // Without this, YouTube sometimes serves a cookie-consent page instead of
        // the real video page when the request comes from a datacenter IP — and
        // that consent page has no captionTracks at all.
        'Cookie': 'CONSENT=YES+cb.20240101-17-p0.en+FX+123',
      },
    });
    const html = await pageRes.text();

    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) {
      const reason = html.includes('consent.youtube.com') || html.includes('Before you continue')
        ? 'YouTube served a consent page instead of the video (cloud-IP issue) — try again, or this video/region may need a different fix.'
        : 'No captions track found in the page for this video.';
      return new Response(JSON.stringify({ error: reason }), { status: 404, headers: cors });
    }
    const tracks = JSON.parse(match[1]);
    const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];

    const xmlRes = await fetch(track.baseUrl);
    const xml = await xmlRes.text();

    const entries = [...xml.matchAll(/<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)];
    const decode = s => s
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\n/g, ' ').trim();

    const transcript = entries.map(([, start, dur, text]) => ({
      start: parseFloat(start),
      dur: parseFloat(dur),
      text: decode(text),
    }));

    if (!transcript.length) {
      return new Response(JSON.stringify({ error: 'Could not parse captions for this video.' }), { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ transcript }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), { status: 502, headers: cors });
  }
}
