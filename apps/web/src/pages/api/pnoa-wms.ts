import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

/**
 * PNOA WMS proxy: /api/pnoa-wms?SERVICE=WMS&BBOX=...&WIDTH=...&HEIGHT=...
 *
 * Unlike the WMTS tile proxy (/api/pnoa-tile), this endpoint forwards to
 * IGN's WMS service which supports arbitrary pixel sizes (up to 2048×2048).
 * This is critical for small parcels where WMTS's fixed 256×256 tiles are
 * too coarse.
 *
 * Cesium's WebMapServiceImageryProvider sends all WMS params as query strings.
 * We forward them to IGN, forcing PNG format and EPSG:4326.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;

  // Extract standard WMS params (Cesium sends them in various cases)
  const bbox = (q.bbox || q.BBOX) as string | undefined;
  const width = (q.width || q.WIDTH) as string | undefined;
  const height = (q.height || q.HEIGHT) as string | undefined;
  const layers = (q.layers || q.LAYERS || 'OI.OrthoimageCoverage') as string;

  if (!bbox || !width || !height) {
    return res.status(400).json({ error: 'Missing WMS params: bbox, width, height' });
  }

  // Sanitize dimensions (prevent abuse)
  const w = parseInt(String(width), 10);
  const h = parseInt(String(height), 10);
  if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 2048 || h > 2048) {
    return res.status(400).json({ error: 'width/height must be 1-2048' });
  }

  // Build IGN WMS URL — force PNG + EPSG:4326
  const ignUrl = new URL('https://www.ign.es/wms-inspire/pnoa-ma');
  ignUrl.searchParams.set('SERVICE', 'WMS');
  ignUrl.searchParams.set('VERSION', '1.1.1');
  ignUrl.searchParams.set('REQUEST', 'GetMap');
  ignUrl.searchParams.set('LAYERS', layers);
  ignUrl.searchParams.set('SRS', 'EPSG:4326');
  ignUrl.searchParams.set('BBOX', bbox);
  ignUrl.searchParams.set('WIDTH', String(w));
  ignUrl.searchParams.set('HEIGHT', String(h));
  ignUrl.searchParams.set('FORMAT', 'image/png');
  ignUrl.searchParams.set('STYLES', '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(ignUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GeoTwin/1.0)',
        'Accept': 'image/png,image/*',
      },
      signal: controller.signal,
    } as RequestInit);
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `IGN WMS returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (contentType.includes('xml') || contentType.includes('html')) {
      return res.status(502).json({ error: 'IGN WMS returned error XML' });
    }

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return res.status(504).json({ error: 'IGN WMS timeout' });
    }
    return res.status(502).json({ error: 'IGN WMS fetch failed' });
  }
}
