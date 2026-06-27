# Architecture

> Describes how anigraph works internally. Updated as features are added.

## Overview

anigraph is a webapp for visualising information and statistics about anime.

Static HTML webapp. No build tooling, no framework, no bundler.

## Structure

```
index.html      shell — links stylesheet + script
css/style.css   global styles (reset + base)
js/main.js      entry point for all application logic
```

## Rendering model

Browser loads `index.html` directly. JS in `js/main.js` manipulates the DOM at runtime. No server-side rendering.

## Data source — AniList GraphQL API

Endpoint: `https://graphql.anilist.co` (public, no auth required for read queries).

User imports a `.txt` file (one title per line). `js/main.js` reads the file via `File.text()`, splits on newlines, strips blanks, then fires a **single batched GraphQL request** using field aliases — one `Media` alias per title:

```graphql
query {
  anime0: Media(search: "Naruto", type: ANIME) { ... }
  anime1: Media(search: "Bleach", type: ANIME) { ... }
}
```

Search terms are embedded as JSON string literals (`JSON.stringify`) so they are safely escaped. Response is a map of `anime0…animeN` keys. Each is matched back to its input term by index. `null` values (no AniList match) rendered as "not found" cards. Found results show `title`, `genres`, `tags[].name`.

### Rate limits

- **90 requests/minute** per IP. Exceeding returns HTTP `429` with a `Retry-After` header.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- HTTP `429` caught as `RateLimitError` (subclass of `Error`). `Retry-After` header parsed; user shown "Rate limited — try again in Xs." Falls back to 60s if header absent.
- Batching all titles into one request minimises request count against this limit.

### Error shape

AniList returns HTTP 200 even for query errors. Errors surface as a top-level `errors` array in the JSON body alongside a partial (or null) `data`. The fetch function checks `errors[0].message` before reading `data`.
