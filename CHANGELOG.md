# Changelog

All notable changes to GeoTwin Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Real satellite data integration (Sentinel-2)
- Cloud storage support (S3/GCS)
- User authentication
- PostgreSQL + PostGIS integration
- Real-time collaboration
- Solar panel placement optimization
- Carbon sequestration modeling

## [0.1.0] - 2026-02-18

### Added
- Initial MVP release
- Monorepo structure with pnpm workspaces
- TypeScript end-to-end implementation
- Next.js web application with CesiumJS integration
- Fastify API server
- KML file parser
- GML file parser
- ZIP file extractor
- Three style presets (Mountain, Dehesa, Mediterranean)
- Five data layers:
  - Parcel boundary
  - Parcel extrusion
  - NDVI heatmap (demo)
  - Water points (demo)
  - ROI labels (demo)
- Interactive 3D visualization with CesiumJS
- Layer visibility toggles
- Camera positioning based on parcel centroid
- Local file storage
- Sample cadastral data files
- Comprehensive documentation:
  - README.md
  - QUICKSTART.md
  - ARCHITECTURE.md
  - API.md
  - CONTRIBUTING.md
- Tailwind CSS styling with premium climate-tech theme
- Deterministic demo data generation
- GeoJSON geometry export
- Twin recipe JSON format
- Shared TypeScript types package
- Error handling for invalid files
- Multi-format support (KML, GML, ZIP)

### Developer Experience
- Format checking with Prettier
- Type checking with TypeScript
- ESLint configuration
- Development mode with hot reload
- Build scripts for production

---

## Release Notes

### v0.1.0 - MVP Release

This is the initial release of GeoTwin Engine, a platform for creating interactive 3D geospatial twins from cadastral files.

**Key Features:**
- Upload cadastral files (KML, GML, ZIP)
- Choose from 3 visual style presets
- View parcels in 3D with terrain and satellite imagery
- Toggle multiple data layers
- Demo NDVI, water points, and ROI labels

**Known Limitations:**
- Demo data only (no real satellite integration)
- Local storage only (no cloud)
- No authentication
- No rate limiting
- Single-server architecture

**Requirements:**
- Node.js >= 18.0.0
- pnpm >= 8.0.0

**Getting Started:**
```bash
pnpm install
pnpm --filter @geotwin/types build
pnpm dev
```

Visit http://localhost:3000 to start creating geospatial twins!

---

[unreleased]: https://github.com/karaokedurrif/Geotwin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/karaokedurrif/Geotwin/releases/tag/v0.1.0
