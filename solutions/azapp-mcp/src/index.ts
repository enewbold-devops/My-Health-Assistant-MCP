import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { port } = loadConfig();
const server = createApp().listen(port, () => {
  console.log(`MCP server listening on port ${port} (POST /mcp)`);
});

// App Service sends SIGTERM on stop/restart/scale-in.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
