// ─── CONFIG ──────────────────────────────────────────────────────────────────

const RSS_FEEDS = [
  { name: "Autosport",      url: "https://www.autosport.com/rss/f1/news/" },
  { name: "RaceFans",       url: "https://www.racefans.net/feed/" },
  { name: "The Race",       url: "https://the-race.com/feed/" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
];

const REDDIT_URL = "https://www.reddit.com/r/formula1/hot.json?limit=20&raw_json=1";

// Multiple free RSS→JSON proxies as fallbacks
const RSS_PROXIES = [
  url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
  url => `https://feedparse.deno.dev/api?url=${encodeURIComponent(url)}`,
];

// Multiple CORS proxies for Reddit as fallbacks
const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadAll();
  document.getElementById("refresh-btn").addEventListener("click", () => loadAll(true));
});

// ─── TABS ─────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById("tab-" + btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });
}

// ─── LOAD ALL ─────────────────────────────────────────────────────────────────

async function loadAll() {
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.textContent = "↻ Loading...";
  setLastUpdated("Loading...");
  showSkeletons();

  const [newsResult, redditResult] = await Promise.allSettled([
    fetchAllRSS(),
    fetchReddit(),
  ]);

  const news   = newsResult.status   === "fulfilled" ? newsResult.value   : [];
  const reddit = redditResult.status === "fulfilled" ? redditResult.value : [];

  renderNews(news);
  renderReddit(reddit);
  renderWeekly([...news, ...reddit]);
  setLastUpdated(nowStr());

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

async function fetchAllRSS() {
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchOneFeed));
  let items = [];
  results.forEach(r => { if (r.status === "fulfilled") items = items.concat(r.value); });
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  // Keep last 48h, fallback to top 20
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = items.filter(i => new Date(i.pubDate).getTime() > cutoff);
  return recent.length >= 3 ? recent : items.slice(0, 20);
}

async function fetchOneFeed(feed) {
  for (const proxyFn of RSS_PROXIES) {
    try {
      const res = await fetch(proxyFn(feed.url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();

      // rss2json format
      if (data.items && Array.isArray(data.items)) {
        return data.items.slice(0, 8).map(item => ({
          source: feed.name,
          title: (item.title || "").trim(),
          link: item.link || item.url || "#",
          pubDate: item.pubDate || item.published || new Date().toISOString(),
          type: "news",
        })).filter(i => i.title);
      }

      // feedparse format
      if (data.feed && data.feed.entries) {
        return data.feed.entries.slice(0, 8).map(item => ({
          source: feed.name,
          title: (item.title || "").trim(),
          link: item.link || "#",
          pubDate: item.published || new Date().toISOString(),
          type: "news",
        })).filter(i => i.title);
      }
    } catch (e) {
      // try next proxy
    }
  }
  return [];
}

// ─── REDDIT ──────────────────────────────────────────────────────────────────

async function fetchReddit() {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const res = await fetch(proxyFn(REDDIT_URL), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { continue; }

      // allorigins wraps in { contents: "..." }
      if (json.contents) {
        try { json = JSON.parse(json.contents); } catch { continue; }
      }

      const posts = json?.data?.children || [];
      if (!posts.length) continue;

      return posts
        .filter(p => !p.data.stickied)
        .slice(0, 15)
        .map(p => ({
          source: "r/formula1",
          title: p.data.title,
          link: "https://reddit.com" + p.data.permalink,
          pubDate: new Date(p.data.created_utc * 1000).toISOString(),
          score: p.data.score,
          comments: p.data.num_comments,
          type: "reddit",
        }));
    } catch (e) {
      // try next proxy
    }
  }
  return [];
}

// ─── RENDER: NEWS ─────────────────────────────────────────────────────────────

function renderNews(items) {
  const el = document.getElementById("news-feed");
  if (!items.length) {
    el.innerHTML = errorState("News couldn't load right now.", "Hit Refresh or check back soon.");
    return;
  }
  el.innerHTML = items.map(item => `
    <a class="news-card" href="${item.link}" target="_blank" rel="noopener noreferrer">
      <div class="card-source">${escHtml(item.source)}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta"><span>${timeAgo(item.pubDate)}</span></div>
    </a>
  `).join("");
}

// ─── RENDER: REDDIT ───────────────────────────────────────────────────────────

function renderReddit(items) {
  const el = document.getElementById("reddit-feed");
  if (!items.length) {
    el.innerHTML = errorState("Reddit couldn't load right now.", "Hit Refresh — proxy might be slow.");
    return;
  }
  el.innerHTML = items.map(item => `
    <a class="news-card reddit" href="${item.link}" target="_blank" rel="noopener noreferrer">
      <div class="card-source">r/formula1</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta">
        <span class="card-score">▲ ${fmtNum(item.score)}</span>
        <span>💬 ${fmtNum(item.comments)}</span>
        <span>${timeAgo(item.pubDate)}</span>
      </div>
    </a>
  `).join("");
}

// ─── RENDER: WEEKLY ───────────────────────────────────────────────────────────

function renderWeekly(items) {
  const el = document.getElementById("weekly-feed");
  if (!items.length) {
    el.innerHTML = errorState("Load the daily tab first, then come back here.", "");
    return;
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = items.filter(i => new Date(i.pubDate).getTime() > cutoff);
  week.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const byDay = {};
  week.forEach(item => {
    const d = dayLabel(item.pubDate);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(item);
  });

  if (!Object.keys(byDay).length) {
    el.innerHTML = errorState("Nothing from the last 7 days yet.", "Try refreshing.");
    return;
  }

  el.innerHTML = Object.entries(byDay).map(([day, dayItems]) => `
    <div class="week-group">
      <div class="week-day-label">${day}</div>
      <div class="card-list">
        ${dayItems.slice(0, 6).map(item => `
          <a class="news-card ${item.type === "reddit" ? "reddit" : ""}" href="${item.link}" target="_blank" rel="noopener noreferrer">
            <div class="card-source">${escHtml(item.source)}</div>
            <div class="card-title">${escHtml(item.title)}</div>
            <div class="card-meta">
              ${item.score ? `<span class="card-score">▲ ${fmtNum(item.score)}</span>` : ""}
              <span>${timeAgo(item.pubDate)}</span>
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `).join("");
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function showSkeletons() {
  const skel = '<div class="skeleton-card"></div>'.repeat(4);
  document.getElementById("news-feed").innerHTML = skel;
  document.getElementById("reddit-feed").innerHTML = skel;
  document.getElementById("weekly-feed").innerHTML = skel;
}

function errorState(msg, hint) {
  return `<div class="error-state">
    <div class="err-icon">⚠️</div>
    <div class="err-msg">${msg}</div>
    ${hint ? `<div>${hint}</div>` : ""}
  </div>`;
}

function setLastUpdated(str) {
  const el = document.getElementById("last-updated");
  if (el) el.textContent = str;
}

function nowStr() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return "TODAY";
  if (isSameDay(d, yesterday)) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }).toUpperCase();
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function fmtNum(n) {
  if (!n) return "0";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
