'use strict';
/* =========================================================
 * つづく. — 習慣化 & TODO（積み上げが「目で見える」デザイン）
 *   🔥連続の鎖・習慣ごとの今週チェーン・積み上げグラフ・週ごとの棒グラフ
 *   データはブラウザの localStorage に保存されます。
 * ========================================================= */

const STORE = 'tsuzuku-v1';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const WD_MON = ['月', '火', '水', '木', '金', '土', '日'];
const AUTOMATIC = 66;   // Lally et al. (2010) 習慣が自動化するまでの平均日数
const MAX_SHIELDS = 3;
// 習慣の色（ダーク面で色覚多様性チェック済みのカテゴリ配色。作成順に固定で割り当て）
const HABIT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const MILESTONES = [7, 21, 30, 66, 100, 200, 365];

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
const md = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

/* ---------- state ---------- */
function defaultState() {
  return {
    version: 4,
    createdAt: dkey(),
    lastOpen: null,
    habits: [],     // { id, color, emoji, name, cue, tiny, identity, reward, remindAt, days, createdAt, archived }
    logs: {},       // { 'YYYY-MM-DD': { habitId: { type } } }
    todos: [],      // { id, text, frog, done, doneAt, createdAt }
    journal: {},    // { 'YYYY-MM-DD': { mood, text } }
    routines: [],   // { id, color, emoji, name, time, steps:[{id,text}], days, createdAt, archived }
    rlogs: {},      // { 'YYYY-MM-DD': { routineId: { checked:[stepId], done } } }
    awarded: {},
    bestStreak: 0,
    tickets: 0,     // シールド枚数
    frozen: {},     // シールドで守った日
    nextColor: 0,
    lastProcessed: null,
    ticketNote: null,
    settings: { notify: false, journalAt: '21:00', skipOnb: false },
  };
}
function hydrate(obj) {
  const st = Object.assign(defaultState(), obj);
  st.settings = Object.assign(defaultState().settings, obj.settings || {});
  st.habits.forEach((h, i) => { if (h.color == null) h.color = i; });
  st.nextColor = Math.max(st.nextColor || 0, st.habits.length);
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
  { emoji: '💪', name: '筋トレ', cue: '帰宅したら', tiny: '腕立て1回', identity: '鍛えている自分' },
  { emoji: '🏃', name: 'ランニング', cue: '朝起きたら', tiny: 'ウェアに着替える', identity: '走れる体' },
  { emoji: '📚', name: '読書', cue: '寝る前', tiny: '1ページだけ', identity: '知識で勝つ人' },
  { emoji: '🗣️', name: '英語', cue: '通勤・通学中', tiny: '単語を1つ', identity: '英語で戦える人' },
  { emoji: '💻', name: '勉強・資格', cue: '夕食のあと', tiny: '問題を1問', identity: '資格を取る人' },
  { emoji: '💧', name: '水を飲む', cue: '朝起きたら', tiny: 'コップ1杯', identity: 'コンディションを整える人' },
  { emoji: '🧘', name: '瞑想', cue: '歯みがきのあと', tiny: '深呼吸3回', identity: 'ブレない人' },
  { emoji: '😴', name: '早く寝る', cue: '23時になったら', tiny: 'スマホを置く', identity: '睡眠を制する人' },
];
const CUES = ['朝起きたら', '朝ごはんのあと', '歯みがきのあと', '通勤・通学中', '昼休み', '帰宅したら', '夕食のあと', 'お風呂のあと', '寝る前'];
const PRAISE = ['ナイス！', 'いい流れ！', '積み上げた！', '一歩前進！', 'その調子！', '強い！', '今日も勝った！'];

/* ---------- core logic ---------- */
const activeHabits = () => S.habits.filter((h) => !h.archived);
const colorOf = (h) => HABIT_COLORS[(h.color ?? 0) % HABIT_COLORS.length];
const isSched = (h, d) => h.days.includes(d.getDay()) && dkey(d) >= h.createdAt;
const logOf = (h, k) => (S.logs[k] && S.logs[k][h.id]) || null;
const totalOf = (h) => Object.values(S.logs).filter((l) => l[h.id]).length;

const routinesDoneOn = (k) => (S.rlogs[k] ? Object.values(S.rlogs[k]).filter((x) => x.done).length : 0);
function winsOn(k) {
  const habits = S.logs[k] ? Object.keys(S.logs[k]).length : 0;
  return habits + routinesDoneOn(k) + S.todos.filter((t) => t.done && t.doneAt === k).length;
}
function totalWins() {
  let n = 0;
  for (const k in S.logs) n += Object.keys(S.logs[k]).length;
  for (const k in S.rlogs) n += routinesDoneOn(k);
  return n + S.todos.filter((t) => t.done).length;
}

/* ---------- routines（毎日のルーティーン） ---------- */
const ROUTINE_TEMPLATES = [
  { emoji: '🌅', name: '朝のルーティーン', time: '07:00', steps: ['カーテンを開けて日光を浴びる', 'コップ1杯の水を飲む', 'ストレッチ3分', '今日やることを3つ決める'] },
  { emoji: '🌙', name: '夜のルーティーン', time: '22:30', steps: ['明日の服とカバンを準備', 'スマホを充電器へ（寝室の外）', 'ひとこと日誌を書く', '23時に布団に入る'] },
  { emoji: '💼', name: '仕事はじめ', time: '09:00', steps: ['デスクを片づける', '今日の最重要タスクを決める', '通知を切って25分集中'] },
  { emoji: '🏋️', name: 'トレーニング前', time: '', steps: ['ウェアに着替える', '水を用意する', 'ウォームアップ5分'] },
];
const activeRoutines = () => S.routines.filter((r) => !r.archived);
const rlogOf = (r, k) => (S.rlogs[k] && S.rlogs[k][r.id]) || null;
const routineDone = (r, k) => !!(rlogOf(r, k) && rlogOf(r, k).done);
const routineTotal = (r) => Object.values(S.rlogs).filter((l) => l[r.id] && l[r.id].done).length;

