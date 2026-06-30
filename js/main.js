const ANILIST_URL = 'https://graphql.anilist.co';

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limited');
    this.retryAfter = retryAfter;
  }
}

let mediaType = 'ANIME';

function mediaTypeArgs() {
  if (mediaType === 'NOVEL') return 'type: MANGA, format: NOVEL';
  return `type: ${mediaType}`;
}

function mediaAnilistPath() {
  return mediaType === 'ANIME' ? 'anime' : 'manga';
}

function buildBatchQuery(terms) {
  const fields = `id title { romaji english } coverImage { medium color } genres tags { name rank } format`;
  const aliases = terms
    .map((term, i) => `m${i}: Media(search: ${JSON.stringify(term)}, ${mediaTypeArgs()}) { ${fields} }`)
    .join('\n  ');
  return `query {\n  ${aliases}\n}`;
}

async function fetchMediaBatch(terms) {
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
  return terms.map((term, i) => ({ term, media: data[`m${i}`] ?? null }));
}

async function fetchProfile(userName, statuses) {
  const listType = mediaType === 'ANIME' ? 'ANIME' : 'MANGA';
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query ($userName: String) {
      MediaListCollection(userName: $userName, type: ${listType}) {
        lists {
          status
          entries {
            media {
              id title { romaji english } coverImage { medium color } genres tags { name rank } format
            }
          }
        }
      }
    }`, variables: { userName } }),
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
    throw new RateLimitError(retryAfter);
  }
  const { data, errors } = await res.json();
  if (!data) throw new Error(errors?.[0]?.message ?? `HTTP ${res.status}`);
  const collection = data.MediaListCollection;
  if (!collection) throw new Error('User not found or list is private.');
  let items = collection.lists
    .filter(l => statuses.has(l.status))
    .flatMap(l => l.entries.map(e => e.media));
  if (mediaType === 'NOVEL') items = items.filter(m => m.format === 'NOVEL');
  return items;
}

async function fetchPopular(count) {
  const perPage = 50;
  const pages = Math.ceil(count / perPage);
  const all = [];
  for (let page = 1; page <= pages; page++) {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query {
        Page(page: ${page}, perPage: ${perPage}) {
          media(${mediaTypeArgs()}, sort: POPULARITY_DESC) {
            id title { romaji english } coverImage { medium color } genres tags { name rank } format
          }
        }
      }` }),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError(retryAfter);
    }
    const { data, errors } = await res.json();
    if (!data) throw new Error(errors?.[0]?.message ?? `HTTP ${res.status}`);
    all.push(...data.Page.media);
    if (page < pages) feedback.textContent = `Fetched ${all.length} / ${count} ${mediaType.toLowerCase()}…`;
  }
  return all.slice(0, count);
}

async function fetchBatchWithSplit(terms) {
  let deferred = [];
  let current = terms;
  const allResults = [];

  while (current.length > 0) {
    try {
      const res = await fetchMediaBatch(current);
      allResults.push(...res);
      current = deferred.flat();
      deferred = [];
      if (current.length > 0) {
        feedback.textContent = `Fetching remaining ${current.length} title${current.length > 1 ? 's' : ''}…`;
      }
    } catch (err) {
      const match = err.message?.match(/max query complexity should be (\d+) but got (\d+)/i);
      if (!match) throw err;
      const max = parseInt(match[1]), got = parseInt(match[2]);
      const keepCount = Math.max(1, Math.floor(current.length * max / got));
      if (keepCount >= current.length) throw err;
      deferred.push(current.slice(keepCount));
      current = current.slice(0, keepCount);
      feedback.textContent = `Query too complex — splitting into smaller batches…`;
    }
  }

  return allResults;
}

let inputMode = 'local';
let popularCount = 10;

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
      <a class="link-btn anime-link" href="https://anilist.co/${mediaAnilistPath()}/${media.id}" target="_blank" rel="noopener"><span class="arrow">↗</span></a>
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
let lineConnMap = new Map();

const CIRCLE_R = 40;
const SPRING_REST = 130;
let springK = 0.04;
const REPEL_K = 5000;
const CENTER_K = 0.002;
const DRAG = 0.82;

let simNodes = [];
let simSprings = [];
let animFrameId = null;

