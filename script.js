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

async function fetchFeed() {
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy(FEED_URL));
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('<rss') || text.includes('<channel')) return text;
    } catch { /* try next proxy */ }
  }
  throw new Error('Nelze nacist RSS feed');
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

function renderPodcastMeta(podcast) {
  const coverEl = document.getElementById('podcast-cover');
  if (podcast.image && coverEl) {
    coverEl.src = podcast.image;
  }
}

function renderEpisodes(episodes) {
  const container = document.getElementById('episodes-list');

  if (episodes.length === 0) {
    container.innerHTML = '<p class="loading">Zatim nejsou k dispozici zadne epizody.</p>';
    return;
  }

  container.innerHTML = episodes.map(ep => `
    <article class="episode">
      <div class="episode-date">${formatDate(ep.pubDate)}</div>
      <h3><a href="${ep.link}" target="_blank" rel="noopener">${ep.title}</a></h3>
      <p class="episode-description">${stripHtml(ep.description)}</p>
      ${ep.audioUrl ? `
        <audio controls preload="none">
          <source src="${ep.audioUrl}" type="${ep.audioType}">
          Vas prohlizec nepodporuje prehravani audia.
        </audio>
      ` : ''}
      ${ep.duration ? `<p class="episode-duration">${ep.duration}</p>` : ''}
    </article>
  `).join('');
}

function renderError() {
  document.getElementById('episodes-list').innerHTML = `
    <div class="error">
      <p><strong>Omlouvame se,</strong> nepodarilo se nacist epizody.</p>
      <p style="margin-top:0.5rem;font-size:0.85rem;">
        Poslouchejte primo na
        <a href="https://ecclesiapodcast.podbean.com/" target="_blank" rel="noopener">Podbean</a>.
      </p>
    </div>
  `;
}

async function init() {
  try {
    const xml = await fetchFeed();
    const { podcast, episodes } = parseFeed(xml);
    renderPodcastMeta(podcast);
    renderEpisodes(episodes);
  } catch (err) {
    console.error('Feed error:', err);
    renderError();
  }
}

init();