function toggleStep(rid, sid) {
  const r = S.routines.find((x) => x.id === rid);
  if (!r) return;
  const k = todayKey();
  S.rlogs[k] = S.rlogs[k] || {};
  const log = S.rlogs[k][rid] || { checked: [], done: false };
  const wasDone = log.done;
  const first = winsOn(k) === 0;
  log.checked = log.checked.includes(sid) ? log.checked.filter((x) => x !== sid) : [...log.checked, sid];
  log.done = r.steps.length > 0 && r.steps.every((s) => log.checked.includes(s.id));
  S.rlogs[k][rid] = log;
  if (!log.checked.length) { delete S.rlogs[k][rid]; if (!Object.keys(S.rlogs[k]).length) delete S.rlogs[k]; }
  if (log.done && !wasDone) {
    toast(`${esc(r.emoji)} ${esc(r.name)} 完了！`);
    confetti(90);
    const n = routineTotal(r);
    if ([1, 7, 21, 30, 66, 100].includes(n) && !S.awarded[`r:${r.id}:${n}`]) {
      S.awarded[`r:${r.id}:${n}`] = true;
      celebrate(n === 1 ? '🎯' : '🔁', `${esc(r.emoji)} ${esc(r.name)}：${n}回完了`,
        n === 1 ? '最初の1周クリア。手順が決まっていると、迷わず動ける。' : '流れが体に入ってきている。');
    }
    afterWin(first);
  } else if (!log.done && log.checked.includes(sid)) {
    const left = r.steps.length - log.checked.length;
    if (left === 1) toast('あと1ステップで完了！');
  }
  save(); render();
}

function routineWeek(r) {
  const mon = mondayOf(new Date()), tk = todayKey();
  let out = '', done = 0, sched = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), k = dkey(d);
    const on = routineDone(r, k), s = isSched(r, d);
    if (s && k <= tk) sched++;
    if (on) done++;
    let cls = 'wc';
    if (on) cls += ' on';
    else if (k > tk) cls += ' future';
    else if (!s) cls += ' rest';
    else if (k === tk) cls += ' today';
    else cls += ' miss';
    out += `<i class="${cls}" title="${md(k)}">${WD_MON[i]}</i>`;
  }
  return { html: out, done, sched };
}

function routineBlock(r) {
  const k = todayKey();
  const log = rlogOf(r, k);
  const checked = log ? log.checked : [];
  const done = routineDone(r, k);
  const n = r.steps.filter((s) => checked.includes(s.id)).length;
  const nextIdx = r.steps.findIndex((s) => !checked.includes(s.id));
  const wk = routineWeek(r);
  return `<div class="routine ${done ? 'done' : ''}" style="--hc:${colorOf(r)}">
    <div class="r-head">
      <div class="r-emo">${done ? '✔' : esc(r.emoji)}</div>
      <div class="r-title"><b>${esc(r.name)}</b><span>${r.time ? `${esc(r.time)}〜 ・ ` : ''}今週 ${wk.done}/${wk.sched}</span></div>
      <div class="r-prog">${n}<small>/${r.steps.length}</small></div>
      <button class="r-edit" data-act="editroutine" data-id="${r.id}" aria-label="編集">✎</button>
    </div>
    <div class="r-bar">${r.steps.map((s) => `<i class="${checked.includes(s.id) ? 'on' : ''}"></i>`).join('')}</div>
    ${done ? `<div class="r-done">🔁 ${esc(r.name)} 完了！ 通算${routineTotal(r)}回 <button class="linkbtn" data-act="ropen" data-id="${r.id}">ステップを見る</button></div>` : ''}
    <div class="steps ${done && !openRoutines.has(r.id) ? 'hide' : ''}">
      ${r.steps.map((s, i) => `<button class="step ${checked.includes(s.id) ? 'on' : ''} ${i === nextIdx ? 'next' : ''}" data-act="step" data-rid="${r.id}" data-sid="${s.id}">
        <span class="sc">${checked.includes(s.id) ? '✔' : i + 1}</span><span class="st">${esc(s.text)}</span>${i === nextIdx ? '<em>次はこれ</em>' : ''}
      </button>`).join('')}
    </div>
    <div class="wchain">${wk.html}</div>
  </div>`;
}
const openRoutines = new Set();

function routinesCard() {
  const d = new Date();
  const rs = activeRoutines().filter((r) => isSched(r, d));
  const off = activeRoutines().filter((r) => !isSched(r, d));
  const doneN = rs.filter((r) => routineDone(r, todayKey())).length;
  return `<section class="card">
    <h2>🔁 毎日のルーティーン <span class="sub">${rs.length ? `${doneN} / ${rs.length} 完了` : ''}</span></h2>
    ${rs.length ? rs.map(routineBlock).join('') : `<div class="empty small">朝や夜の「決まった流れ」を登録すると、迷わず動けるようになります</div>`}
    ${off.length ? `<div class="small muted" style="margin-top:6px">今日はオフ：${off.map((r) => esc(r.emoji + r.name)).join('、')}</div>` : ''}
    <button class="addbtn" data-act="addroutine">＋ ルーティーンを追加</button>
  </section>`;
}