let camX = 0, camY = 0, camZoom = 1;
let isPanning = false, panStartX = 0, panStartY = 0, panStartCamX = 0, panStartCamY = 0;

function initSimulation(count) {
  camX = 0; camY = 0; camZoom = 1;
  simNodes = Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200,
    vx: 0, vy: 0,
  }));
}

function buildSprings(found) {
  const selSets = found.map(({ media }) =>
    new Set(getSelection(media).map(s => s.name))
  );
  simSprings = [];
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const shared = [...selSets[i]].filter(n => selSets[j].has(n));
      if (shared.length) simSprings.push({ i, j, shared });
    }
  }
  const maxShared = Math.max(...simSprings.map(s => s.shared.length), 1);
  simSprings.forEach(s => { s.strength = s.shared.length / maxShared; });
}

function stepPhysics() {
  const n = simNodes.length;
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);

  for (const { i, j, strength } of simSprings) {
    const dx = simNodes[j].x - simNodes[i].x;
    const dy = simNodes[j].y - simNodes[i].y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const f = springK * strength ** 2 * (dist - SPRING_REST);
    const ux = dx / dist, uy = dy / dist;
    fx[i] += f * ux; fy[i] += f * uy;
    fx[j] -= f * ux; fy[j] -= f * uy;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = simNodes[j].x - simNodes[i].x;
      const dy = simNodes[j].y - simNodes[i].y;
      const distSq = Math.max(1, dx * dx + dy * dy);
      const dist = Math.sqrt(distSq);
      const f = REPEL_K / distSq;
      const ux = dx / dist, uy = dy / dist;
      fx[i] -= f * ux; fy[i] -= f * uy;
      fx[j] += f * ux; fy[j] += f * uy;
    }
  }

  for (let i = 0; i < n; i++) {
    fx[i] -= CENTER_K * simNodes[i].x;
    fy[i] -= CENTER_K * simNodes[i].y;
  }

  for (let i = 0; i < n; i++) {
    simNodes[i].vx = (simNodes[i].vx + fx[i]) * DRAG;
    simNodes[i].vy = (simNodes[i].vy + fy[i]) * DRAG;
    simNodes[i].x += simNodes[i].vx;
    simNodes[i].y += simNodes[i].vy;
  }
}

function updateSimDOM() {
  const circleEls = document.querySelectorAll('.anime-circle');
  const rect = results.getBoundingClientRect();
  const vcx = rect.width / 2, vcy = rect.height / 2;

  circleEls.forEach((el, i) => {
    const sx = (simNodes[i].x - camX) * camZoom + vcx;
    const sy = (simNodes[i].y - camY) * camZoom + vcy;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.transform = `translate(-50%, -50%) scale(${camZoom})`;
  });

  connections.forEach(conn => {
    conn.x1 = rect.left + (simNodes[conn.i].x - camX) * camZoom + vcx;
    conn.y1 = rect.top + (simNodes[conn.i].y - camY) * camZoom + vcy;
    conn.x2 = rect.left + (simNodes[conn.j].x - camX) * camZoom + vcx;
    conn.y2 = rect.top + (simNodes[conn.j].y - camY) * camZoom + vcy;
    conn.line.setAttribute('x1', conn.x1);
    conn.line.setAttribute('y1', conn.y1);
    conn.line.setAttribute('x2', conn.x2);
    conn.line.setAttribute('y2', conn.y2);
  });
  updateClusterDOM();
}

function startSimulation() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  function loop() {
    stepPhysics();
    updateSimDOM();
    animFrameId = requestAnimationFrame(loop);
  }
  animFrameId = requestAnimationFrame(loop);
}

function stopSimulation() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function convexHull(pts) {
  if (pts.length <= 1) return pts.slice();
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O, A, B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length-1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function circleHull(screenPts, r) {
  const samples = [];
  for (const [x, y] of screenPts) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      samples.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  }
  return convexHull(samples);
}

