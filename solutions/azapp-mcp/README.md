# azapp-mcp

Node.js (TypeScript) MCP server using the Streamable HTTP transport, intended to run on Azure App Service (Linux).

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Process entry point; listens on `PORT` (App Service sets it; defaults to `3000` locally) |
| `src/app.ts` | Express app: `POST /mcp` (stateless MCP endpoint), `GET /health` |
| `src/mcp/server.ts` | MCP server factory and tool registration (currently a placeholder `ping` tool) |
| `src/config.ts` | Environment configuration |
| `src/app.test.ts` | End-to-end test using the MCP SDK client |

## Local development

```powershell
npm install
npm run build
npm start        # http://localhost:3000/mcp
npm test
```

VS Code `mcp.json` entry for local testing:

```json
{ "servers": { "azapp-mcp": { "type": "http", "url": "http://localhost:3000/mcp" } } }
```

## Azure App Service

- Runtime stack: Node 22 LTS on Linux. Startup command: `npm start` (runs `node dist/index.js`).
- Health check path: `/health`.
- Run `npm ci && npm run build` in CI, then deploy `dist/`, `package.json`, `package-lock.json` and production dependencies (`npm ci --omit=dev`). Alternatively enable build-on-deploy (`SCM_DO_BUILD_DURING_DEPLOYMENT=true`), which requires `typescript` to be available at build time.
- The server is stateless (no session IDs), so it scales out without session affinity.

## Not yet implemented (needs decisions)

- **Authentication/authorization.** `/mcp` is currently unauthenticated and must not be exposed with real tools until an approach is approved (for example App Service Authentication with Microsoft Entra ID, or token validation in the server). Per the reference `AGENTS.md`, tenant context must come from trusted authenticated context, never tool arguments.
- **Infrastructure as code** (App Service plan, managed identity, Key Vault, monitoring).
- **Real tools.** Design contracts with the reference `enewbold-mcp-tool-design` skill before adding them in `src/mcp/`.
