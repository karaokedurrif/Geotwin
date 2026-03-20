import type { NextApiRequest, NextApiResponse } from 'next';

const ILLUSTRATION_URL = process.env.ILLUSTRATION_URL || 'http://geotwin-illustration:8001';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(`${ILLUSTRATION_URL}/generate-ai-illustration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Illustration service unavailable: ${msg}` });
  }
}