function pointInPolygon(px, py, hull) {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const [xi, yi] = hull[i], [xj, yj] = hull[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function tagHue(name) {
  let h = 0;
  for (const c of name) h = (h*31 + c.charCodeAt(0)) & 0xffff;
  return h % 360;
}

let clusterPolygons = [];

function drawClusters() {
  const svg = document.getElementById('clusters-svg');
  const labelsSvg = document.getElementById('labels-svg');
  svg.innerHTML = '';
  labelsSvg.innerHTML = '';
  clusterPolygons = [];
  if (!mediaStore.length) return;
  const tagCounts = new Map();
  for (const { shared } of simSprings) {
    for (const name of shared) tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
  }
  for (const [tag, count] of tagCounts) {
    if (count < clusterMin) continue;
    const indices = mediaStore.reduce((acc, media, i) => {
      if (getSelection(media).some(s => s.name === tag)) acc.push(i);
      return acc;
    }, []);
    if (indices.length < 2) continue;
    const hue = tagHue(tag);
    const baseFill = `hsla(${hue},60%,60%,0.07)`;
    const activeFill = `hsla(${hue},70%,70%,0.22)`;
    const baseStroke = `hsla(${hue},70%,70%,0.3)`;
    const activeStroke = `hsla(${hue},80%,85%,0.9)`;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('fill', baseFill);
    poly.setAttribute('stroke', baseStroke);
    poly.setAttribute('stroke-width', '1.5');
    poly.style.pointerEvents = 'fill';
    svg.appendChild(poly);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.textContent = tag;
    label.setAttribute('fill', `hsla(${hue},70%,80%,0.9)`);
    label.setAttribute('font-size', '11');
    label.setAttribute('font-family', 'sans-serif');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('stroke', '#111');
    label.setAttribute('stroke-width', '3');
    label.setAttribute('paint-order', 'stroke');
    labelsSvg.appendChild(label);
    const entry = { indices, poly, label, tag, baseFill, activeFill, baseStroke, activeStroke };
    clusterPolygons.push(entry);
    poly.addEventListener('mouseover', () => {
      entry.poly.setAttribute('fill', entry.activeFill);
      entry.poly.setAttribute('stroke', entry.activeStroke);
      clearHighlights();
      const circleEls = document.querySelectorAll('.anime-circle');
      for (const conn of connections) {
        if (conn.shared.includes(entry.tag)) {
          conn.line.setAttribute('stroke', conn.activeStroke);
          highlightedLines.push(conn.line);
          [conn.i, conn.j].forEach(idx => {
            const el = circleEls[idx];
            if (el && !el.classList.contains('highlighted')) {
              el.classList.add('highlighted');
              highlightedCircles.push(el);
            }
          });
        }
      }
    });
    poly.addEventListener('mouseout', () => {
      entry.poly.setAttribute('fill', entry.baseFill);
      entry.poly.setAttribute('stroke', entry.baseStroke);
      clearHighlights();
    });
  }
}

function updateClusterDOM() {
  const rect = results.getBoundingClientRect();
  const vcx = rect.width/2, vcy = rect.height/2;
  const r = (CIRCLE_R + 15) * camZoom;

  const hulls = clusterPolygons.map(({ indices }) => {
    const pts = indices.map(i => [
      (simNodes[i].x - camX) * camZoom + vcx + rect.left,
      (simNodes[i].y - camY) * camZoom + vcy + rect.top,
    ]);
    return circleHull(pts, r);
  });

  const placedLabels = [];
  for (let k = 0; k < clusterPolygons.length; k++) {
    const { poly, label } = clusterPolygons[k];
    const hull = hulls[k];
    if (hull.length < 3) { poly.setAttribute('points', ''); label.setAttribute('x', -9999); continue; }
    poly.setAttribute('points', hull.map(p => p.join(',')).join(' '));

    const step = Math.max(1, Math.floor(hull.length / 12));
    const candidates = [];
    for (let i = 0; i < hull.length; i += step) candidates.push(hull[i]);

    const free = candidates.filter(([px, py]) =>
      !hulls.some((h, j) => j !== k && h.length >= 3 && pointInPolygon(px, py, h))
    );
    const pool = free.length ? free : candidates;

    const minDistTo = ([px, py]) => placedLabels.length
      ? Math.min(...placedLabels.map(([lx, ly]) => Math.hypot(px - lx, py - ly)))
      : Infinity;

    const best = pool.reduce((m, p) => {
      const dm = minDistTo(p), mm = minDistTo(m);
      if (Math.abs(dm - mm) > 1) return dm > mm ? p : m;
      return p[1] < m[1] ? p : m;
    }, pool[0]);

    label.setAttribute('x', best[0]);
    label.setAttribute('y', best[1] - 5);
    placedLabels.push([best[0], best[1] - 5]);
  }
}

function drawConnections() {
  const svg = document.getElementById('connections-svg');
  svg.innerHTML = '';
  connections = [];
  lineConnMap = new Map();
  for (const { i, j, shared, strength } of simSprings) {
    const baseStroke = `rgba(255,255,255,${(0.1 + 0.25 * strength).toFixed(2)})`;
    const activeStroke = `rgba(255,255,255,${(0.5 + 0.4 * strength).toFixed(2)})`;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', baseStroke);
    line.setAttribute('stroke-width', '3');
    svg.appendChild(line);
    const conn = { x1: 0, y1: 0, x2: 0, y2: 0, shared, i, j, line, baseStroke, activeStroke };
    connections.push(conn);
    lineConnMap.set(line, conn);
  }
}

const fileInput = document.getElementById('file-input');
const searchBtn = document.getElementById('search-btn');
const results = document.getElementById('results');
const feedback = document.getElementById('feedback');
const popup = document.getElementById('popup');
const springSlider = document.getElementById('spring-slider');
const springVal = document.getElementById('spring-val');
const clusterMinSlider = document.getElementById('cluster-min-slider');
const clusterMinVal = document.getElementById('cluster-min-val');
let clusterMin = 3;
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
  highlightedLines.forEach(l => {
    const conn = lineConnMap.get(l);
    l.setAttribute('stroke', conn ? conn.baseStroke : 'rgba(255,255,255,0.35)');
  });
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

  if (isPanning) {
    camX = panStartCamX - (e.clientX - panStartX) / camZoom;
    camY = panStartCamY - (e.clientY - panStartY) / camZoom;
    return;
  }

  const x = e.clientX, y = e.clientY;

  const circle = e.target.closest?.('.anime-circle');
  if (circle) {
    clearHighlights();
    const idx = parseInt(circle.dataset.index);
    connections.filter(c => c.i === idx || c.j === idx).forEach(c => {
      c.line.setAttribute('stroke', c.activeStroke);
      highlightedLines.push(c.line);
    });
    popup.innerHTML = buildPopupContent(mediaStore[idx]);
    popup.style.display = 'block';
    const r = circle.getBoundingClientRect();
    positionPopup(r.right + MARGIN, r.top);
    return;
  }

  if (e.target.closest('.center')) {
    for (const conn of connections) {
      if (distToSegment(x, y, conn.x1, conn.y1, conn.x2, conn.y2) <= LINE_HIT_DIST) {
        highlightCircles(conn.i, conn.j);
        conn.line.setAttribute('stroke', conn.activeStroke);
        highlightedLines.push(conn.line);
        popup.innerHTML = buildConnectionPopup(conn.shared);
        popup.style.display = 'block';
        positionPopup((conn.x1 + conn.x2) / 2 + MARGIN, (conn.y1 + conn.y2) / 2);
        return;
      }
    }
  }

  if (e.target.closest('.sidebar-left')) return;
  if (e.target.closest('#clusters-svg')) return;
  clearHighlights();
  popup.style.display = 'none';
});

