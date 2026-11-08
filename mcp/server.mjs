#!/usr/bin/env node
/**
 * Detourmap MCP server — a remote Model Context Protocol endpoint over the
 * places dataset (https://detourmap.com/mcp).
 *
 * Zero dependencies by design (pattern shared with the sister atlases): it
 * implements the MCP Streamable HTTP transport (stateless mode) directly —
 * JSON-RPC over POST — so the VPS needs nothing but Node ≥ 18 and the
 * places-compact.json the site already deploys under /data/. Read-only; no
 * sessions, no auth, CORS open (facts from Wikidata, CC0).
 *
 * Spec: modelcontextprotocol.io — protocol revisions 2025-03-26 / 2025-06-18.
 *   POST /mcp  JSON-RPC request  → application/json response
 *   POST /mcp  notification      → 202 empty
 *   GET/DELETE /mcp              → 405 (no server-initiated streams)
 *
 * Run:  PLACES_JSON=/var/www/detourmap/data/places-compact.json PORT=8894 node server.mjs
 */
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 8894)
const HOST = process.env.HOST || '127.0.0.1'
// Data file: env override, else the VPS path, else the open-data copy that
// sits beside this file in the public repo (Flightmussy/detourmap-places) —
// so `node mcp/server.mjs` works out of the box from a clone.
const DATA_CANDIDATES = [
  process.env.PLACES_JSON,
  '/var/www/detourmap/data/places-compact.json',
  fileURLToPath(new URL('../data/places-compact.json', import.meta.url)),
].filter(Boolean)
const exists = (p) => {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}
const DATA = DATA_CANDIDATES.find(exists) ?? DATA_CANDIDATES[0]
const SITE_URL = 'https://detourmap.com'
const PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])
const LATEST = '2025-06-18'
const VERSION = '1.0.0'

// ---- Category metadata (mirrors src/data/placesCore.ts — keep in sync) ------
const KINDS = {
  ruins: {
    label: 'Archaeological',
    slug: 'ancient-sites',
    blurb: 'ancient ruins, tombs, ghost towns, shipwrecks, catacombs, mines, battlefields and crash sites',
  },
  sacred: { label: 'Sacred sites', slug: 'sacred-sites', blurb: 'churches, temples, monasteries, mosques and shrines' },
  landmark: {
    label: 'Built landmarks',
    slug: 'castles',
    blurb: 'castles, forts, palaces, monuments, statues, towers, lighthouses and bridges',
  },
  natural: { label: 'Nature', slug: 'natural-wonders', blurb: 'parks, mountains, waterfalls, caves, volcanoes and coves' },
  parks: {
    label: 'Parks & cemeteries',
    slug: 'gardens',
    blurb: 'botanical gardens, grand parks, arboretums and park-like cemeteries',
  },
  museum: { label: 'Museums & culture', slug: 'museums', blurb: 'art, history and science museums and galleries' },
  fun: {
    label: 'Fun & leisure',
    slug: 'theme-parks',
    blurb: 'theme parks, zoos, aquariums, ski resorts, distilleries, wineries, casinos and funiculars',
  },
}
/** Every kind the pipeline knows. INPUT is matched against all of them, so a
 *  saved call naming a kind the site no longer carries comes back empty rather
 *  than as an error. */
const KIND_KEYS = Object.keys(KINDS)
/** The kinds the DEPLOYED cut actually holds — recomputed from the rows on every
 *  reload, and the only list this server describes ITSELF with.
 *
 *  Derived rather than declared, because the site narrowed from seven kinds to
 *  two on 2026-08-16 (SITE_CATEGORIES in placesCore) and this file went on
 *  offering museums, gardens and theme parks to every AI client that connected,
 *  over a dataset holding none of them. A list read off the rows cannot. */
let LIVE_KINDS = KIND_KEYS
/** The kinds as prose, for descriptions. Derived, never typed out twice: the
 * hand-written list drifted a whole taxonomy behind the map (it still named
 * beaches, caves, volcanoes and ghost towns after the 2026-07-20 fold to seven). */
