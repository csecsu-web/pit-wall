// ─── CONFIG ──────────────────────────────────────────────────────────────────

const RSS_FEEDS = [
  { name: "Autosport",      url: "https://www.autosport.com/rss/f1/news/" },
  { name: "RaceFans",       url: "https://www.racefans.net/feed/" },
  { name: "The Race",       url: "https://the-race.com/feed/" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
];

// Reddit via RSS — works through rss2json just like news feeds
const REDDIT_FEEDS = [
  { name: "r/formula1",    url: "https://www.reddit.com/r/formula1/.rss?limit=20" },
  { name: "r/formuladank", url: "https://www.reddit.com/r/formuladank/.rss?limit=10" },
];

// Bluesky F1 gossip/insider accounts — free open API, no auth needed
const BSKY_ACCOUNTS = [
  { handle: "formula1.bsky.social",     label: "Formula 1" },
  { handle: "racefans.bsky.social",     label: "RaceFans" },
  { handle: "therace.bsky.social",      label: "The Race" },
  { handle: "autosport.bsky.social",    label: "Autosport" },
];

// Bluesky search terms for gossip
const BSKY_SEARCH_TERMS = ["F1 gossip", "Formula 1 transfer", "F1 rumour", "formula1"];

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

  const [newsRes, redditRes, socialRes] = await Promise.allSettled([
    fetchAllRSS(RSS_FEEDS),
    fetchAllRSS(REDDIT_FEEDS),
    fetchBluesky(),
  ]);

  const news   = newsRes.status   === "fulfilled" ? newsRes.value   : [];
  const reddit = redditRes.status === "fulfilled" ? redditRes.value : [];
  const social = socialRes.status === "fulfilled" ? socialRes.value : [];

  renderFeed("news-feed",    news,   "News couldn't load. Hit Refresh.");
  renderFeed("reddit-feed",  reddit, "Reddit couldn't load. Hit Refresh.");
  renderFeed("social-feed",  social, "Social feed couldn't load. Hit Refresh.");
  renderWeekly([...news, ...reddit, ...social]);
  setLastUpdated(nowStr());

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
}

// ─── RSS (news + reddit both use this) ───────────────────────────────────────

async function fetchAllRSS(feeds) {
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
    return data.items.slice(0, 10).map(item => ({
      source: feed.name,
      title: stripHtml(item.title || "").trim(),
      link: item.link || item.url || "#",
      pubDate: item.pubDate || new Date().toISOString(),
      type: feed.name.startsWith("r/") ? "reddit" : "news",
    })).filter(i => i.title.length > 5);
  } catch (e) {
    return [];
  }
}

// ─── BLUESKY ─────────────────────────────────────────────────────────────────
// Bluesky has a completely open public API — no auth, no proxy needed

async function fetchBluesky() {
  let items = [];

  // Search for F1 gossip posts
  for (const term of BSKY_SEARCH_TERMS.slice(0, 2)) {
    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=10&sort=latest`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data.posts || [];
      const mapped = posts
        .filter(p => p.record?.text && p.record.text.length > 20)
        .map(p => ({
          source: p.author?.displayName || p.author?.handle || "Bluesky",
          handle: p.author?.handle || "",
          title: p.record.text.slice(0, 220),
          link: `https://bsky.app/profile/${p.author?.handle}/post/${p.uri?.split("/").pop()}`,
          pubDate: p.record?.createdAt || new Date().toISOString(),
          likes: p.likeCount || 0,
          type: "social",
        }));
      items = items.concat(mapped);
    } catch (e) { /* skip */ }
  }

  // Deduplicate by link
  const seen = new Set();
  items = items.filter(i => {
    if (seen.has(i.link)) return false;
    seen.add(i.link);
    return true;
  });

  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return items.slice(0, 15);
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
    el.innerHTML = errorState("Load the TODAY tab first, then come here.");
    return;
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = items
    .filter(i => new Date(i.pubDate).getTime() > cutoff)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  if (!week.length) {
    el.innerHTML = errorState("Nothing from the last 7 days. Try Refresh.");
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
        ${dayItems.slice(0, 6).map(item => cardHtml(item)).join("")}
      </div>
    </div>
  `).join("");
}

// ─── CARD HTML ────────────────────────────────────────────────────────────────

function cardHtml(item) {
  const cls = item.type === "reddit" ? "reddit"
            : item.type === "social" ? "social-card"
            : "";
  const prefix = item.type === "social" ? "🦋 " : "";
  return `
    <a class="news-card ${cls}" href="${item.link}" target="_blank" rel="noopener noreferrer">
      <div class="card-source">${prefix}${escHtml(item.source)}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta">
        ${item.score  != null ? `<span class="card-score">▲ ${fmtNum(item.score)}</span>` : ""}
        ${item.comments != null ? `<span>💬 ${fmtNum(item.comments)}</span>` : ""}
        ${item.likes  != null && item.type === "social" ? `<span>♥ ${fmtNum(item.likes)}</span>` : ""}
        <span>${timeAgo(item.pubDate)}</span>
      </div>
    </a>
  `;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function showSkeletons() {
  const skel = '<div class="skeleton-card"></div>'.repeat(4);
  ["news-feed", "reddit-feed", "social-feed", "weekly-feed"].forEach(id => {
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
