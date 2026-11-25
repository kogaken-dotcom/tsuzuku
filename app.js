'use strict';
/* =========================================================
 * つづく — 心理学ベースの習慣化 & TODO アプリ
 * データはブラウザの localStorage に保存されます。
 * ========================================================= */

const STORE = 'tsuzuku-v1';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const XP = { habit: 10, tiny: 6, todo: 5, frog: 10, journal: 5 };
const BONUS_RATE = 0.15; // 変動報酬：15%の確率でXP2倍
const AUTOMATIC_DAYS = 66; // Lally et al. (2010) 習慣が自動化するまでの平均日数

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
    version: 1,
    createdAt: dkey(),
    lastOpen: null,
    xp: 0,
    habits: [],
    logs: {},      // { 'YYYY-MM-DD': { habitId: { type: 'full'|'tiny', xp } } }
    todos: [],     // { id, text, frog, done, doneAt, createdAt, xp }
    journal: {},   // { 'YYYY-MM-DD': { mood, text, xp } }
    awarded: {},   // マイルストーン達成済みフラグ
    settings: { notify: false, journalAt: '21:00' },
  };
}
function hydrate(obj) {
  const st = Object.assign(defaultState(), obj);
  st.settings = Object.assign(defaultState().settings, obj.settings || {});
  return st;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return hydrate(JSON.parse(raw));
  } catch (e) { /* noop */ }
  return null;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* noop */ }
  syncReminders();
}

let S = load();
let firstLaunch = false;
if (!S) {
  S = defaultState();
  S.xp = 30; // 授かり効果：最初から少し進んだ状態でスタート
  firstLaunch = true;
}
let tab = 'today';

/* ---------- level ---------- */
const TITLES = ['はじめの一歩', '芽ばえ', 'コツコツ家', '習慣の探検家', '継続の職人', '習慣の達人', '継続マスター', '伝説のつづく人'];
function levelInfo(xp) {
  let lv = 1, acc = 0, need = 60;
  while (xp >= acc + need) { acc += need; lv++; need = 60 + (lv - 1) * 30; }
  return { lv, cur: xp - acc, need, title: TITLES[Math.min(TITLES.length - 1, Math.floor((lv - 1) / 3))] };
}

/* ---------- plant (成長の可視化) ---------- */
const STAGES = [
  { at: 0, icon: '🌰', name: 'たね' },
  { at: 5, icon: '🌱', name: '芽' },
  { at: 20, icon: '🌿', name: '若葉' },
  { at: 50, icon: '🪴', name: '苗木' },
  { at: 100, icon: '🌳', name: '大きな木' },
  { at: 200, icon: '🌸', name: '花ざかり' },
  { at: 400, icon: '🍎', name: '実り' },
  { at: 800, icon: '🏞️', name: '森' },
];
function stageOf(wins) {
  let i = 0;
  while (i + 1 < STAGES.length && wins >= STAGES[i + 1].at) i++;
  return { ...STAGES[i], next: STAGES[i + 1] || null, idx: i };
}

/* ---------- habits logic ---------- */
const activeHabits = () => S.habits.filter((h) => !h.archived);
const isSched = (h, d) => h.days.includes(d.getDay()) && dkey(d) >= h.createdAt;
const logOf = (h, k) => (S.logs[k] && S.logs[k][h.id]) || null;

// 「2日連続で休まない」ルール：1日休んでも連続記録は途切れない（What-the-hell効果を防ぐ）
function streakOf(h) {
  const tk = todayKey();
  let d = new Date();
  if (!logOf(h, tk)) d = addDays(d, -1);
  let s = 0, miss = 0, first = true, risk = false;
  for (let i = 0; i < 3000; i++) {
    const k = dkey(d);
    if (k < h.createdAt) break;
    if (logOf(h, k)) { s++; miss = 0; first = false; }
    else if (isSched(h, d)) {
      miss++;
      if (first) risk = true;
      first = false;
      if (miss >= 2) break;
    }
    d = addDays(d, -1);
  }
  return { streak: s, risk: risk && s > 0 && !logOf(h, tk) };
}
function bestOf(h) {
  const tk = todayKey();
  let d = parseKey(h.createdAt), s = 0, best = 0, miss = 0;
  while (dkey(d) <= tk) {
    const k = dkey(d);
    if (logOf(h, k)) { s++; miss = 0; best = Math.max(best, s); }
    else if (isSched(h, d) && k !== tk) { miss++; if (miss >= 2) { s = 0; miss = 0; } }
    d = addDays(d, 1);
  }
  return best;
}
const totalOf = (h) => Object.values(S.logs).filter((l) => l[h.id]).length;

/* ---------- wins ---------- */
function winsOn(k) {
  const habits = S.logs[k] ? Object.keys(S.logs[k]).length : 0;
  const todos = S.todos.filter((t) => t.done && t.doneAt === k).length;
  return habits + todos;
}
function totalWins() {
  let n = 0;
  for (const k in S.logs) n += Object.keys(S.logs[k]).length;
  n += S.todos.filter((t) => t.done).length;
  return n;
}

/* ---------- rewards ---------- */
const PRAISE = [
  'ナイス！小さな一歩が未来を変える', 'その調子！', '昨日の自分を超えた！', '積み重ねが力になる 💪',
  'えらい！ちゃんと続いてる', '今日もひとつ、自分との約束を守った', 'いいリズム！', '最高！',
  '「やった」は最強のごほうび', 'できた自分をほめよう 👏', '継続は才能を超える',
];
const TINY_PRAISE = [
  '2分でもゼロじゃない。記録はつながった！', '「やる人」であることが大事。完璧！',
  'ハードルを下げて続けるのは賢い選択', '小さくても前進！',
];

