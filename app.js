'use strict';
/* =========================================================
 * つづく — 心理学ベースの習慣化 & TODO アプリ（シンプル版）
 *   育てるもの：🌱植物（通算の小さな勝利）と 🔥連続日数 の2つだけ
 *   データはブラウザの localStorage に保存されます。
 * ========================================================= */

const STORE = 'tsuzuku-v1';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const AUTOMATIC = 66;      // Lally et al. (2010) 習慣が自動化するまでの平均日数
const MAX_TICKETS = 3;     // お休みチケットの上限
const STICKER_RATE = 0.25; // 変動報酬：勝利ごとにシールが出る確率

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const todayKey = () => dkey();

/* ---------- state ---------- */
function defaultState() {
  return {
    version: 2,
    createdAt: dkey(),
    lastOpen: null,
    habits: [],     // { id, emoji, name, cue, tiny, identity, reward, remindAt, days, createdAt, archived }
    logs: {},       // { 'YYYY-MM-DD': { habitId: { type } } }
    todos: [],      // { id, text, frog, done, doneAt, createdAt }
    journal: {},    // { 'YYYY-MM-DD': { mood, text } }
    awarded: {},    // 1回きりのごほうび済みフラグ
    tickets: 0,     // お休みチケット
    frozen: {},     // チケットで守った日 { 'YYYY-MM-DD': true }
    stickers: {},   // { '🦄': 2 }
    lastProcessed: null,
    ticketNote: null,
    settings: { notify: false, journalAt: '21:00', skipOnb: false },
  };
}
function hydrate(obj) {
  const st = Object.assign(defaultState(), obj);
  st.settings = Object.assign(defaultState().settings, obj.settings || {});
  return st;
}
function load() {
  try { const raw = localStorage.getItem(STORE); if (raw) return hydrate(JSON.parse(raw)); } catch (e) { /* noop */ }
  return null;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* noop */ }
  syncReminders();
}

let S = load() || defaultState();
let tab = 'today';
let onb = null;        // 最初の30秒ガイドの状態
let logMonth = 0;      // スタンプカードの表示月（0=今月）
let draftMood = null;

/* ---------- content ---------- */
const TEMPLATES = [
  { emoji: '📚', name: '本を読む', cue: '寝る前', tiny: '1ページだけ読む', identity: '読書家' },
  { emoji: '🏃', name: '運動する', cue: '帰宅したら', tiny: '靴をはいて外に出る', identity: '体を大切にする人' },
  { emoji: '💧', name: '水を飲む', cue: '朝起きたら', tiny: 'コップ1杯だけ', identity: '健康的な人' },
  { emoji: '🧘', name: 'ストレッチ', cue: 'お風呂のあと', tiny: '1ポーズだけ', identity: '体を大切にする人' },
  { emoji: '✍️', name: '日記を書く', cue: '寝る前', tiny: '1行だけ書く', identity: '自分を知る人' },
  { emoji: '🗣️', name: '英語の勉強', cue: '通勤・通学中', tiny: '単語を1つだけ', identity: '英語を話せる人' },
  { emoji: '🧹', name: '片づけ', cue: '朝ごはんのあと', tiny: '1つだけ元に戻す', identity: '整った暮らしの人' },
  { emoji: '😴', name: '早く寝る', cue: '23時になったら', tiny: 'スマホを置く', identity: '睡眠を大事にする人' },
];
const CUES = ['朝起きたら', '朝ごはんのあと', '歯みがきのあと', '通勤・通学中', '昼休み', '帰宅したら', 'お風呂のあと', '寝る前'];

const STAGES = [
  { at: 0, icon: '🌰', name: 'たね' }, { at: 3, icon: '🌱', name: '芽' }, { at: 15, icon: '🌿', name: '若葉' },
  { at: 40, icon: '🪴', name: '苗木' }, { at: 90, icon: '🌳', name: '大きな木' }, { at: 180, icon: '🌸', name: '花ざかり' },
  { at: 360, icon: '🍎', name: '実り' }, { at: 700, icon: '🏞️', name: '森' },
];
const stageOf = (wins) => {
  let i = 0;
  while (i + 1 < STAGES.length && wins >= STAGES[i + 1].at) i++;
  return { ...STAGES[i], next: STAGES[i + 1] || null, idx: i };
};

const STICKERS = [
  ['🐣', 'ひよこ', 1], ['🍀', 'クローバー', 1], ['🍙', 'おにぎり', 1], ['🌼', 'おはな', 1], ['🐌', 'かたつむり', 1],
  ['🍓', 'いちご', 1], ['🎈', 'ふうせん', 1], ['🐟', 'さかな', 1], ['🌙', 'おつきさま', 1], ['🧸', 'くま', 1],
  ['🦊', 'きつね', 2], ['🐼', 'パンダ', 2], ['🌈', 'にじ', 2], ['🍰', 'ケーキ', 2], ['🐬', 'イルカ', 2], ['🦋', 'ちょうちょ', 2],
  ['🦄', 'ユニコーン', 3], ['🐉', 'ドラゴン', 3], ['👑', 'おうかん', 3], ['💎', 'ダイヤ', 3],
];
const RARITY = { 1: '', 2: '（レア✨）', 3: '（超レア🌟）' };

const PRAISE = ['ナイス！', 'その調子！', 'えらい！', 'いいね！', '今日もできた！', '一歩前進！', 'さすが！', '積み重ねてる！'];

/* ---------- core logic ---------- */
const activeHabits = () => S.habits.filter((h) => !h.archived);
const isSched = (h, d) => h.days.includes(d.getDay()) && dkey(d) >= h.createdAt;
const logOf = (h, k) => (S.logs[k] && S.logs[k][h.id]) || null;
const totalOf = (h) => Object.values(S.logs).filter((l) => l[h.id]).length;

