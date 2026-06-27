const ANILIST_URL = 'https://graphql.anilist.co';

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limited');
    this.retryAfter = retryAfter;
  }
}

function buildBatchQuery(terms) {
  const fields = `id title { romaji english } coverImage { medium color } genres tags { name rank }`;
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
  const { data, errors } = await res.json();
  if (!data) {
    const msg = res.status === 404
      ? 'Invalid title in list.'
      : (errors?.[0]?.message ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return terms.map((term, i) => ({ term, media: data[`anime${i}`] ?? null }));
}

function renderGenres(genres) {
  return `<ul class="tag-list">${genres.map(g => `<li>${g}</li>`).join('')}</ul>`;
}

function renderTagsWithRank(tags) {
  return `<ul class="tag-list">${tags.map(t =>
    `<li>${t.name} <span class="pct">${t.rank}%</span></li>`
  ).join('')}</ul>`;
}

function renderResult({ media }) {
  const title = media.title.english ?? media.title.romaji;
  const color = media.coverImage?.color ?? null;
  const cover = media.coverImage?.medium
    ? `<img class="cover" src="${media.coverImage.medium}" alt="${title}" />`
    : '';
  const style = color
    ? `style="background-color: ${color}22; border-color: ${color}66;"`
    : '';
  return `
    <article class="anime-card" ${style}>
      <div class="card-header">
        ${cover}
        <h2 class="anime-title">${title}</h2>
        <a class="link-btn anime-link" href="https://anilist.co/anime/${media.id}" target="_blank" rel="noopener"><span class="arrow">↗</span></a>
      </div>
      <p class="label">Genres</p>
      ${renderGenres(media.genres)}
      <p class="label">Tags</p>
      ${renderTagsWithRank(media.tags)}
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
    const found = resultList.filter(r => r.media);
    if (!found.length) {
      results.innerHTML = '<p class="feedback">Invalid title in list.</p>';
      return;
    }
    results.innerHTML = found.map(renderResult).join('');
  } catch (err) {
    if (err instanceof RateLimitError) {
      results.innerHTML = `<p class="feedback">Rate limited — try again in ${err.retryAfter}s.</p>`;
    } else {
      results.innerHTML = `<p class="feedback">Error: ${err.message}</p>`;
    }
  }
});
