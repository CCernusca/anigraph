# Architecture

> Describes how anigraph works internally. Updated as features are added.

## Overview

Static HTML webapp. No build tooling, no framework, no bundler. Dark-themed, full-viewport layout.

## Structure

```
index.html      shell — layout markup, links stylesheet + script
css/style.css   global styles, layout, component styles
js/main.js      all application logic
```

## Layout

CSS Grid, full viewport (`100vh`, `overflow: hidden`):

```
┌─────────────────────────────────────────┐  topbar (56px)
│ anigraph                     AniList ↗  │
├──────────┬──────────────────┬───────────┤  border: 1px solid white
│          │                  │  Import   │
│  (empty) │   circles        │  Search   │
│          │                  │  feedback │
└──────────┴──────────────────┴───────────┘
  sidebar-L       center          sidebar-R
  (220px)                          (220px)
```

Separator lines are `1px solid white`.

## Results — circles

Each found anime renders as an `80×80px` circle (`.anime-circle`) with `border-radius: 50%` and `border-color` set to `coverImage.color` from the API. Cover image fills the circle via `object-fit: cover`. `data-index` attribute maps each circle to `mediaStore[]`.

Circles have `position: relative; z-index: 6`, placing them above the connection SVG (`z-index: 5`) at all times. Hover/highlight increases `border-width` inward (via `box-sizing: border-box`).

## Hover popup

A single `#popup` element lives at body level (`position: fixed; z-index: 1000; pointer-events: none`). On `mousemove`:

1. `e.target.closest('.anime-circle')` identifies the hovered circle (works anywhere in the viewport — circles can drift outside center bounds).
2. `mediaStore[data-index]` retrieves the media object.
3. Popup content (title, AniList link, genres, tags+rank) is rendered into `#popup` via `innerHTML`. Selected items are highlighted per active selection mode.
4. All connection lines involving that circle are highlighted (stroke alpha increased).
5. `positionPopup(x, y)` places the popup to the right of the hovered element, clamped within the viewport.
6. Hovering a connection line (inside `.center` only): shows shared selection items in popup, highlights both endpoint circles.
7. Popup and highlights clear when cursor leaves all interactive elements.

The `mousemove` fallback that calls `clearHighlights` skips when cursor is over `.sidebar-left` or `#clusters-svg`, so stat-bar and cluster polygon hover highlights persist. The `↗` link has `pointer-events: auto` so it remains clickable.

## Cluster polygons

For each selection item (tag/genre) that appears in at least `clusterMin` connections, a rounded convex hull polygon is drawn around the member anime nodes.

**Hull computation (`circleHull`):** 24 points are sampled around each node's screen position at radius `(CIRCLE_R + 15) × camZoom`. The convex hull of all sample points is taken. This guarantees the polygon wraps outside every circle and is visually rounded at isolated nodes. Computed and rendered every frame inside `updateClusterDOM()`.

**Label placement:** After all hulls are computed for the frame, labels are placed greedily. For each cluster, ~12 candidate positions are sampled from hull vertices. Candidates inside another cluster's hull are deprioritised. Among remaining candidates, the one maximising minimum distance to already-placed labels is chosen (topmost as tiebreak). Labels live in `#labels-svg` (z-index 7, above circles).

**Colors:** Each tag name is hashed to a hue (0–359). Polygon fill is `hsla(hue, 60%, 60%, 0.07)`, stroke `hsla(hue, 70%, 70%, 0.3)`. On hover (direct or via stat bar), fill rises to `0.22` opacity and stroke to `0.9`.

**Interactivity:** Polygons have `pointer-events: fill` so they receive mouse events despite the SVG being `pointer-events: none`. `mouseover` on a polygon highlights it and all connections sharing its tag. `mouseout` restores base styles. The `document` `mousemove` fallback skips `clearHighlights` when target is inside `#clusters-svg`. The stats bar `mouseover` resets all cluster polygons before applying the new active highlight.

`drawClusters()` is called after every `buildSprings()` (search, mode/slider change, clusterMin change). `updateClusterDOM()` runs each physics frame.

## Stats panel (left sidebar)

`#stats` inside `.sidebar-left`. Populated by `updateStats()` after every `drawConnections()` call (search + selection mode/slider changes).

**Counts:** anime count and connection count.

**Bar chart:** one row per unique selection item with `count >= clusterMin`. Rows sorted by connection count descending. Bar width scales to the item with the most connections (relative). Each row shows `count · pct%` where `pct = round(count / totalConnections × 100)`. `updateStats()` also updates `clusterMinSlider.max` to the current max tag count and clamps `clusterMin` if needed.

**Clusters section (right sidebar):** "Min size" slider controls `clusterMin` (default 3). Changing it calls `drawClusters()` + `updateStats()` to simultaneously update polygons and the stat bar chart.

`data-tag` attribute on each row stores the item name. Delegated `mouseover` on `#stats` reads `row.dataset.tag`, resets all cluster polygons to base, then highlights matching lines + circles + the matching cluster polygon. `mouseleave` restores all polygons and clears highlights.

The `document` `mousemove` fallback returns early when cursor is over `.sidebar-left`, preventing the per-frame `clearHighlights()` from erasing stat-hover highlights.

## Data source — AniList GraphQL API

Endpoint: `https://graphql.anilist.co` (public, no auth required for read queries).

User imports a `.txt` file (one title per line). `js/main.js` reads it via `File.text()`, splits on newlines, strips blanks, then fires a **single batched GraphQL request** using field aliases — one `Media` alias per title:

