import { createTopicHttpServer } from './src/server.js';

const port = Number(process.env.PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}
const server = createTopicHttpServer();
server.once('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'The local MCP port is already in use.' : 'The local MCP server could not start.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`MyHealthfinder MCP listening at http://127.0.0.1:${port}/mcp`);
});
