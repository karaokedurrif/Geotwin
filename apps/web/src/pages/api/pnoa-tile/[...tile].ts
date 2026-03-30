import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

// 256x256 fully transparent PNG — Cesium expects standard tile size
const TRANSPARENT_256 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCO' +
  'PVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==',
  'base64',
);

function sendTransparent(res: NextApiResponse) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(TRANSPARENT_256);
}

/**
 * PNOA WMTS tile proxy: /api/pnoa-tile/[z]/[x]/[y]
 * Proxies tiles from IGN's WMTS (no CORS on IGN).
 * Returns 256x256 transparent PNG on error so Cesium shows base imagery.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { tile } = req.query;

  if (!Array.isArray(tile) || tile.length !== 3) {
    return res.status(400).send('Expected /api/pnoa-tile/{z}/{x}/{y}');
  }

  const z = tile[0].replace(/:[^/]*$/, '');
  const x = tile[1].replace(/:[^/]*$/, '');
  const y = tile[2].replace(/:[^/]*$/, '');

  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).send('Invalid tile coordinates');
  }

  const ignUrl = `https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix=${z}&TileRow=${y}&TileCol=${x}&format=image/jpeg`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(ignUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GeoTwin/1.0)',
        'Accept': 'image/jpeg,image/png,image/*',
      },
      signal: controller.signal,
    } as RequestInit);
    clearTimeout(timeout);

    if (!response.ok) {
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