const kindProse = () => {
  const labels = LIVE_KINDS.map((k) => KINDS[k].label.toLowerCase())
  if (labels.length < 2) return labels[0] ?? 'no kinds loaded'
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
/** The same list, saying what each kind holds. The server instructions get this
 *  rather than kindProse(): "nature and archaeological" does not tell a model it
 *  can ask for shipwrecks, catacombs or a sea cave. */
const kindDetail = () =>
  LIVE_KINDS.map((k) => `${KINDS[k].label.toLowerCase()} (${KINDS[k].blurb})`).join('; ')
/** Copy substitution for tool descriptions AND their schemas — see tools/list. */
const fillCopy = (text) =>
  String(text)
    .replaceAll('{{TOTAL}}', displayTotals.total.toLocaleString('en-US'))
    .replaceAll('{{KINDS}}', kindProse())
    .replaceAll('{{KIND_LIST}}', LIVE_KINDS.map((k) => `${k} (${KINDS[k].label})`).join(', '))
const KIND_BY_ANY = new Map()
for (const [key, m] of Object.entries(KINDS)) {
  KIND_BY_ANY.set(key, key)
  KIND_BY_ANY.set(m.slug, key)
}
// Fame bands are rank-fixed (see placesCore FAME_TIERS).
const tierOf = (rank) => (rank <= 300 ? 'iconic' : rank <= 1600 ? 'renowned' : rank <= 12000 ? 'notable' : 'gem')
// Wikidata officialese → the site's display names (placesCore COUNTRY_DISPLAY).
const COUNTRY_DISPLAY = { "People's Republic of China": 'China', 'Republic of Abkhazia': 'Abkhazia' }
const CHAR_MAP = { ı: 'i', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ł: 'l', þ: 'th', ð: 'd', ŋ: 'n' }
const slugify = (v) =>
  String(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ıøđßæœłþðŋ]/g, (ch) => CHAR_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// ---- Dataset (reload when the deployed file changes; stat at most 1/min) ----
let places = []
let displayTotals = { total: 0, countries: 0 }
let loadedMtime = 0
let lastStat = 0
function loadData() {
  const data = JSON.parse(readFileSync(DATA, 'utf8'))
  const c = {}
  data.columns.forEach((name, i) => (c[name] = i))
  const perKind = new Map() // rows are fame-sorted → running count = rank within kind
  places = data.rows.map((r, i) => {
    const rawCountry = r[c.country] ?? null
    const rank = i + 1
    const kindRank = (perKind.get(r[c.cat]) ?? 0) + 1
    perKind.set(r[c.cat], kindRank)
    return {
      qid: r[c.id],
      name: r[c.name],
      kind: r[c.cat],
      lon: r[c.lon],
      lat: r[c.lat],
      year: r[c.year] ?? null,
      iso: r[c.iso] ?? null,
      country: rawCountry ? COUNTRY_DISPLAY[rawCountry] ?? rawCountry : null,
      img: r[c.img] ? `https://commons.wikimedia.org/wiki/Special:FilePath/${r[c.img]}?width=640` : null,
      wiki: r[c.wiki] ? `https://en.wikipedia.org/wiki/${r[c.wiki]}` : null,
      desc: r[c.desc] ?? null,
      slug: r[c.slug],
      rank,
      kindRank,
      tier: tierOf(rank),
    }
  })
  displayTotals = { total: data.total ?? places.length, countries: data.countries ?? 0 }
  const present = new Set(places.map((pl) => pl.kind))
  LIVE_KINDS = KIND_KEYS.filter((k) => present.has(k))
  console.log(
    `detourmap-mcp: loaded ${places.length} places from ${DATA} (${LIVE_KINDS.length} kinds: ${LIVE_KINDS.join(', ')})`,
  )
}
function freshData() {
  const now = Date.now()
  if (now - lastStat < 60_000) return
  lastStat = now
  try {
    const m = statSync(DATA).mtimeMs
    if (m !== loadedMtime) {
      loadedMtime = m
      loadData()
    }
  } catch (e) {
    console.error('detourmap-mcp: stat/reload failed:', e.message)
  }
}
loadedMtime = statSync(DATA).mtimeMs
loadData()

// ---- Tool helpers -----------------------------------------------------------
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
function matchesCountry(p, want) {
  if (!want) return true
  const w = norm(want)
  return norm(p.country) === w || norm(p.iso) === w || norm(p.country).includes(w)
}
function kindOf(arg) {
  if (!arg) return null
  const k = KIND_BY_ANY.get(String(arg).toLowerCase().trim())
  return k ?? undefined // undefined = asked for something unknown
}
function briefOf(p) {
  return {
    name: p.name,
    slug: p.slug,
    kind: p.kind,
    kind_label: KINDS[p.kind]?.label ?? p.kind,
    country: p.country,
    founded: p.year != null ? p.year : undefined,
    latitude: p.lat,
    longitude: p.lon,
    fame_rank: p.rank,
    kind_rank: p.kindRank,
    fame_tier: p.tier,
    map: `${SITE_URL}/?place=${p.slug}`,
    wikipedia: p.wiki,
  }
}
function fullOf(p) {
  return { ...briefOf(p), description: p.desc, image: p.img, wikidata: `https://www.wikidata.org/wiki/${p.qid}` }
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function clampInt(v, def, max) {
  const n = Number.isFinite(Number(v)) ? Math.floor(Number(v)) : def
  return Math.max(1, Math.min(max, n))
}
// A placeholder, not a computed string: it is filled from the LOADED data on
// every tools/list (see fillCopy), so the schema cannot outlive the cut it names.
const KIND_ENUM_DESC = 'Kind of place — key or slug: {{KIND_LIST}}'

// ---- Tools ------------------------------------------------------------------
const TOOLS = [
  {
    name: 'search_places',
    title: 'Search places by name',
    // {{TOTAL}} is substituted from the loaded dataset on every tools/list, NOT
    // baked in. It was baked in once and went stale by 41,436 places: the number
    // here still read 70,520 on 2026-07-29 while the atlas held 111,956, and
    // every AI client that connected was told the wrong figure. The kinds are
    // named from KINDS for the same reason — this listed the pre-2026-07-20
    // eighteen-kind scheme long after it folded to seven.
    description:
      'Search {{TOTAL}} notable places worldwide by name (accent- and case-insensitive substring match): {{KINDS}}. Optionally filter by country (name or ISO code) and kind. Results come best-match-first, then by fame; each carries coordinates, fame rank/tier and links to the map and Wikipedia. If nothing matches, retry with a shorter fragment.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or part of a name, e.g. "pyramiden" or "plitvice"' },
        country: { type: 'string', description: 'Country name or 2-letter ISO code (optional)' },
        kind: { type: 'string', description: KIND_ENUM_DESC + ' (optional)' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    run(args) {
      const q = norm(args.query)
      if (!q) return { error: 'query must be a non-empty string' }
      const kind = kindOf(args.kind)
      if (kind === undefined) return { error: `Unknown kind "${args.kind}". Valid: ${LIVE_KINDS.join(', ')}` }
      const limit = clampInt(args.limit, 10, 50)
      const scored = []
      for (const p of places) {
        if (!matchesCountry(p, args.country)) continue
        if (kind && p.kind !== kind) continue
        const n = norm(p.name)
        let score = -1
        if (n === q) score = 3
        else if (n.startsWith(q)) score = 2
        else if (n.includes(q)) score = 1
        if (score < 0) continue
        scored.push([score, p.rank, p])
      }
      scored.sort((a, b) => b[0] - a[0] || a[1] - b[1])
      return { total_matches: scored.length, results: scored.slice(0, limit).map((s) => briefOf(s[2])) }
    },
  },
  {
    name: 'get_place',
    title: 'Get one place in full',
    description:
      'Fetch one place’s full record by slug (preferred, e.g. "neuschwanstein-castle") or exact name: coordinates, founding year, worldwide fame rank and tier, short description, photo URL, Wikipedia and Wikidata links, and a deep link that opens it on the map. Unsure of the slug? Call search_places first.',
    inputSchema: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Slug (preferred, e.g. "colosseum") or exact name' },
      },
      required: ['place'],
    },
    run(args) {
      const want = norm(args.place).replace(/\s+/g, '-')
      let hit = places.find((p) => p.slug === want)
      if (!hit) {
        const wantName = norm(args.place)
        hit = places.find((p) => norm(p.name) === wantName)
      }
      if (!hit) return { error: `No place matches "${args.place}". Try search_places first.` }
      return fullOf(hit)
    },
  },
  {
    name: 'places_near',
    title: 'Find places worth a detour near a point',
    description:
      'List notable places within a radius of a WGS84 coordinate, most famous first (rank order), each with distance_km — the direct answer to "what is worth visiting near <place>?". Radius defaults to 50 km (max 500). Geocode the location yourself, then call this with its latitude/longitude. Filter by kind to answer e.g. "waterfalls near Zurich".',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        radius_km: { type: 'number', minimum: 1, maximum: 500, description: 'Search radius in km (default 50)' },
        kind: { type: 'string', description: KIND_ENUM_DESC + ' (optional)' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 15)' },
      },
      required: ['latitude', 'longitude'],
    },
    run(args) {
      const lat = Number(args.latitude)
      const lon = Number(args.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: 'latitude/longitude must be numbers' }
      const kind = kindOf(args.kind)
      if (kind === undefined) return { error: `Unknown kind "${args.kind}". Valid: ${LIVE_KINDS.join(', ')}` }
      const radius = Math.max(1, Math.min(500, Number(args.radius_km) || 50))
      const limit = clampInt(args.limit, 15, 50)
      const hits = []
      for (const p of places) {
        if (kind && p.kind !== kind) continue
        // Cheap prefilter: 1° lat ≈ 111 km — skip the haversine for the far away.
        if (Math.abs(p.lat - lat) * 111 > radius) continue
        const d = haversineKm(lat, lon, p.lat, p.lon)
        if (d <= radius) hits.push([d, p])
      }
      hits.sort((a, b) => a[1].rank - b[1].rank)
      return {
        total_within_radius: hits.length,
        results: hits.slice(0, limit).map(([d, p]) => ({ distance_km: Math.round(d * 10) / 10, ...briefOf(p) })),
      }
    },
  },
  {
    name: 'top_places',
    title: 'Most famous places',
    description:
      'The most famous places worldwide, in one country, or of one kind — ordered by Detourmap fame rank (derived from Wikipedia language coverage; rank 1 is the most famous). The direct answer to "most famous <kind> in <country>" and "what are the must-sees in <country>".',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Country name or ISO code (optional — omit for worldwide)' },
        kind: { type: 'string', description: KIND_ENUM_DESC + ' (optional)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many (default 10)' },
      },
    },
    run(args) {
      const kind = kindOf(args.kind)
      if (kind === undefined) return { error: `Unknown kind "${args.kind}". Valid: ${LIVE_KINDS.join(', ')}` }
      const limit = clampInt(args.limit, 10, 100)
      const out = []
      for (const p of places) {
        if (!matchesCountry(p, args.country)) continue
        if (kind && p.kind !== kind) continue
        out.push(p)
        if (out.length === limit) break // places are stored fame-sorted
      }
      return { results: out.map(briefOf) }
    },
  },
  {
    name: 'list_kinds',
    title: 'The kinds of place on the map',
    description:
      'The layers Detourmap carries — {{KINDS}} — with worldwide counts and a browsable index page for each. The atlas is cut to these kinds and holds nothing else.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const counts = {}
      for (const p of places) counts[p.kind] = (counts[p.kind] || 0) + 1
      return {
        kinds: LIVE_KINDS.map((k) => ({
          kind: k,
          label: KINDS[k].label,
          places: counts[k] || 0,
          index: `${SITE_URL}/${KINDS[k].slug}/`,
        })),
      }
    },
  },
  {
    name: 'list_countries',
    title: 'Countries with place counts',
    description:
      'Every country in the atlas with its place count, most first — answers "which country has the most notable places". Countries with eight or more places include a browsable index page URL.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const byCountry = new Map()
      for (const p of places) {
        if (!p.country) continue
        const e = byCountry.get(p.country) || { iso: p.iso, count: 0 }
        e.count++
        if (!e.iso && p.iso) e.iso = p.iso
        byCountry.set(p.country, e)
      }
      const rows = [...byCountry.entries()]
        .map(([country, e]) => ({
          country,
          iso: e.iso,
          places: e.count,
          ...(e.count >= 8 ? { index: `${SITE_URL}/places/${slugify(country)}/` } : {}),
        }))
        .sort((a, b) => b.places - a.places)
      return { total_countries: rows.length, all_places_index: `${SITE_URL}/places/`, results: rows }
    },
  },
  {
    name: 'get_statistics',
    title: 'Atlas statistics',
    description:
      'Headline statistics computed live from the atlas: totals by kind, top countries, fame-tier sizes, dated-entry stats, geographic extremes and the most famous place. The source for aggregate claims like "how many castles are on Detourmap" or "which country has the most notable places".',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const byKind = {}
      const byCountry = new Map()
      const byTier = { iconic: 0, renowned: 0, notable: 0, gem: 0 }
      const dated = []
      let north = null
      let south = null
      for (const p of places) {
        byKind[p.kind] = (byKind[p.kind] || 0) + 1
        byTier[p.tier]++
        if (p.country) {
          const e = byCountry.get(p.country) || { iso: p.iso, count: 0 }
          e.count++
          if (!e.iso && p.iso) e.iso = p.iso
          byCountry.set(p.country, e)
        }
        if (typeof p.year === 'number') dated.push(p)
        if (!north || p.lat > north.lat) north = p
        if (!south || p.lat < south.lat) south = p
      }
      dated.sort((a, b) => a.year - b.year)
      const brief = (p) => p && { name: p.name, country: p.country, map: `${SITE_URL}/?place=${p.slug}` }
      return {
        places: places.length,
        countries: byCountry.size,
        by_kind: Object.fromEntries(
          LIVE_KINDS.map((k) => [k, { label: KINDS[k].label, places: byKind[k] || 0 }]),
        ),
        by_fame_tier: byTier,
        top_countries: [...byCountry.entries()]
          .map(([country, e]) => ({ country, iso: e.iso, places: e.count }))
          .sort((a, b) => b.places - a.places)
          .slice(0, 10),
        dated_entries: dated.length,
        oldest: dated.slice(0, 3).map((p) => ({ ...brief(p), founded: p.year })),
        northernmost: north && { ...brief(north), latitude: north.lat },
        southernmost: south && { ...brief(south), latitude: south.lat },
        most_famous: brief(places[0]),
        browse: `${SITE_URL}/places/`,
      }
    },
  },
  {
    name: 'random_place',
    title: 'A random place worth a detour',
    description:
      'One random place with its full record — deliberately biased toward the little-known long tail, like the site’s own "Surprise me" button. Optionally limit by country and/or kind. Great for discovery and "place of the day" features.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Country name or ISO code (optional)' },
        kind: { type: 'string', description: KIND_ENUM_DESC + ' (optional)' },
      },
    },
    run(args) {
      const kind = kindOf(args.kind)
      if (kind === undefined) return { error: `Unknown kind "${args.kind}". Valid: ${LIVE_KINDS.join(', ')}` }
      const pool = places.filter((p) => matchesCountry(p, args.country) && (!kind || p.kind === kind))
      if (!pool.length) return { error: 'No places match those filters.' }
      // 70% of rolls come from the notable/gem long tail (mirrors the site).
      const tail = pool.filter((p) => p.tier === 'gem' || p.tier === 'notable')
      const from = tail.length && Math.random() < 0.7 ? tail : pool
      return fullOf(from[Math.floor(Math.random() * from.length)])
    },
  },
]
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// ---- JSON-RPC dispatch ------------------------------------------------------
function handleRpc(msg) {
  const { method, params, id } = msg
  if (method === 'initialize') {
    const asked = params?.protocolVersion
    return {
      protocolVersion: PROTOCOLS.has(asked) ? asked : LATEST,
      capabilities: { tools: {} },
      serverInfo: { name: 'detourmap', title: 'Detourmap — every place worth the detour', version: VERSION },
      instructions:
        `Read-only tools over the Detourmap atlas: ${displayTotals.total.toLocaleString('en-US')} notable places ` +
        `across ${displayTotals.countries} countries, and nothing else — the map is cut to ` +
        `${LIVE_KINDS.length} kinds: ${kindDetail()}. It is an atlas of what nature made and what people left ` +
        `behind, so it holds no museums, galleries, churches, castles, gardens or theme parks. ` +
        `(Facts from Wikidata, CC0; every place has a photo and a Wikipedia article, in English where one exists ` +
        `and otherwise in at least three other languages.) Every result links its spot on ${SITE_URL}. ` +
        `Use search_places / get_place for lookups, ` +
        `places_near for "what's worth visiting near X" (geocode X first), top_places for fame, list_kinds / ` +
        `list_countries for coverage, get_statistics for aggregate claims and random_place for discovery.`,
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') {
    freshData()
    return {
      tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description: fillCopy(description),
        // The SCHEMA is substituted too. Its `kind` parameter enumerates the
        // kinds, and a schema baked at startup is exactly as stale as a
        // hard-coded description — the bug this file keeps relearning.
        inputSchema: JSON.parse(fillCopy(JSON.stringify(inputSchema))),
      })),
    }
  }
  if (method === 'tools/call') {
    const tool = TOOL_BY_NAME.get(params?.name)
    if (!tool) return { __rpcError: { code: -32602, message: `Unknown tool: ${params?.name}` } }
    freshData()
    let out
    try {
      out = tool.run(params?.arguments ?? {})
    } catch (e) {
      return { content: [{ type: 'text', text: `Tool failed: ${e.message}` }], isError: true }
    }
    const isError = Boolean(out && typeof out === 'object' && 'error' in out)
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError }
  }
  return { __rpcError: { code: -32601, message: `Method not found: ${method}` } }
}

