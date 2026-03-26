import type { NextApiRequest, NextApiResponse } from 'next';

const ILLUSTRATION_URL = process.env.ILLUSTRATION_URL || 'http://geotwin-illustration:8001';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = req.query.job_id;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'Missing job_id parameter' });
  }

  try {
    const response = await fetch(`${ILLUSTRATION_URL}/status/${encodeURIComponent(jobId)}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Illustration service unavailable: ${msg}` });
  }
}
