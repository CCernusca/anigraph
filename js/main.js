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

let relevanceMode = 'percent';
let relevancePercent = 80;
let relevanceCount = 5;
let relevanceTopPct = 25;

function getSelection(media) {
  if (relevanceMode === 'genres') return media.genres.map(g => ({ name: g }));
  const tags = media.tags;
  if (relevanceMode === 'percent') return tags.filter(t => t.rank > relevancePercent);
  if (relevanceMode === 'top-pct') {
    const n = Math.max(1, Math.ceil(tags.length * relevanceTopPct / 100));
    return [...tags].sort((a, b) => b.rank - a.rank).slice(0, n);
  }
  return [...tags].sort((a, b) => b.rank - a.rank).slice(0, relevanceCount);
}

function renderGenres(genres, selectedSet) {
  return `<ul class="tag-list">${genres.map(g => {
    if (selectedSet?.has(g)) return `<li class="relevant">${g}</li>`;
    return `<li>${g}</li>`;
  }).join('')}</ul>`;
}

function renderTagsWithRank(tags, color, selectedSet) {
  return `<ul class="tag-list">${tags.map(t => {
    if (selectedSet.has(t.name)) {
      const c = color ?? '#ffffff';
      const style = `background-color:${c}33;color:${c};border:1px solid ${c}88;`;
      return `<li class="relevant" style="${style}">${t.name} <span class="pct">${t.rank}%</span></li>`;
    }
    return `<li>${t.name} <span class="pct">${t.rank}%</span></li>`;
  }).join('')}</ul>`;
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
  const sel = new Set(getSelection(media).map(s => s.name));
  const genreSet = relevanceMode === 'genres' ? sel : null;
  const tagSet = relevanceMode === 'genres' ? new Set() : sel;
  return `
    <div class="popup-header">
      <span class="popup-title">${title}</span>
      <a class="link-btn anime-link" href="https://anilist.co/anime/${media.id}" target="_blank" rel="noopener"><span class="arrow">↗</span></a>
    </div>
    <p class="label">Genres</p>
    ${renderGenres(media.genres, genreSet)}
    <p class="label">Tags</p>
    ${renderTagsWithRank(media.tags, media.coverImage?.color, tagSet)}
  `;
}

function buildConnectionPopup(shared) {
  return `
    <p class="label">Shared:</p>
    <ul class="tag-list">${shared.map(t => `<li class="relevant">${t}</li>`).join('')}</ul>
  `;
}

const MARGIN = 8;
const LINE_HIT_DIST = 8;

function positionPopup(x, y) {
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

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

let connections = [];

function drawConnections(found) {
  const svg = document.getElementById('connections-svg');
  svg.innerHTML = '';
  connections = [];

  const circles = document.querySelectorAll('.anime-circle');
  const centers = Array.from(circles).map(c => {
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  const selectionSets = found.map(({ media }) =>
    new Set(getSelection(media).map(s => s.name))
  );

  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const shared = [...selectionSets[i]].filter(name => selectionSets[j].has(name));
      if (!shared.length) continue;

      const { x: x1, y: y1 } = centers[i];
      const { x: x2, y: y2 } = centers[j];

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'rgba(255,255,255,0.35)');
      line.setAttribute('stroke-width', '3');
      svg.appendChild(line);

      connections.push({ x1, y1, x2, y2, shared, i, j, line });
    }
  }
}

const fileInput = document.getElementById('file-input');
const searchBtn = document.getElementById('search-btn');
const results = document.getElementById('results');
const feedback = document.getElementById('feedback');
const popup = document.getElementById('popup');
const percentSlider = document.getElementById('percent-slider');
const countSlider = document.getElementById('count-slider');
const topPctSlider = document.getElementById('top-pct-slider');
const percentVal = document.getElementById('percent-val');
const countVal = document.getElementById('count-val');
const topPctVal = document.getElementById('top-pct-val');
const settingPercent = document.getElementById('setting-percent');
const settingCount = document.getElementById('setting-count');
const settingTopPct = document.getElementById('setting-top-pct');