function updateStats() {
  const statsEl = document.getElementById('stats');
  if (!statsEl) return;
  const n = mediaStore.length;
  const totalConns = simSprings.length;
  if (n === 0) { statsEl.innerHTML = ''; return; }
  const tagCounts = new Map();
  for (const { shared } of simSprings) {
    for (const name of shared) tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
  }
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  clusterMinSlider.max = maxCount;
  if (clusterMin > maxCount) { clusterMin = maxCount; clusterMinSlider.value = maxCount; clusterMinVal.textContent = maxCount; }
  const visible = sorted.filter(([, count]) => count >= clusterMin);
  statsEl.innerHTML = `<p class="label">Overview</p>
  <div class="stat-counts">
    <span>${n} ${mediaType.toLowerCase()}</span>
    <span>${totalConns} connection${totalConns !== 1 ? 's' : ''}</span>
  </div>
  <p class="label">Clusters</p>
  <div class="stat-bars">${visible.map(([name, count]) => {
    const pct = totalConns > 0 ? Math.round(count / totalConns * 100) : 0;
    const barW = (count / maxCount * 100).toFixed(1);
    return `<div class="stat-bar-row" data-tag="${name.replace(/"/g, '&quot;')}">
      <div class="stat-bar-label" title="${name}">${name}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${barW}%"></div></div>
      <div class="stat-bar-nums">${count} · ${pct}%</div>
    </div>`;
  }).join('')}</div>`;
}

