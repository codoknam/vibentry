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
- build command: `npm install`
- start command: `npm start`
- health check path: `/api/status`

## Important

The app runs as a server because the browser UI calls `/api/template` and `/api/status`.
