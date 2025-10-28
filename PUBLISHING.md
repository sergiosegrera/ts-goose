# Publishing ts-goose to npm

## Automated Publishing (Recommended)

The repository includes a GitHub Action that automatically publishes to npm when you push a version tag.

### Setup (One-time)

1. Create an npm access token:
   - Go to https://www.npmjs.com/settings/[your-username]/tokens
   - Click "Generate New Token" → "Automation"
   - Copy the token

2. Add the token to GitHub:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: paste your npm token
   - Click "Add secret"

### Publishing a New Version

1. Update the version and create a git tag:
   ```bash
   # Patch release (1.0.0 -> 1.0.1)
   npm version patch
   
   # Minor release (1.0.0 -> 1.1.0)
   npm version minor
   
   # Major release (1.0.0 -> 2.0.0)
   npm version major
   ```

2. Push the tag to GitHub:
   ```bash
   git push && git push --tags
   ```

3. The GitHub Action will automatically:
   - Run tests
   - Build the project
   - Publish to npm with provenance

You can monitor the publish progress in the "Actions" tab of your GitHub repository.

## Manual Publishing

## Prerequisites

1. Create an npm account at https://www.npmjs.com/signup if you don't have one
2. Login to npm:
   ```bash
   npm login
   ```

## Before Publishing

1. Update the version in `package.json` following [semver](https://semver.org/):
   ```bash
   # Patch release (1.0.0 -> 1.0.1)
   npm version patch
   
   # Minor release (1.0.0 -> 1.1.0)
   npm version minor
   
   # Major release (1.0.0 -> 2.0.0)
   npm version major
   ```

2. Update the author and repository fields in `package.json`

3. Build the project:
   ```bash
   bun run build
   ```

4. Test the built CLI locally:
   ```bash
   ./dist/cli.js status
   ```

## Publishing

### Dry run (check what will be published)
```bash
npm pack --dry-run
```

### Publish to npm
```bash
npm publish
```

Or if you prefer using bun:
```bash
bun publish
```

### For scoped packages (if you change the name to @yourusername/ts-goose)
```bash
npm publish --access public
```

## After Publishing

Users can now install and use your CLI:

```bash
# Run without installation
bunx ts-goose status
pnpx ts-goose status
npx ts-goose status

# Or install globally
bun add -g ts-goose
pnpm add -g ts-goose
npm install -g ts-goose

# Then use
ts-goose status
```

## Updating the Package

1. Make your changes
2. Run tests (if you have them)
3. Update version: `npm version patch|minor|major`
4. Build: `bun run build`
5. Publish: `npm publish`

## Notes

- The `prepublishOnly` script in `package.json` automatically builds before publishing
- Only files listed in the `files` field (and README, LICENSE, package.json) will be published
- The `.npmignore` file excludes development files
- Make sure `dist/cli.js` has the shebang (`#!/usr/bin/env bun`) and is executable