const rdlg = () => $('#routineDialog');
const rform = () => $('#routineForm');
const rfe = (n) => rform().elements.namedItem(n);
let routineTplPicked = false;
function openRoutine(r, tpl) {
  const f = rform();
  f.reset();
  const src = r || tpl || { emoji: '🔁', name: '', time: '', steps: [] };
  rfe('id').value = r ? r.id : '';
  rfe('emoji').value = src.emoji || '🔁';
  rfe('name').value = src.name || '';
  rfe('time').value = src.time || '';
  rfe('steps').value = (src.steps || []).map((s) => (typeof s === 'string' ? s : s.text)).join('\n');
  const days = r ? r.days : [0, 1, 2, 3, 4, 5, 6];
  f.querySelectorAll('input[name=rday]').forEach((c) => { c.checked = days.includes(Number(c.value)); });
  $('#routineTitle').textContent = r ? 'ルーティーンを編集' : '新しいルーティーン';
  $('#archiveRoutine').hidden = !r;
  $('#routineTpls').hidden = !!r;
  rdlg().showModal();
}
function saveRoutine() {
  const lines = rfe('steps').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const days = [...rform().querySelectorAll('input[name=rday]:checked')].map((c) => Number(c.value));
  if (!rfe('name').value.trim()) { toast('名前を入れてください'); return false; }
  if (!lines.length) { toast('ステップを1つ以上書いてください'); return false; }
  if (!days.length) { toast('曜日を1つ以上選んでください'); return false; }
  const id = rfe('id').value;
  const r = id ? S.routines.find((x) => x.id === id) : null;
  const old = r ? r.steps : [];
  const used = new Set();
  const steps = lines.map((text, i) => {
    // 同じ文言 → 同じステップ。同じ位置の文言を書き換えただけ → 同じステップ扱い
    let hit = old.find((s) => s.text === text && !used.has(s.id));
    if (!hit && old[i] && !used.has(old[i].id) && !lines.includes(old[i].text)) hit = old[i];
    if (hit) used.add(hit.id);
    return hit ? { id: hit.id, text } : { id: uid(), text };
  });
  const data = { emoji: rfe('emoji').value.trim() || '🔁', name: rfe('name').value.trim(), time: rfe('time').value, steps, days };
  if (r) {
    Object.assign(r, data);
    const k = todayKey(), log = rlogOf(r, k);
    if (log) { // 今日のチェック状態を新しいステップに合わせて再計算
      log.checked = log.checked.filter((sid) => steps.some((s) => s.id === sid));
      log.done = steps.every((s) => log.checked.includes(s.id));
    }
  } else {
    S.routines.push({ id: uid(), color: S.nextColor++, createdAt: todayKey(), archived: false, ...data });
    toast(`${esc(data.emoji)} 「${esc(data.name)}」を作成。上から順にこなそう`);
  }
  save(); render();
  return true;
}
function progressOn(d) {
  const k = dkey(d);
  const hs = activeHabits().filter((h) => isSched(h, d));
  return { sched: hs.length, done: hs.filter((h) => logOf(h, k)).length };
}
const todayProgress = () => progressOn(new Date());
const perfectOn = (k) => { const p = progressOn(parseKey(k)); return p.sched > 0 && p.done === p.sched; };
const perfectDays = () => Object.keys(S.logs).filter(perfectOn).length;

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
  if (used) S.ticketNote = { date: todayKey(), n: used };
}

/* ---------- rewards ---------- */
const ACHIEVEMENTS = [
  ['first', '🎯', '初クリア', '初めてクリア', 1, (c) => c.total >= 1],
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
  ['r1', '🔁', 'ルーティーン', 'ルーティーンを初完了', 1, (c) => c.routines >= 1],
  ['r30', '⚙️', '仕組み化', 'ルーティーン30回完了', 2, (c) => c.routines >= 30],
  ['r100', '🏯', '鉄のルーティーン', 'ルーティーン100回完了', 3, (c) => c.routines >= 100],
];
function checkAchievements(silent) {
  const c = {
    total: totalWins(), best: Math.max(S.bestStreak, dayStreak()), perfect: perfectDays(),
    todos: S.todos.filter((t) => t.done).length, shields: Object.keys(S.frozen).length,
    routines: Object.keys(S.rlogs).reduce((a, k) => a + routinesDoneOn(k), 0),
  };
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
  [200, '💎', '200回クリア', 'ここまで来る人はほとんどいない。'],
  [365, '👑', '365回クリア', '1年分の積み上げ。人生が変わるレベル。'],
];
function checkHabitMilestone(h) {
  const n = totalOf(h);
  for (const [at, icon, title, text] of HABIT_MILESTONES) {
    const key = `h:${h.id}:${at}`;
    if (n >= at && !S.awarded[key]) {
      S.awarded[key] = true;
      celebrate(icon, `${esc(h.emoji)} ${esc(h.name)}：${title}`,
        `${text}${h.identity ? `<br><br>🎯「${esc(h.identity)}」に一歩近づいた（${n}回目）。` : ''}`);
      confetti(120);
      break;
    }
  }
}