function gainXP(base, msg) {
  const before = levelInfo(S.xp).lv;
  const lucky = Math.random() < BONUS_RATE;
  const amt = lucky ? base * 2 : base;
  S.xp += amt;
  toast(`${msg} <b>+${amt}XP</b>${lucky ? ' <span class="bonus">✨ラッキー2倍！</span>' : ''}`);
  if (lucky) confetti(60);
  const after = levelInfo(S.xp);
  if (after.lv > before) {
    setTimeout(() => celebrate('⬆️', `レベル${after.lv}にアップ！`, `称号：「${after.title}」<br>あなたの積み重ねが形になっています。`), 500);
  }
  return amt;
}
function loseXP(n) { S.xp = Math.max(0, S.xp - (n || 0)); }

const HABIT_MILESTONES = [
  [1, '🌟', '最初の一歩！', 'はじめることが一番むずかしい。もうそれをクリアしました。'],
  [7, '🔥', '7回達成！', '1週間分の積み重ね。リズムができはじめています。'],
  [21, '🥉', '21回達成！', '行動が「いつものこと」になりつつあります。'],
  [30, '🥈', '30回達成！', '1か月分の努力。もう立派な習慣です。'],
  [AUTOMATIC_DAYS, '🧠', `${AUTOMATIC_DAYS}回達成！`, '研究では平均66日で習慣は自動化すると言われています。おめでとう！'],
  [100, '🥇', '100回達成！', '3ケタの大台。あなたは本物の継続者です。'],
  [200, '💎', '200回達成！', 'ここまで来た人はほとんどいません。'],
  [365, '👑', '365回達成！', '1年分の積み重ね。人生が変わるレベルです。'],
];
function checkHabitMilestone(h) {
  const n = totalOf(h);
  for (const [at, icon, title, text] of HABIT_MILESTONES) {
    const key = `h:${h.id}:${at}`;
    if (n >= at && !S.awarded[key]) {
      S.awarded[key] = true;
      setTimeout(() => celebrate(icon, `${h.emoji} ${esc(h.name)}：${title}`,
        `${text}${h.identity ? `<br><br>「${esc(h.identity)}」への${n}票目が入りました。` : ''}`), 700);
      confetti(140);
      break;
    }
  }
}

const GLOBAL_BADGES = [
  [1, '🎈', '初勝利'], [10, '⭐', '10勝'], [30, '🎖️', '30勝'], [50, '🏅', '50勝'], [100, '🏆', '100勝'],
  [250, '🚀', '250勝'], [500, '🌈', '500勝'], [1000, '🗻', '1000勝'],
];
function checkGlobal() {
  const w = totalWins();
  for (const [at, icon, name] of GLOBAL_BADGES) {
    const key = `g:${at}`;
    if (w >= at && !S.awarded[key]) {
      S.awarded[key] = true;
      if (at > 1) setTimeout(() => celebrate(icon, `バッジ獲得：${name}`, `これまでに小さな勝利を${w}回積み重ねました。`), 900);
    }
  }
}

/* ---------- actions ---------- */
function toggleHabit(id, type) {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  const k = todayKey();
  S.logs[k] = S.logs[k] || {};
  const cur = S.logs[k][id];
  if (cur && cur.type === type) {
    loseXP(cur.xp);
    delete S.logs[k][id];
    if (!Object.keys(S.logs[k]).length) delete S.logs[k];
    toast('取り消しました');
  } else {
    if (cur) loseXP(cur.xp);
    const msg = type === 'tiny' ? pick(TINY_PRAISE) : pick(PRAISE);
    const xp = gainXP(type === 'tiny' ? XP.tiny : XP.habit, `${h.emoji} ${msg}`);
    S.logs[k][id] = { type, xp };
    if (!cur) { confetti(type === 'tiny' ? 25 : 45); popPlant(); }
    checkHabitMilestone(h);
    checkGlobal();
    if (h.reward && !cur) setTimeout(() => toast(`🎁 ごほうびタイム：${esc(h.reward)}`), 2300);
  }
  save(); render();
}

function addTodo(text) {
  text = text.trim();
  if (!text) return;
  S.todos.push({ id: uid(), text, frog: false, done: false, doneAt: null, createdAt: todayKey(), xp: 0 });
  save(); render();
  const input = $('#todoInput'); if (input) input.focus();
}
function toggleTodo(id) {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  if (t.done) {
    t.done = false; t.doneAt = null; loseXP(t.xp); t.xp = 0;
  } else {
    t.done = true; t.doneAt = todayKey();
    t.xp = gainXP(t.frog ? XP.frog : XP.todo, t.frog ? '🐸 一番大事なことを片づけた！' : pick(PRAISE));
    confetti(t.frog ? 80 : 30); popPlant(); checkGlobal();
  }
  save(); render();
}
function frogTodo(id) {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const on = !t.frog;
  S.todos.forEach((x) => { if (!x.done) x.frog = false; });
  t.frog = on;
  if (on) toast('🐸 今日の最重要タスクに設定（1つだけ選べます）');
  save(); render();
}
function deleteTodo(id) {
  S.todos = S.todos.filter((x) => x.id !== id);
  save(); render();
}

