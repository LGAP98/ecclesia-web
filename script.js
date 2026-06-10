/* ========================================
   Ecclesia Podcast – script.js
   RSS feed loader & renderer
   ======================================== */

/* ---- Konfigurace webu ----
   Sem doplňte údaje, jakmile budou k dispozici –
   web se podle nich aktualizuje automaticky. */
const SITE_CONFIG = {
  // Číslo účtu spolku pro dary. Po vyplnění se zobrazí číslo účtu
  // i QR kód pro platbu (např. number: '123456789', bankCode: '2010').
  donationAccount: {
    prefix: '',
    number: '2403226142',
    bankCode: '2010',
  },
  // Odkaz na přihlašovací formulář newsletteru (Ecomail, Mailchimp, …).
  newsletterUrl: '',
};

/* ---- Newsletter ---- */
(function initNewsletter() {
  const link = document.getElementById('newsletter-link');
  const hint = document.getElementById('newsletter-hint');
  if (!link || !SITE_CONFIG.newsletterUrl) return;
  link.href = SITE_CONFIG.newsletterUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  if (hint) hint.remove();
})();

/* ---- QR kód pro dar (česká QR platba) ---- */
(function initDonationQr() {
  const { prefix, number, bankCode } = SITE_CONFIG.donationAccount;
  if (!number || !bankCode) return;

  const account = `${prefix ? prefix + '-' : ''}${number}/${bankCode}`;
  const accountEl = document.getElementById('donation-account');
  if (accountEl) accountEl.textContent = account;

  const qrBox = document.getElementById('donation-qr');
  if (qrBox) {
    const params = new URLSearchParams({
      accountNumber: number,
      bankCode: bankCode,
      message: 'ECCLESIA PODCAST',
      size: '200',
    });
    if (prefix) params.set('accountPrefix', prefix);
    const src = `https://api.paylibo.com/paylibo/generator/czech/image?${params}`;
    qrBox.innerHTML = `<img src="${src}" alt="QR kód pro dar na účet ${account}" width="180" height="180">`;
  }
})();

const FEED_URL = 'https://feed.podbean.com/ecclesiapodcast/feed.xml';

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* Zdroje feedu v pořadí podle spolehlivosti: nejdřív přímé stažení
   (Podbean posílá CORS hlavičky), pak veřejné CORS proxy jako záloha. */
const FEED_FETCHERS = [
  () => fetchText(FEED_URL),
  () => fetchText(`https://corsproxy.io/?url=${encodeURIComponent(FEED_URL)}`),
  () => fetchText(`https://api.allorigins.win/raw?url=${encodeURIComponent(FEED_URL)}`),
  async () => JSON.parse(await fetchText(`https://api.allorigins.win/get?url=${encodeURIComponent(FEED_URL)}`)).contents,
  () => fetchText(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(FEED_URL)}`),
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

  for (const fetcher of FEED_FETCHERS) {
    try {
      const text = await fetcher();
      if (text && (text.includes('<rss') || text.includes('<channel'))) {
        setCachedFeed(text);
        return text;
      }
    } catch (err) {
      console.warn('Zdroj feedu selhal, zkouším další:', err.message);
    }
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

const EPISODES_PER_PAGE = 5;
let allEpisodes = [];
let currentPage = 1;

function renderEpisodes(episodes) {
  allEpisodes = episodes;
  currentPage = 1;
  renderPage();
}

function renderPage() {
  const container = document.getElementById('episodes-list');

  if (allEpisodes.length === 0) {
    container.innerHTML = '<p class="loading">Zatím nejsou k dispozici žádné epizody.</p>';
    return;
  }

  const totalPages = Math.ceil(allEpisodes.length / EPISODES_PER_PAGE);
  const start = (currentPage - 1) * EPISODES_PER_PAGE;
  const pageEpisodes = allEpisodes.slice(start, start + EPISODES_PER_PAGE);

  const episodesHtml = pageEpisodes.map(ep => `
    <article class="episode">
      <div class="episode-date">${formatDate(ep.pubDate)}</div>
      <h3><a href="${ep.link}" target="_blank" rel="noopener">${ep.title}</a></h3>
      <p class="episode-description">${stripHtml(ep.description)}</p>
      ${ep.audioUrl ? `
        <audio controls preload="none">
          <source src="${ep.audioUrl}" type="${ep.audioType}">
          Váš prohlížeč nepodporuje přehrávání audia.
        </audio>
      ` : ''}
      ${ep.duration ? `<p class="episode-duration">${ep.duration}</p>` : ''}
    </article>
  `).join('');

  let paginationHtml = '';
  if (totalPages > 1) {
    const buttons = [];
    buttons.push(`<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`);

    const pages = new Set();
    pages.add(1);
    pages.add(totalPages);
    for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
      pages.add(i);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    console.log('[pagination] currentPage:', currentPage, 'totalPages:', totalPages);
    console.log('[pagination] pages set:', [...pages]);
    console.log('[pagination] sorted:', sorted);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) {
        console.log('[pagination] ellipsis between', prev, 'and', p, '(gap:', p - prev, ')');
        buttons.push(`<span class="page-ellipsis">&hellip;</span>`);
      }
      buttons.push(`<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`);
      prev = p;
    }
    console.log('[pagination] total buttons:', buttons.length);

    buttons.push(`<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>`);
    paginationHtml = `<nav class="pagination">${buttons.join('')}</nav>`;
  }

  container.innerHTML = episodesHtml + paginationHtml;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page, 10);
      if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderPage();
        document.getElementById('episodes').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

function renderError() {
  document.getElementById('episodes-list').innerHTML = `
    <div class="error">
      <p>Epizody se momentálně nepodařilo načíst. Mezitím nás můžete poslouchat přímo na
        <a href="https://open.spotify.com/show/2Znn5fGDS0gHYgS1RynksV" target="_blank" rel="noopener">Spotify</a>
        nebo v <a href="https://podcasts.apple.com/cz/podcast/ecclesia-podcast-cz/id1535681775" target="_blank" rel="noopener">Apple Podcasts</a>.
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