// クリア後の共通処理。first=今日はじめてのクリア
function afterWin(first) {
  const k = todayKey();
  const st = dayStreak();
  if (first && st > 1) toast(`🔥 <b>${st}日連続</b>に更新！`);
  const p = todayProgress();
  if (p.sched > 0 && p.done === p.sched && !S.awarded[`perfect:${k}`]) {
    S.awarded[`perfect:${k}`] = true;
    celebrate('⭐', 'PERFECT DAY', '今日の習慣をすべてクリア。<br>この1日は、完全勝利だ。');
    confetti(180);
  }
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
  checkAchievements(false);
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
    toast('取り消した');
    save(); render();
    return;
  }
  const first = winsOn(k) === 0;
  S.logs[k][id] = { type };
  const p = todayProgress(), rem = p.sched - p.done;
  toast(`${esc(h.emoji)} ${pick(PRAISE)}${rem === 1 ? '　残り1つでパーフェクト' : ''}`);
  confetti(45);
  checkHabitMilestone(h);
  afterWin(first);
  if (h.reward) toast(`🎁 ごほうび：${esc(h.reward)}`);
  save(); render(); pulse();
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
  const first = winsOn(todayKey()) === 0;
  t.done = true; t.doneAt = todayKey();
  toast(t.frog ? '★ 最重要タスク撃破！' : `✔ ${pick(PRAISE)}`);
  confetti(t.frog ? 80 : 30);
  afterWin(first);
  save(); render(); pulse();
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
      ${first ? `<div class="onb-hero">🔥</div><h2>ここから、積み上げが始まる</h2>
        <p class="muted">クリアした日が鎖のようにつながり、グラフが右肩上がりに伸びていく。</p>` : '<h2>新しい習慣</h2>'}
      <h2 style="font-size:17px">続けたいことを、まず1つ選ぼう</h2>
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
      <div class="onb-hero" style="font-size:44px">${esc(onb.emoji)}</div>
      <h2>「${esc(onb.name)}」は、いつやる？</h2>
      <p class="muted small">毎日必ずやっている行動の「直後」に固定すると、忘れにくくなる。</p>
      <div class="chips">${chips.map((c) => `<button data-act="onb-cue" data-v="${esc(c)}" class="${c === onb.cue ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <form id="onbCueForm" class="todo-add"><input name="t" placeholder="自分で書く（例：コーヒーを淹れたら）" autocomplete="off"><button class="primary">決定</button></form>
      <button class="linkbtn" data-act="onb-back">もどる</button>
    </section>`;
  }
  const h = S.habits.find((x) => x.id === onb.habitId);
  return `<section class="card onb">
    ${dots(3)}
    <h2>最初の1回、今やろう</h2>
    <div class="try" style="--hc:${colorOf(h)}">
      <div class="e">${esc(h.emoji)}</div>
      <b>${esc(h.name)}</b>
      <div class="muted" style="margin-top:6px">最低ライン「${esc(h.tiny || '2分だけ')}」でクリア。<br>この1回が、鎖の最初の1つになる。</div>
    </div>
    <button class="primary big" data-act="onb-done">クリア！</button>
    <div><button class="linkbtn" data-act="onb-later">あとでやる</button></div>
  </section>`;
}
function finishOnbHabit(cue) {
  const h = {
    id: uid(), color: S.nextColor++, createdAt: todayKey(), archived: false, days: [0, 1, 2, 3, 4, 5, 6], remindAt: '', reward: '',
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
    out += `<div class="banner warn">🛡️ シールドが${S.ticketNote.n}枚発動。🔥連続記録は守られた。今日クリアしてつなげよう。</div>`;
  }
  if (S.welcomeBack === t) out += '<div class="banner">🔄 <b>おかえり！</b> 戻ってきた時点で勝ち。今日は最低ラインを1つだけクリアしよう。</div>';
  else if (d.getDate() === 1) out += '<div class="banner">🗓️ <b>新しい月！</b> カレンダーが新しいページに。最初の1マスを埋めにいこう。</div>';
  else if (d.getDay() === 1 && weekWins(-1) > 0) out += '<div class="banner">📈 <b>新しい週！</b> <button class="linkbtn" data-act="gotolog" style="padding:0">先週のグラフを見る →</button></div>';
  return out;
}

// 🔥 ヒーロー：連続日数＋直近14日の「鎖」＋自己ベストまでの距離
function heroCard() {
  const streak = dayStreak(), best = Math.max(S.bestStreak, streak);
  const tk = todayKey();
  let chain = '';
  for (let i = 13; i >= 0; i--) {
    const k = dkey(addDays(new Date(), -i));
    const w = winsOn(k);
    let cls = 'link', mark = '';
    if (k < S.createdAt) cls += ' pre';
    else if (w > 0) cls += ' on';
    else if (S.frozen[k]) { cls += ' shield'; mark = '🛡️'; }
    else if (k === tk) cls += ' pending';
    else cls += ' off';
    chain += `<i class="${cls}" title="${md(k)}：${w}クリア">${mark}</i>`;
  }
  const isPR = streak > 0 && streak >= best;
  const goal = isPR ? `🏆 自己ベスト更新中！` : `自己ベスト <b>${best}日</b> まで あと <b>${best - streak}日</b>`;
  const pct = best ? Math.min(100, (streak / best) * 100) : 0;
  const todayDone = winsOn(tk) > 0;
  return `<section class="hero ${todayDone ? 'lit' : ''}">
    <div class="hero-top">
      <div>
        <div class="hero-label">連続記録</div>
        <div class="hero-num">${streak}<span>日</span></div>
      </div>
      <div class="hero-flame">${todayDone ? '🔥' : '🕯️'}</div>
    </div>
    <div class="hero-goal">${goal}</div>
    <div class="hero-bar"><i style="width:${isPR ? 100 : pct}%"></i></div>
    <div class="chain">${chain}</div>
    <div class="chain-lbl"><span>2週間前</span><span>${todayDone ? '今日 ✔' : '今日 → まだ'}</span></div>
  </section>`;
}

// 習慣ごとの「今週チェーン」（月〜日）
function weekChain(h) {
  const mon = mondayOf(new Date()), tk = todayKey();
  let out = '', done = 0, sched = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), k = dkey(d);
    const l = logOf(h, k), s = isSched(h, d);
    if (s && k <= tk) sched++;
    if (l) done++;
    let cls = 'wc';
    if (l) cls += ' on';
    else if (k > tk) cls += ' future';
    else if (!s) cls += ' rest';
    else if (k === tk) cls += ' today';
    else cls += ' miss';
    out += `<i class="${cls}" title="${md(k)}">${WD_MON[i]}</i>`;
  }
  return { html: out, done, sched };
}

