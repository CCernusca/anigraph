const ANILIST_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        title { romaji english }
        genres
        tags { name }
      }
    }
  }
`;

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limited');
    this.retryAfter = retryAfter;
  }
}

async function fetchAnime(search) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SEARCH_QUERY, variables: { search } }),
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
    throw new RateLimitError(retryAfter);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data, errors } = await res.json();
  if (errors) throw new Error(errors[0].message);
  return data.Page.media;
}

function renderTags(items) {
  return `<ul class="tag-list">${items.map(t => `<li>${t}</li>`).join('')}</ul>`;
}

function renderMedia(media) {
  const title = media.title.english ?? media.title.romaji;
  return `
    <article class="anime-card">
      <h2 class="anime-title">${title}</h2>
      <p class="label">Genres</p>
      ${renderTags(media.genres)}
      <p class="label">Tags</p>
      ${renderTags(media.tags.map(t => t.name))}
    </article>
  `;
}

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const results = document.getElementById('results');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  results.innerHTML = '<p class="feedback">Searching…</p>';

  try {
    const mediaList = await fetchAnime(query);
    if (!mediaList.length) {
      results.innerHTML = '<p class="feedback">No anime found.</p>';
      return;
    }
    results.innerHTML = `
      <p class="feedback">${mediaList.length} result${mediaList.length > 1 ? 's' : ''} found.</p>
      ${mediaList.map(renderMedia).join('')}
    `;
  } catch (err) {
    if (err instanceof RateLimitError) {
      results.innerHTML = `<p class="feedback">Rate limited — try again in ${err.retryAfter}s.</p>`;
    } else {
      results.innerHTML = `<p class="feedback">Error: ${err.message}</p>`;
    }
  }
});