function redrawIfLoaded() {
  if (!mediaStore.length) return;
  clearHighlights();
  popup.style.display = 'none';
  buildSprings(mediaStore.map(media => ({ media })));
  drawConnections();
  drawClusters();
  updateStats();
}

document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    relevanceMode = btn.dataset.mode;
    settingPercent.style.display = relevanceMode === 'percent' ? '' : 'none';
    settingCount.style.display = relevanceMode === 'count' ? '' : 'none';
    settingTopPct.style.display = relevanceMode === 'top-pct' ? '' : 'none';
    redrawIfLoaded();
  });
});

document.querySelectorAll('.media-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.media-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mediaType = btn.dataset.type;
  });
});

document.querySelectorAll('.input-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.input-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    inputMode = btn.dataset.input;
    document.getElementById('input-local').style.display = inputMode === 'local' ? '' : 'none';
    document.getElementById('input-popular').style.display = inputMode === 'popular' ? '' : 'none';
    document.getElementById('input-profile').style.display = inputMode === 'profile' ? '' : 'none';
    if (inputMode === 'local') searchBtn.disabled = !fileInput.files[0];
    else if (inputMode === 'popular') searchBtn.disabled = false;
    else if (inputMode === 'profile') searchBtn.disabled = !document.getElementById('profile-username').value.trim();
  });
});

document.querySelectorAll('.popular-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.popular-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    popularCount = parseInt(btn.dataset.count);
  });
});

springSlider.addEventListener('input', () => {
  springK = parseInt(springSlider.value) / 100;
  springVal.textContent = springSlider.value;
});

clusterMinSlider.addEventListener('input', () => {
  clusterMin = parseInt(clusterMinSlider.value);
  clusterMinVal.textContent = clusterMin;
  drawClusters();
  updateStats();
});