// ---- HTTP transport (stateless streamable-http) -----------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
}
function send(res, status, body, extra = {}) {
  const headers = { ...CORS, ...extra }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  res.writeHead(status, headers)
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  if (url !== '/mcp' && url !== '/') return send(res, 404, { error: 'not found — MCP endpoint is /mcp' })
  if (req.method === 'OPTIONS') return send(res, 204, undefined)
  if (req.method !== 'POST')
    return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed — POST JSON-RPC to this endpoint' }, id: null }, { Allow: 'POST, OPTIONS' })

  let body = ''
  let overflow = false
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 65536) {
      overflow = true
      req.destroy()
    }
  })
  req.on('end', () => {
    if (overflow) return
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })
    }
    if (Array.isArray(msg))
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'Batching is not supported (protocol 2025-06-18)' }, id: null })
    if (!msg || msg.jsonrpc !== '2.0')
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null })

    const hasId = msg.id !== undefined && msg.id !== null
    const isNotification = typeof msg.method === 'string' && !hasId
    const isResponse = msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)
    if (isNotification || isResponse) return send(res, 202, undefined)
    if (typeof msg.method !== 'string' || !hasId)
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null })

    const t0 = Date.now()
    const result = handleRpc(msg)
    const took = Date.now() - t0
    console.log(`detourmap-mcp: ${msg.method}${msg.params?.name ? ' ' + msg.params.name : ''} (${took}ms)`)
    if (result && result.__rpcError) return send(res, 200, { jsonrpc: '2.0', error: result.__rpcError, id: msg.id })
    return send(res, 200, { jsonrpc: '2.0', result, id: msg.id })
  })
})
server.listen(PORT, HOST, () => console.log(`detourmap-mcp: listening on http://${HOST}:${PORT}/mcp`))
