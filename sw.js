/* =========================================================
 * つづく — Service Worker
 *  - オフライン対応（stale-while-revalidate）
 *  - リマインダー通知（アプリからの合図 / Periodic Background Sync）
 *  - 通知のボタンから「やった！」「2分だけ」を記録
 * ========================================================= */
const VERSION = 'tsuzuku-shell-v7';
const DATA = 'tsuzuku-data';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];
const scoped = (p) => new URL(p, self.registration.scope).href;
const CFG = () => scoped('./__tsuzuku/reminders.json');
const SENT = () => scoped('./__tsuzuku/sent.json');
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ---------- lifecycle ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* ---------- offline ---------- */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? scoped('./index.html') : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req)
      .then((res) => { if (res.ok && res.type === 'basic') cache.put(key, res.clone()); return res; })
      .catch(() => hit || Response.error());
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});

/* ---------- reminders ---------- */
async function readJSON(url) {
  try { const r = await (await caches.open(DATA)).match(url); return r ? await r.json() : null; } catch (e) { return null; }
}
async function writeJSON(url, obj) {
  const c = await caches.open(DATA);
  await c.put(url, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }));
}

async function checkReminders() {
  const cfg = await readJSON(CFG());
  if (!cfg || !cfg.enabled || self.Notification?.permission !== 'granted') return;
  const now = new Date();
  const today = dkey(now);
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fresh = cfg.date === today; // その日アプリを開いていれば完了状況がわかる
  let sent = await readJSON(SENT());
  if (!sent || sent.date !== today) sent = { date: today, tags: [] };

  const jobs = [];
  for (const h of cfg.habits || []) {
    if (!h.remindAt || h.remindAt > hm) continue;
    if (!h.days.includes(now.getDay()) || today < h.createdAt) continue;
    if (fresh && h.done) continue;
    const tag = `${today}:${h.id}`;
    if (sent.tags.includes(tag)) continue;
    sent.tags.push(tag);
    const lines = [];
    if (h.cue) lines.push(`📍 ${h.cue} → ${h.name}`);
    lines.push(`⚡ 最低ライン「${h.tiny || '2分だけ'}」でもクリア`);
    if (fresh && h.risk) lines.push(`🔥 ${h.streak}日連続がかかっている。今日もつなげ`);
    jobs.push(self.registration.showNotification(`${h.emoji} ${h.name}の時間だ`, {
      body: lines.join('\n'),
      tag,
      icon: scoped('./icons/icon-192.png'),
      badge: scoped('./icons/badge-96.png'),
      data: { habitId: h.id },
      actions: [{ action: 'full', title: '✔ クリア' }, { action: 'tiny', title: '⚡ 最低ライン' }],
    }));
  }

  if (cfg.journalAt && cfg.journalAt <= hm && !(fresh && cfg.journalDone)) {
    const tag = `${today}:journal`;
    if (!sent.tags.includes(tag)) {
      sent.tags.push(tag);
      const body = fresh
        ? `今日のクリア：${cfg.winsToday}。${cfg.undone ? `残り${cfg.undone}つ。最低ラインだけでも取りにいけ。` : 'パーフェクト。いい1日だった。'}\n日誌を書くと +10 EXP。`
        : '今日はどんな1日でしたか？日誌を書くと +10 EXP。';
      jobs.push(self.registration.showNotification('📊 今日の戦績', {
        body, tag, icon: scoped('./icons/icon-192.png'), badge: scoped('./icons/badge-96.png'), data: { tab: 'reflect' },
      }));
    }
  }

  if (jobs.length) { await writeJSON(SENT(), sent); await Promise.all(jobs); }
}

// 同時に複数回チェックが走って二重通知しないよう直列化
let chain = Promise.resolve();
const queueCheck = () => (chain = chain.then(checkReminders).catch(() => {}));

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'check') e.waitUntil(queueCheck());
});
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'tsuzuku-reminder') e.waitUntil(queueCheck());
});

/* ---------- notification click ---------- */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const params = new URLSearchParams();
  if (d.habitId && (e.action === 'full' || e.action === 'tiny')) {
    params.set('act', 'habit'); params.set('id', d.habitId); params.set('type', e.action);
  } else if (d.tab) {
    params.set('tab', d.tab);
  }
  const qs = params.toString();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: 'open', params: qs });
      return wins[0].focus();
    }
    return self.clients.openWindow(scoped('./' + (qs ? `?${qs}` : '')));
  })());
});