document.getElementById('vis-connections').addEventListener('change', e => {
  document.getElementById('connections-svg').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('vis-covers').addEventListener('change', e => {
  document.getElementById('results').classList.toggle('hide-covers', !e.target.checked);
});

document.getElementById('vis-clusters').addEventListener('change', e => {
  document.getElementById('clusters-svg').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('vis-labels').addEventListener('change', e => {
  document.getElementById('labels-svg').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('graph-search').addEventListener('input', e => {
  const raw = e.target.value.trim();
  const circleEls = document.querySelectorAll('.anime-circle');
  if (!raw) {
    results.classList.remove('filter-active');
    circleEls.forEach(el => el.classList.remove('filter-match'));
    return;
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const tagFilters = parts
    .filter(p => p.startsWith('#'))
    .map(p => {
      const raw = p.slice(1);
      const colon = raw.lastIndexOf(':');
      if (colon > 0) {
        const minRank = parseInt(raw.slice(colon + 1), 10);
        if (!isNaN(minRank)) {
          return { name: raw.slice(0, colon).replace(/_/g, ' ').toLowerCase(), minRank };
        }
      }
      return { name: raw.replace(/_/g, ' ').toLowerCase(), minRank: null };
    });
  const titleQuery = parts.filter(p => !p.startsWith('#')).join(' ').toLowerCase();

  results.classList.add('filter-active');
  circleEls.forEach(el => {
    const idx = parseInt(el.dataset.index);
    const media = mediaStore[idx];
    if (!media) { el.classList.remove('filter-match'); return; }

    const titleMatch = !titleQuery ||
      (media.title.romaji ?? '').toLowerCase().includes(titleQuery) ||
      (media.title.english ?? '').toLowerCase().includes(titleQuery);

    const tagsMatch = tagFilters.every(({ name, minRank }) => {
      const tagHit = media.tags.some(t =>
        t.name.toLowerCase().includes(name) && (minRank === null || t.rank >= minRank)
      );
      if (tagHit) return true;
      return minRank === null && media.genres.some(g => g.toLowerCase().includes(name));
    });

    el.classList.toggle('filter-match', titleMatch && tagsMatch);
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

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.anime-circle') || e.target.closest('.anime-popup')) return;
  if (!e.target.closest('.center')) return;
  isPanning = true;
  panStartX = e.clientX; panStartY = e.clientY;
  panStartCamX = camX; panStartCamY = camY;
  document.body.style.cursor = 'grabbing';
});

document.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  document.body.style.cursor = '';
});

document.addEventListener('wheel', (e) => {
  if (e.target.closest('.anime-popup')) return;
  if (!e.target.closest('.center')) return;
  e.preventDefault();
  const rect = results.getBoundingClientRect();
  const vcx = rect.left + rect.width / 2;
  const vcy = rect.top + rect.height / 2;
  const wx = (e.clientX - vcx) / camZoom + camX;
  const wy = (e.clientY - vcy) / camZoom + camY;
  camZoom = Math.max(0.1, Math.min(10, camZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  camX = wx - (e.clientX - vcx) / camZoom;
  camY = wy - (e.clientY - vcy) / camZoom;
}, { passive: false });

const centerEl = document.querySelector('.center');
let isPinching = false;
let pinchStartDist = 0, pinchStartZoom = 1;
let pinchMidX = 0, pinchMidY = 0;
let pinchWorldX = 0, pinchWorldY = 0;

function touchDist(touches) {
  return Math.hypot(
    touches[1].clientX - touches[0].clientX,
    touches[1].clientY - touches[0].clientY
  );
}

centerEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    isPinching = false;
    isPanning = true;
    panStartX = e.touches[0].clientX;
    panStartY = e.touches[0].clientY;
    panStartCamX = camX;
    panStartCamY = camY;
  } else if (e.touches.length === 2) {
    isPanning = false;
    isPinching = true;
    pinchStartDist = touchDist(e.touches);
    pinchStartZoom = camZoom;
    pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = results.getBoundingClientRect();
    pinchWorldX = (pinchMidX - (rect.left + rect.width / 2)) / camZoom + camX;
    pinchWorldY = (pinchMidY - (rect.top + rect.height / 2)) / camZoom + camY;
  }
}, { passive: false });

centerEl.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1 && isPanning) {
    camX = panStartCamX - (e.touches[0].clientX - panStartX) / camZoom;
    camY = panStartCamY - (e.touches[0].clientY - panStartY) / camZoom;
  } else if (e.touches.length === 2 && isPinching) {
    const dist = touchDist(e.touches);
    camZoom = Math.max(0.1, Math.min(10, pinchStartZoom * dist / pinchStartDist));
    const rect = results.getBoundingClientRect();
    camX = pinchWorldX - (pinchMidX - (rect.left + rect.width / 2)) / camZoom;
    camY = pinchWorldY - (pinchMidY - (rect.top + rect.height / 2)) / camZoom;
  }
}, { passive: false });

centerEl.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    isPanning = false;
    isPinching = false;
  } else if (e.touches.length === 1 && isPinching) {
    isPinching = false;
    isPanning = true;
    panStartX = e.touches[0].clientX;
    panStartY = e.touches[0].clientY;
    panStartCamX = camX;
    panStartCamY = camY;
  }
}, { passive: false });

fileInput.addEventListener('change', () => {
  if (inputMode === 'local') searchBtn.disabled = !fileInput.files[0];
});

document.getElementById('profile-username').addEventListener('input', e => {
  if (inputMode === 'profile') searchBtn.disabled = !e.target.value.trim();
});

document.getElementById('stats').addEventListener('mouseover', (e) => {
  const row = e.target.closest('.stat-bar-row');
  if (!row) return;
  const tag = row.dataset.tag;
  clusterPolygons.forEach(c => { c.poly.setAttribute('fill', c.baseFill); c.poly.setAttribute('stroke', c.baseStroke); });
  clearHighlights();
  const circleEls = document.querySelectorAll('.anime-circle');
  for (const conn of connections) {
    if (conn.shared.includes(tag)) {
      conn.line.setAttribute('stroke', conn.activeStroke);
      highlightedLines.push(conn.line);
      [conn.i, conn.j].forEach(idx => {
        const el = circleEls[idx];
        if (el && !el.classList.contains('highlighted')) {
          el.classList.add('highlighted');
          highlightedCircles.push(el);
        }
      });
    }
  }
  const cluster = clusterPolygons.find(c => c.tag === tag);
  if (cluster) {
    cluster.poly.setAttribute('fill', cluster.activeFill);
    cluster.poly.setAttribute('stroke', cluster.activeStroke);
  }
});

