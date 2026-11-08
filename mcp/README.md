# Detourmap MCP server

The atlas as tools for AI assistants — search the places by name, find what's worth a detour near a coordinate, pull fame rankings and per-country statistics. The server reads its counts and its kinds from the data it loads, so what it tells a client is what the map holds today.

**You don't need to run this.** A free hosted instance is live:

```
https://detourmap.com/mcp
```

- **Claude (claude.ai):** Settings → Connectors → *Add custom connector* → paste the URL
- **Claude Code:** `claude mcp add --transport http detourmap https://detourmap.com/mcp`
- **Any MCP client:** `{ "mcpServers": { "detourmap": { "type": "http", "url": "https://detourmap.com/mcp" } } }`

Registry entry: [`com.detourmap/places`](https://registry.modelcontextprotocol.io/v0/servers?search=detourmap) · Details: [detourmap.com/mcp-server](https://detourmap.com/mcp-server/)

## Run it yourself

From the repo root:

```bash
node mcp/server.mjs
```

Zero dependencies — plain Node ≥ 18. It finds the dataset automatically (`PLACES_JSON` env override → the hosted path → [`../data/places-compact.json`](../data/) from this repo). `PORT` / `HOST` env to change the bind (default `127.0.0.1:8894`, endpoint `/mcp`).

## About this code

`server.mjs` is the exact source of the hosted server: stateless Streamable-HTTP JSON-RPC, read-only, no auth, CORS open. It serves the same open dataset that ships in [`../data/`](../data/) (CC0).

Tools: `search_places` · `get_place` · `places_near` · `top_places` · `list_kinds` · `list_countries` · `get_statistics` · `random_place`
