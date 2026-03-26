import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

/**
 * Proxy for PNOA WMTS (pre-rendered tiles — much faster than WMS).
 * Forwards requests to https://www.ign.es/wmts/pnoa-ma
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const ignUrl = `https://www.ign.es/wmts/pnoa-ma?${queryString}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(ignUrl, {
      headers: {
        'User-Agent': 'GeoTwin/1.0',
        'Accept': 'image/jpeg,image/png,image/*',
        'Referer': 'https://www.ign.es/',
      },
      signal: controller.signal,
      cache: 'no-store',
    } as any);
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).send('IGN WMTS error');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';

    if (contentType.includes('xml') || contentType.includes('html')) {
      return res.status(502).send('IGN WMTS returned error document');
    }

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days — tiles don't change often
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[PNOA-WMTS proxy] Error:', error?.name, error?.message);
    res.status(502).send('PNOA WMTS proxy error');
  }
}