document.getElementById('stats').addEventListener('mouseleave', () => {
  clusterPolygons.forEach(c => {
    c.poly.setAttribute('fill', c.baseFill);
    c.poly.setAttribute('stroke', c.baseStroke);
  });
  clearHighlights();
});

function displayResults(mediaArray) {
  mediaStore = mediaArray;
  const maxTags = Math.max(...mediaStore.map(m => m.tags.length));
  countSlider.max = maxTags;
  if (relevanceCount > maxTags) { relevanceCount = maxTags; countSlider.value = maxTags; countVal.textContent = maxTags; }
  results.innerHTML = mediaStore.map((media, i) => renderCircle({ media }, i)).join('');
  stopSimulation();
  initSimulation(mediaStore.length);
  buildSprings(mediaStore.map(media => ({ media })));
  drawConnections();
  drawClusters();
  updateStats();
  updateSimDOM();
  startSimulation();
}

searchBtn.addEventListener('click', async () => {
  stopSimulation();
  results.innerHTML = '';
  results.classList.remove('filter-active');
  document.getElementById('graph-search').value = '';
  document.getElementById('connections-svg').innerHTML = '';
  document.getElementById('clusters-svg').innerHTML = '';
  document.getElementById('labels-svg').innerHTML = '';
  connections = [];
  clusterPolygons = [];
  lineConnMap = new Map();
  clearHighlights();
  mediaStore = [];
  document.getElementById('stats').innerHTML = '';
  feedback.textContent = '';

  try {
    let mediaArray;
    if (inputMode === 'local') {
      const file = fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      const terms = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (!terms.length) { feedback.textContent = 'File is empty.'; return; }
      feedback.textContent = `Searching ${terms.length} title${terms.length > 1 ? 's' : ''}…`;
      const resultList = await fetchBatchWithSplit(terms);
      const found = resultList.filter(r => r.media);
      if (!found.length) { feedback.textContent = 'Invalid title in list.'; return; }
      mediaArray = found.map(r => r.media);
    } else if (inputMode === 'popular') {
      feedback.textContent = `Fetching top ${popularCount} popular ${mediaType.toLowerCase()}…`;
      mediaArray = await fetchPopular(popularCount);
    } else if (inputMode === 'profile') {
      const userName = document.getElementById('profile-username').value.trim();
      if (!userName) return;
      const statuses = new Set(
        [...document.querySelectorAll('.status-check:checked')].map(cb => cb.value)
      );
      if (!statuses.size) { feedback.textContent = 'Select at least one status.'; return; }
      feedback.textContent = `Fetching ${mediaType.toLowerCase()} list for ${userName}…`;
      mediaArray = await fetchProfile(userName, statuses);
      if (!mediaArray.length) { feedback.textContent = `No ${mediaType.toLowerCase()} found in list.`; return; }
    } else {
      return;
    }
    feedback.textContent = '';
    displayResults(mediaArray);
  } catch (err) {
    results.innerHTML = '';
    if (err instanceof RateLimitError) {
      feedback.textContent = `Rate limited — try again in ${err.retryAfter}s.`;
    } else {
      feedback.textContent = `Error: ${err.message}`;
    }
  }
});

document.getElementById('toggle-left').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar-left');
  const area = document.querySelector('.content-area');
  const collapsed = sidebar.classList.toggle('collapsed');
  area.classList.toggle('left-collapsed', collapsed);
  document.getElementById('toggle-left').textContent = collapsed ? '▶' : '◀';
  document.getElementById('toggle-left').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
});

document.getElementById('toggle-right').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar-right');
  const area = document.querySelector('.content-area');
  const collapsed = sidebar.classList.toggle('collapsed');
  area.classList.toggle('right-collapsed', collapsed);
  document.getElementById('toggle-right').textContent = collapsed ? '◀' : '▶';
  document.getElementById('toggle-right').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
});