/* ---------- render: top bar ---------- */
function renderTop() {
  const L = levelInfo(S.xp);
  $('#lvbox').innerHTML = `
    <div class="lvline"><span><b>Lv.${L.lv}</b> ${L.title}</span><span>あと${L.need - L.cur}XP</span></div>
    <div class="bar"><i style="width:${(L.cur / L.need) * 100}%"></i></div>`;
}

/* ---------- render: today ---------- */
function freshStartBanner() {
  const t = todayKey();
  const last = S.lastOpen;
  const d = new Date();
  if (firstLaunch || (!S.habits.length && !totalWins())) return `<div class="banner">👋 ようこそ！<b>はじめの一歩ボーナス +30XP</b> をプレゼント。まずは「習慣」タブで小さな習慣をひとつ作ってみましょう。</div>`;
  if (last && diffDays(last, t) >= 3) return `<div class="banner">🌤️ <b>おかえりなさい！</b> 戻ってきたこと自体が一番の勝利です。今日はひとつだけ、小さくやってみましょう。</div>`;
  if (d.getDate() === 1) return `<div class="banner">🗓️ <b>新しい月のはじまり。</b> リセットして再スタートするのに最高のタイミングです。</div>`;
  if (d.getDay() === 1) return `<div class="banner">🌅 <b>新しい週のスタート！</b> 今週の自分は、先週の自分を少しだけ超えていこう。</div>`;
  return '';
}

function habitCard(h) {
  const k = todayKey();
  const log = logOf(h, k);
  const { streak, risk } = streakOf(h);
  const cls = log ? (log.type === 'tiny' ? 'habit tiny' : 'habit done') : 'habit';
  return `
  <div class="${cls}">
    <div class="emo">${esc(h.emoji || '✅')}</div>
    <div class="body">
      <div class="name">${esc(h.name)}</div>
      ${h.cue ? `<div class="cue">📍 ${esc(h.cue)} → ${esc(h.name)}</div>` : ''}
      <div class="meta">
        <span class="flame">${streak > 0 ? `🔥 ${streak}回連続` : '🔥 0'}</span>
        ${h.remindAt && !log ? `<span class="muted">⏰ ${esc(h.remindAt)}</span>` : ''}
        ${risk ? `<span class="risk">⚠️ 昨日はお休み。今日やれば記録は守れる！</span>` : ''}
      </div>
    </div>
    <div class="actions">
      <button class="btn-do" data-act="habit" data-id="${h.id}" data-type="full">${log && log.type === 'full' ? '✓ できた' : 'やった！'}</button>
      <button class="btn-tiny" data-act="habit" data-id="${h.id}" data-type="tiny" title="${esc(h.tiny || '2分だけやる')}">${log && log.type === 'tiny' ? '✓ 2分' : '2分だけ'}</button>
    </div>
  </div>`;
}

function todoRow(t) {
  const age = !t.done && t.createdAt < todayKey() ? `<span class="age">${diffDays(t.createdAt, todayKey())}日前〜</span>` : '';
  return `
  <div class="todo ${t.done ? 'done' : ''}">
    <button class="check" data-act="todo" data-id="${t.id}" aria-label="完了">${t.done ? '✓' : ''}</button>
    <span class="txt">${t.frog ? '🐸 ' : ''}${esc(t.text)} ${age}</span>
    ${t.done ? '' : `<button class="star ${t.frog ? 'on' : ''}" data-act="frog" data-id="${t.id}" title="今日の最重要タスクにする">🐸</button>`}
    <button class="del" data-act="deltodo" data-id="${t.id}" aria-label="削除">🗑️</button>
  </div>`;
}

function renderToday() {
  const k = todayKey();
  const d = new Date();
  const wins = winsOn(k);
  const tw = totalWins();
  const st = stageOf(tw);
  const todayHabits = activeHabits().filter((h) => isSched(h, d));
  const restHabits = activeHabits().filter((h) => !isSched(h, d));
  const doneHabits = todayHabits.filter((h) => logOf(h, k)).length;
  const openTodos = S.todos.filter((t) => !t.done).sort((a, b) => (b.frog - a.frog) || (a.createdAt < b.createdAt ? -1 : 1));
  const doneTodos = S.todos.filter((t) => t.done && t.doneAt === k);
  const nextTxt = st.next ? `次の「${st.next.name}」まであと${st.next.at - tw}勝` : '最終形態に到達！';
  const stageProg = st.next ? ((tw - st.at) / (st.next.at - st.at)) * 100 : 100;

  let winIcons = '';
  for (let i = 0; i < Math.min(wins, 30); i++) winIcons += '<span>⭐</span>';

  return `
  ${freshStartBanner()}
  <section class="card">
    <div class="hero">
      <div class="plant" id="plant" title="${st.name}">${st.icon}</div>
      <div class="info">
        <div class="title">今日の小さな勝利：${wins}</div>
        <div class="wins-today">${winIcons || '<span class="muted small">チェックするたびに⭐が増えます</span>'}</div>
        <div class="small muted" style="margin-top:6px">🌱 ${st.name}（通算${tw}勝）・${nextTxt}</div>
        <div class="bar" style="margin-top:4px"><i style="width:${stageProg}%"></i></div>
      </div>
    </div>
  </section>

  <section class="card">
    <h2>🔁 今日の習慣 <span class="sub">${doneHabits}/${todayHabits.length}</span></h2>
    ${todayHabits.length ? todayHabits.map(habitCard).join('') : `
      <div class="empty">今日の習慣はまだありません。<br><button class="linkbtn" data-act="newhabit">＋ 小さな習慣をつくる</button></div>`}
    ${restHabits.length ? `<div class="small muted">今日はお休み：${restHabits.map((h) => esc(h.emoji + h.name)).join('、')}</div>` : ''}
  </section>

  <section class="card">
    <h2>✅ TODO <span class="sub">今日 ${doneTodos.length}件 完了</span></h2>
    <form class="todo-add" id="todoForm">
      <input id="todoInput" placeholder="やることを追加…（小さく分けるのがコツ）" autocomplete="off">
      <button class="primary" type="submit">追加</button>
    </form>
    ${openTodos.length && !openTodos.some((t) => t.frog) ? `<div class="small muted" style="margin-bottom:6px">💡 🐸を押して「今日いちばん大事なこと」を1つ選ぶと集中しやすくなります</div>` : ''}
    ${openTodos.map(todoRow).join('')}
    ${doneTodos.map(todoRow).join('')}
    ${!openTodos.length && !doneTodos.length ? '<div class="empty small">やることを書き出すだけで、頭がすっきりします</div>' : ''}
  </section>`;
}

