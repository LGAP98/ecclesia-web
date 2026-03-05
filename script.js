/* ========================================
   Ecclesia Podcast – script.js
   RSS feed loader & renderer
   ======================================== */

/* ---- Hero slideshow ---- */
(function() {
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length <= 1) return;
  let current = 0;
  setInterval(() => {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
})();

const FEED_URL = 'https://feed.podbean.com/ecclesiapodcast/feed.xml';
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const s = parseInt(seconds, 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hod ${m} min`;
  return `${m} min`;
}

function parseDurationToSeconds(duration) {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(duration, 10) || 0;
}

const CACHE_KEY = 'ecclesia_feed_cache';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedFeed() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL) return data;
  } catch { /* ignore corrupt cache */ }
  return null;
}

function setCachedFeed(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch { /* storage full or unavailable */ }
}

async function fetchFeed() {
  const cached = getCachedFeed();
  if (cached) return cached;

  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy(FEED_URL));
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('<rss') || text.includes('<channel')) {
        setCachedFeed(text);
        return text;
      }
    } catch { /* try next proxy */ }
  }
  throw new Error('Nelze načíst RSS feed');
}

function parseFeed(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const channel = doc.querySelector('channel');

  const podcast = {
    title: channel.querySelector('title')?.textContent || 'Ecclesia Podcast',
    description: channel.querySelector('description')?.textContent || '',
    image: channel.querySelector('image url')?.textContent
      || doc.querySelector('itunes\\:image, image')?.getAttribute('href')
      || '',
    author: doc.querySelector('itunes\\:author')?.textContent || '',
  };

  const items = channel.querySelectorAll('item');
  const episodes = [];

  items.forEach(item => {
    const enclosure = item.querySelector('enclosure');
    const durationEl = item.querySelector('itunes\\:duration');
    const durationRaw = durationEl?.textContent || '';
    const durationSec = durationRaw.includes(':')
      ? parseDurationToSeconds(durationRaw)
      : parseInt(durationRaw, 10) || 0;

    episodes.push({
      title: item.querySelector('title')?.textContent || '',
      description: item.querySelector('description')?.textContent || '',
      pubDate: item.querySelector('pubDate')?.textContent || '',
      audioUrl: enclosure?.getAttribute('url') || '',
      audioType: enclosure?.getAttribute('type') || 'audio/mpeg',
      link: item.querySelector('link')?.textContent || '',
      duration: formatDuration(durationSec),
    });
  });

  return { podcast, episodes };
}

function renderPodcastMeta() {
  // podcast cover removed – no meta rendering needed
}

const EPISODES_BATCH = 5;
let allEpisodes = [];
let visibleCount = 0;

function renderEpisodes(episodes) {
  allEpisodes = episodes;
  visibleCount = 0;
  const container = document.getElementById('episodes-list');
  container.innerHTML = '';

  if (allEpisodes.length === 0) {
    container.innerHTML = '<p class="loading">Zatím nejsou k dispozici žádné epizody.</p>';
    return;
  }

  loadMore();
}

function createEpisodeEl(ep) {
  const article = document.createElement('article');
  article.className = 'episode';
  article.innerHTML = `
    <div class="episode-date">${formatDate(ep.pubDate)}</div>
    <h3><a href="${ep.link}" target="_blank" rel="noopener">${ep.title}</a></h3>
    <p class="episode-description">${stripHtml(ep.description)}</p>
    ${ep.duration ? `<p class="episode-duration">${ep.duration}</p>` : ''}
  `;

  if (ep.audioUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    const source = document.createElement('source');
    source.src = ep.audioUrl;
    source.type = ep.audioType;
    audio.appendChild(source);
    article.insertBefore(audio, article.querySelector('.episode-duration'));
  }

  return article;
}

function loadMore() {
  const container = document.getElementById('episodes-list');
  const oldBtn = container.querySelector('.load-more-btn');
  if (oldBtn) oldBtn.remove();

  const end = Math.min(visibleCount + EPISODES_BATCH, allEpisodes.length);
  for (let i = visibleCount; i < end; i++) {
    container.appendChild(createEpisodeEl(allEpisodes[i]));
  }
  visibleCount = end;

  if (visibleCount < allEpisodes.length) {
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = `Načíst další epizody (${allEpisodes.length - visibleCount} zbývá)`;
    btn.addEventListener('click', loadMore);
    container.appendChild(btn);
  }
}

function renderError() {
  document.getElementById('episodes-list').innerHTML = `
    <div class="error">
      <p>Nepodařilo se načíst epizody. Zkuste to prosím později.</p>
      <p style="margin-top:0.5rem;font-size:0.85rem;">
        Poslouchejte přímo na
        <a href="https://ecclesiapodcast.podbean.com/" target="_blank" rel="noopener">Podbean</a>.
      </p>
    </div>
  `;
}

async function init() {
  try {
    const xml = await fetchFeed();
    const { podcast, episodes } = parseFeed(xml);
    renderPodcastMeta();
    renderEpisodes(episodes);
  } catch (err) {
    console.error('Feed error:', err);
    renderError();
  }
}

init();
