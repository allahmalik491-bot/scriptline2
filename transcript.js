// Cloudflare Pages Function — lives at /api/transcript automatically.
// No Express, no npm package for the fetch itself — just plain fetch(),
// which is what makes this compatible with the Workers runtime.

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('id');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: cors });
  }

  try {
    // 1. Fetch the watch page (with a normal browser user-agent, or YouTube serves a stripped page)
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const html = await pageRes.text();

    // 2. Pull the captionTracks JSON blob out of the page's inline player config
    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'No captions available for this video.' }), { status: 404, headers: cors });
    }
    const tracks = JSON.parse(match[1]);

    // 3. Prefer English, else fall back to the first available track
    const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
    const captionUrl = track.baseUrl;

    // 4. Fetch the actual caption XML and parse it (simple enough to regex — no XML parser in Workers)
    const xmlRes = await fetch(captionUrl);
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
    return new Response(JSON.stringify({ error: 'Could not fetch transcript. Video may be private or region-locked.' }), { status: 502, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