/* ---------- render: habits ---------- */
const TEMPLATES = [
  { emoji: '📚', name: '本を読む', identity: '読書家', cue: '夜ベッドに入ったら', tiny: '1ページだけ読む' },
  { emoji: '🏃', name: '運動する', identity: '体を大切にする人', cue: '仕事から帰ったら', tiny: '靴をはいて外に出る' },
  { emoji: '💧', name: '水を飲む', identity: '健康的な人', cue: '朝起きたら', tiny: 'コップ1杯の水' },
  { emoji: '🧘', name: '瞑想する', identity: '落ち着いた人', cue: '歯をみがいたあと', tiny: '深呼吸を3回' },
  { emoji: '✍️', name: '日記を書く', identity: '自分を知る人', cue: '夕食のあと', tiny: '1行だけ書く' },
  { emoji: '🇬🇧', name: '英語を勉強する', identity: '英語を話せる人', cue: '通勤電車に乗ったら', tiny: '単語を1つ覚える' },
  { emoji: '🧹', name: '片づける', identity: '整った暮らしをする人', cue: '朝コーヒーを淹れる間に', tiny: '1つだけ元に戻す' },
  { emoji: '😴', name: '早く寝る', identity: '睡眠を大事にする人', cue: '23時になったら', tiny: 'スマホを置く' },
];

function renderHabits() {
  const hs = activeHabits();
  const archived = S.habits.filter((h) => h.archived);
  return `
  <section class="card">
    <h2>🔁 習慣 <span class="sub">${hs.length}件</span></h2>
    ${hs.length ? hs.map((h) => {
      const { streak } = streakOf(h);
      return `<div class="habit">
        <div class="emo">${esc(h.emoji)}</div>
        <div class="body">
          <div class="name">${esc(h.name)}</div>
          ${h.identity ? `<div class="cue">🪪 ${esc(h.identity)}になる</div>` : ''}
          ${h.cue ? `<div class="cue">📍 ${esc(h.cue)}</div>` : ''}
          ${h.tiny ? `<div class="cue">🐣 ${esc(h.tiny)}</div>` : ''}
          <div class="meta muted">${h.days.length === 7 ? '毎日' : h.days.slice().sort().map((d) => WD[d]).join('・')} ・ 🔥${streak} ・ 通算${totalOf(h)}回</div>
        </div>
        <div class="actions"><button class="ghost" data-act="edithabit" data-id="${h.id}">編集</button></div>
      </div>`;
    }).join('') : '<div class="empty">まだ習慣がありません。下のテンプレートから選ぶか、自分で作ってみましょう。</div>'}
    <button class="primary" data-act="newhabit" style="width:100%;margin-top:4px">＋ 新しい習慣</button>
  </section>

  <section class="card">
    <h2>💡 テンプレートから始める</h2>
    <div class="small muted">ポイントは「ばかばかしいほど小さく」始めること。続けば自然と大きくなります。</div>
    <div class="templates">
      ${TEMPLATES.map((t, i) => `<button data-act="template" data-i="${i}"><b>${t.emoji} ${t.name}</b><small>${t.cue} → ${t.tiny}</small></button>`).join('')}
    </div>
  </section>

  ${archived.length ? `<section class="card">
    <h2>🗄️ アーカイブ</h2>
    ${archived.map((h) => `<div class="todo"><span class="txt">${esc(h.emoji)} ${esc(h.name)}（通算${totalOf(h)}回）</span>
      <button class="ghost" data-act="restore" data-id="${h.id}">戻す</button></div>`).join('')}
  </section>` : ''}

  ${notifyCard()}

  <section class="card">
    <h2>⚙️ データ</h2>
    <div class="small muted" style="margin-bottom:10px">データはこのブラウザ内に保存されています。機種変更やバックアップにはエクスポートを使ってください。</div>
    <div class="row" style="flex-wrap:wrap">
      <button class="ghost" data-act="export">📤 エクスポート</button>
      <button class="ghost" data-act="import">📥 インポート</button>
      <span class="spacer"></span>
      <button class="ghost danger" data-act="reset">全データ削除</button>
    </div>
    <input type="file" id="importFile" accept="application/json" hidden>
  </section>`;
}

/* ---------- render: growth ---------- */
function heatLevel(n) { return n === 0 ? '' : n <= 1 ? 'l1' : n <= 3 ? 'l2' : n <= 5 ? 'l3' : 'l4'; }

