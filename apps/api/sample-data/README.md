# Sample Cadastral Data

This directory contains sample cadastral files for testing the GeoTwin Engine.

## Files

- **40212A00200007.kml**: Sample parcel in KML format
- **40212A00200007 (1).gml**: Same parcel in GML format
- **40212A00200007.zip**: ZIP archive containing the KML file

## Parcel Information

- **Location**: Central Spain (approximate)
- **Coordinates**: ~40.987°N, 4.123°W
- **Area**: ~1 hectare (approximate)
- **Format**: EPSG:4326 (WGS84)

## Usage

These files can be uploaded through the web interface or used with the "Load Sample Data" button.

## Testing API Directly

```bash
# Upload KML
curl -X POST \
  'http://localhost:3001/api/import?preset=mountain' \
  -F 'file=@40212A00200007.kml'

# Upload GML
curl -X POST \
  'http://localhost:3001/api/import?preset=dehesa' \
  -F 'file=@40212A00200007 (1).gml'

# Upload ZIP
curl -X POST \
  'http://localhost:3001/api/import?preset=mediterranean' \
  -F 'file=@40212A00200007.zip'
```