let mediaStore = [];
let highlightedCircles = [];
let highlightedLines = [];

function clearHighlights() {
  highlightedCircles.forEach(el => el.classList.remove('highlighted'));
  highlightedCircles = [];
  highlightedLines.forEach(l => l.setAttribute('stroke', 'rgba(255,255,255,0.35)'));
  highlightedLines = [];
}

function highlightCircles(...indices) {
  clearHighlights();
  const circleEls = document.querySelectorAll('.anime-circle');
  indices.forEach(idx => {
    const el = circleEls[idx];
    if (el) { el.classList.add('highlighted'); highlightedCircles.push(el); }
  });
}

document.addEventListener('mousemove', (e) => {
  if (e.target.closest?.('.anime-popup')) return;

  const x = e.clientX, y = e.clientY;

  const circle = e.target.closest?.('.anime-circle');
  if (circle) {
    clearHighlights();
    const idx = parseInt(circle.dataset.index);
    connections.filter(c => c.i === idx || c.j === idx).forEach(c => {
      c.line.setAttribute('stroke', 'rgba(255,255,255,0.9)');
      highlightedLines.push(c.line);
    });
    popup.innerHTML = buildPopupContent(mediaStore[idx]);
    popup.style.display = 'block';
    const r = circle.getBoundingClientRect();
    positionPopup(r.right + MARGIN, r.top);
    return;
  }

  for (const conn of connections) {
    if (distToSegment(x, y, conn.x1, conn.y1, conn.x2, conn.y2) <= LINE_HIT_DIST) {
      highlightCircles(conn.i, conn.j);
      conn.line.setAttribute('stroke', 'rgba(255,255,255,0.9)');
      highlightedLines.push(conn.line);
      popup.innerHTML = buildConnectionPopup(conn.shared);
      popup.style.display = 'block';
      positionPopup((conn.x1 + conn.x2) / 2 + MARGIN, (conn.y1 + conn.y2) / 2);
      return;
    }
  }

  clearHighlights();
  popup.style.display = 'none';
});

function redrawIfLoaded() {
  if (!mediaStore.length) return;
  clearHighlights();
  popup.style.display = 'none';
  requestAnimationFrame(() => drawConnections(mediaStore.map(media => ({ media }))));
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    relevanceMode = btn.dataset.mode;
    settingPercent.style.display = relevanceMode === 'percent' ? '' : 'none';
    settingCount.style.display = relevanceMode === 'count' ? '' : 'none';
    settingTopPct.style.display = relevanceMode === 'top-pct' ? '' : 'none';
    redrawIfLoaded();
  });
});

percentSlider.addEventListener('input', () => {
  relevancePercent = parseInt(percentSlider.value);
  percentVal.textContent = relevancePercent;
  redrawIfLoaded();
});

countSlider.addEventListener('input', () => {
  relevanceCount = parseInt(countSlider.value);
  countVal.textContent = relevanceCount;
  redrawIfLoaded();
});

topPctSlider.addEventListener('input', () => {
  relevanceTopPct = parseInt(topPctSlider.value);
  topPctVal.textContent = relevanceTopPct;
  redrawIfLoaded();
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
    const maxTags = Math.max(...mediaStore.map(m => m.tags.length));
    countSlider.max = maxTags;
    if (relevanceCount > maxTags) { relevanceCount = maxTags; countSlider.value = maxTags; countVal.textContent = maxTags; }
    results.innerHTML = found.map((r, i) => renderCircle(r, i)).join('');
    requestAnimationFrame(() => drawConnections(found));
  } catch (err) {
    results.innerHTML = '';
    if (err instanceof RateLimitError) {
      feedback.textContent = `Rate limited — try again in ${err.retryAfter}s.`;
    } else {
      feedback.textContent = `Error: ${err.message}`;
    }
  }
});