function renderGrowth() {
  const today = new Date();
  const tk = dkey(today);
  const tw = totalWins();
  const L = levelInfo(S.xp);

  // 週ごとの勝利数（月曜始まり）
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const start = addDays(monday, -7 * w);
    let n = 0;
    for (let i = 0; i < 7; i++) n += winsOn(dkey(addDays(start, i)));
    weeks.push({ start, n, cur: w === 0 });
  }
  const thisW = weeks[7].n, lastW = weeks[6].n;
  // 今週は「同じ曜日まで」で先週と比べる（フェアな比較）
  const dayIdx = (today.getDay() + 6) % 7;
  let lastSame = 0;
  for (let i = 0; i <= dayIdx; i++) lastSame += winsOn(dkey(addDays(monday, i - 7)));
  const diff = thisW - lastSame;
  const maxW = Math.max(1, ...weeks.map((w) => w.n));

  // ヒートマップ（20週）
  const startHeat = addDays(today, -today.getDay() - 7 * 19);
  let cells = '';
  for (let i = 0; i < 140; i++) {
    const d = addDays(startHeat, i);
    const k = dkey(d);
    if (k > tk) { cells += '<i class="future"></i>'; continue; }
    const n = winsOn(k);
    cells += `<i class="${heatLevel(n)} ${k === tk ? 'today' : ''}" title="${k}：${n}勝"></i>`;
  }
  let activeDays = 0;
  for (const k of new Set([...Object.keys(S.logs), ...S.todos.filter((t) => t.done).map((t) => t.doneAt)])) if (winsOn(k) > 0) activeDays++;

  const bestAll = Math.max(0, ...activeHabits().map(bestOf));

  const habitStats = activeHabits().map((h) => {
    const { streak } = streakOf(h);
    const best = bestOf(h);
    const total = totalOf(h);
    let dots = '', sched = 0, done = 0;
    for (let i = 27; i >= 0; i--) {
      const d = addDays(today, -i), k = dkey(d), l = logOf(h, k);
      if (k < h.createdAt) { dots += '<i class="off"></i>'; continue; }
      if (isSched(h, d) && k !== tk) sched++;
      if (l && k !== tk) done++;
      dots += `<i class="${l ? (l.type === 'tiny' ? 't' : 'on') : (isSched(h, d) ? '' : 'off')}" title="${k}"></i>`;
    }
    const rate = sched ? Math.min(100, Math.round((done / sched) * 100)) : null;
    const auto = Math.min(100, (total / AUTOMATIC_DAYS) * 100);
    return `<div class="hstat">
      <div class="top">${esc(h.emoji)} ${esc(h.name)} <span class="r">🔥${streak}（最高${best}）・通算${total}回${rate !== null ? `・達成率${rate}%` : ''}</span></div>
      <div class="dots">${dots}</div>
      <div class="small muted">🧠 自動化まで ${total}/${AUTOMATIC_DAYS}</div>
      <div class="bar"><i style="width:${auto}%"></i></div>
      ${h.identity && total ? `<div class="vote">🗳️ 「${esc(h.identity)}」に <b>${total}票</b> 投じました</div>` : ''}
    </div>`;
  }).join('');

  const habitBadges = [];
  activeHabits().forEach((h) => {
    HABIT_MILESTONES.forEach(([at, icon, title]) => {
      if (S.awarded[`h:${h.id}:${at}`]) habitBadges.push(`<div class="badge"><span class="i">${icon}</span>${esc(h.emoji)}${title.replace('達成！', '')}</div>`);
    });
  });

  return `
  <section class="card">
    <h2>📈 あなたの成長</h2>
    <div class="stats">
      <div class="stat"><div class="v">${tw}</div><div class="k">通算の小さな勝利</div></div>
      <div class="stat"><div class="v">Lv.${L.lv}</div><div class="k">${L.title}（${S.xp}XP）</div></div>
      <div class="stat"><div class="v">${activeDays}日</div><div class="k">行動した日数</div></div>
      <div class="stat"><div class="v">${thisW}</div><div class="k">今週の勝利 ${diff > 0 ? `<span class="up">▲${diff}</span>` : diff < 0 ? `<span class="down">先週同日比 ${diff}</span>` : '<span class="down">先週並み</span>'}</div></div>
    </div>
    ${bestAll ? `<div class="small muted" style="margin-top:10px">🏔️ 自己ベスト連続記録：${bestAll}回</div>` : ''}
  </section>

  <section class="card">
    <h2>🗓️ 積み上げカレンダー <span class="sub">過去20週</span></h2>
    <div class="heat-wrap"><div class="heatmap">${cells}</div></div>
    <div class="legend">少 <i style="background:var(--heat0)"></i><i style="background:var(--heat1)"></i><i style="background:var(--heat2)"></i><i style="background:var(--heat3)"></i><i style="background:var(--heat4)"></i> 多</div>
  </section>

  <section class="card">
    <h2>📊 週ごとの勝利数 <span class="sub">比べる相手は過去の自分だけ</span></h2>
    <div class="bars">
      ${weeks.map((w) => `<div class="col ${w.cur ? 'cur' : ''}"><div class="b" style="height:${(w.n / maxW) * 100}%"><em>${w.n}</em></div><div class="lbl">${w.cur ? '今週' : `${w.start.getMonth() + 1}/${w.start.getDate()}`}</div></div>`).join('')}
    </div>
  </section>

  ${habitStats ? `<section class="card"><h2>🔁 習慣ごとの記録</h2>
    <div class="small muted">● 完了　<span style="color:var(--primary)">●</span> 2分だけ　○ 予定外</div>
    ${habitStats}</section>` : ''}

  <section class="card">
    <h2>🏅 バッジ</h2>
    <div class="badges">
      ${GLOBAL_BADGES.map(([at, icon, name]) => `<div class="badge ${tw >= at ? '' : 'locked'}"><span class="i">${icon}</span>${name}</div>`).join('')}
      ${habitBadges.join('')}
    </div>
  </section>`;
}

