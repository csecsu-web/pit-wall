// ─── CONFIG ──────────────────────────────────────────────────────────────────

const NEWS_FEEDS = [
  { name: "Autosport",      url: "https://www.autosport.com/rss/f1/news/",   type: "news" },
  { name: "RaceFans",       url: "https://www.racefans.net/feed/",           type: "news" },
  { name: "The Race",       url: "https://the-race.com/feed/",               type: "news" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/",  type: "news" },
  { name: "BBC Sport F1",   url: "https://feeds.bbci.co.uk/sport/formula1/rss.xml", type: "news" },
];

const GOSSIP_FEEDS = [
  { name: "PlanetF1",       url: "https://www.planetf1.com/ps-rss",               type: "gossip" },
  { name: "Sky Sports F1",  url: "https://www.skysports.com/rss/12433",            type: "gossip" },
  { name: "Joe Saward",     url: "https://joesaward.wordpress.com/feed/",          type: "gossip" },
  { name: "Adam Cooper F1", url: "https://adamcooperf1.com/feed/",                 type: "gossip" },
  { name: "Crash.net F1",   url: "https://www.crash.net/rss/f1",                   type: "gossip" },
];

// Reddit via RSS — goes through same proxy as everything else, reliable
const REDDIT_FEEDS = [
  { name: "r/formula1",    url: "https://www.reddit.com/r/formula1/new/.rss?limit=20",   type: "reddit" },
  { name: "r/formuladank", url: "https://www.reddit.com/r/formuladank/hot/.rss?limit=10",type: "reddit" },
  { name: "r/F1Technical", url: "https://www.reddit.com/r/F1Technical/hot/.rss?limit=8", type: "reddit" },
];

const RSS_PROXY = url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadAll();
  document.getElementById("refresh-btn").addEventListener("click", loadAll);
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

  const [newsRes, gossipRes, redditRes] = await Promise.allSettled([
    fetchRSSGroup(NEWS_FEEDS),
    fetchRSSGroup(GOSSIP_FEEDS),
    fetchRSSGroup(REDDIT_FEEDS),
  ]);

  const news   = newsRes.status   === "fulfilled" ? newsRes.value   : [];
  const gossip = gossipRes.status === "fulfilled" ? gossipRes.value : [];
  const reddit = redditRes.status === "fulfilled" ? redditRes.value : [];

  renderFeed("news-feed",   news,   "News couldn't load. Hit Refresh.");
  renderFeed("gossip-feed", gossip, "Gossip feeds couldn't load. Hit Refresh.");
  renderFeed("reddit-feed", reddit, "Reddit couldn't load. Hit Refresh.");
  renderWeekly([...news, ...gossip, ...reddit]);
  setLastUpdated(nowStr());

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
}

// ─── RSS (all feeds use same proxy) ──────────────────────────────────────────

async function fetchRSSGroup(feeds) {
  const results = await Promise.allSettled(feeds.map(fetchOneFeed));
  let items = [];
  results.forEach(r => { if (r.status === "fulfilled") items = items.concat(r.value); });
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = items.filter(i => new Date(i.pubDate).getTime() > cutoff);
  return recent.length >= 2 ? recent : items.slice(0, 20);
}

async function fetchOneFeed(feed) {
  try {
    const res = await fetch(RSS_PROXY(feed.url), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    if (!data.items || !Array.isArray(data.items)) throw new Error("no items");
    return data.items.slice(0, 8).map(item => ({
      source: feed.name,
      title: stripHtml(item.title || "").trim(),
      link: item.link || item.url || "#",
      pubDate: item.pubDate || new Date().toISOString(),
      type: feed.type,
    })).filter(i => i.title.length > 5);
  } catch (e) {
    return [];
  }
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderFeed(id, items, errMsg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = errorState(errMsg);
    return;
  }
  el.innerHTML = items.map(item => cardHtml(item)).join("");
}

function renderWeekly(items) {
  const el = document.getElementById("weekly-feed");
  if (!items.length) {
    el.innerHTML = errorState("Load the TODAY tab first, then switch here.");
    return;
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = items
    .filter(i => new Date(i.pubDate).getTime() > cutoff)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  if (!week.length) {
    el.innerHTML = errorState("Nothing from the last 7 days yet. Try refreshing.");
    return;
  }

  const byDay = {};
  week.forEach(item => {
    const d = dayLabel(item.pubDate);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(item);
  });

  el.innerHTML = Object.entries(byDay).map(([day, dayItems]) => `
    <div class="week-group">
      <div class="week-day-label">${day}</div>
      <div class="card-list">
        ${dayItems.slice(0, 8).map(item => cardHtml(item)).join("")}
      </div>
    </div>
  `).join("");
}

function cardHtml(item) {
  const cls = item.type === "reddit"  ? "reddit"
            : item.type === "gossip"  ? "gossip-card"
            : "";
  return `
    <a class="news-card ${cls}" href="${item.link}" target="_blank" rel="noopener noreferrer">
      <div class="card-source">${escHtml(item.source)}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta"><span>${timeAgo(item.pubDate)}</span></div>
    </a>
  `;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function showSkeletons() {
  const skel = '<div class="skeleton-card"></div>'.repeat(4);
  ["news-feed", "gossip-feed", "reddit-feed", "weekly-feed"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = skel;
  });
}

function errorState(msg) {
  return `<div class="error-state"><div class="err-icon">⚠️</div><div class="err-msg">${msg}</div></div>`;
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
  if (n == null) return "0";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripHtml(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
