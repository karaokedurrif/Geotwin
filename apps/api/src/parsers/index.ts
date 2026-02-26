import type { MultipartFile } from '@fastify/multipart';
import { parseKML } from './kml.js';
import { parseGML } from './gml.js';
import { parseZIP } from './zip.js';

/**
 * Parse an uploaded file and extract geometry
 */
export async function parseFile(file: MultipartFile) {
  const filename = file.filename.toLowerCase();
  
  if (filename.endsWith('.kml')) {
    return await parseKML(file);
  } else if (filename.endsWith('.gml') || filename.endsWith('.xml')) {
    return await parseGML(file);
  } else if (filename.endsWith('.zip')) {
    return await parseZIP(file);
  } else {
    throw new Error('Unsupported file type. Supported: KML, GML, ZIP');
  }
}