function habitRow(h) {
  const k = todayKey();
  const done = !!logOf(h, k);
  const wc = weekChain(h);
  const n = totalOf(h);
  const next = MILESTONES.find((m) => m > n);
  return `<div class="habit ${done ? 'done' : ''}" style="--hc:${colorOf(h)}">
    <button class="tap" data-act="habit" data-id="${h.id}" aria-label="${done ? '取り消す' : 'クリア'}">${done ? '✔' : esc(h.emoji)}</button>
    <div class="body" data-act="edithabit" data-id="${h.id}">
      <div class="name">${esc(h.name)} <span class="cnt">${n}回</span></div>
      <div class="wchain">${wc.html}</div>
      <div class="sub">${done ? (next ? `✔ クリア！ 次の目標 ${next}回まで あと${next - n}` : '✔ クリア！')
        : [h.cue ? `🕖 ${esc(h.cue)}` : '', h.tiny ? `最低ライン：${esc(h.tiny)}` : ''].filter(Boolean).join('　')}</div>
    </div>
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
  const todayHabits = activeHabits().filter((h) => isSched(h, d));
  const rest = activeHabits().filter((h) => !isSched(h, d));
  const p = todayProgress(), rem = p.sched - p.done;
  const open = S.todos.filter((t) => !t.done).sort((a, b) => (b.frog - a.frog) || (a.createdAt < b.createdAt ? -1 : 1));
  const doneT = S.todos.filter((t) => t.done && t.doneAt === k);
  const msg = p.sched === 0 ? '今日は習慣オフの日'
    : rem === 0 ? '⭐ パーフェクト！今日は完全勝利'
      : p.done === 0 ? '最初の1つで流れを作ろう'
        : rem === 1 ? '残り1つでパーフェクト！' : `残り${rem}つ。このまま押し切れ`;

  return `
  ${banners()}
  ${heroCard()}
  ${routinesCard()}

  <section class="card">
    <div class="today-head">
      <div><span class="big-frac">${p.done}<small> / ${p.sched}</small></span><span class="muted small"> 今日の習慣</span></div>
      <div class="today-msg ${rem === 0 && p.sched ? 'win' : ''}">${msg}</div>
    </div>
    ${p.sched ? `<div class="segbar">${todayHabits.map((h) => `<i class="${logOf(h, k) ? 'on' : ''}" style="--hc:${colorOf(h)}" title="${esc(h.name)}"></i>`).join('')}</div>` : ''}
    ${todayHabits.length ? todayHabits.map(habitRow).join('') : '<div class="empty small">今日の習慣はなし</div>'}
    ${rest.length ? `<div class="small muted" style="margin-top:6px">今日はオフ：${rest.map((h) => esc(h.emoji + h.name)).join('、')}</div>` : ''}
    <button class="addbtn" data-act="addhabit">＋ 習慣を追加</button>
    ${todayHabits.length ? '<div class="small muted" style="text-align:center;margin-top:6px">左のボタンでクリア・名前をタップで編集</div>' : ''}
  </section>

  <section class="card">
    <h2>✅ やること <span class="sub">${doneT.length ? `今日 ${doneT.length}件 完了` : ''}</span></h2>
    <form class="todo-add" id="todoForm">
      <input id="todoInput" placeholder="やることを追加…" autocomplete="off">
      <button class="primary" type="submit">追加</button>
    </form>
    ${open.length >= 2 && !open.some((t) => t.frog) ? '<div class="small muted" style="margin-bottom:4px">☆で「最重要」に指定 → 一番上に固定</div>' : ''}
    ${open.map(todoRow).join('')}
    ${doneT.map(todoRow).join('')}
    ${!open.length && !doneT.length ? '<div class="empty small">頭の中のタスクを全部書き出そう</div>' : ''}
  </section>`;
}

/* ---------- charts ---------- */
const charts = {};   // id -> ホバー用の点データ
const chartW = () => Math.max(260, Math.min(612, ($('#view').clientWidth || 360) - 34));

// 積み上げグラフ（通算クリア数の推移。右肩上がりにしか動かない）
function cumulativeChart() {
  const tk = todayKey();
  const span = Math.min(30, Math.max(7, diffDays(S.createdAt, tk) + 1));
  const start = addDays(new Date(), -(span - 1));
  const days = [];
  for (let i = 0; i < span; i++) days.push(dkey(addDays(start, i)));
  const inWin = days.reduce((a, k) => a + winsOn(k), 0);
  let acc = totalWins() - inWin;
  const base = acc;
  const vals = days.map((k) => { acc += winsOn(k); return acc; });
  const W = chartW(), H = 180, L = 34, R = 44, T = 14, B = 24;
  const max = Math.max(5, ...vals), min = Math.max(0, Math.min(base, ...vals) - 1);
  const niceMax = Math.ceil(max / 5) * 5;
  const x = (i) => L + (i * (W - L - R)) / (span - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (niceMax - min || 1));
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(span - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const ticks = [...new Set([min, Math.round((min + niceMax) / 2), niceMax])];
  charts.cum = { type: 'line', pts: vals.map((v, i) => ({ x: x(i), y: y(v), tip: `<b>${md(days[i])}</b><br>通算 ${v}回（この日 +${winsOn(days[i])}）` })) };
  const gain = vals[vals.length - 1] - base;
  return `<section class="card">
    <h2>📈 積み上げグラフ <span class="sub">直近${span}日で +${gain}回</span></h2>
    <div class="chart" data-chart="cum">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="通算クリア数の推移">
        <defs><linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3987e5" stop-opacity=".35"/><stop offset="1" stop-color="#3987e5" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        <path d="${area}" fill="url(#cumFill)"/>
        <path d="${line}" class="ln" stroke="#3987e5"/>
        <circle cx="${x(span - 1)}" cy="${y(vals[span - 1])}" r="5" fill="#3987e5" class="ring"/>
        <text class="dl" x="${x(span - 1) + 9}" y="${y(vals[span - 1]) + 4}">${vals[span - 1]}</text>
        <text class="ax" x="${L}" y="${H - 6}">${md(days[0])}</text>
        <text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">今日</text>
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        <circle class="xdot" r="5" style="display:none"/>
      </svg>
    </div>
  </section>`;
}

function weekWins(offset, uptoToday = false) {
  const mon = addDays(mondayOf(new Date()), 7 * offset);
  const limit = uptoToday ? (new Date().getDay() + 6) % 7 : 6;
  let n = 0;
  for (let i = 0; i <= limit; i++) { const k = dkey(addDays(mon, i)); if (k <= todayKey()) n += winsOn(k); }
  return n;
}

// 週ごとのクリア数（8週）
function weeklyChart() {
  const weeks = [];
  for (let w = 7; w >= 0; w--) weeks.push({ off: -w, n: weekWins(-w), start: addDays(mondayOf(new Date()), -7 * w) });
  const W = chartW(), H = 170, L = 28, R = 8, T = 18, B = 24;
  const max = Math.max(5, ...weeks.map((w) => w.n));
  const niceMax = Math.ceil(max / 5) * 5;
  const slot = (W - L - R) / weeks.length, bw = Math.min(34, slot - 6);
  const y = (v) => T + (H - T - B) * (1 - v / niceMax);
  const me = weekWins(0, true), rival = weekWins(-1, true), diff = me - rival;
  charts.week = { type: 'bar', pts: weeks.map((w, i) => ({ x: L + slot * i + slot / 2, y: y(w.n), tip: `<b>${w.off === 0 ? '今週' : `${md(dkey(w.start))}の週`}</b><br>${w.n}回クリア` })) };
  const bars = weeks.map((w, i) => {
    const bx = L + slot * i + (slot - bw) / 2, by = y(w.n), bh = Math.max(0, H - B - by);
    const r = Math.min(4, bh);
    const path = bh > 0 ? `M${bx},${H - B}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${H - B}Z` : '';
    return `<path d="${path}" class="${w.off === 0 ? 'bar cur' : 'bar'}"/>
      ${w.off === 0 || w.off === -1 ? `<text class="dl" x="${bx + bw / 2}" y="${by - 5}" text-anchor="middle">${w.n}</text>` : ''}
      <text class="ax" x="${bx + bw / 2}" y="${H - 7}" text-anchor="middle">${w.off === 0 ? '今週' : md(dkey(w.start))}</text>`;
  }).join('');
  const verdict = diff > 0 ? `<span class="up">▲ 先週の同じ曜日より +${diff}</span>`
    : diff < 0 ? `<span class="down">先週の同じ曜日まで あと${-diff}</span>` : '<span class="muted">先週の同じ曜日と互角</span>';
  return `<section class="card">
    <h2>📊 週ごとのクリア数 <span class="sub">${verdict}</span></h2>
    <div class="chart" data-chart="week">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="週ごとのクリア数">
        ${[0, niceMax / 2, niceMax].map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${bars}
      </svg>
    </div>
  </section>`;
}

function calendarCard() {
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
    else if (w > 0) { cls += ` ${w >= 6 ? 'l4' : w >= 4 ? 'l3' : w >= 2 ? 'l2' : 'l1'}`; active++; if (perfectOn(k)) mark = '★'; }
    else if (S.frozen[k]) mark = '🛡️';
    if (k === tk) cls += ' today';
    cells += `<div class="${cls}" title="${md(k)}：${w}クリア${perfectOn(k) ? '（パーフェクト）' : ''}"><span class="n">${i}</span>${mark}</div>`;
  }
  return `<section class="card">
    <h2>🗓️ 活動カレンダー <span class="sub">${active}日 稼働</span></h2>
    <div class="month-nav">
      <button data-act="month" data-d="-1" aria-label="前の月">‹</button>
      <b>${y}年${m + 1}月</b>
      <button data-act="month" data-d="1" aria-label="次の月" ${logMonth >= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="grid">${cells}</div>
    <div class="legend">少 <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> 多　★ パーフェクト　🛡️ シールド</div>
  </section>`;
}

function habitsCard() {
  const hs = activeHabits();
  if (!hs.length) return '';
  return `<section class="card">
    <h2>🎯 習慣ごとの記録 <span class="sub">直近30日の達成率</span></h2>
    ${hs.map((h) => {
      const n = totalOf(h);
      let sched = 0, done = 0;
      for (let i = 1; i <= 30; i++) {
        const d = addDays(new Date(), -i), dk = dkey(d);
        if (dk < h.createdAt) break;
        if (isSched(h, d)) { sched++; if (logOf(h, dk)) done++; }
      }
      const rate = sched ? Math.round((done / sched) * 100) : null;
      const next = MILESTONES.find((m) => m > n) || n;
      const prev = [0, ...MILESTONES].filter((m) => m <= n).pop();
      return `<div class="hstat" style="--hc:${colorOf(h)}">
        <div class="top"><span><i class="sw"></i>${esc(h.emoji)} ${esc(h.name)}</span><span class="rate">${rate !== null ? `${rate}%` : '—'}</span></div>
        <div class="hbar"><i style="width:${rate ?? 0}%"></i></div>
        <div class="road">
          <span class="small muted">通算 <b>${n}</b>回</span>
          <div class="road-bar"><i style="width:${next > prev ? ((n - prev) / (next - prev)) * 100 : 100}%"></i></div>
          <span class="small muted">次 <b>${next}</b>回</span>
        </div>
        ${n < AUTOMATIC ? `<div class="small muted">🧠 自動化（66回）まで あと${AUTOMATIC - n}回</div>` : '<div class="small muted">🧠 自動化ライン突破。もう体に刻まれている</div>'}
      </div>`;
    }).join('')}
  </section>`;
}

function routineStatsCard() {
  const rs = activeRoutines();
  if (!rs.length) return '';
  return `<section class="card">
    <h2>🔁 ルーティーンの記録 <span class="sub">直近30日の完了率</span></h2>
    ${rs.map((r) => {
      let sched = 0, done = 0;
      for (let i = 1; i <= 30; i++) {
        const d = addDays(new Date(), -i), dk = dkey(d);
        if (dk < r.createdAt) break;
        if (isSched(r, d)) { sched++; if (routineDone(r, dk)) done++; }
      }
      const rate = sched ? Math.round((done / sched) * 100) : null;
      return `<div class="hstat" style="--hc:${colorOf(r)}">
        <div class="top"><span><i class="sw"></i>${esc(r.emoji)} ${esc(r.name)}</span><span class="rate">${rate !== null ? `${rate}%` : '—'}</span></div>
        <div class="hbar"><i style="width:${rate ?? 0}%"></i></div>
        <div class="small muted" style="margin-top:6px">通算 <b>${routineTotal(r)}</b>回完了 ・ ${r.steps.length}ステップ</div>
      </div>`;
    }).join('')}
  </section>`;
}

function renderLog() {
  const k = todayKey();
  const j = S.journal[k] || {};
  const mood = draftMood ?? j.mood ?? null;
  const MOODS = ['😫', '😕', '😐', '🙂', '😤'];
  const entries = Object.entries(S.journal).filter(([d]) => d !== k).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
  const unlocked = ACHIEVEMENTS.filter(([id]) => S.awarded[`a:${id}`]).length;
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  let active = 0;
  for (let i = 0; i < today.getDate(); i++) if (winsOn(dkey(addDays(first, i))) > 0) active++;

  return `
  <section class="tiles">
    <div class="tile t1"><span class="v">${totalWins()}</span><small>通算クリア</small></div>
    <div class="tile t2"><span class="v">${Math.max(S.bestStreak, dayStreak())}<em>日</em></span><small>自己ベスト連続</small></div>
    <div class="tile t3"><span class="v">${active}<em>/${today.getDate()}</em></span><small>今月 動いた日</small></div>
  </section>
  ${cumulativeChart()}
  ${weeklyChart()}
  ${calendarCard()}
  ${habitsCard()}
  ${routineStatsCard()}

  <section class="card">
    <h2>🏅 実績 <span class="sub">${unlocked} / ${ACHIEVEMENTS.length}</span></h2>
    <div class="achs">
      ${ACHIEVEMENTS.map(([id, icon, name, desc, tier]) => {
        const on = S.awarded[`a:${id}`];
        return `<div class="ach t${tier} ${on ? '' : 'locked'}"><span class="i">${icon}</span><b>${on ? name : '？？？'}</b><small>${desc}</small></div>`;
      }).join('')}
    </div>
  </section>

  <section class="card">
    <h2>📝 ひとこと日誌</h2>
    <div class="moods">${MOODS.map((m, i) => `<button data-act="mood" data-i="${i}" class="${mood === i ? 'on' : ''}">${m}</button>`).join('')}</div>
    <textarea id="journalText" rows="3" placeholder="今日の勝ちポイントを1つ（例：雨でも走った）">${esc(j.text || '')}</textarea>
    <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="primary" data-act="savejournal">保存</button></div>
    ${entries.length ? `<details style="margin-top:12px"><summary class="small">過去の日誌（${entries.length}）</summary>
      ${entries.map(([dd, e]) => `<div class="entry"><div class="d">${dd}（${WD[parseKey(dd).getDay()]}）${e.mood != null ? MOODS[e.mood] : ''}</div>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div>`).join('')}
    </details>` : ''}
  </section>`;
}

// グラフのホバー／タップでツールチップ
function onChartMove(e) {
  const box = e.target.closest('.chart');
  const tip = $('#tip');
  if (!box) { tip.hidden = true; return; }
  const c = charts[box.dataset.chart];
  if (!c) return;
  const svg = box.querySelector('svg');
  const r = svg.getBoundingClientRect();
  const mx = e.clientX - r.left;
  let best = c.pts[0];
  for (const p of c.pts) if (Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p;
  if (c.type === 'line') {
    const xh = svg.querySelector('.xh'), dot = svg.querySelector('.xdot');
    xh.setAttribute('x1', best.x); xh.setAttribute('x2', best.x); xh.style.display = '';
    dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); dot.style.display = '';
  } else {
    svg.querySelectorAll('.bar').forEach((b, i) => b.classList.toggle('hover', c.pts[i] === best));
  }
  tip.innerHTML = best.tip;
  tip.hidden = false;
  const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + best.x - tip.offsetWidth / 2));
  tip.style.left = `${tx}px`;
  tip.style.top = `${r.top + best.y - tip.offsetHeight - 12 + window.scrollY}px`;
}
function hideChartHover() {
  const tip = $('#tip');
  if (tip) tip.hidden = true;
  document.querySelectorAll('.chart .xh, .chart .xdot').forEach((n) => { n.style.display = 'none'; });
  document.querySelectorAll('.chart .bar.hover').forEach((n) => n.classList.remove('hover'));
}
document.addEventListener('pointermove', (e) => { if (e.target.closest('.chart')) onChartMove(e); else if (!$('#tip').hidden) hideChartHover(); });
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.chart')) onChartMove(e); });

/* ---------- render: settings ---------- */
const PSY = [
  ['🔥 つながる鎖（損失回避）', 'クリアした日が鎖のようにつながると「途切れさせたくない」気持ちが生まれます。人は得るより失うことを強く嫌います（カーネマン＆トヴェルスキー）。'],
  ['📈 右肩上がりの積み上げグラフ（進捗の法則）', '前に進んでいると実感できた日に、やる気は最も高まります（アマビール）。通算の積み上げは下がらないので、休んだ後でも「ここまで来た」が見えます。'],
  ['📊 先週の自分と比べる（時間的比較）', '他人と比べると落ち込みやすいですが、過去の自分と比べると自己効力感が上がります。'],
  ['🏆 自己ベストまであと◯日（目標勾配効果）', 'ゴールが近づくほど人は加速します。自己ベストまでの距離を常に表示しています。'],
  ['⭕ 今日の進捗バー（ツァイガルニク効果）', '人は未完了のものを完了させたくなります。「残り1つでパーフェクト」で最後のひと押しを。'],
  ['🛡️ シールド（What-the-hell 効果の防止）', '1回途切れると「もういいや」とやめてしまいがち。7日連続ごとのシールドが休んだ日を守ります。'],
  ['🔁 ルーティーン（ハビット・スタッキング）', '「Aが終わったらB」と行動を鎖のようにつなげると、1つ目を始めるだけで残りが自然に続きます（ジェームズ・クリア）。決まった手順は「何をするか考える」負担（決断疲れ）も減らします。'],
  ['⚡ 最低ライン（タイニー・ハビット）', 'ハードルを下げて「ゼロの日」をなくすのが継続の鍵です（BJ・フォッグ）。'],
  ['🕖 いつやる？（If-Thenプランニング）', '「〜したら、〜する」と決めておくと実行率が大きく上がります（ゴルヴィツァー）。'],
  ['🏅 実績・マイルストーン（目標設定）', '7・21・30・66・100回…と次の目標が常に見えることで、次の一歩が具体的になります（ロック＆レイサム）。'],
  ['🧠 66回で自動化', '新しい行動が自動化するまで平均66日（個人差あり）と言われています（ラリー他）。'],
  ['🎯 目指す姿（アイデンティティ）', 'クリアのたびに「なりたい自分」に近づく。自己イメージが行動を支えます（ジェームズ・クリア）。'],
];

function renderSettings() {
  const archived = S.habits.filter((h) => h.archived);
  const archivedR = S.routines.filter((r) => r.archived);
  return `
  <div class="sec">${notifySection()}</div>
  ${archivedR.length ? `<div class="sec"><h3>🗄️ やめたルーティーン</h3>
    ${archivedR.map((r) => `<div class="setting"><span>${esc(r.emoji)} ${esc(r.name)}（${routineTotal(r)}回）</span><button class="ghost" data-act="rrestore" data-id="${r.id}">再開</button></div>`).join('')}</div>` : ''}
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
  hideChartHover();
  $('#view').innerHTML = tab === 'log' ? renderLog() : renderToday();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if ($('#settingsDialog').open) $('#settingsBody').innerHTML = renderSettings();
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (tab === 'log') render(); }, 200); });

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

