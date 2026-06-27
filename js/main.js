const ANILIST_URL = 'https://graphql.anilist.co';

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limited');
    this.retryAfter = retryAfter;
  }
}

function buildBatchQuery(terms) {
  const fields = `title { romaji english } genres tags { name }`;
  const aliases = terms
    .map((term, i) => `anime${i}: Media(search: ${JSON.stringify(term)}, type: ANIME) { ${fields} }`)
    .join('\n  ');
  return `query {\n  ${aliases}\n}`;
}

async function fetchAnimeList(terms) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: buildBatchQuery(terms) }),
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
    throw new RateLimitError(retryAfter);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data, errors } = await res.json();
  if (errors) throw new Error(errors[0].message);
  return terms.map((term, i) => ({ term, media: data[`anime${i}`] }));
}

function renderTags(items) {
  return `<ul class="tag-list">${items.map(t => `<li>${t}</li>`).join('')}</ul>`;
}

function renderResult({ term, media }) {
  if (!media) {
    return `<article class="anime-card not-found"><p class="anime-title">Not found: ${term}</p></article>`;
  }
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

const fileInput = document.getElementById('file-input');
const searchBtn = document.getElementById('search-btn');
const results = document.getElementById('results');

fileInput.addEventListener('change', () => {
  searchBtn.disabled = !fileInput.files[0];
});

searchBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const text = await file.text();
  const terms = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (!terms.length) {
    results.innerHTML = '<p class="feedback">File is empty.</p>';
    return;
  }

  results.innerHTML = `<p class="feedback">Searching ${terms.length} title${terms.length > 1 ? 's' : ''}…</p>`;

  try {
    const resultList = await fetchAnimeList(terms);
    const found = resultList.filter(r => r.media).length;
    results.innerHTML = `
      <p class="feedback">${found} of ${terms.length} found.</p>
      ${resultList.map(renderResult).join('')}
    `;
  } catch (err) {
    if (err instanceof RateLimitError) {
      results.innerHTML = `<p class="feedback">Rate limited — try again in ${err.retryAfter}s.</p>`;
    } else {
      results.innerHTML = `<p class="feedback">Error: ${err.message}</p>`;
    }
  }
});
