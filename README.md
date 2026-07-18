# Detourmap Places — 70,343 places worth a detour, as open data

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21432200.svg)](https://doi.org/10.5281/zenodo.21432200)

**70,343 places · 16 kinds · 348 countries and territories** — every place with coordinates, a photo and an English Wikipedia article, from [detourmap.com](https://detourmap.com), the interactive world map of places worth going out of your way for: ancient ruins, waterfalls, caves, volcanoes, castles, monuments, museums, ghost towns and more.

🗺️ **Explore it interactively:** [detourmap.com](https://detourmap.com)
🏆 **Every country's single most famous place, ranked:** [detourmap.com/famous](https://detourmap.com/famous/)
🤖 **Use it from an AI assistant:** free MCP server at `https://detourmap.com/mcp` ([how to connect](https://detourmap.com/mcp-server/)) — or run it from this repo: `node mcp/server.mjs` ([`mcp/`](mcp/))

## Files

| File | Contents |
|---|---|
| `data/places.csv` | One row per place — all fields, flat table |
| `data/places.geojson` | One `Point` feature per place, all fields as properties |
| `data/places-compact.json` | Columnar `{columns, rows}` — the site's own wire format (smallest) |

The same files are served from [detourmap.com/data](https://detourmap.com/data/).

## Schema

| Field | Type | Notes |
|---|---|---|
| `qid` | string | Wikidata item ID, e.g. `Q243` |
| `name` | string | English label |
| `kind` / `kind_label` | enum | One of sixteen: `ancient` · `monument` · `sacred` · `beach` · `waterfall` · `cave` · `volcanic` · `natural` · `tower` · `structure` · `castle` · `abandoned` · `macabre` · `museum` · `garden` · `leisure` |
| `country` / `iso` | string | Country per Wikidata's country statement (P17); ISO 3166-1 alpha-2 where known |
| `latitude` / `longitude` | number | WGS84 |
| `founded_year` | number\|empty | Negative = BC |
| `century` | string\|empty | Display label, e.g. `3rd century BC` |
| `fame_rank` | number | 1 = most famous (Wikidata sitelink count, ties broken stably) |
| `fame_tier` | enum | `iconic` (top 300) · `renowned` (to 1,600) · `notable` (to 12,000) · `gem` (the long tail) |
| `wikipedia` | url | English Wikipedia article |
| `image` | url | Wikimedia Commons thumbnail (see licensing note below) |
| `map_url` | url | The place on detourmap.com |
| `description` | string | Wikidata's own short description |

## Quick start

```python
import pandas as pd
places = pd.read_csv("data/places.csv")
places.nsmallest(10, "fame_rank")[["name", "kind_label", "country"]]
places[places.kind == "abandoned"].sample(5)          # a random ghost town or five

import geopandas as gpd
gdf = gpd.read_file("data/places.geojson")
gdf.plot(column="kind", markersize=1, figsize=(16, 8))
```

## Provenance & accuracy

- **Selection is deterministic, not editorial.** Places come from ~50 Wikidata classes (castles, waterfalls, show caves, archaeological sites, museums…), and a record only qualifies with coordinates **on Earth** (Olympus Mons and lunar craters are checked out), a Wikimedia Commons photo (P18), an English label and an English Wikipedia article. No AI-generated content: names and descriptions are Wikidata's own.
- **Fame is measured, not judged:** `fame_rank` orders places by Wikidata sitelink count — how many language editions cover a place.
- **`country` is Wikidata's P17 statement as-is.** Mostly present-day countries, but a few hundred places carry the state that existed when they did (Roman Empire, Soviet Union, Duchy of Brabant…). We keep the field honest rather than silently rewriting it; the site's [/famous/](https://detourmap.com/famous/) page ranks the 229 present-day countries and territories.
- **Upstream is community-maintained.** Wikidata has errors; corrections made there flow into the next dataset build. If you spot a wrong coordinate or label, fixing it on Wikidata fixes it for everyone.
- **Basemap ≠ data:** the site renders these points over OpenFreeMap (OpenStreetMap) tiles, but no OSM data is part of this dataset. OSM © OpenStreetMap contributors.

## License

- **Data** (`data/`): [**CC0 1.0**](https://creativecommons.org/publicdomain/zero/1.0/) — the underlying facts come from [Wikidata](https://www.wikidata.org) (CC0) and this compilation is dedicated to the public domain as well. Use it for anything; attribution is appreciated but not required (a link to [detourmap.com](https://detourmap.com) is the nice move). ([notice](data/LICENSE))
- **Photos are not included** — the `image` column contains URLs to Wikimedia Commons files, and each photo carries its own per-file license on Commons. Check before republishing an image.
- **Code** (the MCP server in `mcp/`): [MIT](LICENSE).

## Also available on

- **Zenodo (archived, DOI):** [doi.org/10.5281/zenodo.21432200](https://doi.org/10.5281/zenodo.21432200) — always resolves to the latest version

## Citing

> Detourmap Places: 70,343 places worth a detour, from Wikidata (2026). detourmap.com. DOI: 10.5281/zenodo.21432200. https://github.com/Flightmussy/detourmap-places

## Updating

Generated from the Detourmap pipeline (sitelink-banded WDQS queries, deduped, geographically balanced). New versions land here first; publishing a GitHub release mints a Zenodo DOI and (once the repo's `KAGGLE_API_TOKEN` / `HF_TOKEN` secrets are configured) syncs the Kaggle and Hugging Face mirrors via [`sync-mirrors.yml`](.github/workflows/sync-mirrors.yml).
