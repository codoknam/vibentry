# vibentry

`vibentry` is a Korean-first AI chat interface for creating and editing Entry `.ent` projects with Gemini API keys supplied by end users.

## Features

- Chat-style UI inspired by coding assistants
- Supports new project generation and `.ent` editing flows
- Reads Entry template data from `templates/blank-entry-template.json`
- Repairs IDs, asset references, script JSON, and verified block types against a known-good template
- Preserves non-project files from uploaded `.ent` archives while editing
- Reopens and validates every generated `.ent` before allowing download
- Generates downloadable `.ent` and `project.json` outputs in the browser
- Uses a tiny Node server for static assets plus `/api/template` and `/api/status`

## Local run

```bash
npm install
npm start
```

Run the deterministic Entry repair and archive round-trip tests with:

```bash
npm test
```

Default local URL:

```text
http://localhost:4173
```

## Render deployment

If you deploy from the monorepo root, use the included root `render.yaml`.

If you deploy only this folder directly, use:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/status`

## Files

- `public/`: UI files
- `public/entry-safety.js`: deterministic project repair and validation
- `public/entry-archive.js`: `.ent` TAR/gzip reader and writer
- `server.mjs`: Node web server
- `templates/blank-entry-template.json`: starter Entry project template
- `scripts/build_blank_template.mjs`: helper to rebuild the starter template