function winsOn(k) {
  const habits = S.logs[k] ? Object.keys(S.logs[k]).length : 0;
  return habits + S.todos.filter((t) => t.done && t.doneAt === k).length;
}
function totalWins() {
  let n = 0;
  for (const k in S.logs) n += Object.keys(S.logs[k]).length;
  return n + S.todos.filter((t) => t.done).length;
}
function progressOn(d) {
  const k = dkey(d);
  const hs = activeHabits().filter((h) => isSched(h, d));
  return { sched: hs.length, done: hs.filter((h) => logOf(h, k)).length };
}
const todayProgress = () => progressOn(new Date());
const perfectOn = (k) => { const p = progressOn(parseKey(k)); return p.sched > 0 && p.done === p.sched; };

// 🔥 連続日数：何かひとつでも「やった」日が続いている日数（チケットで守った日はつながる）
function dayStreak() {
  let s = winsOn(todayKey()) > 0 ? 1 : 0;
  let d = addDays(new Date(), -1);
  for (let i = 0; i < 3650; i++) {
    const k = dkey(d);
    if (k < S.createdAt) break;
    if (winsOn(k) > 0) s++;
    else if (!S.frozen[k]) break;
    d = addDays(d, -1);
  }
  return s;
}
function aliveBefore(k) {
  let d = addDays(parseKey(k), -1);
  for (let i = 0; i < 3650; i++) {
    const x = dkey(d);
    if (x < S.createdAt) return false;
    if (winsOn(x) > 0) return true;
    if (!S.frozen[x]) return false;
    d = addDays(d, -1);
  }
  return false;
}
// 🎫 休んだ日があれば、チケットで足りる場合だけ自動で使って連続記録を守る
function processTickets() {
  const yest = dkey(addDays(new Date(), -1));
  if (!S.lastProcessed) { S.lastProcessed = yest; return; }
  let d = addDays(parseKey(S.lastProcessed), 1), run = [], used = 0;
  const flush = () => {
    if (run.length && run.length <= S.tickets && aliveBefore(run[0])) {
      run.forEach((x) => { S.frozen[x] = true; });
      S.tickets -= run.length; used += run.length;
    }
    run = [];
  };
  while (dkey(d) <= yest) {
    const k = dkey(d);
    if (k >= S.createdAt && winsOn(k) === 0 && !S.frozen[k]) run.push(k); else flush();
    d = addDays(d, 1);
  }
  flush();
  S.lastProcessed = yest;
  if (used) S.ticketNote = { date: todayKey(), n: used, streak: dayStreak() };
}

/* ---------- rewards ---------- */
function giveSticker(force) {
  if (!force && Math.random() > STICKER_RATE) return;
  const r = Math.random();
  const rar = r < 0.06 ? 3 : r < 0.32 ? 2 : 1;
  const [e, name] = pick(STICKERS.filter((s) => s[2] === rar));
  const isNew = !S.stickers[e];
  S.stickers[e] = (S.stickers[e] || 0) + 1;
  toast(`🎁 シールをゲット！ <b>${e} ${name}</b>${RARITY[rar]}${isNew ? ' <b>NEW</b>' : ''}`);
  if (rar >= 2) confetti(70);
}

const HABIT_MILESTONES = [
  [1, '🌟', '最初の一歩！', 'はじめるのが一番むずかしい。もうそれをクリアしました。'],
  [7, '🔥', '7回達成！', 'リズムができはじめています。'],
  [21, '🥉', '21回達成！', '「いつものこと」になってきました。'],
  [30, '🥈', '30回達成！', 'もう立派な習慣です。'],
  [AUTOMATIC, '🧠', `${AUTOMATIC}回達成！`, '研究では、平均66回くらいで行動は「自動」になると言われています。'],
  [100, '🥇', '100回達成！', 'あなたは本物の「続く人」です。'],
  [200, '💎', '200回達成！', 'ここまで来る人はほとんどいません。'],
  [365, '👑', '365回達成！', '1年分の積み重ね。人生が変わるレベルです。'],
];
function checkHabitMilestone(h) {
  const n = totalOf(h);
  for (const [at, icon, title, text] of HABIT_MILESTONES) {
    const key = `h:${h.id}:${at}`;
    if (n >= at && !S.awarded[key]) {
      S.awarded[key] = true;
      celebrate(icon, `${esc(h.emoji)} ${esc(h.name)}：${title}`,
        `${text}${h.identity ? `<br><br>「${esc(h.identity)}」への${n}票目が入りました。` : ''}`);
      confetti(120);
      break;
    }
  }
}

// 勝利のあとの共通処理：植物の成長・コンプリート・チケット・シール
function afterWin(prevTotal) {
  const k = todayKey();
  const a = stageOf(prevTotal), b = stageOf(totalWins());
  if (b.idx > a.idx) celebrate(b.icon, `「${b.name}」に育ちました！`, 'あなたのコツコツが、目に見える形になってきました。');

  const p = todayProgress();
  let perfect = false;
  if (p.sched > 0 && p.done === p.sched && !S.awarded[`perfect:${k}`]) {
    S.awarded[`perfect:${k}`] = true; perfect = true;
    celebrate('💮', '今日コンプリート！', 'ぜんぶの習慣をやりきりました。<br>今日のスタンプは「花まる」です。');
    confetti(180);
  }

  const st = dayStreak();
  if (st > 0 && st % 7 === 0 && !S.awarded[`ticket:${k}`]) {
    S.awarded[`ticket:${k}`] = true;
    if (S.tickets < MAX_TICKETS) {
      S.tickets++;
      celebrate('🎫', `${st}日連続！お休みチケットをゲット`,
        'うっかり休んでしまった日に自動で使われて、🔥連続記録を守ってくれます。<br>（7日続けるごとに1枚・最大3枚）');
    }
  }
  giveSticker(perfect);
}

/* ---------- actions ---------- */
function toggleHabit(id, type = 'full') {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  const k = todayKey();
  S.logs[k] = S.logs[k] || {};
  if (S.logs[k][id]) {
    delete S.logs[k][id];
    if (!Object.keys(S.logs[k]).length) delete S.logs[k];
    toast('取り消しました');
    save(); render();
    return;
  }
  const before = totalWins();
  S.logs[k][id] = { type };
  const p = todayProgress(), rem = p.sched - p.done;
  toast(`${esc(h.emoji)} ${pick(PRAISE)}${rem === 1 ? '　<b>あと1つでコンプリート！</b>' : ''}`);
  confetti(40);
  checkHabitMilestone(h);
  afterWin(before);
  if (h.reward) toast(`🎁 ごほうびタイム：${esc(h.reward)}`);
  save(); render(); popPlant();
}