/* ---------- render: reflect ---------- */
const MOODS = ['😫', '😕', '😐', '🙂', '😄'];
const PSY = [
  ['🐣 タイニー・ハビット（BJ・フォッグ）', '行動 = 動機 × 能力 × きっかけ。やる気に頼らず「2分だけ版」でハードルを下げれば、やる気が低い日でも行動が起きます。2分版でも連続記録はつながります。'],
  ['📍 If-Thenプランニング（ゴルヴィツァー）', '「〜したら、〜する」と状況と行動をセットで決めると、実行率が大きく高まることが多数の研究で示されています。習慣ごとに「きっかけ」を設定できます。'],
  ['🪪 アイデンティティ投票（ジェームズ・クリア）', '行動のたびに「なりたい自分」へ1票が入ります。「本を読む」ではなく「読書家である」という自己像が、長期的な継続を支えます。'],
  ['⭐ スモールウィン / 進捗の法則（アマビール）', '人は「前に進んでいる」と感じた日に最もやる気が高まります。TODOも習慣もすべて「小さな勝利」としてカウントし、⭐と植物の成長で見える化しています。'],
  ['🔥 2日連続で休まない（What-the-hell効果の防止）', '連続記録が1回途切れると「もうどうでもいい」と全部やめてしまいがち。1日休んでも記録は消えず、2日連続で休んだときだけリセットされます。'],
  ['✨ 変動報酬（スキナー）', 'ごほうびが予測できないほど行動は強化されます。チェックすると一定確率でXPが2倍になる「ラッキーボーナス」が発生します。'],
  ['📈 目標勾配効果', 'ゴールが近づくほど人は加速します。レベルや植物の次の段階まで「あと何XP・何勝」を常に表示しています。'],
  ['🎁 授かり効果（エンダウド・プログレス）', '最初から少し進んでいると、人は完了まで頑張りやすくなります。初回起動時にボーナスXPを付与しています。'],
  ['🌅 フレッシュスタート効果（ダイ他）', '週はじめ・月はじめ・久しぶりの再開は、新しい自分を始めやすいタイミング。その日にはメッセージでそっと背中を押します。'],
  ['🧠 66日の自動化（ラリー他）', '新しい行動が自動化されるまで平均66日（個人差は18〜254日）。進捗バーで「習慣になるまであとどれくらいか」を表示します。'],
  ['🐸 カエルを食べろ（最重要タスク）', '1日1つだけ最重要タスクを選ぶことで、選択の負担を減らし集中できます。'],
  ['📝 スリー・グッド・シングス（セリグマン）', '今日よかったことを書き出す習慣は、幸福感を高めることが研究で示されています。気分の記録と合わせて自分の変化に気づけます。'],
  ['🤝 セルフ・コンパッション（ネフ）', '休んだ日に自分を責めると継続率は下がります。アプリは「おかえり」と迎え、休みを責めない言葉を使っています。'],
  ['🪞 過去の自分との比較（時間的比較）', '他人と比べるより過去の自分と比べるほうが、モチベーションと自己効力感が高まります。他人のランキングは置かず、週ごとの推移だけを見せています。'],
];

let draftMood = null;
function renderReflect() {
  const k = todayKey();
  const j = S.journal[k] || {};
  const mood = draftMood ?? j.mood ?? null;
  const entries = Object.entries(S.journal).filter(([d]) => d !== k).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30);
  return `
  <section class="card">
    <h2>📝 今日のふりかえり</h2>
    <div class="small muted" style="margin-bottom:8px">今日の気分は？</div>
    <div class="moods">${MOODS.map((m, i) => `<button data-act="mood" data-i="${i}" class="${mood === i ? 'on' : ''}">${m}</button>`).join('')}</div>
    <textarea id="journalText" rows="4" placeholder="今日よかったこと・できたことを3つ書いてみよう&#10;例）朝、時間どおりに起きられた">${esc(j.text || '')}</textarea>
    <div class="row" style="margin-top:10px">
      <span class="small muted">今日の勝利：${winsOn(k)}件</span><span class="spacer"></span>
      <button class="primary" data-act="savejournal">保存</button>
    </div>
  </section>

  <section class="card">
    <h2>📚 これまでの記録</h2>
    ${entries.length ? entries.map(([d, e]) => `<div class="entry">
      <div class="d">${d}（${WD[parseKey(d).getDay()]}）${e.mood != null ? MOODS[e.mood] : ''} ・ ${winsOn(d)}勝</div>
      ${e.text ? `<p>${esc(e.text)}</p>` : ''}</div>`).join('') : '<div class="empty small">ふりかえりを続けると、ここに積み重なっていきます</div>'}
  </section>

  <section class="card">
    <h2>🧪 このアプリに組み込まれた心理学</h2>
    ${PSY.map(([t, d]) => `<details class="psy"><summary>${t}</summary><p>${d}</p></details>`).join('')}
  </section>`;
}

