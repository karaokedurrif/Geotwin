# Contributing to GeoTwin Engine

Thank you for your interest in contributing to GeoTwin Engine!

## Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/karaokedurrif/Geotwin.git
   cd Geotwin
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Build Shared Packages**
   ```bash
   pnpm --filter @geotwin/types build
   ```

4. **Start Development Servers**
   ```bash
   pnpm dev
   ```

## Project Structure

- `apps/web`: Next.js web application
- `apps/api`: Fastify API server
- `packages/types`: Shared TypeScript types

## Code Style

- We use **Prettier** for code formatting
- We use **ESLint** for linting
- Run `pnpm format` before committing
- Run `pnpm typecheck` to ensure types are correct

## Making Changes

1. Create a new branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run tests and type checking: `pnpm typecheck`
4. Format code: `pnpm format`
5. Commit with a clear message
6. Push and create a pull request

## Commit Messages

Use clear, descriptive commit messages:
- `feat: add NDVI layer support`
- `fix: resolve polygon parsing issue`
- `docs: update README with new presets`
- `refactor: improve demo data generation`

## Adding New Features

### New Style Preset

1. Add preset config in `apps/api/src/config/presets.ts`
2. Update `StylePreset` type in `packages/types/src/index.ts`
3. Add UI button in `apps/web/src/components/UploadPanel.tsx`

### New Data Layer

1. Add layer type to `packages/types/src/index.ts`
2. Generate data in `apps/api/src/services/demo-generator.ts`
3. Add layer config in `apps/api/src/services/recipe-generator.ts`
4. Render in `apps/web/src/components/CesiumViewer.tsx`

### New File Format Parser

1. Create parser in `apps/api/src/parsers/`
2. Add to switch in `apps/api/src/parsers/index.ts`
3. Update file input accept in `apps/web/src/components/UploadPanel.tsx`

## Questions?

Open an issue or discussion on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
