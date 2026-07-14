# vibentry

`vibentry` is a Korean-first AI chat interface for creating and editing Entry `.ent` projects with Gemini API keys supplied by end users.

## Features

- Chat-style UI inspired by coding assistants
- Full-screen Entry AI Workbench popup with observable task stages, elapsed time, model status, URL citations, objects, stage positions, and block code
- Direct Workbench editing: add/delete objects, drag them on a 480x270 Entry stage, edit properties, add verified quick blocks, or edit advanced script JSON
- Supports new project generation and `.ent` editing flows
- Reads Entry template data from `templates/blank-entry-template.json`
- Repairs IDs, asset references, script JSON, and verified block types against a known-good template
- Preserves non-project files from uploaded `.ent` archives while editing
- Runs long Gemini coding tasks with the Interactions API background mode and high thinking level
- Discovers text-capable models from the user's API key, prioritizes the strongest current coding model, and falls back automatically when a model is unavailable
- Keeps stateful Gemini interactions for stronger follow-up edits while also retaining local and optional cross-device chat memory
- Uses Gemini URL Context for public links and surfaces returned source citations in the Workbench
- Sends up to four PNG/JPEG/WebP attachments as real multimodal image input, with an 8MB combined safety limit
- Generates custom images and embeds image/thumb bytes into official Entry-style sharded asset paths inside the `.ent` archive
- Reopens and validates every generated `.ent` before showing it as an AI response file card
- Uses a tiny Node server for static assets plus `/api/template` and `/api/status`

## Local run

```bash
npm ci
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

- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/api/status`

## Files

- `public/`: UI files
- `public/entry-safety.js`: deterministic project repair and validation
- `public/entry-archive.js`: `.ent` TAR/gzip reader and writer
- `public/entry-assets.js`: generated image conversion and official Entry archive asset layout
- `public/entry-workbench.js`: deterministic object and verified quick-block editing engine
- `public/entry-workbench-ui.js`: observable AI progress and direct editing popup
- `server.mjs`: Node web server
- `templates/blank-entry-template.json`: starter Entry project template
- `scripts/build_blank_template.mjs`: helper to rebuild the starter template