```graphql
query {
  anime0: Media(search: "Naruto", type: ANIME) { ... }
  anime1: Media(search: "Bleach", type: ANIME) { ... }
}
```

Search terms are embedded as JSON string literals (`JSON.stringify`) for safe escaping. Response is a map of `anime0…animeN` keys matched back to input terms by index. Fields fetched per title: `id`, `title{romaji,english}`, `coverImage{medium,color}`, `genres`, `tags{name,rank}`.

`null` aliases (no match) are filtered out silently. Found media stored in `mediaStore[]` for popup rendering.

## Camera

Virtual camera state: `camX, camY` (world-space center) and `camZoom`. Initialized to `(0,0,1)` on each new search.

**Pan:** `mousedown` inside `.center` (not on a circle or popup) sets `isPanning = true`, records start positions. `mousemove` updates `camX/Y` via `panStartCamX - dx/camZoom`. `mouseup` clears flag. Pan is restricted to the center area — clicks on sidebars/topbar have no effect.

**Zoom:** `wheel` event inside `.center` only (non-passive, `preventDefault`). Zoom-to-pointer: record world position under cursor before zoom, recompute `camX/Y` to keep that world point under the cursor after zoom. Clamped to `[0.1, 10]`.

**Projection** (world → screen, per frame in `updateSimDOM`):
```
screenX = (worldX - camX) * camZoom + rect.width/2
screenY = (worldY - camY) * camZoom + rect.height/2
```
Circles: `left/top` set to screen position; `transform: translate(-50%,-50%) scale(camZoom)`.
SVG lines: screen coords + `rect.left/top` offset for viewport space.

## Physics simulation

Nodes (`simNodes[]`) live in world space (origin 0,0). Each frame:

1. **Spring forces** — connected pairs: `F = SPRING_K × strength² × (dist − SPRING_REST)` along the axis. `strength = shared.length / maxShared` (relative, 0–1).
2. **Repulsion** — all pairs: `F = REPEL_K / dist²` (inverse square).
3. **Centering** — each node: `F = −CENTER_K × pos` (weak pull toward world origin).
4. **Integrate** — `vel = (vel + F) × DRAG; pos += vel`. No boundary clamping — nodes free to leave center area.

Constants: `SPRING_REST=130`, `REPEL_K=5000`, `CENTER_K=0.002`, `DRAG=0.82`. `springK` (default 0.04) is user-adjustable via the Spring strength slider in the right sidebar — takes effect immediately, no redraw needed.

Loop runs via `requestAnimationFrame`. Stopped/restarted on new search. Selection mode changes rebuild spring topology without resetting node positions.

## Z-index layering

| Layer | z-index |
|-------|---------|
| Topbar, sidebars | 10 (above graph) |
| Popup (`#popup`) | 1000 |
| Cluster labels (`#labels-svg`) | 7 |
| Circles (`.anime-circle`) | 6 |
| Connection SVG (`#connections-svg`) | 5 |
| Cluster polygons (`#clusters-svg`) | 4 |

Sidebars/topbar have `background: var(--bg)` so graph elements sliding under them are occluded.

## Selection modes and connections

`getSelection(media)` returns a list of `{name}` objects representing the active selection for an anime. Four modes, toggled via sidebar:

| Mode | Logic |
|------|-------|
| `percent` | `tags.filter(t => t.rank > relevancePercent)` |
| `count` | top `relevanceCount` tags sorted by rank desc; slider max set to `max(tags.length)` across loaded data |
| `top-pct` | top `ceil(tags.length × relevanceTopPct / 100)` tags by rank |
| `genres` | all genres as `{name}` objects (no rank filter) |

`drawConnections(found)` builds SVG `<line>` elements for every pair `(i, j)` whose selection sets share at least one name. Shared names are stored in `connections[]` for popup rendering.

On selection mode or slider change, `redrawIfLoaded()` clears highlights and redraws connections. Popup tag/genre highlights also update on the next hover (rendered dynamically).

### Tag rank

`tags[].rank` is the AniList community agreement percentage (0–100). Shown next to each tag name in the popup.

### Complexity splitting

AniList returns a complexity error (`errors[0].message` matches `/max query complexity should be (\d+) but got (\d+)/i`) when the batched query is too large.

`fetchBatchWithSplit(terms)` handles this automatically:

1. Try full `current` batch.
2. On complexity error: parse `max` and `got`; compute `keepCount = floor(current.length × max/got)`; move `current.slice(keepCount)` into `deferred`; retry `current.slice(0, keepCount)`.
3. Repeat until `current` succeeds.
4. Combine all `deferred` entries into one new `current` batch; go to step 1.
5. Accumulate all partial results; return merged list in call order.

### Rate limits

- **90 requests/minute** per IP. Exceeding returns HTTP `429` with a `Retry-After` header.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- HTTP `429` caught as `RateLimitError`. `Retry-After` parsed; user shown "Rate limited — try again in Xs." Falls back to 60s if header absent.
- Batching all titles into one request minimises request count against this limit.

### Error shape

AniList returns HTTP 200 even for query errors. Errors surface as a top-level `errors` array alongside partial (or null) `data`. The fetch function checks `errors[0].message` before reading `data`.

### HTTP 404

AniList returns `404` when any `Media` alias finds no match. Response body still has `data` (with nulls) in some cases. The fetch function always parses the body — if `data` is present, nulls are treated as not-found and filtered out. If `data` is absent, throws with "Invalid title in list."