function addTodo(text) {
  text = text.trim();
  if (!text) return;
  S.todos.push({ id: uid(), text, frog: false, done: false, doneAt: null, createdAt: todayKey() });
  save(); render();
  const input = $('#todoInput'); if (input) input.focus();
}
function toggleTodo(id) {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  if (t.done) { t.done = false; t.doneAt = null; save(); render(); return; }
  const before = totalWins();
  t.done = true; t.doneAt = todayKey();
  toast(t.frog ? '⭐ いちばん大事なことを片づけた！' : `✅ ${pick(PRAISE)}`);
  confetti(t.frog ? 80 : 30);
  afterWin(before);
  save(); render(); popPlant();
}
function starTodo(id) {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const on = !t.frog;
  S.todos.forEach((x) => { if (!x.done) x.frog = false; });
  t.frog = on;
  save(); render();
}
function deleteTodo(id) { S.todos = S.todos.filter((x) => x.id !== id); save(); render(); }

/* ---------- render: top ---------- */
function renderTop() {
  $('#ticketBadge').textContent = `🎫 ${S.tickets}`;
}

/* ---------- render: onboarding（最初の30秒ガイド） ---------- */
function renderOnboarding() {
  const dots = (n) => `<div class="dots">${[1, 2, 3].map((i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  const first = !activeHabits().length && !totalWins();
  if (!onb || onb.step === 1) {
    return `<section class="card onb">
      ${dots(1)}
      ${first ? `<div class="seed">🌰</div><h2>このタネを育てよう</h2>
        <p class="muted">毎日の小さな「やった！」で、タネが芽を出し、木に育ちます。</p>` : '<h2>新しい習慣</h2>'}
      <h2 style="font-size:17px">続けたいことを、まず1つ選ぼう</h2>
      <div class="templates">${TEMPLATES.map((t, i) => `<button data-act="onb-tpl" data-i="${i}"><span>${t.emoji}</span>${t.name}</button>`).join('')}</div>
      <form id="onbCustom" class="todo-add"><input name="t" placeholder="自分で書く（例：ギターを弾く）" autocomplete="off"><button class="primary">次へ</button></form>
      ${first ? '<button class="linkbtn" data-act="onb-skip">習慣はあとで（やることリストだけ使う）</button>'
        : '<button class="linkbtn" data-act="onb-cancel">やめる</button>'}
    </section>`;
  }
  if (onb.step === 2) {
    const chips = [...new Set([onb.cue, ...CUES].filter(Boolean))];
    return `<section class="card onb">
      ${dots(2)}
      <div class="seed" style="font-size:44px">${esc(onb.emoji)}</div>
      <h2>「${esc(onb.name)}」は、いつやる？</h2>
      <p class="muted small">毎日していることの「あと」にくっつけると、忘れにくくなります。</p>
      <div class="chips">${chips.map((c) => `<button data-act="onb-cue" data-v="${esc(c)}" class="${c === onb.cue ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <form id="onbCueForm" class="todo-add"><input name="t" placeholder="自分で書く（例：コーヒーを淹れたら）" autocomplete="off"><button class="primary">決定</button></form>
      <button class="linkbtn" data-act="onb-back">もどる</button>
    </section>`;
  }
  const h = S.habits.find((x) => x.id === onb.habitId);
  return `<section class="card onb">
    ${dots(3)}
    <h2>できた！🎉 さっそく今日の分をやってみよう</h2>
    <div class="try">
      <div class="e">${esc(h.emoji)}</div>
      <b>${esc(h.name)}</b>
      <div class="muted" style="margin-top:6px">まずは「${esc(h.tiny || '2分だけ')}」でOK。<br>小さくても、やれば1回です。</div>
    </div>
    <button class="primary big" data-act="onb-done">やった！</button>
    <div><button class="linkbtn" data-act="onb-later">あとでやる</button></div>
  </section>`;
}

function finishOnbHabit(cue) {
  const h = {
    id: uid(), createdAt: todayKey(), archived: false, days: [0, 1, 2, 3, 4, 5, 6], remindAt: '', reward: '',
    emoji: onb.emoji, name: onb.name, cue, tiny: onb.tiny, identity: onb.identity,
  };
  S.habits.push(h);
  onb = { step: 3, habitId: h.id };
  save(); render();
}

/* ---------- render: today ---------- */
function banners() {
  const t = todayKey(), d = new Date();
  let out = '';
  if (S.ticketNote && S.ticketNote.date === t) {
    out += `<div class="banner warn">🎫 お休みチケットを${S.ticketNote.n}枚使って、🔥連続記録を守りました！ 今日もひとつやって、つなげよう。</div>`;
  }
  if (S.welcomeBack === t) out += '<div class="banner">🌤️ <b>おかえりなさい！</b> 戻ってきたことが一番の勝利です。今日はひとつだけ、小さくやってみよう。</div>';
  else if (d.getDate() === 1) out += '<div class="banner">🗓️ <b>新しい月のはじまり！</b> スタンプカードも新しいページです。</div>';
  else if (d.getDay() === 1 && weekStats(-1).days > 0) out += '<div class="banner">🌅 <b>新しい週のスタート！</b> <button class="linkbtn" data-act="gotolog" style="padding:0">「先週のあなた」を見る →</button></div>';
  return out;
}

function habitRow(h) {
  const k = todayKey();
  const done = !!logOf(h, k);
  const total = totalOf(h);
  const sub = done ? `✓ ${total}回目！`
    : [h.cue ? `🕖 ${esc(h.cue)}` : '', h.tiny ? `しんどい日は「${esc(h.tiny)}」でOK` : ''].filter(Boolean).join('　');
  return `<div class="habit ${done ? 'done' : ''}">
    <button class="tap" data-act="habit" data-id="${h.id}" aria-label="${done ? '取り消す' : 'やった'}">${done ? '✓' : ''}</button>
    <div class="body" data-act="edithabit" data-id="${h.id}">
      <div class="name">${esc(h.emoji)} ${esc(h.name)}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
  </div>`;
}

function todoRow(t) {
  const age = !t.done && t.createdAt < todayKey() ? ` <span class="small muted">${diffDays(t.createdAt, todayKey())}日前〜</span>` : '';
  return `<div class="todo ${t.done ? 'done' : ''} ${t.frog && !t.done ? 'star-on' : ''}">
    <button class="check" data-act="todo" data-id="${t.id}" aria-label="完了">${t.done ? '✓' : ''}</button>
    <span class="txt">${esc(t.text)}${age}</span>
    ${t.done ? '' : `<button class="star ${t.frog ? 'on' : ''}" data-act="star" data-id="${t.id}" title="いちばん大事にする">${t.frog ? '★' : '☆'}</button>`}
    <button class="del" data-act="deltodo" data-id="${t.id}" aria-label="削除">✕</button>
  </div>`;
}

function renderToday() {
  if (onb || (!activeHabits().length && !S.settings.skipOnb)) return renderOnboarding();
  const k = todayKey(), d = new Date();
  const p = todayProgress(), rem = p.sched - p.done;
  const tw = totalWins(), st = stageOf(tw), streak = dayStreak(), winsT = winsOn(k);
  const thirsty = p.sched > 0 && p.done === 0 && winsT === 0;
  const full = p.sched > 0 ? rem === 0 : winsT > 0;
  const pct = p.sched > 0 ? p.done / p.sched : (winsT > 0 ? 1 : 0);
  const bubble = p.sched === 0 ? (winsT > 0 ? 'ありがとう！元気いっぱい🌟' : '今日はのんびりの日🍃')
    : p.done === 0 ? (winsT > 0 ? 'ありがとう！習慣もやってみる？' : 'のどかわいたな…💧')
      : rem === 0 ? 'おなかいっぱい！ありがとう🌟'
        : `あと${rem}つで満タン！`;
  const C = 2 * Math.PI * 52;
  const nextTxt = st.next ? `次の「${st.next.name}」まで あと${st.next.at - tw}回` : '最後まで育ちきりました！';
  const stageProg = st.next ? ((tw - st.at) / (st.next.at - st.at)) * 100 : 100;

  const todayHabits = activeHabits().filter((h) => isSched(h, d));
  const rest = activeHabits().filter((h) => !isSched(h, d));
  const open = S.todos.filter((t) => !t.done).sort((a, b) => (b.frog - a.frog) || (a.createdAt < b.createdAt ? -1 : 1));
  const doneT = S.todos.filter((t) => t.done && t.doneAt === k);

  return `
  ${banners()}
  <section class="card hero">
    <div class="ring-wrap ${thirsty ? 'thirsty' : ''} ${full ? 'full' : ''}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#34b27b"/></linearGradient></defs>
        <circle class="ring-bg" cx="60" cy="60" r="52"/>
        <circle class="ring-fg" cx="60" cy="60" r="52" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
      </svg>
      <div class="plant" id="plant" title="${st.name}">${st.icon}</div>
    </div>
    <div class="hero-info">
      <div class="bubble ${thirsty ? 'thirsty-b' : ''}">${bubble}</div>
      <div class="streak">🔥 <b>${streak}</b> 日連続</div>
      <div class="small muted">${st.icon} ${st.name}・${nextTxt}</div>
      <div class="bar" style="margin-top:4px"><i style="width:${stageProg}%"></i></div>
    </div>
  </section>

  <section class="card">
    <h2>今日の習慣 <span class="sub">${p.done} / ${p.sched}</span></h2>
    ${todayHabits.length ? todayHabits.map(habitRow).join('') : '<div class="empty small">今日の習慣はありません</div>'}
    ${rest.length ? `<div class="small muted" style="margin-top:6px">今日はお休み：${rest.map((h) => esc(h.emoji + h.name)).join('、')}</div>` : ''}
    <button class="addbtn" data-act="addhabit">＋ 習慣を追加</button>
    ${todayHabits.length ? '<div class="small muted" style="text-align:center;margin-top:6px">○をタップで「やった！」・名前をタップで編集</div>' : ''}
  </section>

  <section class="card">
    <h2>やること <span class="sub">${doneT.length ? `今日 ${doneT.length}件 完了` : ''}</span></h2>
    <form class="todo-add" id="todoForm">
      <input id="todoInput" placeholder="やることを書く…" autocomplete="off">
      <button class="primary" type="submit">追加</button>
    </form>
    ${open.length >= 2 && !open.some((t) => t.frog) ? '<div class="small muted" style="margin-bottom:4px">☆を押すと「いちばん大事」が一番上に来ます</div>' : ''}
    ${open.map(todoRow).join('')}
    ${doneT.map(todoRow).join('')}
    ${!open.length && !doneT.length ? '<div class="empty small">書き出すだけで、頭がすっきりします</div>' : ''}
  </section>`;
}

/* ---------- render: log（きろく） ---------- */
function weekStats(offset) {
  const today = new Date();
  const mon = addDays(today, -((today.getDay() + 6) % 7) + 7 * offset);
  let days = 0, wins = 0, perfect = 0;
  for (let i = 0; i < 7; i++) {
    const k = dkey(addDays(mon, i));
    if (k > todayKey()) break;
    const w = winsOn(k);
    if (w > 0) days++;
    wins += w;
    if (perfectOn(k)) perfect++;
  }
  return { days, wins, perfect };
}

function weeklyCard() {
  const lw = weekStats(-1), pw = weekStats(-2);
  if (!lw.days && !pw.days) return '';
  const diff = lw.days - pw.days;
  const msg = !pw.days ? 'はじめての1週間、おつかれさま！'
    : diff > 0 ? `先々週より${diff}日多くスタンプを押せました！📈`
      : diff === 0 ? 'ペースをキープ！安定してきました。'
        : '先週はひと休み。今週は「1日だけ多く」を目指そう。';
  const isMon = new Date().getDay() === 1;
  return `<section class="card">
    <h2>📮 先週のあなた ${isMon ? '<span class="new">NEW</span>' : ''}</h2>
    <div class="week3">
      <div><b>${lw.days}</b><small>スタンプの日</small></div>
      <div><b>${lw.wins}</b><small>やった回数</small></div>
      <div><b>${lw.perfect}</b><small>💮 花まるの日</small></div>
    </div>
    <div>${msg}</div>
    <div class="small muted" style="margin-top:4px">🎯 今週の目標：スタンプ ${Math.min(7, lw.days + 1)}日（比べる相手は、過去の自分だけ）</div>
  </section>`;
}

function stampCard() {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + logMonth);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const tk = todayKey();
  let cells = WD.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="c blank"></div>';
  let count = 0;
  for (let i = 1; i <= days; i++) {
    const k = dkey(new Date(y, m, i));
    let cls = 'c', mark = '';
    if (k > tk) cls += ' future';
    else if (winsOn(k) > 0) { cls += ' has'; mark = perfectOn(k) ? '💮' : '🌸'; count++; }
    else if (S.frozen[k]) { cls += ' has'; mark = '🎫'; }
    if (k === tk) cls += ' today';
    cells += `<div class="${cls}" title="${k}"><span class="n">${i}</span>${mark}</div>`;
  }
  return `<section class="card">
    <h2>🌸 スタンプカード <span class="sub">${count}日</span></h2>
    <div class="month-nav">
      <button data-act="month" data-d="-1" aria-label="前の月">‹</button>
      <b>${y}年${m + 1}月</b>
      <button data-act="month" data-d="1" aria-label="次の月" ${logMonth >= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="stamps">${cells}</div>
    <div class="legend"><span>🌸 やった日</span><span>💮 ぜんぶやった日</span><span>🎫 チケットで守った日</span></div>
  </section>`;
}

