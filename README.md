# MyHealthfinder MCP

This development server lets ChatGPT browse public health topics from HHS's MyHealthfinder and open an official article in English or Spanish. It fetches content from ODPHP on each call. The [topic-to-skill registry](solutions/myhealthfinder-mcp/data/myhealthfinder-topic-skill-registry.json) supplies navigation metadata. [Architecture and scope](docs/architecture/solution-profile.md)

## Run locally

The prototype runs on Node.js 22.23.2. From the repository root, use these PowerShell commands.

```powershell
Set-Location .\solutions\myhealthfinder-mcp
npm ci
npm test
npm start
```

The default origin is `http://127.0.0.1:8787` and the Streamable HTTP endpoint is `/mcp`. Keep the process running during plugin tests. Use Ctrl+C to stop a foreground run. Set `$env:PORT` before `npm start` to change the port and use the same port in the tunnel.

## Connect the development plugin

| Setting | Value |
| --- | --- |
| Cloudflare Tunnel public hostname | `myhealthfinder.e-newbold.com` |
| Origin service on the machine running Node | `http://127.0.0.1:8787` |
| ChatGPT custom MCP server URL | `https://myhealthfinder.e-newbold.com/mcp` |
| Authentication for this prototype | No authentication |

1. In the Cloudflare Tunnel configuration, route the hostname to the HTTP origin above. The connector must be able to reach the Node listener. The incoming `/mcp` path should arrive at the origin as `/mcp`. [Cloudflare published application routes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
2. On ChatGPT web, open **Plugins → + → Add custom MCP server**, enter the HTTPS URL and authentication setting above, then create and install the development plugin. Refresh its tool list after changing the server. [OpenAI custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
3. In a fresh chat, select the installed plugin with `@`. Confirm discovery shows exactly `list_health_topics` and `get_health_topic`. A browser address-bar visit does not exercise MCP discovery.

## Test in ChatGPT

| Ask the plugin | Expected observation |
| --- | --- |
| “List five MyHealthfinder topics in English. Open the second topic.” | First call uses `list_health_topics` with `limit: 5`. The next call uses `get_health_topic` with the second returned `topicId` and `language: "en"`. |
| “Open MyHealthfinder topic 527 in Spanish.” | Topic `527` opens in Spanish. Check the official article link, publisher wording, last-updated date and linked MyHealthfinder logo in the article view. |
| “Open MyHealthfinder topic 30602 in Spanish.” | At the reviewed inventory revision, Spanish is unavailable. The plugin should offer an explicit choice before showing English. If ODPHP adds a translation, expect the verified Spanish article instead. |

Check the tool calls as well as the visible answer. The endpoint accepts public topic IDs, language and pagination. The registry's ten skill classifications and 208 sample cases are design and evaluation data. Connecting this endpoint discovers its tools and presentation resource.
