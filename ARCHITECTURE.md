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

On search submit, `js/main.js` POSTs a GraphQL `Page` query (`perPage: 8, sort: SEARCH_MATCH`) with `type: ANIME` and the user's search string. Returns up to 8 ranked matches. Response fields used per item: `title`, `genres`, `tags[].name`. Each result rendered as an `.anime-card` article into `#results` via `innerHTML`.

### Rate limits

- **90 requests/minute** per IP. Exceeding returns HTTP `429` with a `Retry-After` header.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- HTTP `429` caught as `RateLimitError` (subclass of `Error`). `Retry-After` header parsed; user shown "Rate limited — try again in Xs." Falls back to 60s if header absent.

### Pagination

`Page` supports `page` + `perPage` (max `perPage: 50`). Current impl fetches page 1 only. No infinite scroll or load-more implemented yet.

### Error shape

AniList returns HTTP 200 even for query errors. Errors surface as a top-level `errors` array in the JSON body alongside a partial (or null) `data`. The fetch function checks `errors[0].message` before reading `data`.
