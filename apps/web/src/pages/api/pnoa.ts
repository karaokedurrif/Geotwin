import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const ignUrl = `https://www.ign.es/wms-inspire/pnoa-ma?${queryString}`;
  
  try {
    const response = await fetch(ignUrl, {
      headers: {
        'User-Agent': 'GeoTwin/1.0',
        'Accept': 'image/jpeg,image/png,image/*',
        'Referer': 'https://www.ign.es/',
      },
    });
    
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).send('Proxy error');
  }
}
