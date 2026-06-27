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

1. `e.target.closest('.anime-circle')` identifies the hovered circle.
2. `mediaStore[data-index]` retrieves the media object.
3. Popup content (title, AniList link, genres, tags+rank) is rendered into `#popup` via `innerHTML`. Selected items are highlighted per active selection mode.
4. All connection lines involving that circle are highlighted (stroke alpha 0.35 → 0.9).
5. `positionPopup(clientX, clientY)` places the top-left corner at the cursor, then clamps to keep within the viewport (8px margin). If the popup is wider/taller than the available space, `max-width`/`max-height` are set accordingly.
6. Hovering a connection line instead: shows shared selection items in popup, highlights both endpoint circles.
7. Popup and highlights clear when cursor leaves all circles and lines.

`pointer-events: none` prevents the popup from intercepting mouse events. The `↗` link has `pointer-events: auto` so it remains clickable.

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

### Rate limits

- **90 requests/minute** per IP. Exceeding returns HTTP `429` with a `Retry-After` header.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- HTTP `429` caught as `RateLimitError`. `Retry-After` parsed; user shown "Rate limited — try again in Xs." Falls back to 60s if header absent.
- Batching all titles into one request minimises request count against this limit.

### Error shape

AniList returns HTTP 200 even for query errors. Errors surface as a top-level `errors` array alongside partial (or null) `data`. The fetch function checks `errors[0].message` before reading `data`.

### HTTP 404

AniList returns `404` when any `Media` alias finds no match. Response body still has `data` (with nulls) in some cases. The fetch function always parses the body — if `data` is present, nulls are treated as not-found and filtered out. If `data` is absent, throws with "Invalid title in list."
