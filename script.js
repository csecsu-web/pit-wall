// ─── CONFIG ──────────────────────────────────────────────────────────────────

const REDDIT_SUBS = [
  { name: "r/formula1",    url: "https://www.reddit.com/r/formula1/hot.json?limit=15&raw_json=1" },
  { name: "r/formuladank", url: "https://www.reddit.com/r/formuladank/hot.json?limit=8&raw_json=1" },
];

const RSS_FEEDS = [
  { name: "Autosport",      url: "https://www.autosport.com/rss/f1/news/" },
  { name: "RaceFans",       url: "https://www.racefans.net/feed/" },
  { name: "The Race",       url: "https://the-race.com/feed/" },
  { name: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
];

// Gossip & insider Twitter accounts via Nitter RSS
// Nitter instances rotate — we try multiple
const NITTER_INSTANCES = [
  "https://nitter.poast.org",
  "https://nitter.privacydev.net",
  "https://nitter.cz",
];

const TWITTER_ACCOUNTS = [
  { handle: "f1gossip",        label: "F1 Gossip" },
  { handle: "F1transfers",     label: "F1 Transfers" },
  { handle: "pitlaneinsider_", label: "Pitlane Insider" },
  { handle: "MissedApex_F1",   label: "Missed Apex" },
  { handle: "juniorformula",   label: "Junior Formula" },
  { handle: "RacingLines_F1",  label: "Racing Lines" },
  { handle: "LandoNorris",     label: "Lando Norris" },
  { handle: "Charles_Leclerc", label: "Charles Leclerc" },
];

const RSS_PROXIES = [
  url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadAll();
  document.getElementById("refresh-btn").addEventListener("click", () => loadAll());
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

  const [newsRes, redditRes, twitterRes] = await Promise.allSettled([
    fetchAllRSS(),
    fetchReddit(),
    fetchTwitter(),
  ]);

  const news    = newsRes.status    === "fulfilled" ? newsRes.value    : [];
  const reddit  = redditRes.status  === "fulfilled" ? redditRes.value  : [];
  const twitter = twitterRes.status === "fulfilled" ? twitterRes.value : [];

  renderNews(news);
  renderReddit(reddit);
  renderTwitter(twitter);
  renderWeekly([...news, ...reddit, ...twitter]);
  setLastUpdated(nowStr());

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
}

// ─── RSS NEWS ─────────────────────────────────────────────────────────────────

async function fetchAllRSS() {
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchOneFeed));
  let items = [];
  results.forEach(r => { if (r.status === "fulfilled") items = items.concat(r.value); });
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
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

      if (data.items && Array.isArray(data.items)) {
        return data.items.slice(0, 8).map(item => ({
          source: feed.name,
          title: (item.title || "").trim(),
          link: item.link || "#",
          pubDate: item.pubDate || new Date().toISOString(),
          type: "news",
        })).filter(i => i.title);
      }
    } catch (e) { /* try next */ }
  }
  return [];
}

// ─── REDDIT ──────────────────────────────────────────────────────────────────
// Reddit's .json endpoint works directly from browser — no proxy needed