/* ---------- main render ---------- */
function render() {
  renderTop();
  const v = $('#view');
  v.innerHTML = tab === 'today' ? renderToday() : tab === 'habits' ? renderHabits() : tab === 'growth' ? renderGrowth() : renderReflect();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const tf = $('#todoForm');
  if (tf) tf.addEventListener('submit', (e) => { e.preventDefault(); addTodo($('#todoInput').value); });
}

/* ---------- habit dialog ---------- */
const dlg = $('#habitDialog');
const form = $('#habitForm');
const fe = (n) => form.elements.namedItem(n);
$('#dayPicker').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="day" value="${d}"><span>${WD[d]}</span></label>`).join('');

function openHabit(h = null, tpl = null) {
  form.reset();
  const src = h || tpl || {};
  fe('id').value = h ? h.id : '';
  fe('emoji').value = src.emoji || '✅';
  fe('name').value = src.name || '';
  fe('identity').value = src.identity || '';
  fe('cue').value = src.cue || '';
  fe('tiny').value = src.tiny || '';
  fe('reward').value = src.reward || '';
  fe('remindAt').value = src.remindAt || '';
  const days = h ? h.days : [0, 1, 2, 3, 4, 5, 6];
  form.querySelectorAll('input[name=day]').forEach((c) => { c.checked = days.includes(Number(c.value)); });
  $('#habitDialogTitle').textContent = h ? '習慣を編集' : '新しい習慣';
  $('#archiveHabit').hidden = !h;
  dlg.showModal();
}
form.addEventListener('submit', (e) => {
  const days = [...form.querySelectorAll('input[name=day]:checked')].map((c) => Number(c.value));
  if (!days.length) { e.preventDefault(); toast('曜日を1つ以上選んでください'); return; }
  const data = {
    emoji: fe('emoji').value.trim() || '✅', name: fe('name').value.trim(), identity: fe('identity').value.trim(),
    cue: fe('cue').value.trim(), tiny: fe('tiny').value.trim(), reward: fe('reward').value.trim(), remindAt: fe('remindAt').value, days,
  };
  if (!data.name) { e.preventDefault(); return; }
  const id = fe('id').value;
  if (id) Object.assign(S.habits.find((h) => h.id === id), data);
  else {
    S.habits.push({ id: uid(), createdAt: todayKey(), archived: false, ...data });
    toast(`🌱 「${esc(data.name)}」をはじめました。まずは小さく！`);
  }
  save(); render();
});
$('#cancelHabit').addEventListener('click', () => dlg.close());
$('#archiveHabit').addEventListener('click', () => {
  const h = S.habits.find((x) => x.id === fe('id').value);
  if (h && confirm(`「${h.name}」をアーカイブしますか？（記録は残ります）`)) {
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

$('#view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  switch (act) {
    case 'habit': toggleHabit(id, b.dataset.type); break;
    case 'todo': toggleTodo(id); break;
    case 'frog': frogTodo(id); break;
    case 'deltodo': deleteTodo(id); break;
    case 'newhabit': openHabit(); break;
    case 'edithabit': openHabit(S.habits.find((h) => h.id === id)); break;
    case 'template': openHabit(null, TEMPLATES[Number(b.dataset.i)]); break;
    case 'restore': { const h = S.habits.find((x) => x.id === id); if (h) { h.archived = false; save(); render(); } break; }
    case 'mood': draftMood = Number(b.dataset.i); {
      const txt = $('#journalText').value; render(); $('#journalText').value = txt;
    } break;
    case 'savejournal': saveJournal(); break;
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'notifyon': enableNotify(); break;
    case 'notifyoff': S.settings.notify = false; save(); render(); toast('🔕 通知をオフにしました'); break;
    case 'testnotify': testNotify(); break;
    case 'install': promptInstall(); break;
    case 'ics': exportICS(); break;
    case 'reset':
      if (confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) {
        localStorage.removeItem(STORE); S = defaultState(); save(); render(); toast('リセットしました');
      }
      break;
  }
});

$('#view').addEventListener('change', (e) => {
  if (e.target.id === 'journalAt') {
    S.settings.journalAt = e.target.value; save();
    toast(e.target.value ? `📝 ${e.target.value} にふりかえりをお知らせします` : 'ふりかえり通知をオフにしました');
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
      if (!confirm('現在のデータを上書きしてインポートしますか？')) return;
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
  S.journal[k] = { mood, text, xp: prev.xp || 0 };
  if (!prev.xp) S.journal[k].xp = gainXP(XP.journal, '📝 ふりかえり完了！');
  else toast('保存しました');
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
let toastTimer;
function toast(html) {
  const t = $('#toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function celebrate(icon, title, text) {
  $('#celebrateIcon').textContent = icon;
  $('#celebrateTitle').innerHTML = title;
  $('#celebrateText').innerHTML = text;
  const c = $('#celebrate');
  if (!c.open) c.showModal();
}
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

// Service Worker が読む「今日のリマインダー情報」を作る
function reminderConfig() {
  const k = todayKey(), d = new Date();
  const hs = activeHabits();
  return {
    enabled: !!S.settings.notify,
    date: k,
    journalAt: S.settings.journalAt || '',
    journalDone: !!S.journal[k],
    winsToday: winsOn(k),
    undone: hs.filter((h) => isSched(h, d) && !logOf(h, k)).length,
    habits: hs.filter((h) => h.remindAt).map((h) => {
      const { streak, risk } = streakOf(h);
      return { id: h.id, name: h.name, emoji: h.emoji, cue: h.cue, tiny: h.tiny, remindAt: h.remindAt, days: h.days, createdAt: h.createdAt, done: !!logOf(h, k), streak, risk };
    }),
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
  const opts = { body: '📍 こんなふうに、決めた時刻にお知らせします。\n🐣 2分だけでもOK！', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'test' };
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

function notifyCard() {
  const perm = canNotify ? Notification.permission : 'unsupported';
  const on = S.settings.notify && perm === 'granted';
  const status = !canNotify ? (isIOS ? 'iPhoneではホーム画面に追加したアプリからのみ使えます' : 'このブラウザは通知に対応していません')
    : !canSW ? 'http(s)で開いたときに使えます（ファイルを直接開いた場合は不可）'
      : perm === 'denied' ? 'ブラウザで通知がブロックされています。サイトの設定から許可してください'
        : on ? `オン（時刻を設定した習慣 ${activeHabits().filter((h) => h.remindAt).length}件）` : 'オフ';
  const disabled = !canNotify || !canSW || perm === 'denied';
  const install = isStandalone() ? '✅ アプリとしてインストール済みです'
    : installEvt ? '<button class="primary" data-act="install">📲 ホーム画面に追加</button>'
      : isIOS ? 'Safariの共有ボタン <b>⬆️</b> →「ホーム画面に追加」でアプリとして使えます'
        : 'ブラウザのメニューから「アプリをインストール」/「ホーム画面に追加」を選ぶとアプリとして使えます';
  return `<section class="card">
    <h2>🔔 通知とアプリ</h2>
    <div class="setting">
      <div><b>リマインダー通知</b><div class="small muted">${status}</div></div>
      ${on ? '<button class="ghost" data-act="notifyoff">オフにする</button>'
        : `<button class="primary" data-act="notifyon" ${disabled ? 'disabled' : ''}>オンにする</button>`}
    </div>
    <div class="setting">
      <div><b>📝 ふりかえりの時刻</b><div class="small muted">今日の勝利数と、残っている習慣をお知らせ</div></div>
      <input type="time" id="journalAt" value="${esc(S.settings.journalAt || '')}">
    </div>
    <div class="small muted" style="margin-top:8px">⏰ 習慣ごとの時刻は、各習慣の「編集」で設定できます。通知の「やった！」ボタンでそのまま記録できます。</div>
    <div class="row" style="flex-wrap:wrap;margin-top:10px">
      ${on ? '<button class="ghost" data-act="testnotify">🔔 テスト通知</button>' : ''}
      <button class="ghost" data-act="ics">📅 カレンダーに登録（.ics）</button>
    </div>
    <div class="small muted note">💡 アプリを閉じている間の通知は、ブラウザや端末の省電力設定により遅れたり届かないことがあります。
      確実に通知したい場合は「📅 カレンダーに登録」で、スマホのカレンダーにリマインダーを入れておくのがおすすめです。</div>
    <hr>
    <div class="small">${install}</div>
  </section>`;
}

// 端末のカレンダーに「繰り返しリマインダー」として登録できる .ics を作る
function exportICS() {
  const hs = activeHabits().filter((h) => h.remindAt);
  if (!hs.length && !S.settings.journalAt) { toast('習慣の「編集」で時刻を設定してください'); return; }
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
    `${h.cue ? `📍 ${h.cue} → ${h.name}\n` : ''}🐣 気が乗らなければ「${h.tiny || '2分だけ'}」でもOK\n${h.identity ? `🪪 「${h.identity}」への1票を入れよう\n` : ''}✅ 終わったら「つづく」でチェック！`));
  if (S.settings.journalAt) events.push(ev('journal', S.settings.journalAt, [0, 1, 2, 3, 4, 5, 6], '📝 つづく：今日のふりかえり', '今日の小さな勝利を数えて、よかったことを1行書こう'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tsuzuku//habit//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:つづく 習慣リマインダー', ...events, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'tsuzuku-reminders.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('📅 .icsを書き出しました。開くとカレンダーに追加できます');
}

// 通知のボタンやショートカットから開かれたときの処理
function handleParams(qs) {
  const p = new URLSearchParams(qs);
  if (p.get('act') === 'habit') {
    const id = p.get('id'), type = p.get('type') === 'tiny' ? 'tiny' : 'full';
    const h = S.habits.find((x) => x.id === id);
    tab = 'today';
    if (h && !logOf(h, todayKey())) toggleHabit(id, type); else render();
  } else if (['today', 'habits', 'growth', 'reflect'].includes(p.get('tab'))) {
    tab = p.get('tab'); render();
  }
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (tab === 'habits') render(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('🎉 ホーム画面に追加しました'); render(); });

if (canSW) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    return navigator.serviceWorker.ready;
  }).then((reg) => {
    swReg = reg; syncReminders();
    if (S.settings.notify) registerPeriodic();
  }).catch(() => { /* noop */ });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open') handleParams(e.data.params);
  });
}
// アプリを開いている間は1分ごとにリマインダーを確認
setInterval(pingSW, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncReminders(); });

/* ---------- boot ---------- */
render();
if (location.search) { handleParams(location.search); history.replaceState(null, '', location.pathname); }
S.lastOpen = todayKey();
firstLaunch = false;
save();

// 日付が変わったら自動で再描画
let lastDay = todayKey();
setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); S.lastOpen = lastDay; save(); render(); } }, 60000);
