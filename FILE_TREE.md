# GeoTwin - Complete File Tree

```
Geotwin/
│
├── .github/                          # GitHub configuration
│   ├── workflows/
│   │   └── ci.yml                    # CI/CD pipeline
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md            # Bug report template
│   │   └── feature_request.md       # Feature request template
│   └── PULL_REQUEST_TEMPLATE.md     # PR template
│
├── apps/                             # Application packages
│   ├── api/                          # Backend API (Fastify)
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── presets.ts       # Visual style presets
│   │   │   ├── parsers/
│   │   │   │   ├── index.ts         # Parser router
│   │   │   │   ├── kml.ts           # KML parser
│   │   │   │   ├── gml.ts           # GML parser
│   │   │   │   └── zip.ts           # ZIP extractor
│   │   │   ├── routes/
│   │   │   │   └── import.ts        # API routes
│   │   │   ├── services/
│   │   │   │   ├── demo-generator.ts    # Demo data generation
│   │   │   │   ├── recipe-generator.ts  # Twin recipe creation
│   │   │   │   └── storage.ts           # Local storage
│   │   │   └── server.ts            # Main server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   │
│   └── web/                          # Frontend (Next.js)
│       ├── public/
│       │   └── sample-data/
│       │       ├── 40212A00200007.kml      # Sample KML
│       │       ├── 40212A00200007 (1).gml  # Sample GML
│       │       └── README.md
│       ├── src/
│       │   ├── components/
│       │   │   ├── CesiumViewer.tsx       # 3D viewer
│       │   │   ├── LayerControls.tsx      # Layer toggles
│       │   │   ├── UploadPanel.tsx        # Upload UI
│       │   │   └── ViewerContainer.tsx    # Layout
│       │   ├── pages/
│       │   │   ├── _app.tsx               # App wrapper
│       │   │   ├── _document.tsx          # HTML document
│       │   │   └── index.tsx              # Main page
│       │   └── styles/
│       │       └── globals.css            # Global styles
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.js
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       ├── next-env.d.ts
│       └── .env.example
│
├── packages/                         # Shared packages
│   └── types/                        # TypeScript types
│       ├── src/
│       │   └── index.ts              # Type definitions
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/                          # Helper scripts
│   └── create-sample-zip.sh         # Create sample ZIP
│
├── data/                             # Generated twin data (gitignored)
│   └── <twinId>/
│       ├── scene.json
│       └── geometry.geojson
│
├── package.json                      # Root package
├── pnpm-workspace.yaml              # Workspace config
├── pnpm-lock.yaml                   # Lock file
├── tsconfig.json                    # Base TypeScript config
├── .gitignore                       # Git ignore rules
├── .prettierrc                      # Prettier config
├── .eslintrc.json                   # ESLint config
│
├── README.md                        # Main documentation
├── QUICKSTART.md                    # Quick start guide
├── ARCHITECTURE.md                  # Architecture overview
├── API.md                           # API reference
├── CONTRIBUTING.md                  # Contribution guidelines
├── CHANGELOG.md                     # Version history
├── PROJECT.md                       # Project summary
├── SECURITY.md                      # Security policy
├── BANNER.md                        # ASCII banner
├── LICENSE                          # MIT License
│
└── dev.sh                           # Development helper script
```

## File Count

- **Source Files**: ~30 TypeScript/JavaScript files
- **Configuration Files**: ~15 config files
- **Documentation Files**: 9 markdown files
- **Sample Data**: 3 files
- **Total Lines of Code**: ~4,000+ LOC

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `apps/api` | Backend API server |
| `apps/web` | Frontend Next.js app |
| `packages/types` | Shared TypeScript types |
| `.github` | GitHub workflows & templates |
| `scripts` | Helper scripts |
| `data` | Generated twin data (runtime) |

## Entry Points

- **API Server**: `apps/api/src/server.ts`
- **Web App**: `apps/web/src/pages/index.tsx`
- **Types**: `packages/types/src/index.ts`

## Build Artifacts (gitignored)

- `node_modules/` - Dependencies
- `dist/` - Compiled TypeScript
- `.next/` - Next.js build
- `data/` - Generated twin data
- `*.log` - Log files