async function fetchReddit() {
  let items = [];
  for (const sub of REDDIT_SUBS) {
    try {
      const res = await fetch(sub.url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data?.data?.children || [];
      const mapped = posts
        .filter(p => !p.data.stickied)
        .slice(0, 10)
        .map(p => ({
          source: sub.name,
          title: p.data.title,
          link: "https://reddit.com" + p.data.permalink,
          pubDate: new Date(p.data.created_utc * 1000).toISOString(),
          score: p.data.score,
          comments: p.data.num_comments,
          type: "reddit",
        }));
      items = items.concat(mapped);
    } catch (e) { /* skip */ }
  }
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return items;
}

// ─── TWITTER via NITTER RSS ───────────────────────────────────────────────────

async function fetchTwitter() {
  // Pick a random Nitter instance to spread load
  const instance = NITTER_INSTANCES[Math.floor(Math.random() * NITTER_INSTANCES.length)];
  let items = [];

  // Fetch a few accounts in parallel (don't slam the server with all of them)
  const sample = TWITTER_ACCOUNTS.sort(() => 0.5 - Math.random()).slice(0, 5);

  const results = await Promise.allSettled(
    sample.map(acc => fetchNitterAccount(instance, acc))
  );

  results.forEach(r => { if (r.status === "fulfilled") items = items.concat(r.value); });
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return items.slice(0, 20);
}

async function fetchNitterAccount(instance, acc) {
  const rssUrl = `${instance}/${acc.handle}/rss`;
  for (const proxyFn of RSS_PROXIES) {
    try {
      const res = await fetch(proxyFn(rssUrl), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.items || !Array.isArray(data.items)) continue;
      return data.items.slice(0, 4).map(item => ({
        source: acc.label,
        handle: acc.handle,
        title: stripHtml(item.description || item.title || "").slice(0, 200),
        link: `https://twitter.com/${acc.handle}`,
        pubDate: item.pubDate || new Date().toISOString(),
        type: "twitter",
      })).filter(i => i.title.length > 10);
    } catch (e) { /* try next proxy */ }
  }
  return [];
}

// ─── RENDER: NEWS ─────────────────────────────────────────────────────────────

function renderNews(items) {
  const el = document.getElementById("news-feed");
  if (!items.length) {
    el.innerHTML = errorState("News couldn't load.", "Hit Refresh or try again soon.");
    return;
  }
  el.innerHTML = items.map(item => cardHtml(item)).join("");
}

// ─── RENDER: REDDIT ───────────────────────────────────────────────────────────

function renderReddit(items) {
  const el = document.getElementById("reddit-feed");
  if (!items.length) {
    el.innerHTML = errorState("Reddit couldn't load.", "Hit Refresh.");
    return;
  }
  el.innerHTML = items.map(item => cardHtml(item)).join("");
}

// ─── RENDER: TWITTER ──────────────────────────────────────────────────────────

function renderTwitter(items) {
  const el = document.getElementById("twitter-feed");
  if (!items.length) {
    el.innerHTML = errorState("Twitter gossip couldn't load.", "Nitter instances go up and down — try Refresh.");
    return;
  }
  el.innerHTML = items.map(item => cardHtml(item)).join("");
}

// ─── RENDER: WEEKLY ───────────────────────────────────────────────────────────

function renderWeekly(items) {
  const el = document.getElementById("weekly-feed");
  if (!items.length) {
    el.innerHTML = errorState("Nothing loaded yet.", "Go to TODAY tab and hit Refresh first.");
    return;
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = items
    .filter(i => new Date(i.pubDate).getTime() > cutoff)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const byDay = {};
  week.forEach(item => {
    const d = dayLabel(item.pubDate);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(item);
  });

  if (!Object.keys(byDay).length) {
    el.innerHTML = errorState("Nothing from the last 7 days.", "Try refreshing.");
    return;
  }

  el.innerHTML = Object.entries(byDay).map(([day, dayItems]) => `
    <div class="week-group">
      <div class="week-day-label">${day}</div>
      <div class="card-list">
        ${dayItems.slice(0, 6).map(item => cardHtml(item)).join("")}
      </div>
    </div>
  `).join("");
}

// ─── SHARED CARD HTML ─────────────────────────────────────────────────────────

function cardHtml(item) {
  const cls = item.type === "reddit" ? "reddit"
            : item.type === "twitter" ? "twitter-card"
            : "";
  const icon = item.type === "twitter" ? "𝕏 " : "";
  return `
    <a class="news-card ${cls}" href="${item.link}" target="_blank" rel="noopener noreferrer">
      <div class="card-source">${icon}${escHtml(item.source)}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta">
        ${item.score != null ? `<span class="card-score">▲ ${fmtNum(item.score)}</span>` : ""}
        ${item.comments != null ? `<span>💬 ${fmtNum(item.comments)}</span>` : ""}
        <span>${timeAgo(item.pubDate)}</span>
      </div>
    </a>
  `;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function showSkeletons() {
  const skel = '<div class="skeleton-card"></div>'.repeat(4);
  ["news-feed", "reddit-feed", "twitter-feed", "weekly-feed"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = skel;
  });
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
  if (n == null) return "0";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
