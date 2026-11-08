# Detourmap Places — 39,832 places worth a detour, as open data

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21432200.svg)](https://doi.org/10.5281/zenodo.21432200)

**39,832 places · 2 kinds · 233 countries and territories** — every place with coordinates, a Wikimedia Commons photo and a Wikipedia article, from [detourmap.com](https://detourmap.com), the interactive world map of places worth going out of your way for. Since 16 August 2026 the map is cut to what nature made and what people left behind: **Nature** (parks, mountains, waterfalls, caves, volcanoes and coves) and **Archaeological** (ancient ruins, tombs, ghost towns, shipwrecks, catacombs, mines, battlefields and crash sites). It holds no museums, galleries, churches, castles, gardens or theme parks; the kinds that were in v1.1.0 and are not in this release are listed under *Releases* below.

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
| `kind` / `kind_label` | enum | One of two: `natural` (*Nature*, 25,830 places) · `ruins` (*Archaeological*, 14,002 places) |
| `country` / `iso` | string | Country per Wikidata's country statement (P17); ISO 3166-1 alpha-2 where known. Empty on 1,332 rows, where Wikidata gives no country |
| `latitude` / `longitude` | number | WGS84 |
| `founded_year` | number\|empty | Negative = BC |
| `century` | string\|empty | Display label, e.g. `3rd century BC` |
| `fame_rank` | number | 1 = most famous (Wikidata sitelink count, ties broken stably) |
| `kind_rank` | number | 1 = most famous **within its `kind`** (same ordering, per-category) |
| `fame_tier` | enum | `iconic` (top 300) · `renowned` (to 1,600) · `notable` (to 12,000) · `gem` (the long tail) |
| `wikipedia` | url | English Wikipedia article, where one exists; empty on 9,091 rows whose article is in other languages only (a place qualifies with an English article, or with articles in at least three other languages) |
| `image` | url | Wikimedia Commons thumbnail (see licensing note below) |
| `map_url` | url | The place on detourmap.com |
| `description` | string | Wikidata's own short description; empty on 2,550 rows |

## Quick start

```python
import pandas as pd
places = pd.read_csv("data/places.csv")
places.nsmallest(10, "fame_rank")[["name", "kind_label", "country"]]
places[places.kind == "ruins"].sample(5)              # a random ruin or five

import geopandas as gpd
gdf = gpd.read_file("data/places.geojson")
gdf.plot(column="kind", markersize=1, figsize=(16, 8))
```

## Provenance & accuracy

- **Selection is deterministic, not editorial.** Places come from Wikidata classes under the two kinds the map carries (waterfalls, show caves, volcanoes, national parks, archaeological sites, ghost towns, shipwrecks…), and a record only qualifies with coordinates **on Earth** (Olympus Mons and lunar craters are checked out), a Wikimedia Commons photo (P18), an English label and a Wikipedia article, in English where one exists, otherwise in at least three other languages. No AI-generated content: names and descriptions are Wikidata's own.
- **Fame is measured, not judged:** `fame_rank` orders places by Wikidata sitelink count — how many language editions cover a place.
- **`country` is Wikidata's P17 statement as-is.** Present-day countries and territories almost everywhere (two places still carry the Russian Empire), and empty where Wikidata states none. We keep the field honest rather than silently rewriting it; the site's [/famous/](https://detourmap.com/famous/) page ranks the present-day countries and territories.
- **Upstream is community-maintained.** Wikidata has errors; corrections made there flow into the next dataset build. If you spot a wrong coordinate or label, fixing it on Wikidata fixes it for everyone.
- **Basemap ≠ data:** the site renders these points over OpenFreeMap (OpenStreetMap) tiles, but no OSM data is part of this dataset. OSM © OpenStreetMap contributors.

## License

- **Data** (`data/`): [**CC0 1.0**](https://creativecommons.org/publicdomain/zero/1.0/) — the underlying facts come from [Wikidata](https://www.wikidata.org) (CC0) and this compilation is dedicated to the public domain as well. Use it for anything; attribution is appreciated but not required (a link to [detourmap.com](https://detourmap.com) is the nice move). ([notice](data/LICENSE))
- **Photos are not included** — the `image` column contains URLs to Wikimedia Commons files, and each photo carries its own per-file license on Commons. Check before republishing an image.
- **Code** (the MCP server in `mcp/`): [MIT](LICENSE).

## Also available on

- **Zenodo (archived, DOI):** [doi.org/10.5281/zenodo.21432200](https://doi.org/10.5281/zenodo.21432200) — always resolves to the latest version

## Citing

> Detourmap Places: places worth a detour, from Wikidata (2026). detourmap.com. DOI: 10.5281/zenodo.21432200. https://github.com/Flightmussy/detourmap-places

## Releases

- **v1.2.0** (2026-11-08): **71,763 → 39,832 places, 17 kinds → 2, 349 → 233 countries and territories.** The map narrowed twice after v1.1.0: on 20 July 2026 the seventeen kinds folded into seven, and on 16 August 2026 the site was cut to nature and archaeology. This release is the first dataset snapshot since, so against v1.1.0 it reads as 47,302 places removed (every monument, sacred site, tower, bridge, castle, military site, museum, garden and leisure place, and the natural and archaeological places that did not survive the re-selection), 15,371 added (natural and archaeological places admitted since July) and 24,461 kept. The two kinds absorb the old fine ones: `natural` holds what was `natural`, `volcanic`, `waterfall`, `cave` and `beach`; `ruins` holds what was `ancient`, `abandoned` and `macabre`. Column order is unchanged (the same 17 columns as v1.1.0); `fame_tier` keeps its thresholds (`iconic` to rank 300, `renowned` to 1,600, `notable` to 12,000, `gem` beyond). The Wikipedia requirement widened: an article in English, or in at least three other languages, so `wikipedia` is empty on 9,091 rows. 1,332 rows carry no country. The MCP server in `mcp/` is the deployed one: it now derives the kinds it describes from the rows it loads, so a saved call naming a kind the site no longer carries comes back empty rather than as an error.
- **v1.1.0** (2026-07-20): 71,763 places, 17 kinds, the `kind_rank` column added.
- **v1.0.0** (2026-07-18): first release, 70,343 places.

## Updating

Generated from the Detourmap pipeline (sitelink-banded WDQS queries, deduped, geographically balanced). New versions land here first; publishing a GitHub release mints a Zenodo DOI and (once the repo's `KAGGLE_API_TOKEN` / `HF_TOKEN` secrets are configured) syncs the Kaggle and Hugging Face mirrors via [`sync-mirrors.yml`](.github/workflows/sync-mirrors.yml).
