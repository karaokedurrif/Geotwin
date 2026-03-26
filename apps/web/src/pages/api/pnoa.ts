import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: { responseLimit: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const ignUrl = `https://www.ign.es/wms-inspire/pnoa-ma?${queryString}`;
  
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
    });
    clearTimeout(timeout);

    // Forward the upstream HTTP status — don't mask errors as 200
    if (!response.ok) {
      return res.status(response.status).send('IGN WMS error');
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // If the IGN server returns XML instead of an image, it's an error response
    if (contentType.includes('xml') || contentType.includes('html')) {
      return res.status(502).send('IGN returned error document');
    }

    const buffer = await response.arrayBuffer();
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    res.status(502).send('PNOA proxy error');
  }
}