function renderLog() {
  const k = todayKey();
  const j = S.journal[k] || {};
  const mood = draftMood ?? j.mood ?? null;
  const MOODS = ['😫', '😕', '😐', '🙂', '😄'];
  const entries = Object.entries(S.journal).filter(([d]) => d !== k).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
  const owned = STICKERS.filter(([e]) => S.stickers[e]).length;
  const hs = activeHabits();

  return `
  ${weeklyCard()}
  ${stampCard()}

  ${hs.length ? `<section class="card">
    <h2>🔁 習慣ごと</h2>
    ${hs.map((h) => {
      const n = totalOf(h);
      return `<div class="hstat">
        <div class="top">${esc(h.emoji)} ${esc(h.name)} <span>${n}回</span></div>
        <div class="bar"><i style="width:${Math.min(100, (n / AUTOMATIC) * 100)}%"></i></div>
        <div class="small muted" style="margin-top:4px">${n >= AUTOMATIC ? '🧠 もう体になじんでいます！' : `🧠 体になじむまで あと${AUTOMATIC - n}回`}
          ${h.identity && n ? `・🪪「${esc(h.identity)}」に${n}票` : ''}</div>
      </div>`;
    }).join('')}
  </section>` : ''}

  <section class="card">
    <h2>🎁 シール図鑑 <span class="sub">${owned} / ${STICKERS.length}</span></h2>
    <div class="small muted" style="margin-bottom:8px">「やった！」のたびに、ときどきシールがもらえます。💮の日は必ず1枚！</div>
    <div class="stickers">
      ${STICKERS.map(([e, name, r]) => {
        const n = S.stickers[e] || 0;
        return `<div class="sticker r${r} ${n ? '' : 'locked'}"><span class="i">${e}</span>${n ? name : '？？？'}${n > 1 ? `<span class="x">×${n}</span>` : ''}</div>`;
      }).join('')}
    </div>
  </section>

  <section class="card">
    <h2>📝 ひとこと日記</h2>
    <div class="moods">${MOODS.map((m, i) => `<button data-act="mood" data-i="${i}" class="${mood === i ? 'on' : ''}">${m}</button>`).join('')}</div>
    <textarea id="journalText" rows="3" placeholder="今日よかったことを1つ書いてみよう">${esc(j.text || '')}</textarea>
    <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="primary" data-act="savejournal">保存</button></div>
    ${entries.length ? `<details style="margin-top:12px"><summary class="small">これまでの日記（${entries.length}）</summary>
      ${entries.map(([dd, e]) => `<div class="entry"><div class="d">${dd}（${WD[parseKey(dd).getDay()]}）${e.mood != null ? MOODS[e.mood] : ''}</div>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div>`).join('')}
    </details>` : ''}
  </section>`;
}