/* ---------- routine dialog ---------- */
$('#rDayPicker').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="rday" value="${d}"><span>${WD[d]}</span></label>`).join('');
$('#routineTpls').innerHTML = ROUTINE_TEMPLATES.map((t, i) => `<button type="button" data-act="rtpl" data-i="${i}">${t.emoji} ${t.name}</button>`).join('');
rform().addEventListener('submit', (e) => { if (!saveRoutine()) e.preventDefault(); });
$('#cancelRoutine').addEventListener('click', () => rdlg().close());
$('#archiveRoutine').addEventListener('click', () => {
  const r = S.routines.find((x) => x.id === rfe('id').value);
  if (r && confirm(`「${r.name}」をやめますか？\n（これまでの記録は残ります。⚙️からいつでも再開できます）`)) {
    r.archived = true; save(); rdlg().close(); render();
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
    case 'step': toggleStep(b.dataset.rid, b.dataset.sid); break;
    case 'addroutine': openRoutine(null, null); break;
    case 'editroutine': { const r = S.routines.find((x) => x.id === id); if (r) openRoutine(r); break; }
    case 'rtpl': { const t = ROUTINE_TEMPLATES[Number(b.dataset.i)]; rfe('emoji').value = t.emoji; rfe('name').value = t.name; rfe('time').value = t.time; rfe('steps').value = t.steps.join('\n'); break; }
    case 'rrestore': { const r = S.routines.find((x) => x.id === id); if (r) { r.archived = false; save(); render(); toast(`${esc(r.emoji)} 再開した`); } break; }
    case 'ropen': if (openRoutines.has(id)) openRoutines.delete(id); else openRoutines.add(id); render(); break;
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
    case 'onb-later': onb = null; render(); toast('準備完了。左のボタンでクリアできる'); break;
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
    if (!name) { toast('続けたいことを書こう'); return; }
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
function pulse() {
  requestAnimationFrame(() => {
    const p = document.querySelector('.hero');
    if (p) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
  });
}

const cv = $('#confetti');
const cx = cv.getContext('2d');
let parts = [], animating = false;
const COLORS = ['#ff7a1a', '#f5c542', '#3987e5', '#199e70', '#ffffff', '#e8336b'];
function confetti(n = 40) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * 11 + 3;
    parts.push({
      x: innerWidth / 2, y: innerHeight * 0.35, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
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
    habits: [
      ...hs.filter((h) => h.remindAt).map((h) => ({
        id: h.id, name: h.name, emoji: h.emoji, cue: h.cue, tiny: h.tiny, remindAt: h.remindAt, days: h.days,
        createdAt: h.createdAt, done: !!logOf(h, k), streak, risk: streak > 0 && noneToday,
      })),
      ...activeRoutines().filter((r) => r.time).map((r) => ({
        id: `r:${r.id}`, name: r.name, emoji: r.emoji, cue: `最初のステップ：${r.steps[0] ? r.steps[0].text : ''}`, tiny: '1ステップ目だけ',
        remindAt: r.time, days: r.days, createdAt: r.createdAt, done: routineDone(r, k), streak, risk: streak > 0 && noneToday,
      })),
    ],
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
  const opts = { body: '🕖 決めた時刻に、まだなら通知します。\n⚡ 最低ラインだけでもクリア。', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'test' };
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
      <div><b>📝 ふりかえりの時刻</b><div class="small muted">今日の結果を通知</div></div>
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
  const rs = activeRoutines().filter((r) => r.time);
  if (!hs.length && !rs.length && !S.settings.journalAt) { toast('習慣の「くわしく設定」で時刻を決めてください'); return; }
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
  rs.forEach((r) => events.push(ev(`routine-${r.id}`, r.time, r.days, `${r.emoji} ${r.name}`,
    `${r.steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}\n✔ 終わったら「つづく.」でチェック！`)));
  if (S.settings.journalAt) events.push(ev('journal', S.settings.journalAt, [0, 1, 2, 3, 4, 5, 6], '📝 つづく. 今日の結果チェック', '今日の勝ちポイントを1つ記録しよう'));
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
  if (p.get('act') === 'habit' && (p.get('id') || '').startsWith('r:')) {
    tab = 'today'; render(); // ルーティーンの通知 → 今日の画面を開く
  } else if (p.get('act') === 'habit') {
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
checkAchievements(true);
render();
if (location.search) { handleParams(location.search); history.replaceState(null, '', location.pathname); }
S.lastOpen = todayKey();
save();

let lastDay = todayKey();
setInterval(() => {
  if (todayKey() !== lastDay) { lastDay = todayKey(); processShields(); S.lastOpen = lastDay; save(); render(); }
}, 60000);
