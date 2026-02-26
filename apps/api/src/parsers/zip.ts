import type { MultipartFile } from '@fastify/multipart';
import JSZip from 'jszip';
import { parseKML } from './kml.js';
import { parseGML } from './gml.js';
import type { GeoJSONGeometry } from '@geotwin/types';

/**
 * Parse ZIP file, extract KML or GML, and return geometry
 */
export async function parseZIP(file: MultipartFile): Promise<GeoJSONGeometry | null> {
  const buffer = await file.toBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // Look for KML or GML files
  for (const filename in zip.files) {
    const lowerFilename = filename.toLowerCase();

    if (lowerFilename.endsWith('.kml')) {
      const content = await zip.files[filename].async('nodebuffer');
      const mockFile = createMockFile(content, filename);
      return await parseKML(mockFile);
    } else if (lowerFilename.endsWith('.gml') || lowerFilename.endsWith('.xml')) {
      const content = await zip.files[filename].async('nodebuffer');
      const mockFile = createMockFile(content, filename);
      return await parseGML(mockFile);
    }
  }

  throw new Error('No KML or GML file found in ZIP archive');
}

/**
 * Create a mock MultipartFile from buffer
 */
function createMockFile(buffer: Buffer, filename: string): MultipartFile {
  return {
    filename,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    toBuffer: async () => buffer,
    file: {} as any,
    fieldname: 'file',
    fields: {},
  } as MultipartFile;
}