/* ---------- render: settings ---------- */
const PSY = [
  ['🐣 小さく始める（タイニー・ハビット）', 'やる気に頼らず、ハードルを極限まで下げると行動が起きやすくなります（BJ・フォッグ）。「しんどい日はちょっとだけ版」でも1回にカウントします。'],
  ['🕖 「いつやる？」を決める（If-Thenプランニング）', '「〜したら、〜する」と決めておくと実行率が大きく上がることが、多くの研究で示されています（ゴルヴィツァー）。'],
  ['⭕ 今日のリング（閉じたくなる輪）', '人は「あと少しで完成するもの」を完成させたくなります（目標勾配効果・ツァイガルニク効果）。「あと1つで満タン！」と知らせます。'],
  ['🌱 育つ植物と「のどかわいた」', '成長が目に見えると続けたくなります（進捗の法則・アマビール）。まだの日は植物が少ししょんぼり。でも枯れることはなく、責めずにやさしく背中を押します。'],
  ['🎫 お休みチケット', '連続記録が1回途切れると「もういいや」とやめてしまいがち（What-the-hell効果）。7日続けるともらえるチケットが、休んだ日の記録を守ります。'],
  ['🎁 ときどきもらえるシール', 'ごほうびが「いつ出るかわからない」ほど行動は続きやすくなります（変動報酬・スキナー）。'],
  ['🌸 スタンプカード', '空欄を作りたくない気持ちと、積み重ねが一目でわかる満足感で、毎日を続けやすくします。'],
  ['📮 先週のあなた', '週のはじめは「新しい自分」を始めやすいタイミング（フレッシュスタート効果）。比べる相手は他人ではなく、過去の自分だけです。'],
  ['🎉 最初の1回をその場で', '習慣を作ったらすぐ「今日の分」をやってもらうことで、最初の成功体験を作ります。'],
  ['🧠 66回で体になじむ', '新しい行動が自動化するまで平均66日（個人差あり）と言われています（ラリー他）。'],
  ['🪪 なりたい自分への1票', 'やるたびに「なりたい自分」へ1票。自己イメージが行動を支えます（ジェームズ・クリア）。「くわしく設定」で使えます。'],
];

