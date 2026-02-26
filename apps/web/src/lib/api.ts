/**
 * GeoTwin API Client
 * Centralized API calls for Next.js web app
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export interface UploadOptions {
  file: File;
  preset: 'mountain' | 'dehesa' | 'mediterranean';
  onProgress?: (status: string) => void;
}

export interface LoadSampleOptions {
  preset: 'mountain' | 'dehesa' | 'mediterranean';
  onProgress?: (status: string) => void;
}

/**
 * Upload a cadastral file and generate a twin
 */
export async function uploadCadastralFile(options: UploadOptions) {
  const { file, preset, onProgress } = options;

  onProgress?.('Uploading file...');

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/import?preset=${preset}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Upload failed');
  }

  onProgress?.('Parsing geometry...');
  const data = await response.json();

  if (!data.success || !data.recipe) {
    throw new Error(data.error || 'Failed to generate twin');
  }

  onProgress?.('Twin ready ✓');
  return data.recipe;
}

/**
 * Load sample data without file upload
 */
export async function loadSampleData(options: LoadSampleOptions) {
  const { preset, onProgress } = options;

  onProgress?.('Loading sample twin...');

  const response = await fetch(`${API_BASE_URL}/api/sample?preset=${preset}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to load sample');
  }

  onProgress?.('Generating demo layers...');
  const data = await response.json();

  if (!data.success || !data.recipe) {
    throw new Error(data.error || 'Failed to generate twin');
  }

  onProgress?.('Twin ready ✓');
  return data.recipe;
}

/**
 * Fetch twin recipe by ID
 */
export async function getTwinById(twinId: string) {
  const response = await fetch(`${API_BASE_URL}/api/twin/${twinId}`);

  if (!response.ok) {
    throw new Error('Twin not found');
  }

  return response.json();
}

/**
 * Health check
 */
export async function healthCheck() {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}

/**
 * Fetch real NDVI from Copernicus Sentinel-2
 */
export async function fetchNDVI(twinId: string, options?: { date?: string; refresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.date) params.append('date', options.date);
  if (options?.refresh) params.append('refresh', 'true');

  const url = `${API_BASE_URL}/api/twin/${twinId}/ndvi${params.toString() ? `?${params.toString()}` : ''}`;
  
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch NDVI');
  }

  // Return blob URL for the image
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetch NDVI with custom bbox and date range
 */
export async function fetchNDVICustom(bbox: [number, number, number, number], from: string, to: string) {
  const response = await fetch(`${API_BASE_URL}/api/ndvi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bbox, from, to }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch NDVI' }));
    throw new Error(error.message || 'Failed to fetch NDVI');
  }

  // Return blob for the image
  const blob = await response.blob();
  return blob;
}
