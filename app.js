'use strict';
/* =========================================================
 * つづく. — 習慣化 & TODO（成長・達成・記録更新に振り切ったデザイン）
 *   EXP / レベル / ランク、デイリーミッション、自己ベスト、実績、
 *   VS 先週の自分、シールド（連続記録の保護）
 *   データはブラウザの localStorage に保存されます。
 * ========================================================= */

const STORE = 'tsuzuku-v1';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const AUTOMATIC = 66;    // Lally et al. (2010) 習慣が自動化するまでの平均日数
const MAX_SHIELDS = 3;   // シールドの上限
const CRIT_RATE = 0.15;  // 変動報酬：クリティカル（EXP 2倍）の確率
const EXP = { habit: 10, todo: 5, star: 10 };

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
    version: 3,
    createdAt: dkey(),
    lastOpen: null,
    habits: [],     // { id, emoji, name, cue, tiny, identity, reward, remindAt, days, createdAt, archived }
    logs: {},       // { 'YYYY-MM-DD': { habitId: { type, xp } } }
    todos: [],      // { id, text, frog, done, doneAt, createdAt, xp }
    journal: {},    // { 'YYYY-MM-DD': { mood, text } }
    awarded: {},    // 1回きりのごほうび済みフラグ
    exp: 0,
    bestStreak: 0,
    tickets: 0,     // シールド枚数
    frozen: {},     // シールドで守った日
    lastProcessed: null,
    ticketNote: null,
    settings: { notify: false, journalAt: '21:00', skipOnb: false },
  };
}
function hydrate(obj) {
  const fresh = obj.exp == null;
  const st = Object.assign(defaultState(), obj);
  st.settings = Object.assign(defaultState().settings, obj.settings || {});
  if (fresh) { // 旧バージョンからの引き継ぎ：これまでの記録からEXPを算出
    let n = 0;
    for (const k in st.logs) n += Object.keys(st.logs[k]).length * EXP.habit;
    n += st.todos.filter((t) => t.done).length * EXP.todo;
    st.exp = n; st.migratedOn = dkey();
  }
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
let onb = null;
let logMonth = 0;
let draftMood = null;

/* ---------- content ---------- */
const TEMPLATES = [
  { emoji: '💪', name: '筋トレ', cue: '帰宅したら', tiny: '腕立て1回', identity: '鍛えている男' },
  { emoji: '🏃', name: 'ランニング', cue: '朝起きたら', tiny: 'ウェアに着替える', identity: '走れる体' },
  { emoji: '📚', name: '読書', cue: '寝る前', tiny: '1ページだけ', identity: '知識で勝つ人' },
  { emoji: '🗣️', name: '英語', cue: '通勤・通学中', tiny: '単語を1つ', identity: '英語で戦える人' },
  { emoji: '💻', name: '勉強・資格', cue: '夕食のあと', tiny: '問題を1問', identity: '資格を取る人' },
  { emoji: '💧', name: '水を飲む', cue: '朝起きたら', tiny: 'コップ1杯', identity: 'コンディションを整える人' },
  { emoji: '🧘', name: '瞑想', cue: '歯みがきのあと', tiny: '深呼吸3回', identity: 'ブレない人' },
  { emoji: '😴', name: '早く寝る', cue: '23時になったら', tiny: 'スマホを置く', identity: '睡眠を制する人' },
];
const CUES = ['朝起きたら', '朝ごはんのあと', '歯みがきのあと', '通勤・通学中', '昼休み', '帰宅したら', '夕食のあと', 'お風呂のあと', '寝る前'];

// ランク（レベルで昇格）
const RANKS = [
  [1, 'E', 'ルーキー'], [5, 'D', 'チャレンジャー'], [10, 'C', 'ファイター'], [18, 'B', 'エキスパート'],
  [28, 'A', 'マスター'], [40, 'S', 'レジェンド'], [60, 'SS', 'アンストッパブル'],
];
function levelInfo(exp) {
  let lv = 1, acc = 0, need = 100;
  while (exp >= acc + need) { acc += need; lv++; need = 100 + (lv - 1) * 20; }
  let r = RANKS[0];
  for (const x of RANKS) if (lv >= x[0]) r = x;
  return { lv, cur: exp - acc, need, rank: r[1], title: r[2] };
}

const PRAISE = ['ナイス。', 'いい流れだ。', '積み上げた。', '一歩前進。', 'その調子。', '強い。', '今日も勝った。', '継続は力。'];

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
function perfectDays() { return Object.keys(S.logs).filter(perfectOn).length; }

// 🔥 連続日数：何かひとつでもクリアした日が続いている日数（シールドで守った日はつながる）
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
function computeBest() {
  let d = parseKey(S.createdAt), s = 0, best = 0;
  const tk = todayKey();
  while (dkey(d) <= tk) {
    const k = dkey(d);
    if (winsOn(k) > 0) { s++; best = Math.max(best, s); } else if (!S.frozen[k] && k !== tk) s = 0;
    d = addDays(d, 1);
  }
  return best;
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
// 🛡️ 休んだ日があれば、シールドで足りる場合だけ自動で使って連続記録を守る
function processShields() {
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
function gainExp(base, canCrit = true) {
  const before = levelInfo(S.exp);
  const crit = canCrit && Math.random() < CRIT_RATE;
  const amt = crit ? base * 2 : base;
  S.exp += amt;
  const after = levelInfo(S.exp);
  if (after.lv > before.lv) {
    const rankUp = after.rank !== before.rank;
    celebrate(rankUp ? '🏆' : '⚡', rankUp ? `RANK UP!  ${after.rank}` : `LEVEL UP!  LV.${after.lv}`,
      rankUp ? `ランク「${after.title}」に昇格。<br>積み上げた分だけ、確実に強くなっている。`
        : `LV.${after.lv} 到達。次のレベルまで ${after.need} EXP。`);
    confetti(rankUp ? 200 : 120);
  }
  return { amt, crit };
}
const expTag = ({ amt, crit }) => ` <b class="exp">+${amt} EXP</b>${crit ? ' <span class="crit">CRITICAL!</span>' : ''}`;

function missions() {
  const k = todayKey(), p = todayProgress();
  const todosDone = S.todos.filter((t) => t.done && t.doneAt === k).length;
  return [
    { id: 'all', name: '今日の習慣をすべてクリア', done: p.sched > 0 && p.done === p.sched, exp: 30, prog: `${p.done}/${p.sched}`, hide: p.sched === 0 },
    { id: 'todo3', name: 'やることを3件片づける', done: todosDone >= 3, exp: 15, prog: `${Math.min(3, todosDone)}/3` },
    { id: 'log', name: 'ひとこと日誌を書く', done: !!S.journal[k], exp: 10, prog: S.journal[k] ? '1/1' : '0/1' },
  ].filter((m) => !m.hide);
}
function checkMissions() {
  const k = todayKey();
  for (const m of missions()) {
    const key = `m:${k}:${m.id}`;
    if (m.done && !S.awarded[key]) {
      S.awarded[key] = true;
      const r = gainExp(m.exp, false);
      toast(`🎯 MISSION CLEAR：${m.name}${expTag(r)}`);
      if (missions().every((x) => S.awarded[`m:${k}:${x.id}`])) {
        celebrate('🎯', 'ALL MISSIONS CLEAR', '今日のミッションを全部達成。完全勝利だ。');
      }
    }
  }
}

const ACHIEVEMENTS = [
  ['first', '🎯', '初陣', '初めてクリア', 1, (c) => c.total >= 1],
  ['t10', '🥉', '10クリア', '通算10回', 1, (c) => c.total >= 10],
  ['t50', '🥈', '50クリア', '通算50回', 2, (c) => c.total >= 50],
  ['t100', '🥇', '100クリア', '通算100回', 2, (c) => c.total >= 100],
  ['t300', '💎', '300クリア', '通算300回', 3, (c) => c.total >= 300],
  ['t1000', '👑', '1000クリア', '通算1000回', 3, (c) => c.total >= 1000],
  ['s3', '🔥', '3日連続', '連続3日', 1, (c) => c.best >= 3],
  ['s7', '🔥', '1週間', '連続7日', 1, (c) => c.best >= 7],
  ['s14', '🔥', '2週間', '連続14日', 2, (c) => c.best >= 14],
  ['s30', '🚀', '1か月', '連続30日', 2, (c) => c.best >= 30],
  ['s66', '🧠', '自動化', '連続66日', 3, (c) => c.best >= 66],
  ['s100', '🗻', '100日', '連続100日', 3, (c) => c.best >= 100],
  ['p1', '⭐', 'パーフェクト', '全習慣クリアの日', 1, (c) => c.perfect >= 1],
  ['p10', '🌟', 'パーフェクト×10', '全クリア10日', 2, (c) => c.perfect >= 10],
  ['p30', '✨', 'パーフェクト×30', '全クリア30日', 3, (c) => c.perfect >= 30],
  ['d10', '🗡️', 'タスクハンター', 'やること10件', 1, (c) => c.todos >= 10],
  ['d50', '⚔️', 'タスクスレイヤー', 'やること50件', 2, (c) => c.todos >= 50],
  ['d200', '🐉', 'タスクキング', 'やること200件', 3, (c) => c.todos >= 200],
  ['sh1', '🛡️', '不屈', 'シールドで記録を守った', 1, (c) => c.shields >= 1],
  ['lv10', '⚡', 'LV.10', 'レベル10到達', 2, (c) => c.lv >= 10],
  ['lv30', '🏆', 'LV.30', 'レベル30到達', 3, (c) => c.lv >= 30],
];
function achCtx() {
  return {
    total: totalWins(), best: Math.max(S.bestStreak, dayStreak()), perfect: perfectDays(),
    todos: S.todos.filter((t) => t.done).length, shields: Object.keys(S.frozen).length, lv: levelInfo(S.exp).lv,
  };
}
function checkAchievements(silent) {
  const c = achCtx();
  for (const [id, icon, name, desc, , test] of ACHIEVEMENTS) {
    if (!S.awarded[`a:${id}`] && test(c)) {
      S.awarded[`a:${id}`] = true;
      if (!silent) celebrate(icon, `実績解除：${name}`, desc);
    }
  }
}

const HABIT_MILESTONES = [
  [1, '🎯', '初クリア', 'はじめるのが一番むずかしい。もう突破した。'],
  [7, '🔥', '7回クリア', 'リズムができはじめている。'],
  [21, '🥉', '21回クリア', '「やるのが当たり前」になってきた。'],
  [30, '🥈', '30回クリア', 'もう立派な習慣だ。'],
  [AUTOMATIC, '🧠', `${AUTOMATIC}回クリア`, '研究では平均66回で行動は自動化すると言われている。体に刻まれた。'],
  [100, '🥇', '100回クリア', '3ケタの大台。本物だ。'],
  [200, '💎', '200回クリア', 'ここまで来る人間はほとんどいない。'],
  [365, '👑', '365回クリア', '1年分の積み上げ。人生が変わるレベル。'],
];
function checkHabitMilestone(h) {
  const n = totalOf(h);
  for (const [at, icon, title, text] of HABIT_MILESTONES) {
    const key = `h:${h.id}:${at}`;
    if (n >= at && !S.awarded[key]) {
      S.awarded[key] = true;
      celebrate(icon, `${esc(h.emoji)} ${esc(h.name)}：${title}`,
        `${text}${h.identity ? `<br><br>🎯「${esc(h.identity)}」に ${n} ポイント。` : ''}`);
      confetti(120);
      break;
    }
  }
}

// クリア後の共通処理
function afterWin() {
  const k = todayKey();
  const p = todayProgress();
  if (p.sched > 0 && p.done === p.sched && !S.awarded[`perfect:${k}`]) {
    S.awarded[`perfect:${k}`] = true;
    celebrate('⭐', 'PERFECT DAY', '今日の習慣をすべてクリア。<br>この1日は、完全勝利だ。');
    confetti(180);
  }
  const st = dayStreak();
  if (st > S.bestStreak) {
    const prev = S.bestStreak;
    S.bestStreak = st;
    if (prev >= 3 && !S.awarded[`pr:${k}`]) {
      S.awarded[`pr:${k}`] = true;
      celebrate('🏆', `自己ベスト更新！ ${st}日連続`, `これまでの記録は${prev}日。<br>過去の自分を超えた。`);
    }
  }
  if (st > 0 && st % 7 === 0 && !S.awarded[`ticket:${k}`]) {
    S.awarded[`ticket:${k}`] = true;
    if (S.tickets < MAX_SHIELDS) {
      S.tickets++;
      celebrate('🛡️', `${st}日連続！ シールド獲得`, 'サボってしまった日に自動で発動し、🔥連続記録を守る。<br>（7日連続ごとに1枚・最大3枚）');
    }
  }
  checkMissions();
  checkAchievements(false);
}

/* ---------- actions ---------- */
function toggleHabit(id, type = 'full') {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  const k = todayKey();
  S.logs[k] = S.logs[k] || {};
  const cur = S.logs[k][id];
  if (cur) {
    S.exp = Math.max(0, S.exp - (cur.xp ?? EXP.habit));
    delete S.logs[k][id];
    if (!Object.keys(S.logs[k]).length) delete S.logs[k];
    toast('取り消した');
    save(); render();
    return;
  }
  const r = gainExp(EXP.habit);
  S.logs[k][id] = { type, xp: r.amt };
  const p = todayProgress(), rem = p.sched - p.done;
  toast(`${esc(h.emoji)} ${pick(PRAISE)}${expTag(r)}${rem === 1 ? '<br>残り1つでパーフェクト' : ''}`);
  confetti(r.crit ? 90 : 40);
  checkHabitMilestone(h);
  afterWin();
  if (h.reward) toast(`🎁 ごほうび：${esc(h.reward)}`);
  save(); render(); popRing();
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
  if (t.done) { t.done = false; t.doneAt = null; S.exp = Math.max(0, S.exp - (t.xp || 0)); t.xp = 0; save(); render(); return; }
  t.done = true; t.doneAt = todayKey();
  const r = gainExp(t.frog ? EXP.star : EXP.todo);
  t.xp = r.amt;
  toast(`${t.frog ? '★ 最重要タスク撃破。' : `✔ ${pick(PRAISE)}`}${expTag(r)}`);
  confetti(t.frog ? 80 : 30);
  afterWin();
  save(); render(); popRing();
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
function renderTop() { $('#ticketBadge').textContent = `🛡️ ${S.tickets}`; }

/* ---------- render: onboarding ---------- */
function renderOnboarding() {
  const dots = (n) => `<div class="dots">${[1, 2, 3].map((i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  const first = !activeHabits().length && !totalWins();
  if (!onb || onb.step === 1) {
    return `<section class="card onb">
      ${dots(1)}
      ${first ? `<div class="label">LV.1 / RANK E</div><h2>ここから、積み上げが始まる</h2>
        <p class="muted">毎日クリアするたびにEXPが貯まり、レベルとランクが上がっていく。</p>` : '<h2>新しい習慣</h2>'}
      <h2 style="font-size:17px">鍛えたいことを、まず1つ選べ</h2>
      <div class="templates">${TEMPLATES.map((t, i) => `<button data-act="onb-tpl" data-i="${i}"><span>${t.emoji}</span>${t.name}</button>`).join('')}</div>
      <form id="onbCustom" class="todo-add"><input name="t" placeholder="自分で書く（例：ギター）" autocomplete="off"><button class="primary">次へ</button></form>
      ${first ? '<button class="linkbtn" data-act="onb-skip">習慣はあとで（やることリストだけ使う）</button>'
        : '<button class="linkbtn" data-act="onb-cancel">やめる</button>'}
    </section>`;
  }
  if (onb.step === 2) {
    const chips = [...new Set([onb.cue, ...CUES].filter(Boolean))];
    return `<section class="card onb">
      ${dots(2)}
      <div class="seed" style="font-size:40px">${esc(onb.emoji)}</div>
      <h2>「${esc(onb.name)}」は、いつやる？</h2>
      <p class="muted small">毎日必ずやっている行動の「直後」に固定する。これが実行率を上げる最短ルート。</p>
      <div class="chips">${chips.map((c) => `<button data-act="onb-cue" data-v="${esc(c)}" class="${c === onb.cue ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <form id="onbCueForm" class="todo-add"><input name="t" placeholder="自分で書く（例：コーヒーを淹れたら）" autocomplete="off"><button class="primary">決定</button></form>
      <button class="linkbtn" data-act="onb-back">もどる</button>
    </section>`;
  }
  const h = S.habits.find((x) => x.id === onb.habitId);
  return `<section class="card onb">
    ${dots(3)}
    <div class="label">FIRST MISSION</div>
    <h2>最初の1回、今やろう</h2>
    <div class="try">
      <div class="e">${esc(h.emoji)}</div>
      <b>${esc(h.name)}</b>
      <div class="muted" style="margin-top:6px">最低ライン「${esc(h.tiny || '2分だけ')}」でクリア扱い。<br>ハードルは低くていい。ゼロにしないことが勝ち。</div>
    </div>
    <button class="primary big" data-act="onb-done">クリア！</button>
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
  if (S.migratedOn === t) {
    out += `<div class="banner">⚡ <b>アップデート完了。</b> これまでの記録から <b>${S.exp} EXP</b> を算出し、LV.${levelInfo(S.exp).lv} からスタート。</div>`;
  }
  if (S.ticketNote && S.ticketNote.date === t) {
    out += `<div class="banner warn">🛡️ シールドが${S.ticketNote.n}枚発動。🔥連続記録は守られた。今日クリアしてつなげ。</div>`;
  }
  if (S.welcomeBack === t) out += '<div class="banner">🔄 <b>おかえり。</b> 戻ってきた時点で勝ち。今日は最低ラインを1つだけクリアしよう。</div>';
  else if (d.getDate() === 1) out += '<div class="banner">🗓️ <b>新しい月。</b> 今月の達成率はゼロからスタート。最初の1日を取りにいこう。</div>';
  else if (d.getDay() === 1 && weekScore(-1).days > 0) out += '<div class="banner">🥊 <b>新しい週。</b> <button class="linkbtn" data-act="gotolog" style="padding:0">先週の結果を見る →</button></div>';
  return out;
}

function habitRow(h) {
  const k = todayKey();
  const done = !!logOf(h, k);
  const total = totalOf(h);
  const sub = done ? `✔ CLEAR`
    : [h.cue ? `🕖 ${esc(h.cue)}` : '', h.tiny ? `最低ライン：${esc(h.tiny)}` : ''].filter(Boolean).join('　');
  return `<div class="habit ${done ? 'done' : ''}">
    <button class="tap" data-act="habit" data-id="${h.id}" aria-label="${done ? '取り消す' : 'クリア'}">${done ? '✔' : ''}</button>
    <div class="body" data-act="edithabit" data-id="${h.id}">
      <div class="name">${esc(h.emoji)} ${esc(h.name)}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
    <div class="cnt"><b>${total}</b>回</div>
  </div>`;
}

function todoRow(t) {
  const age = !t.done && t.createdAt < todayKey() ? ` <span class="small muted">${diffDays(t.createdAt, todayKey())}日経過</span>` : '';
  return `<div class="todo ${t.done ? 'done' : ''} ${t.frog && !t.done ? 'star-on' : ''}">
    <button class="check" data-act="todo" data-id="${t.id}" aria-label="完了">${t.done ? '✔' : ''}</button>
    <span class="txt">${esc(t.text)}${age}</span>
    ${t.done ? '' : `<button class="star ${t.frog ? 'on' : ''}" data-act="star" data-id="${t.id}" title="最重要にする">${t.frog ? '★' : '☆'}</button>`}
    <button class="del" data-act="deltodo" data-id="${t.id}" aria-label="削除">✕</button>
  </div>`;
}

function renderToday() {
  if (onb || (!activeHabits().length && !S.settings.skipOnb)) return renderOnboarding();
  const k = todayKey(), d = new Date();
  const p = todayProgress(), rem = p.sched - p.done;
  const L = levelInfo(S.exp), streak = dayStreak(), best = Math.max(S.bestStreak, streak), winsT = winsOn(k);
  const pct = p.sched > 0 ? Math.round((p.done / p.sched) * 100) : (winsT > 0 ? 100 : 0);
  const full = pct === 100;
  const C = 2 * Math.PI * 50;
  let status, cls = '';
  if (p.sched === 0) status = winsT > 0 ? '今日の行動は記録済み。ナイス。' : '今日は習慣オフの日。やることを1つ片づけよう。';
  else if (p.done === 0) {
    status = streak > 0 ? `🔥${streak}日の連続記録がかかっている。最初の1つで流れを作れ。` : 'まだ0%。最初の1つで流れを作れ。';
    cls = 'hot';
  } else if (rem === 0) { status = '🏁 COMPLETE。今日は勝ちだ。'; cls = 'win'; }
  else status = rem === 1 ? '残り1つ。パーフェクトは目の前。' : `残り${rem}つ。このまま押し切れ。`;

  const todayHabits = activeHabits().filter((h) => isSched(h, d));
  const rest = activeHabits().filter((h) => !isSched(h, d));
  const open = S.todos.filter((t) => !t.done).sort((a, b) => (b.frog - a.frog) || (a.createdAt < b.createdAt ? -1 : 1));
  const doneT = S.todos.filter((t) => t.done && t.doneAt === k);
  const ms = missions();

  return `
  ${banners()}
  <section class="card">
    <div class="hero">
      <div class="ring-wrap ${full ? 'full' : ''}" id="ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a1a"/><stop offset="1" stop-color="#f5c542"/></linearGradient></defs>
          <circle class="ring-bg" cx="60" cy="60" r="50"/>
          <circle class="ring-fg" cx="60" cy="60" r="50" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
        </svg>
        <div class="ring-center"><div class="num">${pct}<small>%</small></div><div class="label">TODAY</div></div>
      </div>
      <div class="hero-info">
        <div class="rankline">
          <div class="rank">${L.rank}</div>
          <div class="lv">LV.${L.lv}<small>${L.title}</small></div>
        </div>
        <div class="bar"><i style="width:${(L.cur / L.need) * 100}%"></i></div>
        <div class="small muted" style="margin-top:3px">次のレベルまで <b style="color:var(--cyan)">${L.need - L.cur} EXP</b></div>
        <div class="streak"><span class="fire">🔥 <b>${streak}</b>日連続</span><span>BEST <b>${best}</b></span></div>
      </div>
    </div>
    <div class="status ${cls}">${status}</div>
  </section>

  <section class="card">
    <h2><span class="label">Daily Mission</span><span class="sub">${ms.filter((m) => m.done).length}/${ms.length}</span></h2>
    ${ms.map((m) => `<div class="mission ${m.done ? 'done' : ''}">
      <div class="ck">${m.done ? '✔' : ''}</div><div class="t">${m.name} <span class="p">${m.prog}</span></div><div class="x">+${m.exp} EXP</div>
    </div>`).join('')}
  </section>

  <section class="card">
    <h2><span class="label">Habits</span> 今日の習慣 <span class="sub">${p.done} / ${p.sched}</span></h2>
    ${todayHabits.length ? todayHabits.map(habitRow).join('') : '<div class="empty small">今日の習慣はなし</div>'}
    ${rest.length ? `<div class="small muted" style="margin-top:6px">今日はオフ：${rest.map((h) => esc(h.emoji + h.name)).join('、')}</div>` : ''}
    <button class="addbtn" data-act="addhabit">＋ 習慣を追加</button>
    ${todayHabits.length ? '<div class="small muted" style="text-align:center;margin-top:6px">□をタップでクリア・名前をタップで編集</div>' : ''}
  </section>

  <section class="card">
    <h2><span class="label">Tasks</span> やること <span class="sub">${doneT.length ? `今日 ${doneT.length}件 撃破` : ''}</span></h2>
    <form class="todo-add" id="todoForm">
      <input id="todoInput" placeholder="やることを追加…" autocomplete="off">
      <button class="primary" type="submit">追加</button>
    </form>
    ${open.length >= 2 && !open.some((t) => t.frog) ? '<div class="small muted" style="margin-bottom:4px">☆で「最重要」に指定 → 一番上に固定・EXP 2倍</div>' : ''}
    ${open.map(todoRow).join('')}
    ${doneT.map(todoRow).join('')}
    ${!open.length && !doneT.length ? '<div class="empty small">頭の中のタスクを全部書き出そう</div>' : ''}
  </section>`;
}

/* ---------- render: data ---------- */
function weekScore(offset, uptoToday = false) {
  const today = new Date();
  const mon = addDays(today, -((today.getDay() + 6) % 7) + 7 * offset);
  const limit = uptoToday ? (today.getDay() + 6) % 7 : 6;
  let days = 0, wins = 0, perfect = 0;
  for (let i = 0; i <= limit; i++) {
    const k = dkey(addDays(mon, i));
    if (k > todayKey()) break;
    const w = winsOn(k);
    if (w > 0) days++;
    wins += w;
    if (perfectOn(k)) perfect++;
  }
  return { days, wins, perfect };
}

function vsCard() {
  const me = weekScore(0, true), rival = weekScore(-1, true);
  const lw = weekScore(-1), pw = weekScore(-2);
  if (!me.wins && !rival.wins && !lw.wins) return '';
  const diff = me.wins - rival.wins;
  const verdict = diff > 0 ? `<div class="verdict lead">リード中 +${diff}</div>`
    : diff < 0 ? `<div class="verdict behind">あと${-diff}でタイ。巻き返せ</div>`
      : '<div class="verdict">互角。次の1つで抜け出せ</div>';
  const res = lw.wins || pw.wins
    ? `先週の結果：${lw.wins > pw.wins ? '<span class="res-win">WIN</span>' : lw.wins === pw.wins ? 'DRAW' : 'LOSE'}（${lw.wins} vs ${pw.wins}）`
    : '';
  const isMon = new Date().getDay() === 1;
  return `<section class="card">
    <h2><span class="label">VS 先週の自分</span>${isMon ? '<span class="new">NEW WEEK</span>' : ''}<span class="sub">同じ曜日までのクリア数</span></h2>
    <div class="vs">
      <div class="me"><div class="num">${me.wins}</div><small>今週のあなた</small></div>
      <div class="vsx">VS</div>
      <div><div class="num">${rival.wins}</div><small>先週のあなた</small></div>
    </div>
    ${verdict}
    ${res ? `<div class="prev">${res}</div>` : ''}
  </section>`;
}

function statsCard() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const elapsed = today.getDate();
  let active = 0;
  for (let i = 0; i < elapsed; i++) if (winsOn(dkey(addDays(first, i))) > 0) active++;
  const rate = Math.round((active / elapsed) * 100);
  return `<section class="card">
    <h2><span class="label">Status</span></h2>
    <div class="stats">
      <div class="stat"><span class="num">${totalWins()}</span><small>通算クリア</small></div>
      <div class="stat"><span class="num">${Math.max(S.bestStreak, dayStreak())}<small>日</small></span><small>自己ベスト連続</small></div>
      <div class="stat"><span class="num">${rate}<small>%</small></span><small>今月の稼働率</small></div>
      <div class="stat"><span class="num">${perfectDays()}</span><small>パーフェクトデー</small></div>
    </div>
  </section>`;
}

function gridCard() {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + logMonth);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const tk = todayKey();
  let cells = WD.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="c blank"></div>';
  let active = 0;
  for (let i = 1; i <= days; i++) {
    const k = dkey(new Date(y, m, i));
    const w = winsOn(k);
    let cls = 'c', mark = '';
    if (k > tk) cls += ' future';
    else if (w > 0) { cls += ` ${w >= 6 ? 'l4' : w >= 4 ? 'l3' : w >= 2 ? 'l2' : 'l1'}`; active++; if (perfectOn(k)) cls += ' perfect'; }
    else if (S.frozen[k]) mark = '🛡️';
    if (k === tk) cls += ' today';
    cells += `<div class="${cls}" title="${k}：${w}クリア"><span class="n">${i}</span>${mark}</div>`;
  }
  return `<section class="card">
    <h2><span class="label">Activity</span><span class="sub">${active}日稼働</span></h2>
    <div class="month-nav">
      <button data-act="month" data-d="-1" aria-label="前の月">‹</button>
      <b>${y}年${m + 1}月</b>
      <button data-act="month" data-d="1" aria-label="次の月" ${logMonth >= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="grid">${cells}</div>
    <div class="legend">少 <i style="background:#0f3b2b"></i><i style="background:#17693f"></i><i style="background:#23a35c"></i><i style="background:#3ddc84"></i> 多
      <span><i style="box-shadow:inset 0 0 0 2px var(--gold);background:var(--card2)"></i> パーフェクト</span><span>🛡️ シールド</span></div>
  </section>`;
}

function renderLog() {
  const k = todayKey();
  const j = S.journal[k] || {};
  const mood = draftMood ?? j.mood ?? null;
  const MOODS = ['😫', '😕', '😐', '🙂', '😤'];
  const entries = Object.entries(S.journal).filter(([d]) => d !== k).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
  const hs = activeHabits();
  const unlocked = ACHIEVEMENTS.filter(([id]) => S.awarded[`a:${id}`]).length;

  return `
  ${vsCard()}
  ${statsCard()}
  ${gridCard()}

  ${hs.length ? `<section class="card">
    <h2><span class="label">Habits</span><span class="sub">直近30日の達成率</span></h2>
    ${hs.map((h) => {
      const n = totalOf(h);
      let sched = 0, done = 0;
      for (let i = 1; i <= 30; i++) {
        const d = addDays(new Date(), -i), dk = dkey(d);
        if (dk < h.createdAt) break;
        if (isSched(h, d)) { sched++; if (logOf(h, dk)) done++; }
      }
      const rate = sched ? Math.round((done / sched) * 100) : null;
      return `<div class="hstat">
        <div class="top">${esc(h.emoji)} ${esc(h.name)} <span>${rate !== null ? `達成率 ${rate}% ・ ` : ''}通算${n}回</span></div>
        <div class="bar fire"><i style="width:${Math.min(100, (n / AUTOMATIC) * 100)}%"></i></div>
        <div class="small muted" style="margin-top:4px">${n >= AUTOMATIC ? '🧠 自動化完了。もう体に刻まれている' : `🧠 自動化まで あと${AUTOMATIC - n}回`}
          ${h.identity && n ? `・🎯「${esc(h.identity)}」${n}pt` : ''}</div>
      </div>`;
    }).join('')}
  </section>` : ''}

  <section class="card">
    <h2><span class="label">Achievements</span><span class="sub">${unlocked} / ${ACHIEVEMENTS.length}</span></h2>
    <div class="achs">
      ${ACHIEVEMENTS.map(([id, icon, name, desc, tier]) => {
        const on = S.awarded[`a:${id}`];
        return `<div class="ach t${tier} ${on ? '' : 'locked'}"><span class="i">${icon}</span><b>${on ? name : '？？？'}</b><small>${desc}</small></div>`;
      }).join('')}
    </div>
  </section>

  <section class="card">
    <h2><span class="label">Log</span> ひとこと日誌</h2>
    <div class="moods">${MOODS.map((m, i) => `<button data-act="mood" data-i="${i}" class="${mood === i ? 'on' : ''}">${m}</button>`).join('')}</div>
    <textarea id="journalText" rows="3" placeholder="今日の勝ちポイントを1つ（例：雨でも走った）">${esc(j.text || '')}</textarea>
    <div class="row" style="margin-top:10px"><span class="small muted">書くとミッション達成 +10 EXP</span><span class="spacer"></span><button class="primary" data-act="savejournal">保存</button></div>
    ${entries.length ? `<details style="margin-top:12px"><summary class="small">過去の日誌（${entries.length}）</summary>
      ${entries.map(([dd, e]) => `<div class="entry"><div class="d">${dd}（${WD[parseKey(dd).getDay()]}）${e.mood != null ? MOODS[e.mood] : ''}</div>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div>`).join('')}
    </details>` : ''}
  </section>`;
}

/* ---------- render: settings ---------- */
const PSY = [
  ['⚡ EXP・レベル・ランク（有能感）', '成長が数字で見えると「自分はできる」という感覚（有能感）が高まり、内発的動機づけが強まります（自己決定理論・デシ＆ライアン）。'],
  ['🎯 デイリーミッション（目標設定理論）', '「なんとなく頑張る」より、具体的で達成可能な目標があるほうが成果が出ます（ロック＆レイサム）。毎日3つの明確なミッションを用意しています。'],
  ['🥊 VS 先週の自分（社会的比較→時間的比較）', '競争は強い動機になりますが、他人と比べると落ち込みやすい。比べる相手を「過去の自分」にすると、勝ち負けの熱さを保ったまま自己効力感が上がります。'],
  ['🏆 自己ベスト（記録更新）', 'スポーツのPB（パーソナルベスト）と同じく、自分の記録を塗り替える体験は強い達成感を生みます。'],
  ['💥 クリティカル（変動報酬）', 'ごほうびが「いつ出るかわからない」ほど行動は強化されます（スキナー）。15%の確率でEXPが2倍になります。'],
  ['🏅 実績（コレクション・ゴールの見える化）', 'ロックされた実績は「次に取りにいく目標」になります（目標勾配効果）。'],
  ['⭕ 今日のクリア率（ツァイガルニク効果）', '人は未完了のものを完了させたくなります。%表示とリングで「あと少し」を可視化しています。'],
  ['🛡️ シールド（What-the-hell 効果の防止）', '連続記録が1回途切れると「もういいや」とやめてしまいがち。7日連続ごとのシールドが、休んだ日を守ります。'],
  ['🔥 連続記録（損失回避）', '人は得るより失うことを強く嫌います（カーネマン＆トヴェルスキー）。積み上げた🔥を守りたい気持ちが、行動の背中を押します。'],
  ['⚡ 最低ライン（タイニー・ハビット）', 'やる気に頼らず、ハードルを下げて「ゼロの日」をなくすのが継続の鍵です（BJ・フォッグ）。'],
  ['🕖 いつやる？（If-Thenプランニング）', '「〜したら、〜する」と決めておくと実行率が大きく上がります（ゴルヴィツァー）。'],
  ['🎯 目指す姿（アイデンティティ）', 'クリアのたびに「なりたい自分」へポイントが積み上がる。自己イメージが行動を支えます（ジェームズ・クリア）。'],
  ['🧠 66回で自動化', '新しい行動が自動化するまで平均66日（個人差あり）と言われています（ラリー他）。'],
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
      celebrate('🛡️', `シールド：${S.tickets}枚`, '🔥を7日連続するごとに1枚獲得（最大3枚）。<br>サボってしまった日に自動で発動し、連続記録を守る。');
      break;
    case 'settings': $('#settingsBody').innerHTML = renderSettings(); $('#settingsDialog').showModal(); break;
    case 'closesettings': $('#settingsDialog').close(); break;
    case 'onb-tpl': { const t = TEMPLATES[Number(b.dataset.i)]; onb = { step: 2, ...t }; render(); break; }
    case 'onb-cue': finishOnbHabit(b.dataset.v); break;
    case 'onb-back': onb = { step: 1 }; render(); break;
    case 'onb-skip': S.settings.skipOnb = true; onb = null; save(); render(); break;
    case 'onb-cancel': onb = null; render(); break;
    case 'onb-done': { const hid = onb.habitId; onb = null; toggleHabit(hid); break; }
    case 'onb-later': onb = null; render(); toast('準備完了。□をタップでクリアできる'); break;
    case 'month': logMonth = Math.min(0, logMonth + Number(b.dataset.d)); render(); break;
    case 'mood': { draftMood = Number(b.dataset.i); const txt = $('#journalText').value; render(); $('#journalText').value = txt; break; }
    case 'savejournal': saveJournal(); break;
    case 'restore': { const h = S.habits.find((x) => x.id === id); if (h) { h.archived = false; save(); render(); toast(`${esc(h.emoji)} 再開した`); } break; }
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
    if (!name) { toast('鍛えたいことを書こう'); return; }
    onb = { step: 2, emoji: '🔥', name, cue: '', tiny: '', identity: '' }; render();
  } else if (id === 'onbCueForm') {
    e.preventDefault();
    const cue = e.target.elements.namedItem('t').value.trim();
    if (!cue) { toast('いつやるか書こう'); return; }
    finishOnbHabit(cue);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'journalAt') {
    S.settings.journalAt = e.target.value; save();
    toast(e.target.value ? `📝 ${e.target.value} に通知します` : 'ふりかえり通知をオフにしました');
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
  if (!text && mood == null) { toast('気分かひとことを入れよう'); return; }
  S.journal[k] = { mood, text };
  toast('📝 記録した');
  draftMood = null;
  checkMissions(); checkAchievements(false);
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
function popRing() {
  requestAnimationFrame(() => {
    const p = $('#ring');
    if (p) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
  });
}

const cv = $('#confetti');
const cx = cv.getContext('2d');
let parts = [], animating = false;
const COLORS = ['#ff7a1a', '#f5c542', '#22d3ee', '#3ddc84', '#ffffff'];
function confetti(n = 40) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * 11 + 3;
    parts.push({
      x: innerWidth / 2, y: innerHeight * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
      s: Math.random() * 3 + 2, c: pick(COLORS), life: 50 + Math.random() * 40,
    });
  }
  if (!animating) { animating = true; requestAnimationFrame(tick); }
}
function tick() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.vy += 0.22; p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx; p.y += p.vy; p.life--;
    cx.globalAlpha = Math.min(1, p.life / 25);
    cx.strokeStyle = p.c; cx.lineWidth = p.s; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); cx.stroke();
  }
  cx.globalAlpha = 1;
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
  const opts = { body: '🕖 決めた時刻に、まだなら通知する。\n⚡ 最低ラインだけでもクリア扱い。', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'test' };
  try {
    if (swReg) await swReg.showNotification('つづく. テスト通知', opts);
    else new Notification('つづく. テスト通知', opts);
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
      <div><b>📝 ふりかえりの時刻</b><div class="small muted">今日の戦績を通知</div></div>
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
    `${h.cue ? `🕖 ${h.cue}\n` : ''}⚡ 最低ライン：${h.tiny || '2分だけ'}\n✔ 終わったら「つづく.」でクリア！`));
  if (S.settings.journalAt) events.push(ev('journal', S.settings.journalAt, [0, 1, 2, 3, 4, 5, 6], '📝 つづく. 今日の戦績チェック', '今日の勝ちポイントを1つ記録しよう'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tsuzuku//habit//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:つづく. 習慣リマインダー', ...events, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'tsuzuku-reminders.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('📅 書き出しました。ファイルを開くとカレンダーに追加できます');
}

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
processShields();
S.bestStreak = Math.max(S.bestStreak || 0, computeBest());
checkAchievements(true); // 既存の記録で達成済みの実績は静かに解除
render();
if (location.search) { handleParams(location.search); history.replaceState(null, '', location.pathname); }
S.lastOpen = todayKey();
save();

let lastDay = todayKey();
setInterval(() => {
  if (todayKey() !== lastDay) { lastDay = todayKey(); processShields(); S.lastOpen = lastDay; save(); render(); }
}, 60000);