function renderSettings() {
  const archived = S.habits.filter((h) => h.archived);
  return `
  <div class="sec">${notifySection()}</div>
  <div class="sec"><h3>📲 アプリ</h3><div class="small">${installSection()}</div></div>
  ${archived.length ? `<div class="sec"><h3>🗄️ やめた習慣</h3>
    ${archived.map((h) => `<div class="setting"><span>${esc(h.emoji)} ${esc(h.name)}（${totalOf(h)}回）</span><button class="ghost" data-act="restore" data-id="${h.id}">再開</button></div>`).join('')}</div>` : ''}
  <div class="sec"><h3>💾 データ</h3>
    <div class="small muted" style="margin-bottom:8px">データはこの端末のブラウザ内だけに保存されています。機種変更のときはエクスポート → インポートで移せます。</div>
    <div class="row" style="flex-wrap:wrap">
      <button class="ghost" data-act="export">📤 エクスポート</button>
      <button class="ghost" data-act="import">📥 インポート</button>
      <span class="spacer"></span>
      <button class="ghost danger" data-act="reset">全データ削除</button>
    </div>
    <input type="file" id="importFile" accept="application/json" hidden>
  </div>
  <div class="sec"><h3>🧪 このアプリのしくみ</h3>
    ${PSY.map(([t, d]) => `<details class="psy"><summary>${t}</summary><p>${d}</p></details>`).join('')}
  </div>`;
}

/* ---------- main render ---------- */
function render() {
  renderTop();
  $('#view').innerHTML = tab === 'log' ? renderLog() : renderToday();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if ($('#settingsDialog').open) $('#settingsBody').innerHTML = renderSettings();
}

