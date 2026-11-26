export interface Config {
  port: number;
}

// Azure App Service (Linux) injects PORT; fall back to 3000 for local development.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  return { port };
}
