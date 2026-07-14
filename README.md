# vibentry deploy workspace

This repository is prepared so the `ent-ai-studio` app can be deployed on Render from a monorepo root.

## App location

- App source: `ent-ai-studio/`
- Render blueprint: `render.yaml`

## Render settings

The included `render.yaml` config deploys:

- service type: `web`
- runtime: `node`
- root directory: `ent-ai-studio`
- build command: `npm ci`
- start command: `npm start`
- health check path: `/api/status`
- a Render Postgres database for cross-device conversations, projects, and safe AI memory
- an automatically generated `CLOUD_TOKEN_SECRET`

## Important

The app runs as a server because the browser UI calls `/api/template` and `/api/status`.

## Cross-device storage

The browser always saves locally first. Users can optionally create a `VIBE-XXXX-XXXX` sync code and a numeric PIN to synchronize all chats and Entry project snapshots across devices.

Completed `.ent` projects appear as downloadable file cards inside the AI response, rather than as a permanent download button in the project inspector.

The Entry AI Workbench popup shows safe, observable task milestones instead of hidden chain-of-thought. It lets users inspect objects and scripts, drag objects, add or delete objects, add verified blocks, edit raw script JSON, and apply the validated draft back to the current chat project.

Gemini-generated images are stored as real files under Entry-compatible `temp/<2>/<2>/image/` and `thumb/` archive paths. Public links supplied in prompts are passed to Gemini URL Context, and returned citations appear in the Workbench.

The app discovers text-capable Gemini models available to each API key, prioritizes the strongest coding model, and falls back automatically. PNG/JPEG/WebP attachments are sent as actual multimodal input so the AI can inspect them before reusing them in an Entry object.

- `DATABASE_URL` is supplied from the `vibentry-db` Render Postgres resource.
- PINs are stored as salted scrypt hashes.
- Login tokens are stored as SHA-256 hashes and expire after 90 days.
- Gemini API keys are never sent to or stored by the vibentry server.
- Source `.ent` assets are synchronized as base64 when the conversation stays within the server request limit. Oversized projects remain safely available on the original device and show a clear sync warning.

For long-term production use, review the limits and retention terms of the selected Render Postgres plan before launch.

## Deployment handoff

Use [`DEPLOY_PROMPT.md`](./DEPLOY_PROMPT.md) as the copy-ready prompt for a Codex task that has GitHub and Render browser access. It includes preflight checks, safe deployment steps, and a two-device acceptance test.
