import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';

interface CopernicusToken {
  access_token: string;
  expires_at: number; // Timestamp when token expires
}

interface NDVIRequest {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

// In-memory token cache
let tokenCache: CopernicusToken | null = null;

/**
 * Get Copernicus Dataspace access token with caching
 */
export async function getCopernicusToken(): Promise<string> {
  // Check if cached token is still valid
  if (tokenCache && Date.now() < tokenCache.expires_at) {
    const remainingSeconds = Math.floor((tokenCache.expires_at - Date.now()) / 1000);
    console.log(`Using cached CDSE token (expires in ${remainingSeconds}s)`);
    return tokenCache.access_token;
  }

  // Get credentials from environment
  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET must be set');
  }

  console.log('Fetching new CDSE OAuth token...');

  const tokenUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';

  try {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = response.data;

    // Cache token with 5 minute buffer before expiry
    const expiresAt = Date.now() + (expires_in - 300) * 1000;
    tokenCache = {
      access_token,
      expires_at: expiresAt,
    };

    console.log(`CDSE token obtained (expires in ${expires_in}s)`);
    return access_token;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to get CDSE token: ${error.response?.data?.error_description || error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch NDVI from Copernicus Sentinel-2 L2A Process API
 */
export async function fetchNDVI(request: NDVIRequest, token: string): Promise<Buffer> {
  const processUrl = 'https://sh.dataspace.copernicus.eu/api/v1/process';

  // Evalscript to compute NDVI
  const evalscript = `
//VERSION=3
function setup() {
  return {
    input: ["B04", "B08"],
    output: { bands: 1 }
  };
}

function evaluatePixel(sample) {
  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  return [ndvi];
}
`;

  const requestBody = {
    input: {
      bounds: {
        bbox: request.bbox,
        properties: {
          crs: 'http://www.opengis.net/def/crs/EPSG/0/4326',
        },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: {
              from: `${request.from}T00:00:00Z`,
              to: `${request.to}T23:59:59Z`,
            },
            maxCloudCoverage: 30,
          },
        },
      ],
    },
    output: {
      width: 512,
      height: 512,
      responses: [
        {
          identifier: 'default',
          format: {
            type: 'image/png',
          },
        },
      ],
    },
    evalscript,
  };

  console.log('Calling Copernicus Process API...');
  console.log(`Bbox: ${request.bbox}`);
  console.log(`Time range: ${request.from} to ${request.to}`);

  try {
    const response = await axios.post(processUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
      },
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout
    });

    console.log('NDVI image received successfully');
    return Buffer.from(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data 
        ? Buffer.from(error.response.data).toString('utf-8')
        : error.message;
      throw new Error(`Copernicus Process API error: ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Get NDVI for a twin parcel (legacy - kept for compatibility)
 */
export async function getTwinNDVI(
  twinId: string,
  bbox: [number, number, number, number],
  date?: string
): Promise<string> {
  // Use recent date if not specified (30 days ago)
  const targetDate = date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fromDate = targetDate;
  const toDate = new Date(new Date(targetDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get token and fetch NDVI
  const token = await getCopernicusToken();
  const imageBuffer = await fetchNDVI(
    {
      bbox,
      from: fromDate,
      to: toDate,
    },
    token
  );

  // Save to disk
  const dataDir = path.join(process.cwd(), 'data', twinId);
  await fs.mkdir(dataDir, { recursive: true });
  const ndviPath = path.join(dataDir, 'ndvi.png');
  await fs.writeFile(ndviPath, imageBuffer);

  return ndviPath;
}

