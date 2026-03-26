import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

/**
 * Direct PNOA tile proxy: /api/pnoa-tile/[z]/[x]/[y]
 * Constructs the exact WMTS KVP URL for IGN's PNOA service.
 * Used with Cesium UrlTemplateImageryProvider for guaranteed correct URLs.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { tile } = req.query;

  if (!Array.isArray(tile) || tile.length !== 3) {
    return res.status(400).send('Expected /api/pnoa-tile/{z}/{x}/{y}');
  }

  const [z, x, y] = tile;

  // Validate numeric params
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).send('Invalid tile coordinates');
  }

  const ignUrl = `https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix=${z}&TileRow=${y}&TileCol=${x}&format=image/jpeg`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(ignUrl, {
      headers: {
        'User-Agent': 'GeoTwin/1.0',
        'Accept': 'image/jpeg,image/png,image/*',
        'Referer': 'https://www.ign.es/',
      },
      signal: controller.signal,
      cache: 'no-store',
    } as RequestInit);
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[PNOA-tile] IGN ${response.status} for z=${z} x=${x} y=${y}`);
      return res.status(response.status).send('IGN tile error');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('xml') || contentType.includes('html')) {
      return res.status(502).send('IGN returned error document');
    }

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error(`[PNOA-tile] Error z=${z} x=${x} y=${y}:`, msg);
    res.status(502).send('PNOA tile proxy error');
  }
}
