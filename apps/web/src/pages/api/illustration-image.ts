import type { NextApiRequest, NextApiResponse } from 'next';

const ILLUSTRATION_URL = process.env.ILLUSTRATION_URL || 'http://geotwin-illustration:8001';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const path = req.query.path;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Only allow /generated/ paths to prevent SSRF
  if (!path.startsWith('/generated/')) {
    return res.status(403).json({ error: 'Forbidden path' });
  }

  try {
    const response = await fetch(`${ILLUSTRATION_URL}${path}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Image not found' });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Illustration service unavailable: ${msg}` });
  }
}
