import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

// 1x1 transparent PNG to serve as fallback when IGN fails
const TRANSPARENT_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

function sendTransparent(res: NextApiResponse) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(TRANSPARENT_1PX);
}

/**
 * Direct PNOA tile proxy: /api/pnoa-tile/[z]/[x]/[y]
 * Constructs the exact WMTS KVP URL for IGN's PNOA service.
 * Used with Cesium UrlTemplateImageryProvider for guaranteed correct URLs.
 * Returns transparent 1px PNG on error so the base layer shows through.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { tile } = req.query;

  if (!Array.isArray(tile) || tile.length !== 3) {
    return res.status(400).send('Expected /api/pnoa-tile/{z}/{x}/{y}');
  }

  // Strip Cesium retry/subdomain suffixes like ":1" from tile coordinates
  const z = tile[0].replace(/:[^/]*$/, '');
  const x = tile[1].replace(/:[^/]*$/, '');
  const y = tile[2].replace(/:[^/]*$/, '');

  // Validate numeric params
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).send('Invalid tile coordinates');
  }

  const ignUrl = `https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix=${z}&TileRow=${y}&TileCol=${x}&format=image/jpeg`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

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
      // Return transparent tile so base imagery (Bing) shows through
      return sendTransparent(res);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('xml') || contentType.includes('html')) {
      return sendTransparent(res);
    }

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch {
    return sendTransparent(res);
  }
}
