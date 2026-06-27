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

function renderCircle({ media }, index) {
  const title = media.title.english ?? media.title.romaji;
  const color = media.coverImage?.color ?? '#888';
  const cover = media.coverImage?.medium
    ? `<img src="${media.coverImage.medium}" alt="${title}" />`
    : '';
  return `
    <div class="anime-circle" style="border-color: ${color};" data-index="${index}">
      ${cover}
    </div>
  `;
}

function buildPopupContent(media) {
  const title = media.title.english ?? media.title.romaji;
  return `
    <div class="popup-header">
      <span class="popup-title">${title}</span>
      <a class="link-btn anime-link" href="https://anilist.co/anime/${media.id}" target="_blank" rel="noopener"><span class="arrow">↗</span></a>
    </div>
    <p class="label">Genres</p>
    ${renderGenres(media.genres)}
    <p class="label">Tags</p>
    ${renderTagsWithRank(media.tags)}
  `;
}

const MARGIN = 8;

function positionPopup(popup, x, y) {
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  popup.style.maxWidth = '';
  popup.style.maxHeight = '';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = popup.getBoundingClientRect();

  if (rect.right > vw - MARGIN) {
    const left = Math.max(MARGIN, vw - rect.width - MARGIN);
    popup.style.left = left + 'px';
    if (left === MARGIN) popup.style.maxWidth = (vw - 2 * MARGIN) + 'px';
  }
  if (rect.bottom > vh - MARGIN) {
    const top = Math.max(MARGIN, vh - rect.height - MARGIN);
    popup.style.top = top + 'px';
    if (top === MARGIN) popup.style.maxHeight = (vh - 2 * MARGIN) + 'px';
  }
}

const fileInput = document.getElementById('file-input');
const searchBtn = document.getElementById('search-btn');
const results = document.getElementById('results');
const feedback = document.getElementById('feedback');
const popup = document.getElementById('popup');

let mediaStore = [];

results.addEventListener('mousemove', (e) => {
  const circle = e.target.closest('.anime-circle');
  if (!circle) { popup.style.display = 'none'; return; }
  const idx = parseInt(circle.dataset.index);
  popup.innerHTML = buildPopupContent(mediaStore[idx]);
  popup.style.display = 'block';
  positionPopup(popup, e.clientX, e.clientY);
});

results.addEventListener('mouseleave', () => {
  popup.style.display = 'none';
});

fileInput.addEventListener('change', () => {
  searchBtn.disabled = !fileInput.files[0];
});

searchBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const text = await file.text();
  const terms = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (!terms.length) {
    feedback.textContent = 'File is empty.';
    results.innerHTML = '';
    return;
  }

  feedback.textContent = `Searching ${terms.length} title${terms.length > 1 ? 's' : ''}…`;
  results.innerHTML = '';

  try {
    const resultList = await fetchAnimeList(terms);
    const found = resultList.filter(r => r.media);
    if (!found.length) {
      feedback.textContent = 'Invalid title in list.';
      return;
    }
    feedback.textContent = '';
    mediaStore = found.map(r => r.media);
    results.innerHTML = found.map((r, i) => renderCircle(r, i)).join('');
  } catch (err) {
    results.innerHTML = '';
    if (err instanceof RateLimitError) {
      feedback.textContent = `Rate limited — try again in ${err.retryAfter}s.`;
    } else {
      feedback.textContent = `Error: ${err.message}`;
    }
  }
});