/* ---------- habit dialog ---------- */
const dlg = $('#habitDialog');
const form = $('#habitForm');
const fe = (n) => form.elements.namedItem(n);
$('#dayPicker').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="day" value="${d}"><span>${WD[d]}</span></label>`).join('');

function openHabit(h) {
  form.reset();
  ['id', 'emoji', 'name', 'cue', 'tiny', 'identity', 'reward', 'remindAt'].forEach((n) => { fe(n).value = h[n] || ''; });
  form.querySelectorAll('input[name=day]').forEach((c) => { c.checked = h.days.includes(Number(c.value)); });
  form.querySelector('details.more').open = false;
  dlg.showModal();
}
form.addEventListener('submit', (e) => {
  const days = [...form.querySelectorAll('input[name=day]:checked')].map((c) => Number(c.value));
  if (!days.length) { e.preventDefault(); toast('曜日を1つ以上選んでください'); return; }
  const h = S.habits.find((x) => x.id === fe('id').value);
  if (!h || !fe('name').value.trim()) { e.preventDefault(); return; }
  Object.assign(h, {
    emoji: fe('emoji').value.trim() || '✅', name: fe('name').value.trim(), cue: fe('cue').value.trim(),
    tiny: fe('tiny').value.trim(), identity: fe('identity').value.trim(), reward: fe('reward').value.trim(),
    remindAt: fe('remindAt').value, days,
  });
  save(); render();
});
$('#cancelHabit').addEventListener('click', () => dlg.close());
$('#archiveHabit').addEventListener('click', () => {
  const h = S.habits.find((x) => x.id === fe('id').value);
  if (h && confirm(`「${h.name}」をやめますか？\n（これまでの記録は残ります。⚙️からいつでも再開できます）`)) {
    h.archived = true; save(); dlg.close(); render();
  }
});

/* ---------- events ---------- */
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab; draftMood = null;
  render(); window.scrollTo({ top: 0 });
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  switch (act) {
    case 'habit': toggleHabit(id); break;
    case 'edithabit': { const h = S.habits.find((x) => x.id === id); if (h) openHabit(h); break; }
    case 'addhabit': onb = { step: 1 }; render(); window.scrollTo({ top: 0 }); break;
    case 'todo': toggleTodo(id); break;
    case 'star': starTodo(id); break;
    case 'deltodo': deleteTodo(id); break;
    case 'gotolog': tab = 'log'; render(); window.scrollTo({ top: 0 }); break;
    case 'ticketinfo':
      celebrate('🎫', `お休みチケット：${S.tickets}枚`, '🔥を7日続けるごとに1枚もらえます（最大3枚）。<br>うっかり休んだ日に自動で使われて、連続記録を守ってくれます。');
      break;
    case 'settings': $('#settingsBody').innerHTML = renderSettings(); $('#settingsDialog').showModal(); break;
    case 'closesettings': $('#settingsDialog').close(); break;
    // onboarding
    case 'onb-tpl': { const t = TEMPLATES[Number(b.dataset.i)]; onb = { step: 2, ...t }; render(); break; }
    case 'onb-cue': finishOnbHabit(b.dataset.v); break;
    case 'onb-back': onb = { step: 1 }; render(); break;
    case 'onb-skip': S.settings.skipOnb = true; onb = null; save(); render(); break;
    case 'onb-cancel': onb = null; render(); break;
    case 'onb-done': { const hid = onb.habitId; onb = null; toggleHabit(hid); break; }
    case 'onb-later': onb = null; render(); toast('🌱 準備OK！ ○をタップすると記録できます'); break;
    // log
    case 'month': logMonth = Math.min(0, logMonth + Number(b.dataset.d)); render(); break;
    case 'mood': { draftMood = Number(b.dataset.i); const txt = $('#journalText').value; render(); $('#journalText').value = txt; break; }
    case 'savejournal': saveJournal(); break;
    // settings
    case 'restore': { const h = S.habits.find((x) => x.id === id); if (h) { h.archived = false; save(); render(); toast(`${esc(h.emoji)} 再開しました`); } break; }
    case 'notifyon': enableNotify(); break;
    case 'notifyoff': S.settings.notify = false; save(); render(); toast('🔕 通知をオフにしました'); break;
    case 'testnotify': testNotify(); break;
    case 'install': promptInstall(); break;
    case 'ics': exportICS(); break;
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'reset':
      if (confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) {
        localStorage.removeItem(STORE); S = defaultState(); onb = null; save();
        $('#settingsDialog').close(); tab = 'today'; render(); toast('リセットしました');
      }
      break;
    default: break;
  }
});

document.addEventListener('submit', (e) => {
  const id = e.target.id;
  if (id === 'todoForm') { e.preventDefault(); addTodo($('#todoInput').value); }
  else if (id === 'onbCustom') {
    e.preventDefault();
    const name = e.target.elements.namedItem('t').value.trim();
    if (!name) { toast('続けたいことを書いてね'); return; }
    onb = { step: 2, emoji: '✅', name, cue: '', tiny: '', identity: '' }; render();
  } else if (id === 'onbCueForm') {
    e.preventDefault();
    const cue = e.target.elements.namedItem('t').value.trim();
    if (!cue) { toast('いつやるか書いてね'); return; }
    finishOnbHabit(cue);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'journalAt') {
    S.settings.journalAt = e.target.value; save();
    toast(e.target.value ? `📝 ${e.target.value} にお知らせします` : 'ふりかえり通知をオフにしました');
    return;
  }
  if (e.target.id !== 'importFile') return;
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.habits)) throw new Error('bad');
      if (!confirm('今のデータを上書きしてインポートしますか？')) return;
      S = hydrate(d); save(); render(); toast('インポートしました');
    } catch (err) { toast('ファイルを読み込めませんでした'); }
  };
  r.readAsText(f);
});

function saveJournal() {
  const k = todayKey();
  const text = $('#journalText').value.trim();
  const prev = S.journal[k] || {};
  const mood = draftMood ?? prev.mood ?? null;
  if (!text && mood == null) { toast('気分かひとことを入れてみよう'); return; }
  S.journal[k] = { mood, text };
  toast(prev.text || prev.mood != null ? '保存しました' : '📝 書けたね！おつかれさま');
  draftMood = null;
  save(); render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tsuzuku-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- feedback effects ---------- */
const toastQ = [];
let toastBusy = false;
function toast(html) { toastQ.push(html); if (!toastBusy) nextToast(); }
function nextToast() {
  const t = $('#toast');
  if (!toastQ.length) { toastBusy = false; t.classList.remove('show'); return; }
  toastBusy = true;
  t.innerHTML = toastQ.shift();
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(nextToast, 250); }, 1900);
}
const celebQ = [];
function celebrate(icon, title, text) { celebQ.push([icon, title, text]); setTimeout(nextCeleb, 400); }
function nextCeleb() {
  const c = $('#celebrate');
  if (c.open || !celebQ.length) return;
  const [i, t, x] = celebQ.shift();
  $('#celebrateIcon').textContent = i;
  $('#celebrateTitle').innerHTML = t;
  $('#celebrateText').innerHTML = x;
  c.showModal();
}
$('#celebrate').addEventListener('close', () => setTimeout(nextCeleb, 250));
function popPlant() {
  requestAnimationFrame(() => {
    const p = $('#plant');
    if (p) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
  });
}

const cv = $('#confetti');
const cx = cv.getContext('2d');
let parts = [], animating = false;
const COLORS = ['#5b8def', '#34b27b', '#f0a23b', '#e5534b', '#a974ff', '#ffd23f'];
function confetti(n = 40) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < n; i++) {
    parts.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 4,
      s: Math.random() * 6 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      c: pick(COLORS), life: 90 + Math.random() * 40,
    });
  }
  if (!animating) { animating = true; requestAnimationFrame(tick); }
}
function tick() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r);
    cx.globalAlpha = Math.min(1, p.life / 30);
    cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    cx.restore();
  }
  if (parts.length) requestAnimationFrame(tick);
  else { animating = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
}

/* ---------- PWA & 通知 ---------- */
const DATA_CACHE = 'tsuzuku-data';
const CFG_PATH = './__tsuzuku/reminders.json';
const canSW = 'serviceWorker' in navigator && window.isSecureContext;
const canNotify = 'Notification' in window;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let swReg = null, installEvt = null, syncTimer = null;

// Service Worker が読む「今日のリマインダー情報」
function reminderConfig() {
  const k = todayKey(), d = new Date();
  const hs = activeHabits();
  const streak = dayStreak(), noneToday = winsOn(k) === 0;
  return {
    enabled: !!S.settings.notify,
    date: k,
    journalAt: S.settings.journalAt || '',
    journalDone: !!S.journal[k],
    winsToday: winsOn(k),
    undone: hs.filter((h) => isSched(h, d) && !logOf(h, k)).length,
    habits: hs.filter((h) => h.remindAt).map((h) => ({
      id: h.id, name: h.name, emoji: h.emoji, cue: h.cue, tiny: h.tiny, remindAt: h.remindAt, days: h.days,
      createdAt: h.createdAt, done: !!logOf(h, k), streak, risk: streak > 0 && noneToday,
    })),
  };
}
function syncReminders() {
  if (!canSW || !('caches' in window)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const c = await caches.open(DATA_CACHE);
      await c.put(new URL(CFG_PATH, location.href).href,
        new Response(JSON.stringify(reminderConfig()), { headers: { 'Content-Type': 'application/json' } }));
      pingSW();
    } catch (e) { /* noop */ }
  }, 300);
}
function pingSW() { if (swReg && swReg.active) swReg.active.postMessage({ type: 'check' }); }

async function registerPeriodic() {
  try {
    if (!swReg || !('periodicSync' in swReg)) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await swReg.periodicSync.register('tsuzuku-reminder', { minInterval: 60 * 60 * 1000 });
  } catch (e) { /* 非対応ブラウザ */ }
}
async function enableNotify() {
  if (!canNotify) { toast('このブラウザは通知に対応していません'); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('通知が許可されませんでした（ブラウザの設定から変更できます）'); render(); return; }
  S.settings.notify = true; save(); render(); registerPeriodic();
  toast('🔔 通知をオンにしました');
}
async function testNotify() {
  if (!canNotify || Notification.permission !== 'granted') { toast('先に通知をオンにしてください'); return; }
  const opts = { body: '🕖 こんなふうに、決めた時刻にお知らせします。\n🐣 ちょっとだけでもOK！', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'test' };
  try {
    if (swReg) await swReg.showNotification('🌱 つづく：テスト通知', opts);
    else new Notification('🌱 つづく：テスト通知', opts);
    toast('テスト通知を送りました');
  } catch (e) { toast('通知を表示できませんでした'); }
}
function promptInstall() {
  if (!installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.finally(() => { installEvt = null; render(); });
}

function notifySection() {
  const perm = canNotify ? Notification.permission : 'unsupported';
  const on = S.settings.notify && perm === 'granted';
  const status = !canNotify ? (isIOS ? 'iPhoneではホーム画面に追加したアプリから使えます' : 'このブラウザは通知に対応していません')
    : !canSW ? 'https で開いたときに使えます'
      : perm === 'denied' ? 'ブラウザで通知がブロックされています。サイトの設定から許可してください'
        : on ? `オン（時刻を決めた習慣 ${activeHabits().filter((h) => h.remindAt).length}件）` : 'オフ';
  const disabled = !canNotify || !canSW || perm === 'denied';
  return `<h3>🔔 通知</h3>
    <div class="setting">
      <div><b>リマインダー</b><div class="small muted">${status}</div></div>
      ${on ? '<button class="ghost" data-act="notifyoff">オフ</button>'
        : `<button class="primary" data-act="notifyon" ${disabled ? 'disabled' : ''}>オンにする</button>`}
    </div>
    <div class="setting">
      <div><b>📝 ふりかえりの時刻</b><div class="small muted">今日のようすをお知らせ</div></div>
      <input type="time" id="journalAt" value="${esc(S.settings.journalAt || '')}">
    </div>
    <div class="small muted">⏰ 習慣ごとの時刻は、習慣の名前をタップ →「くわしく設定」で決められます。</div>
    <div class="row" style="flex-wrap:wrap;margin-top:10px">
      ${on ? '<button class="ghost" data-act="testnotify">🔔 テスト通知</button>' : ''}
      <button class="ghost" data-act="ics">📅 カレンダーに登録</button>
    </div>
    <div class="small muted note">💡 アプリを閉じている間の通知は遅れたり届かないことがあります。確実に知らせてほしいときは「📅 カレンダーに登録」がおすすめです。</div>`;
}
function installSection() {
  return isStandalone() ? '✅ アプリとしてインストール済みです'
    : installEvt ? '<button class="primary" data-act="install">📲 ホーム画面に追加</button>'
      : isIOS ? 'Safariの共有ボタン <b>⬆️</b> →「ホーム画面に追加」でアプリとして使えます'
        : 'ブラウザのメニューから「アプリをインストール」/「ホーム画面に追加」を選ぶとアプリとして使えます';
}

// 端末のカレンダーに「繰り返しリマインダー」として登録できる .ics
function exportICS() {
  const hs = activeHabits().filter((h) => h.remindAt);
  if (!hs.length && !S.settings.journalAt) { toast('習慣の「くわしく設定」で時刻を決めてください'); return; }
  const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const day = todayKey().replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ie = (s) => String(s || '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const ev = (id, time, days, summary, desc) => [
    'BEGIN:VEVENT', `UID:${id}@tsuzuku`, `DTSTAMP:${stamp}`,
    `DTSTART:${day}T${time.replace(':', '')}00`, 'DURATION:PT10M',
    `RRULE:FREQ=WEEKLY;BYDAY=${days.slice().sort().map((x) => BY[x]).join(',')}`,
    `SUMMARY:${ie(summary)}`, `DESCRIPTION:${ie(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ie(summary)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
  const events = hs.map((h) => ev(h.id, h.remindAt, h.days, `${h.emoji} ${h.name}`,
    `${h.cue ? `🕖 ${h.cue}\n` : ''}🐣 しんどい日は「${h.tiny || '2分だけ'}」でOK\n✅ 終わったら「つづく」でタップ！`));
  if (S.settings.journalAt) events.push(ev('journal', S.settings.journalAt, [0, 1, 2, 3, 4, 5, 6], '📝 つづく：今日のふりかえり', '今日よかったことを1つ書こう'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tsuzuku//habit//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:つづく 習慣リマインダー', ...events, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'tsuzuku-reminders.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('📅 書き出しました。ファイルを開くとカレンダーに追加できます');
}

// 通知のボタンやショートカットから開かれたとき
function handleParams(qs) {
  const p = new URLSearchParams(qs);
  if (p.get('act') === 'habit') {
    const id = p.get('id'), type = p.get('type') === 'tiny' ? 'tiny' : 'full';
    const h = S.habits.find((x) => x.id === id);
    tab = 'today';
    if (h && !logOf(h, todayKey())) toggleHabit(id, type); else render();
  } else if (p.get('tab')) {
    tab = ['log', 'reflect', 'growth'].includes(p.get('tab')) ? 'log' : 'today';
    render();
  }
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; render(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('🎉 ホーム画面に追加しました'); render(); });

if (canSW) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    swReg = reg; syncReminders();
    if (S.settings.notify) registerPeriodic();
  }).catch(() => { /* noop */ });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open') handleParams(e.data.params);
  });
}
setInterval(pingSW, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncReminders(); });

/* ---------- boot ---------- */
if (S.lastOpen && diffDays(S.lastOpen, todayKey()) >= 3) S.welcomeBack = todayKey();
processTickets();
render();
if (location.search) { handleParams(location.search); history.replaceState(null, '', location.pathname); }
S.lastOpen = todayKey();
save();

// 日付が変わったら自動で更新
let lastDay = todayKey();
setInterval(() => {
  if (todayKey() !== lastDay) { lastDay = todayKey(); processTickets(); S.lastOpen = lastDay; save(); render(); }
}, 60000);
