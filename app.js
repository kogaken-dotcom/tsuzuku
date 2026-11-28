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
    work: defaultWork(), // 仕事（最低ライン・目標・面談・フォロー・ふりかえり・私の基準）
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
  st.work = Object.assign(defaultWork(), obj.work || {});
  st.work.goal = Object.assign(defaultWork().goal, (obj.work || {}).goal || {});
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
  return habits + routinesDoneOn(k) + (activityMetOn(k) ? 1 : 0) + S.todos.filter((t) => t.done && t.doneAt === k).length;
}
function totalWins() {
  let n = 0;
  for (const k in S.logs) n += Object.keys(S.logs[k]).length;
  for (const k in S.rlogs) n += routinesDoneOn(k);
  for (const k in S.work.alog) if (activityMetOn(k)) n++;
  return n + S.todos.filter((t) => t.done).length;
}

/* =========================================================
 * 仕事：毎日の最低ライン・目標と期限・面談チェック・契約後フォロー・
 *       ABCセットアップ・週1ふりかえり・私の基準・Notion用コピー
 * ※ 個人の目標や考え方はすべてアプリ内で入力し、この端末にだけ保存されます
 * ========================================================= */
function defaultWork() {
  return {
    principles: '', mentor: '',
    metrics: [{ id: 'm1', name: '連絡', min: 5 }, { id: 'm2', name: 'アポ獲得', min: 1 }, { id: 'm3', name: '面談', min: 1 }],
    alog: {},       // { 'YYYY-MM-DD': { metricId: count } }
    meetings: [],   // { id, date, who, first, checks:{}, score, next, note }
    contracts: [],  // { id, date, who }
    abc: { checked: [] },
    reviews: {},    // { 週の月曜日: { a:[...], savedAt } }
    channels: ['交流会', '紹介', 'マッチングアプリ', 'SNS', '既存のお客様', 'その他'], // 出会ったフィールド
    hypotheses: [], // { id, text, metric, until, status:'testing'|'hit'|'miss', result, createdAt }
    reports: {},    // 日報 { 'YYYY-MM-DD': { a:[...], savedAt, sentAt } }
    reportTo: '',   // 日報の提出先
    inputs: [],     // 学び { id, date, text }
    outputs: [],    // アウトプット { id, date, type, title, people }
    seminar: { date: '', title: '' }, // 次のセミナー・勉強会
    goal: { contractTarget: 0, contractDeadline: '', contractStart: dkey(), monthlyTarget: 0, ksf: [], conditions: [], deadlineDate: '', deadlineLabel: '', incomeTarget: 0, income: {}, history: [] },
  };
}
const W = () => S.work;
const metricsWithMin = () => W().metrics.filter((m) => m.min > 0);
const actOn = (k, m) => (W().alog[k] && W().alog[k][m.id]) || 0;
const activityMetOn = (k) => metricsWithMin().length > 0 && metricsWithMin().every((m) => actOn(k, m) >= m.min);
function activityStreak() {
  let s = activityMetOn(todayKey()) ? 1 : 0;
  let d = addDays(new Date(), -1);
  for (let i = 0; i < 3650; i++) { if (activityMetOn(dkey(d))) s++; else break; d = addDays(d, -1); }
  return s;
}
const daysLeft = (k) => Math.max(0, diffDays(todayKey(), k));
const contractCount = () => W().contracts.filter((c) => c.date >= (W().goal.contractStart || '0000')).length;
const mentorName = () => W().mentor || '相談相手';
const hashStr = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

// 貼り付けた「考え方・行動基準」から、箇条書きの1行ずつを取り出す
function parsePrinciples(text) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || /^[━─＝=\-—_]{3,}/.test(line) || /^[【■◆●]/.test(line) || /^[→※]/.test(line)) continue;
    line = line.replace(/^(・|[-*•]|[0-9０-９]+[.．、)）]\s*)/, '').trim();
    if (line.length < 4 || line.length > 140) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

/* ----- 今日の画面：判断基準 ----- */
let compassOffset = 0;
// 経営者として自分に問いかける質問（毎日1つ）
const MINDSET_QS = [
  'もし明日、看板と商品が消えても、お客様と自分のスキルで来月稼げるか？',
  '「株式会社自分」の経営者として、今日なにを決める？',
  '仮説を持たない実行は、ただの浪費。今日の行動の仮説は？',
  '2割できたら、まずやる。完璧を待っていないか？',
  '受けただけの研修は、受けていないのと同じ。最近学んだことを今すぐ話せるか？',
  '自分ひとりで完結する予定（勉強・振り返り・連絡）も、時間を決めて入れたか？',
  '分からないことを、先を走っている人に聞いたか？',
  '今日の行動は、自分でコントロールできるKPIに沿っているか？',
  '指示を待っていないか？ 自分で考えて、自分で動いているか？',
  '1週間前の自分より、今日の自分は楽にできているか？',
];
const mindsetQ = () => MINDSET_QS[(hashStr(`q${todayKey()}`) + compassOffset) % MINDSET_QS.length];
function goalStrip() {
  const g = W().goal, parts = [];
  if (g.contractTarget) parts.push(`🎯 契約 <b>${contractCount()}</b>/${g.contractTarget}${g.contractDeadline ? `（残り${daysLeft(g.contractDeadline)}日）` : ''}`);
  if (g.deadlineDate) parts.push(`⏳ ${esc(g.deadlineLabel || '期限')}まで <b>${daysLeft(g.deadlineDate)}</b>日`);
  return parts.length ? `<div class="goalstrip">${parts.join('<span class="sep">・</span>')}</div>` : '';
}
function compassCard() {
  const ps = parsePrinciples(W().principles);
  if (!ps.length) {
    return `<section class="card compass">
      <div class="c-top"><span class="c-label">🧭 今日の判断基準</span></div>
      <div class="small muted">自分の「考え方・行動基準」を登録すると、毎日ここに1つずつ表示されます。</div>
      <button class="ghost" data-act="gotowork" style="margin-top:8px">私の基準を登録する</button>
      <div class="mq">💭 今日の問い：${esc(mindsetQ())}</div>
      ${goalStrip()}
    </section>`;
  }
  const i = (hashStr(todayKey()) + compassOffset) % ps.length;
  return `<section class="card compass">
    <div class="c-top"><span class="c-label">🧭 今日の判断基準</span><button class="linkbtn" data-act="compassnext">別のを見る</button></div>
    <div class="principle">${esc(ps[i])}</div>
    <div class="mq">💭 今日の問い：${esc(mindsetQ())}</div>
    ${goalStrip()}
  </section>`;
}

/* ----- 今日の画面：活動量（最低ライン） ----- */
function activityCard() {
  const k = todayKey(), ms = W().metrics;
  if (!ms.length) return '';
  const met = activityMetOn(k);
  const remain = metricsWithMin().reduce((a, m) => a + Math.max(0, m.min - actOn(k, m)), 0);
  return `<section class="card act ${met ? 'met' : ''}">
    <h2>📊 今日の活動量 <span class="sub">${met ? '✔ 最低ラインクリア' : `最低ラインまで あと${remain}`}</span></h2>
    ${ms.map((m) => {
      const v = actOn(k, m), pct = m.min ? Math.min(100, (v / m.min) * 100) : (v ? 100 : 0);
      return `<div class="metric ${m.min && v >= m.min ? 'ok' : ''}">
        <div class="m-name">${esc(m.name)}<small>${m.min ? `最低 ${m.min}` : '記録のみ'}</small></div>
        <div class="m-bar"><i style="width:${pct}%"></i></div>
        <button class="m-btn" data-act="actminus" data-id="${m.id}" aria-label="${esc(m.name)}を減らす">−</button>
        <div class="m-val">${v}</div>
        <button class="m-btn plus" data-act="actplus" data-id="${m.id}" aria-label="${esc(m.name)}を増やす">＋</button>
      </div>`;
    }).join('')}
    <div class="small muted" style="margin-top:8px">🔥 最低ライン連続 <b>${activityStreak()}</b>日 ・ 外からの刺激に頼らず、毎日このラインだけは守る</div>
  </section>`;
}
function bumpActivity(id, d, silent) {
  const k = todayKey(), m = W().metrics.find((x) => x.id === id);
  if (!m) return;
  const wasMet = activityMetOn(k), first = winsOn(k) === 0;
  W().alog[k] = W().alog[k] || {};
  W().alog[k][id] = Math.max(0, (W().alog[k][id] || 0) + d);
  const met = activityMetOn(k);
  if (met && !wasMet) { toast('📊 今日の最低ラインクリア！'); confetti(100); afterWin(first); }
  else if (!silent && d > 0 && m.min && W().alog[k][id] === m.min) toast(`✔ ${esc(m.name)} 最低ライン到達`);
  if (silent) return;
  save(); render();
}

/* ----- 24時間ルール ----- */
let todoMode = '';
const TODO_KIND = { insight: '💡', regret: '😤', follow: '📞', meet: '📅', output: '🎤' };
function dueLabel(t) {
  if (!t.due || t.done) return '';
  const ms = t.due - Date.now();
  if (ms < 0) return '<span class="due over">⚠️ 期限切れ</span>';
  const h = Math.floor(ms / 3600000);
  return `<span class="due ${h < 3 ? 'soon' : ''}">⏳ 残り${h >= 1 ? `${h}時間` : `${Math.max(1, Math.ceil(ms / 60000))}分`}</span>`;
}
const overdueCount = () => S.todos.filter((t) => !t.done && t.due && t.due < Date.now()).length;

/* ----- 目標と期限 ----- */
function goalCard() {
  const g = W().goal;
  const set = g.contractTarget || g.deadlineDate || g.incomeTarget || g.conditions.length || g.monthlyTarget || (g.ksf || []).length;
  if (!set) {
    return `<section class="card"><h2>🎯 目標と期限</h2>
      <div class="empty small">契約目標・達成条件・期限・収入の基準を登録すると、毎日の画面で確認できます。</div>
      <button class="primary" data-act="editgoal" style="width:100%">目標を設定する</button></section>`;
  }
  const cc = contractCount(), ym = todayKey().slice(0, 7), inc = Number(g.income[ym] || 0);
  const left = g.contractDeadline ? daysLeft(g.contractDeadline) : null;
  const pace = left && g.contractTarget > cc ? ((g.contractTarget - cc) / Math.max(1, left / 7)).toFixed(1) : null;
  const okMonths = Object.values(g.income).filter((v) => g.incomeTarget && Number(v) >= g.incomeTarget).length;
  return `<section class="card goal">
    <h2>🎯 目標と期限 <button class="linkbtn" data-act="editgoal" style="margin-left:auto">編集</button></h2>
    ${g.contractTarget ? `<div class="g-block">
      <div class="g-row"><span>契約</span><span class="g-big">${cc}<small> / ${g.contractTarget}</small></span></div>
      <div class="g-bar"><i style="width:${Math.min(100, (cc / g.contractTarget) * 100)}%"></i></div>
      <div class="small muted">${left !== null ? `期限まで残り <b>${left}</b>日` : ''}${cc >= g.contractTarget ? ' ・ 🎉 達成！' : pace ? ` ・ 必要ペース 週${pace}件` : ''}</div>
    </div>` : ''}
    ${g.monthlyTarget ? (() => { const mc = W().contracts.filter((c) => c.date.startsWith(todayKey().slice(0, 7))).length;
      return `<div class="g-block"><div class="g-row"><span>今月の契約</span><span class="g-big">${mc}<small> / ${g.monthlyTarget}</small></span></div>
        <div class="g-bar"><i style="width:${Math.min(100, (mc / g.monthlyTarget) * 100)}%"></i></div></div>`; })() : ''}
    ${(g.ksf || []).length ? `<div class="g-block"><div class="g-sub">🔑 成功の鍵（KSF）</div>
      ${g.ksf.map((x) => `<div class="ksf">${esc(x)}</div>`).join('')}
      <div class="small muted" style="margin-top:4px">→ 毎日の行動（KPI）は「📊 活動量」で記録。KPIは自分で100%コントロールできる</div></div>` : ''}
    ${g.conditions.length ? `<div class="g-block">
      <div class="g-sub">達成条件 ${g.conditions.filter((c) => c.done).length} / ${g.conditions.length}</div>
      ${g.conditions.map((c) => `<button class="cond ${c.done ? 'on' : ''}" data-act="cond" data-id="${c.id}"><span class="sc">${c.done ? '✔' : ''}</span><span>${esc(c.text)}</span></button>`).join('')}
    </div>` : ''}
    ${g.deadlineDate ? `<div class="g-block g-dead">
      <span>⏳ ${esc(g.deadlineLabel || '期限')}</span><span class="g-big">${daysLeft(g.deadlineDate)}<small>日</small></span>
      <span class="small muted">${g.deadlineDate.replace(/-/g, '/')}</span>
    </div>` : ''}
    ${g.incomeTarget ? `<div class="g-block">
      <div class="g-row"><span>今月の収入</span><span class="inc-in"><input type="number" id="incomeInput" value="${inc || ''}" placeholder="0" inputmode="numeric">円</span></div>
      <div class="g-bar inc"><i style="width:${Math.min(100, (inc / g.incomeTarget) * 100)}%"></i></div>
      <div class="small muted">基準 ${g.incomeTarget.toLocaleString()}円 ${inc >= g.incomeTarget ? '・ ✔ 今月クリア' : `まで あと${(g.incomeTarget - inc).toLocaleString()}円`} ・ 基準を超えた月 ${okMonths}</div>
    </div>` : ''}
    ${g.history.length ? `<details class="small"><summary>目標の変更履歴（${g.history.length}）</summary>
      ${g.history.slice().reverse().map((h) => `<div class="entry"><div class="d">${h.date}</div><p>${esc(h.change)}<br>理由：${esc(h.reason)}${h.told ? `（${esc(mentorName())}に共有済み）` : ''}</p></div>`).join('')}
    </details>` : ''}
  </section>`;
}
function openGoal() {
  const g = W().goal;
  openForm(`<form method="dialog" id="goalForm">
    <h2>🎯 目標と期限</h2>
    <label>契約目標（件）<input type="number" name="contractTarget" min="0" value="${g.contractTarget || ''}" inputmode="numeric"></label>
    <label>契約目標の期限<input type="date" name="contractDeadline" value="${g.contractDeadline}"></label>
    <label>契約を数え始める日<input type="date" name="contractStart" value="${g.contractStart}"><small>この日以降に「契約後フォロー」で記録した契約を数えます</small></label>
    <label>今月の契約目標（件）<input type="number" name="monthlyTarget" min="0" value="${g.monthlyTarget || ''}" inputmode="numeric"><small>年間（期限）の目標から逆算した、今月の目標</small></label>
    <label>🔑 成功の鍵（KSF）：目標達成に欠かせないこと（3〜5個・1行に1つ）
      <textarea name="ksf" rows="3" placeholder="例：紹介を途切れさせない&#10;ライフプランで潜在的な不安を深く聞き出す&#10;契約後のフォローで信頼関係を築く">${esc((g.ksf || []).join('\n'))}</textarea>
      <small>KSFを実行するための「毎日の行動（KPI）」は、仕事タブの「活動量の最低ライン」で決めます</small></label>
    <label>達成条件（1行に1つ）<textarea name="conditions" rows="3" placeholder="例：資格試験に合格">${esc(g.conditions.map((c) => c.text).join('\n'))}</textarea></label>
    <label>期限の名前<input name="deadlineLabel" value="${esc(g.deadlineLabel)}" placeholder="例：判断の期限"></label>
    <label>期限日<input type="date" name="deadlineDate" value="${g.deadlineDate}"></label>
    <label>毎月の収入の基準（円）<input type="number" name="incomeTarget" min="0" value="${g.incomeTarget || ''}" inputmode="numeric"></label>
    <div class="guard">
      <b>🔒 目標の定義を変えるとき</b>
      <small>一度決めた目標を変えるときは、理由を書き、${esc(mentorName())}に伝えてから保存します（新しく決めるときは不要）</small>
      <label>変える理由<textarea name="reason" rows="2"></textarea></label>
      <label class="inline"><input type="checkbox" name="told"> ${esc(mentorName())}に伝えた</label>
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button type="button" class="ghost" data-act="closeform">キャンセル</button><button class="primary">保存</button></div>
  </form>`);
}
function saveGoal(f) {
  const g = W().goal, v = (n) => f.elements.namedItem(n).value.trim();
  const next = {
    contractTarget: Number(v('contractTarget')) || 0, contractDeadline: v('contractDeadline'), contractStart: v('contractStart') || g.contractStart,
    deadlineLabel: v('deadlineLabel'), deadlineDate: v('deadlineDate'), incomeTarget: Number(v('incomeTarget')) || 0,
  };
  const labels = { contractTarget: '契約目標', contractDeadline: '契約の期限', deadlineDate: '期限日', incomeTarget: '収入の基準' };
  const changes = Object.keys(labels).filter((key) => g[key] && String(g[key]) !== String(next[key]))
    .map((key) => `${labels[key]}：${g[key]} → ${next[key] || 'なし'}`);
  if (changes.length) {
    const reason = v('reason'), told = f.elements.namedItem('told').checked;
    if (!reason || !told) { toast(`目標を変えるときは、理由を書いて${esc(mentorName())}に伝えてから`); return false; }
    g.history.push({ date: todayKey(), change: changes.join(' / '), reason, told });
  }
  const lines = v('conditions').split('\n').map((s) => s.trim()).filter(Boolean);
  g.conditions = lines.map((text) => g.conditions.find((c) => c.text === text) || { id: uid(), text, done: false });
  g.ksf = v('ksf').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 7);
  g.monthlyTarget = Number(v('monthlyTarget')) || 0;
  Object.assign(g, next);
  save(); render(); toast('🎯 目標を保存しました');
  return true;
}

/* ----- 面談チェック ----- */
const MEET_CHECKS = [
  ['customer', 'お客様の利益を最優先にできた（守れた）', false],
  ['honest', '相手が損をしないために、言うべきことを言えた', false],
  ['next', '次の約束をその場で日時まで決めた', false],
  ['nopitch', '事実確認とニーズ把握に徹し、商品の提案はしなかった', true],
  ['numbers', '数字で聞いた（引退する年齢・毎月の必要額など）', false],
  ['deep', '縦に深掘る質問をした', false],
  ['noscare', '不安をあおらず、最後は背中を押した', false],
];
const MEET_RESULTS = [['meet', '面談のみ'], ['appo', '次のアポ獲得'], ['offer', '提案（オファー）'], ['contract', '契約']];
// フィールドごとの数字管理：どこで出会った人が、どこまで進んでいるか
function channelTable() {
  const by = {};
  W().meetings.forEach((m) => {
    const c = m.channel || '未設定';
    by[c] = by[c] || { n: 0, offer: 0, contract: 0 };
    by[c].n++;
    if (m.result === 'offer' || m.result === 'contract') by[c].offer++;
    if (m.result === 'contract') by[c].contract++;
  });
  const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) return '';
  const best = Math.max(...rows.map(([, v]) => (v.n ? v.contract / v.n : 0)));
  return `<div class="g-sub" style="margin-top:12px">フィールド別の数字（どこで出会った人が成約しやすいか）</div>
    <table class="ctab"><thead><tr><th>フィールド</th><th>面談</th><th>提案</th><th>契約</th><th>成約率</th></tr></thead><tbody>
    ${rows.map(([c, v]) => { const r = v.n ? Math.round((v.contract / v.n) * 100) : 0;
      return `<tr class="${v.n && v.contract / v.n === best && best > 0 ? 'top' : ''}"><td>${esc(c)}</td><td>${v.n}</td><td>${v.offer}</td><td>${v.contract}</td><td><div class="rbar"><i style="width:${r}%"></i><span>${r}%</span></div></td></tr>`; }).join('')}
    </tbody></table>
    <div class="small muted">件数が少ないうちは参考程度に。数字をもとに「来月どのフィールドに時間を使うか」を決める</div>`;
}
function meetingCard() {
  const ms = W().meetings.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const n = ms.length, kept = ms.filter((m) => m.checks.customer).length;
  const last10 = ms.slice(0, 10).reverse();
  return `<section class="card">
    <h2>🤝 面談チェック <span class="sub">${n ? `守れた率 ${Math.round((kept / n) * 100)}%（${kept}/${n}）` : ''}</span></h2>
    <div class="small muted" style="margin-bottom:8px">自分の印象ではなく、お客様の結果に集中できたかを毎回記録する</div>
    ${n ? `<div class="mbars">${last10.map((m) => `<div class="mb" title="${md(m.date)} ${esc(m.who)}：${m.score}%"><div class="mb-col"><i style="height:${Math.max(6, m.score)}%" class="${m.checks.customer ? '' : 'warn'}"></i></div><span>${md(m.date)}</span></div>`).join('')}</div>
      <div class="small muted" style="margin:4px 0 8px">棒＝チェックの達成率（直近10件）・🛡️ 守れた／⚠️ 守れなかった</div>` : ''}
    ${ms.slice(0, 5).map((m) => `<div class="mrow"><span>${m.checks.customer ? '🛡️' : '⚠️'} ${md(m.date)} ${esc(m.who || '（名前なし）')}${m.first ? ' ・初回' : ''}${m.result ? ` ・${(MEET_RESULTS.find((x) => x[0] === m.result) || [, ''])[1]}` : ''}</span><span class="small muted">${m.score}%</span></div>`).join('')}
    ${channelTable()}
    <button class="primary" data-act="addmeeting" style="width:100%;margin-top:10px">＋ 面談を記録（アポ後すぐ）</button>
  </section>`;
}
function openMeeting() {
  openForm(`<form method="dialog" id="meetingForm">
    <h2>🤝 面談を記録</h2>
    <label>相手（イニシャル推奨）<input name="who" placeholder="例：Aさん" autocomplete="off"></label>
    <label>日付<input type="date" name="date" value="${todayKey()}"></label>
    <div class="row"><label class="grow">出会ったフィールド<select name="channel">${W().channels.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="grow">結果<select name="result">${MEET_RESULTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div>
    <label class="inline"><input type="checkbox" name="first"> 初回面談</label>
    <label>🧪 この面談で試したこと（仮説）<input name="hypo" placeholder="例：最初に「入っているもの」を聞いてから数字で深掘る" autocomplete="off"></label>
    <div class="g-sub" style="margin-top:6px">ふりかえりチェック</div>
    ${MEET_CHECKS.map(([key, label, firstOnly]) => `<label class="inline ${firstOnly ? 'first-only' : ''}"><input type="checkbox" name="c_${key}"> ${label}${firstOnly ? '（初回）' : ''}</label>`).join('')}
    <label class="inline"><input type="checkbox" name="fb"> 先輩・マネージャーからフィードバックをもらった</label>
    <label style="margin-top:8px">👍 良かった点<textarea name="good" rows="2"></textarea></label>
    <label>🔧 悪かった点・次回どうする<textarea name="note" rows="2"></textarea><small>書くと、24時間ルールの「やること」になります</small></label>
    <label>📅 次の約束（日時）<input type="datetime-local" name="next"><small>入れると、その日の「やること」に自動で入ります</small></label>
    <div class="dialog-actions"><span class="spacer"></span><button type="button" class="ghost" data-act="closeform">キャンセル</button><button class="primary">保存</button></div>
  </form>`);
}
function saveMeeting(f) {
  const v = (n) => f.elements.namedItem(n);
  const first = v('first').checked;
  const checks = {};
  let total = 0, ok = 0;
  MEET_CHECKS.forEach(([key, , firstOnly]) => {
    if (firstOnly && !first) return;
    checks[key] = v(`c_${key}`).checked; total++; if (checks[key]) ok++;
  });
  const m = {
    id: uid(), date: v('date').value || todayKey(), who: v('who').value.trim(), first, checks, score: Math.round((ok / total) * 100),
    next: v('next').value, note: v('note').value.trim(), good: v('good').value.trim(), hypo: v('hypo').value.trim(),
    channel: v('channel').value, result: v('result').value, fb: v('fb').checked,
  };
  W().meetings.push(m);
  if (m.result === 'contract') addContract(m.who || '契約者', m.date, true);
  if (m.next) {
    const [nd, nt] = m.next.split('T');
    S.todos.push({ id: uid(), text: `${m.who || '次回'}との面談 ${md(nd)} ${nt || ''}`.trim(), frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: 'meet', date: nd, due: null });
  }
  if (m.note) {
    S.todos.push({ id: uid(), text: `面談の改善：${m.note}`, frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: 'insight', due: Date.now() + 86400000, date: null });
  }
  const meetMetric = W().metrics.find((x) => x.name.includes('面談'));
  if (meetMetric && m.date === todayKey()) bumpActivity(meetMetric.id, 1, true);
  toast(m.checks.customer ? `🛡️ 記録しました（チェック ${m.score}%）` : '⚠️ 記録しました。「守れなかった」理由を自責で考えよう');
  save(); render();
}

/* ----- 契約後フォロー ----- */
const FOLLOW_STEPS = [[1, '翌日の連絡'], [7, '1週間後の連絡'], [30, '1か月後の連絡']];
function followCard() {
  const k = todayKey();
  const upcoming = S.todos.filter((t) => !t.done && t.kind === 'follow' && t.date && t.date > k).sort((a, b) => (a.date < b.date ? -1 : 1));
  const cs = W().contracts.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<section class="card">
    <h2>📞 契約後フォロー <span class="sub">${cs.length ? `記録 ${cs.length}件` : ''}</span></h2>
    <form id="contractForm" class="todo-add"><input name="who" placeholder="契約者（イニシャル推奨）" autocomplete="off"><input type="date" name="date" value="${k}" class="date-in"><button class="primary">記録</button></form>
    <div class="small muted">記録すると「翌日・1週間後・1か月後」の連絡が、その日の「やること」に自動で入ります</div>
    ${upcoming.length ? `<div class="g-sub" style="margin-top:12px">これからのフォロー</div>
      ${upcoming.slice(0, 8).map((t) => `<div class="mrow"><span>📞 ${esc(t.text)}</span><span class="small muted">${md(t.date)}</span></div>`).join('')}` : ''}
    ${cs.length ? `<details class="small" style="margin-top:8px"><summary>契約の記録（${cs.length}）</summary>
      ${cs.map((c) => `<div class="mrow"><span>${md(c.date)} ${esc(c.who)}</span><button class="linkbtn" data-act="delcontract" data-id="${c.id}">削除</button></div>`).join('')}
    </details>` : ''}
  </section>`;
}
function saveContract(f) {
  addContract(f.elements.namedItem('who').value.trim() || '契約者', f.elements.namedItem('date').value || todayKey(), false);
}
function addContract(who, date, fromMeeting) {
  const c = { id: uid(), date, who };
  W().contracts.push(c);
  FOLLOW_STEPS.forEach(([n, label]) => {
    S.todos.push({ id: uid(), text: `${who}：${label}`, frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: 'follow', date: dkey(addDays(parseKey(date), n)), due: null, ref: c.id });
  });
  const g = W().goal;
  if (g.contractTarget) celebrate('🤝', `契約 ${contractCount()} / ${g.contractTarget}`, 'フォローの予定（翌日・1週間後・1か月後）を「やること」に入れました。<br>ゴールは「この人から紹介をもらうこと」。');
  else toast('🤝 契約を記録。フォローの予定を入れました');
  confetti(120);
  if (!fromMeeting) { save(); render(); }
}

/* ----- ABCセットアップ ----- */
const ABC_STEPS = [
  'C（お客様）を知る：現状・悩み・聞きたいこと',
  'A（紹介する専門家）を伝える：人柄・実績・専門性',
  '面談を整える：目的・ゴール・安心感',
  '組む前のチェックリストを確認した',
];
function abcCard() {
  const a = W().abc;
  const n = a.checked.length;
  return `<section class="card">
    <h2>🔺 ABCセットアップ <span class="sub">${n}/${ABC_STEPS.length}</span></h2>
    <div class="small muted" style="margin-bottom:8px">Bとしての自分の役割。面談を組む前に上から確認する</div>
    ${ABC_STEPS.map((s, i) => `<button class="cond ${a.checked.includes(i) ? 'on' : ''}" data-act="abc" data-i="${i}"><span class="sc">${a.checked.includes(i) ? '✔' : i + 1}</span><span>${s}</span></button>`).join('')}
    ${n ? '<button class="linkbtn" data-act="abcreset">リセットして次のABCへ</button>' : ''}
  </section>`;
}

/* ----- 週1ふりかえり ----- */
const REVIEW_QS = [
  '今週いちばん前に進んだことは？',
  '教えた・伝えた結果、相手は動いたか？',
  'うまくいかなかったことの原因は、自分のどこにある？（完全自責）',
  '目標を見直して、来週いちばん大事な一つの行動は？',
  '最低ラインは守れたか？ 来週変えることは？',
];
const reviewKey = () => { const d = new Date(); return dkey(d.getDay() === 1 ? addDays(mondayOf(d), -7) : mondayOf(d)); };
function reviewCard() {
  const key = reviewKey(), r = W().reviews[key] || {};
  const past = Object.entries(W().reviews).filter(([k]) => k !== key).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8);
  return `<section class="card">
    <h2>🗓️ 週1ふりかえり <span class="sub">${md(key)}の週${r.savedAt ? ' ✔ 記入済み' : ''}</span></h2>
    <div class="small muted" style="margin-bottom:8px">日曜か月曜に、じっくり考える時間をとる</div>
    <form id="reviewForm">
      ${REVIEW_QS.map((q, i) => `<label class="rq">${q}<textarea name="q${i}" rows="2">${esc((r.a || [])[i] || '')}</textarea></label>`).join('')}
      <button class="primary" style="width:100%">保存</button>
    </form>
    ${past.length ? `<details class="small" style="margin-top:10px"><summary>過去のふりかえり（${past.length}）</summary>
      ${past.map(([k, v]) => `<div class="entry"><div class="d">${md(k)}の週</div>${(v.a || []).map((x, i) => (x ? `<p><b>${REVIEW_QS[i]}</b><br>${esc(x)}</p>` : '')).join('')}</div>`).join('')}
    </details>` : ''}
  </section>`;
}

/* ----- 活動量の設定 ----- */
function metricsCard() {
  const k = todayKey();
  let sq = '';
  for (let i = 13; i >= 0; i--) {
    const dk = dkey(addDays(new Date(), -i));
    sq += `<i class="${activityMetOn(dk) ? 'on' : ''} ${dk === k ? 'today' : ''}" title="${md(dk)}"></i>`;
  }
  return `<section class="card">
    <h2>📊 KPI：毎日の最低ライン <span class="sub">連続 ${activityStreak()}日</span></h2>
    <div class="small muted" style="margin-bottom:8px">成約数や売上はお客様次第。でも連絡・アポ・面談の数は、自分で100%コントロールできる。ここを守れば目標（KGI）は近づく</div>
    <div class="sq14">${sq}</div>
    <div class="small muted" style="margin-bottom:10px">直近14日（光っている日＝最低ラインクリア）</div>
    <form id="metricsForm">
      ${W().metrics.map((m) => `<div class="mset"><input name="n_${m.id}" value="${esc(m.name)}" aria-label="項目名"><input type="number" min="0" name="v_${m.id}" value="${m.min}" inputmode="numeric" aria-label="最低ライン"><button type="button" class="linkbtn" data-act="delmetric" data-id="${m.id}">削除</button></div>`).join('')}
      <div class="row" style="margin-top:8px"><button type="button" class="ghost" data-act="addmetric">＋ 項目を追加</button><span class="spacer"></span><button class="primary">保存</button></div>
    </form>
    <div class="small muted" style="margin-top:6px">最低ラインは「調子が悪い日でもできる量」に固定する。0にすると記録だけの項目になります</div>
    <details class="small" style="margin-top:8px"><summary>KPIの決め方（SMARTチェック）</summary>
      <div class="smart">
        <div><b>S</b> 具体的か：「意識する」ではなく「何を何件」になっている</div>
        <div><b>M</b> 測れるか：数字で記録できる</div>
        <div><b>A</b> 達成できるか：ギリギリ届く量。無謀だと続かない</div>
        <div><b>R</b> 目標につながるか：成功の鍵（KSF）に関係している</div>
        <div><b>T</b> 期限があるか：毎日・今週など、いつまでかが明確</div>
        <div class="muted">項目は3〜5個がおすすめ。多すぎると守れない</div>
      </div>
    </details>
  </section>`;
}

/* ----- 私の基準 ----- */
function principlesCard() {
  const n = parsePrinciples(W().principles).length;
  return `<section class="card">
    <h2>🧭 私の基準 <span class="sub">${n ? `${n}項目` : ''}</span></h2>
    <div class="small muted" style="margin-bottom:8px">考え方・判断基準・行動基準をそのまま貼り付けてください。箇条書きの1行ずつが「今日の判断基準」として毎日1つ表示されます。<b>この内容はこの端末の中だけに保存され、外部には送信されません。</b></div>
    <form id="principlesForm">
      <textarea name="p" rows="8" placeholder="・迷ったら〜で決める&#10;・毎日〜だけは必ずやる">${esc(W().principles)}</textarea>
      <label class="rq">目標を変えるときに伝える相手（任意）<input name="mentor" value="${esc(W().mentor)}" placeholder="例：上司・メンターの名前" autocomplete="off"></label>
      <button class="primary" style="width:100%;margin-top:8px">保存</button>
    </form>
  </section>`;
}

/* ----- Notion用コピー ----- */
function dayMarkdown() {
  const k = todayKey(), d = new Date();
  const L = [`## ${k}（${WD[d.getDay()]}）`];
  const ms = W().metrics;
  if (ms.length) L.push(`- 活動量：${ms.map((m) => `${m.name} ${actOn(k, m)}${m.min ? `/${m.min}` : ''}`).join('・')}（最低ライン：${activityMetOn(k) ? 'クリア' : '未達'}）`);
  const hs = activeHabits().filter((h) => isSched(h, d));
  if (hs.length) L.push(`- 習慣：${hs.map((h) => `${h.name}${logOf(h, k) ? '✔' : '－'}`).join('・')}`);
  const rs = activeRoutines().filter((r) => isSched(r, d));
  if (rs.length) L.push(`- ルーティーン：${rs.map((r) => `${r.name}${routineDone(r, k) ? '✔' : '－'}`).join('・')}`);
  W().meetings.filter((m) => m.date === k).forEach((m) => L.push(`- 面談：${m.who || '（名前なし）'}（${m.checks.customer ? '守れた' : '要ふりかえり'}・チェック${m.score}%）${m.note ? ` メモ：${m.note}` : ''}`));
  const done = S.todos.filter((t) => t.done && t.doneAt === k);
  if (done.length) L.push(`- 完了：${done.map((t) => t.text).join('、')}`);
  const rep = W().reports[k];
  if (rep && rep.a) REPORT_QS.forEach((q, i) => { if (rep.a[i]) L.push(`- ${q}：${rep.a[i].replace(/\n/g, ' ')}`); });
  const ins = S.todos.filter((t) => (t.kind === 'insight' || t.kind === 'regret') && t.createdAt === k);
  if (ins.length) L.push(`- 気づき・悔しい→行動：${ins.map((t) => `${t.text}${t.done ? '（実行済み）' : ''}`).join('、')}`);
  const j = S.journal[k];
  if (j && j.text) L.push(`- 日誌：${j.text}`);
  L.push(`- 🔥 連続 ${dayStreak()}日 ／ 最低ライン連続 ${activityStreak()}日`);
  return L.join('\n');
}
async function copyDay() {
  const txt = dayMarkdown();
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* noop */ }
    ta.remove();
  }
  toast('📋 今日の記録をコピーしました。Notionに貼り付けてください');
}
function notionCard() {
  return `<section class="card">
    <h2>📋 Notionに記録</h2>
    <div class="small muted" style="margin-bottom:8px">今日の活動量・習慣・面談・気づき・日誌をまとめてコピーします。Notionのページにそのまま貼り付けてください。</div>
    <button class="ghost" data-act="copyday" style="width:100%">📋 今日の記録をコピー</button>
  </section>`;
}

/* ----- 仮説と検証（仮説を持たない実行はただの浪費） ----- */
function hypoCard() {
  const hs = W().hypotheses;
  const testing = hs.filter((h) => h.status === 'testing');
  const done = hs.filter((h) => h.status !== 'testing').slice().reverse();
  const hit = done.filter((h) => h.status === 'hit').length;
  return `<section class="card">
    <h2>🧪 仮説と検証 <span class="sub">${done.length ? `検証済み ${done.length}件（当たり ${hit}）` : ''}</span></h2>
    <div class="small muted" style="margin-bottom:8px">「なんとなく数をこなす」をやめる。こうしたら → こうなるはず、を決めて数字で確かめる</div>
    ${testing.map((h) => `<div class="hypo">
      <div class="h-text">${esc(h.text)}</div>
      <div class="small muted">📏 ${esc(h.metric || '測るもの未設定')}${h.until ? ` ・ 〜${md(h.until)}（残り${daysLeft(h.until)}日）` : ''}</div>
      <div class="h-judge"><input id="hr_${h.id}" placeholder="結果（例：10枚中3件アポ）" autocomplete="off">
        <button class="ghost" data-act="hypohit" data-id="${h.id}">⭕ 当たり</button><button class="ghost" data-act="hypomiss" data-id="${h.id}">❌ 外れ</button></div>
    </div>`).join('')}
    <form id="hypoForm" class="hypo-form">
      <input name="text" placeholder="仮説：例）経営者の会で「保険を卒業させるFP」と名乗ると、アポ率が上がる" autocomplete="off">
      <input name="metric" placeholder="測るもの：例）名刺交換→アポ率" autocomplete="off"><label class="rq" style="margin:0">検証の期限<input type="date" name="until"></label>
      <button class="primary" style="width:100%">仮説を立てる</button>
    </form>
    ${done.length ? `<details class="small" style="margin-top:10px"><summary>検証の記録（${done.length}）</summary>
      ${done.map((h) => `<div class="entry"><div class="d">${h.status === 'hit' ? '⭕ 当たり' : '❌ 外れ'} ・ ${md(h.doneAt || h.createdAt)}</div><p>${esc(h.text)}<br>→ ${esc(h.result || '（結果メモなし）')}</p></div>`).join('')}
    </details>` : ''}
  </section>`;
}

/* ----- 今日の日報（振り返りの土台。提出先を決めて毎日出す） ----- */
const REPORT_QS = ['今日の仮説と、やってみた結果は？', '良かった点・悪かった点は？', '明日はどうする？（いつ・何を・何件）'];
function reportNumbers(k) {
  const ms = W().meetings.filter((m) => m.date === k);
  const cnt = (r) => ms.filter((m) => m.result === r).length;
  const parts = [];
  if (W().metrics.length) parts.push(W().metrics.map((m) => `${m.name} ${actOn(k, m)}${m.min ? `/${m.min}` : ''}`).join('・'));
  if (ms.length) parts.push(`面談 ${ms.length}（次アポ ${cnt('appo')}・提案 ${cnt('offer')}・契約 ${cnt('contract')}）・FB ${ms.filter((m) => m.fb).length}回`);
  return parts;
}
function reportText(k) {
  const r = W().reports[k] || {};
  const d = parseKey(k);
  const L = [`【日報】${md(k)}（${WD[d.getDay()]}）`, ...reportNumbers(k).map((x) => `■ ${x}`)];
  REPORT_QS.forEach((q, i) => { if ((r.a || [])[i]) L.push(`■ ${q}\n${r.a[i]}`); });
  return L.join('\n');
}
function reportStreak() {
  let s = W().reports[todayKey()] ? 1 : 0;
  let d = addDays(new Date(), -1);
  for (let i = 0; i < 3650; i++) { if (W().reports[dkey(d)]) s++; else break; d = addDays(d, -1); }
  return s;
}
function reportCard() {
  const k = todayKey(), r = W().reports[k] || {};
  const nums = reportNumbers(k);
  return `<section class="card report">
    <h2>📝 今日の日報 <span class="sub">${r.sentAt ? '✔ 提出済み' : r.savedAt ? '保存済み・未提出' : ''}${reportStreak() ? ` ・ 連続${reportStreak()}日` : ''}</span></h2>
    <div class="small muted" style="margin-bottom:8px">今日の数字は自動で入ります。自分で決めた相手に、決めた時間までに毎日提出する</div>
    ${nums.length ? `<div class="rnums">${nums.map((x) => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
    <form id="reportForm">
      ${REPORT_QS.map((q, i) => `<label class="rq">${q}<textarea name="a${i}" rows="2">${esc((r.a || [])[i] || '')}</textarea></label>`).join('')}
      <label class="rq">提出先<input name="to" value="${esc(W().reportTo)}" placeholder="例：先輩・マネージャーの名前" autocomplete="off"></label>
      <div class="row"><button class="ghost" name="mode" value="save">保存</button><span class="spacer"></span><button class="primary" name="mode" value="send">📤 ${W().reportTo ? `${esc(W().reportTo)}に` : ''}送る</button></div>
    </form>
    <button class="linkbtn" data-act="copyday">📋 Notion用に今日の記録をまとめてコピー</button>
  </section>`;
}
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  try { await navigator.clipboard.writeText(text); } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* noop */ }
    ta.remove();
  }
  return 'copied';
}

/* ----- IOIF：少し学んだら、すぐアウトプット ----- */
const OUTPUT_TYPES = ['セミナー・勉強会', '学んだことを人に説明', 'ロープレ', '資料作成・SNS発信'];
function ioifCard() {
  const ym = todayKey().slice(0, 7);
  const inM = W().inputs.filter((x) => x.date.startsWith(ym)).length;
  const outM = W().outputs.filter((x) => x.date.startsWith(ym)).length;
  const sem = W().seminar;
  const semLeft = sem.date && sem.date >= todayKey() ? daysLeft(sem.date) : null;
  return `<section class="card">
    <h2>🎤 インプット → すぐアウトプット <span class="sub">今月 学び${inM}・アウトプット${outM}</span></h2>
    <div class="small muted" style="margin-bottom:8px">受けただけの研修は、受けていないのと同じ。2割わかったら、まず話す・やってみる</div>
    <div class="io-ratio"><div class="io-in" style="flex:${Math.max(1, inM)}">学び ${inM}</div><div class="io-out" style="flex:${Math.max(1, outM)}">アウトプット ${outM}</div></div>
    <form id="inputForm" class="todo-add"><input name="text" placeholder="今日学んだこと（研修・本・動画）" autocomplete="off"><button class="primary">登録</button></form>
    <div class="small muted" style="margin-bottom:12px">登録すると「人に話す・使ってみる」が24時間以内のやることになります</div>
    <div class="g-sub">🎤 次のセミナー・勉強会</div>
    ${semLeft !== null ? `<div class="sem"><b>${esc(sem.title || 'セミナー')}</b><span>${md(sem.date)} ・ あと <b>${semLeft}</b>日</span></div>`
      : '<div class="small muted" style="margin-bottom:6px">参加者は1人でもいい。内容が決まっていなくても、まず日程を入れる</div>'}
    <form id="seminarForm" class="todo-add"><input name="title" placeholder="テーマ（仮でOK）" value="${esc(semLeft !== null ? sem.title : '')}" autocomplete="off"><input type="date" name="date" class="date-in" value="${semLeft !== null ? sem.date : ''}"><button class="ghost">${semLeft !== null ? '変更' : '日程を入れる'}</button></form>
    <div class="g-sub" style="margin-top:12px">アウトプットを記録</div>
    <form id="outputForm">
      <div class="row"><select name="type">${OUTPUT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select><input name="people" type="number" min="0" placeholder="人数" class="num-in" inputmode="numeric"></div>
      <div class="todo-add" style="margin-top:6px"><input name="title" placeholder="内容（例：先週の研修内容を同僚に説明）" autocomplete="off"><button class="primary">記録</button></div>
    </form>
    ${W().outputs.length ? `<details class="small"><summary>アウトプットの記録（${W().outputs.length}）</summary>
      ${W().outputs.slice().reverse().slice(0, 20).map((o) => `<div class="mrow"><span>${md(o.date)} ${esc(o.type)}：${esc(o.title)}</span><span class="small muted">${o.people ? `${o.people}人` : ''}</span></div>`).join('')}
    </details>` : ''}
  </section>`;
}

/* ----- 積み上げ3本柱（人脈・知識・技術） ----- */
function pillarsCard() {
  const ym = todayKey().slice(0, 7);
  const people = new Set(W().meetings.map((m) => m.who).filter(Boolean));
  const peopleM = new Set(W().meetings.filter((m) => m.date.startsWith(ym)).map((m) => m.who).filter(Boolean));
  const know = W().inputs.length, knowM = W().inputs.filter((x) => x.date.startsWith(ym)).length;
  const skill = W().outputs.length + W().meetings.length;
  const skillM = W().outputs.filter((x) => x.date.startsWith(ym)).length + W().meetings.filter((m) => m.date.startsWith(ym)).length;
  const last = W().meetings.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const avg = last.length ? Math.round(last.reduce((a, m) => a + m.score, 0) / last.length) : null;
  if (!people.size && !know && !skill) return '';
  return `<section class="card">
    <h2>🏗️ 積み上げ3本柱 <span class="sub">FPは「人脈・知識・技術」を積み上げる仕事</span></h2>
    <div class="pillars">
      <div class="pl p1"><small>人脈</small><b>${people.size}</b><span>会った人 ・ 今月+${peopleM.size}</span></div>
      <div class="pl p2"><small>知識</small><b>${know}</b><span>学び ・ 今月+${knowM}</span></div>
      <div class="pl p3"><small>技術</small><b>${skill}</b><span>実践回数 ・ 今月+${skillM}</span></div>
    </div>
    ${avg !== null ? `<div class="small muted" style="margin-top:8px">面談チェックの平均（直近${last.length}件）：<b>${avg}%</b> ・ 積み上がっていれば、半年前より今の方が楽になっているはず</div>` : ''}
  </section>`;
}

function renderWork() {
  return `${reportCard()}${goalCard()}${hypoCard()}${meetingCard()}${followCard()}${ioifCard()}${abcCard()}${reviewCard()}${metricsCard()}${principlesCard()}`;
}
function openForm(html) { $('#formBody').innerHTML = html; $('#formDialog').showModal(); }

/* ---------- routines（毎日のルーティーン） ---------- */
const ROUTINE_TEMPLATES = [
  { emoji: '🌅', name: '朝のルーティーン', time: '07:00', steps: ['カーテンを開けて日光を浴びる', 'コップ1杯の水を飲む', 'ストレッチ3分', '今日やることを3つ決める'] },
  { emoji: '🌙', name: '夜のルーティーン', time: '22:30', steps: ['明日の服とカバンを準備', 'スマホを充電器へ（寝室の外）', 'ひとこと日誌を書く', '23時に布団に入る'] },
  { emoji: '💼', name: '仕事はじめ', time: '09:00', steps: ['デスクを片づける', '今日の最重要タスクを決める', '通知を切って25分集中'] },
  { emoji: '🏋️', name: 'トレーニング前', time: '', steps: ['ウェアに着替える', '水を用意する', 'ウォームアップ5分'] },
  { emoji: '📖', name: '勉強の時間', time: '07:00', steps: ['商品・制度の資料を1つ読む', 'Q&Aを3つ確認する', '学んだことを声に出して説明してみる'] },
  { emoji: '📱', name: '連絡まとめの時間', time: '12:30', steps: ['LINE・メールをまとめて返信', 'フォローの連絡をする', '次のアポの確認連絡'] },
  { emoji: '🧠', name: '振り返りの時間', time: '21:00', steps: ['今日の面談を記録する', '日報を書いて提出する', '明日の仮説を1つ決める'] },
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
  const t = { id: uid(), text, frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: todoMode, due: null, date: null };
  if (todoMode === 'insight') { t.due = Date.now() + 86400000; toast('💡 24時間以内に行動へ。期限を過ぎると赤く表示されます'); }
  if (todoMode === 'regret') { const e = new Date(); e.setHours(23, 59, 0, 0); t.due = e.getTime(); toast('😤 「悔しい」で終わらせない。今日中に一つ動こう'); }
  S.todos.push(t);
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
  const od = overdueCount();
  if (od) out += `<div class="banner warn">⚠️ <b>24時間ルール：</b>期限切れが${od}件。今すぐ1つ動こう。</div>`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const rep = W().reports[t];
  if (S.settings.journalAt && hm >= S.settings.journalAt && !(rep && rep.sentAt)) {
    out += `<div class="banner warn">📝 <b>日報の時間。</b>${W().reportTo ? `${esc(W().reportTo)}に` : ''}今日の振り返りを提出しよう。 <button class="linkbtn" data-act="gotowork" style="padding:0">日報を書く →</button></div>`;
  }
  if ((d.getDay() === 0 || d.getDay() === 1) && !W().reviews[reviewKey()]) {
    out += '<div class="banner">🗓️ <b>週1ふりかえりの日。</b> <button class="linkbtn" data-act="gotowork" style="padding:0">仕事タブで今週をふりかえる →</button></div>';
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
  const over = !t.done && t.due && t.due < Date.now();
  return `<div class="todo ${t.done ? 'done' : ''} ${t.frog && !t.done ? 'star-on' : ''} ${over ? 'over' : ''}">
    <button class="check" data-act="todo" data-id="${t.id}" aria-label="完了">${t.done ? '✔' : ''}</button>
    <span class="txt">${TODO_KIND[t.kind] ? `${TODO_KIND[t.kind]} ` : ''}${esc(t.text)}${age} ${dueLabel(t)}</span>
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
  const now = Date.now();
  const open = S.todos.filter((t) => !t.done && (!t.date || t.date <= k)).sort((a, b) =>
    ((b.due && b.due < now) - (a.due && a.due < now)) || ((a.due || Infinity) - (b.due || Infinity)) || (b.frog - a.frog) || (a.createdAt < b.createdAt ? -1 : 1));
  const doneT = S.todos.filter((t) => t.done && t.doneAt === k);
  const msg = p.sched === 0 ? '今日は習慣オフの日'
    : rem === 0 ? '⭐ パーフェクト！今日は完全勝利'
      : p.done === 0 ? '最初の1つで流れを作ろう'
        : rem === 1 ? '残り1つでパーフェクト！' : `残り${rem}つ。このまま押し切れ`;

  return `
  ${banners()}
  ${compassCard()}
  ${heroCard()}
  ${activityCard()}
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
    <div class="modes">
      <button type="button" data-act="todomode" data-m="" class="${todoMode === '' ? 'on' : ''}">✅ ふつう</button>
      <button type="button" data-act="todomode" data-m="insight" class="${todoMode === 'insight' ? 'on' : ''}">💡 気づき → 24時間以内</button>
      <button type="button" data-act="todomode" data-m="regret" class="${todoMode === 'regret' ? 'on' : ''}">😤 悔しい → 今日中</button>
    </div>
    <form class="todo-add" id="todoForm">
      <input id="todoInput" placeholder="${todoMode === 'insight' ? '気づいたこと → どう動く？' : todoMode === 'regret' ? '悔しかったこと → 今日やる一つの行動は？' : 'やることを追加…'}" autocomplete="off">
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
  ${pillarsCard()}
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
  ['🧪 仮説と検証', '仮説を持たない実行は、ただの浪費。「こうしたら → こうなるはず」を決め、数字で結果を確かめると、うまくいってもいかなくても次の改善につながります。'],
  ['🎤 IOIF（少しインプット → すぐアウトプット）', '完璧にインプットしてから動くのではなく、2割わかったらアウトプットし、その結果からまた学ぶ。失敗を前提にした試行錯誤が、いちばん早く成果につながります。'],
  ['📝 日報と提出（コミットメント）', '数字と振り返りを毎日書き、決めた相手に提出する。誰かに約束すると、自分ひとりより続きやすくなります。'],
  ['🗺️ フィールド別の数字管理', 'どこで出会った人が成約しやすいかを数字で見ると、限られた時間をどこに使うべきかがわかります。'],
  ['🔑 KGI・KSF・KPI', 'ゴール（KGI）→ 達成に欠かせないこと（KSF）→ 自分で100%コントロールできる毎日の行動（KPI）の順に決めます。KPIを守れば、ゴールは自然と近づきます。'],
  ['⏱️ 自分で完結する予定もスケジュールに', '勉強・振り返り・連絡など、自分ひとりで完結することほど「空いたらやる」になりがち。時間を決めてルーティーンに入れます。'],
  ['🏗️ 人脈・知識・技術の積み上げ', 'FPは積み上げる仕事。積み上がっていれば、半年前より今の方が楽になっているはず。3本柱の数字でそれを確かめます。'],
  ['📊 毎日の最低ライン（外発的な刺激に頼らない）', '人に会った直後だけやる気が上がり、数日で元に戻るのは自然なこと。調子が悪い日でもできる量を固定し、毎日記録することで「気分」ではなく「仕組み」で動けるようになります。'],
  ['⚡ 24時間ルール（実行意図・ツァイガルニク効果）', '気づきは時間がたつほど行動に変わらなくなります。期限と残り時間を見えるようにすると「やりかけ」が気になって動きやすくなります。「悔しい」は感情が強いうちに一つの行動へ。'],
  ['🤝 面談のあとに「守れたか」を記録（自己モニタリング）', '自分の行動を記録するだけで、行動は基準に近づいていきます。自分の印象ではなく、相手の結果で自分を評価する習慣をつくります。'],
  ['🔒 目標の定義を勝手に変えない（コミットメントと一貫性）', '目標を下げたくなったときに理由を書き、誰かに伝えるというひと手間が、「なんとなくの妥協」を防ぎます（チャルディーニ）。'],
  ['🧭 今日の判断基準（プライミング）', '朝に自分の基準を一つ目にすると、その日の判断がその基準に引っぱられやすくなります。'],
  ['🗓️ 週1ふりかえり（内省）', '経験は、ふりかえって言葉にしたときに学びになります（コルブの経験学習）。完全自責で「自分にできたこと」を探すと、次の行動が具体的になります。'],
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
  $('#view').innerHTML = tab === 'log' ? renderLog() : tab === 'work' ? renderWork() : renderToday();
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
    // 仕事
    case 'gotowork': tab = 'work'; render(); window.scrollTo({ top: 0 }); break;
    case 'compassnext': compassOffset++; render(); break;
    case 'actplus': bumpActivity(id, 1); break;
    case 'actminus': bumpActivity(id, -1); break;
    case 'todomode': todoMode = b.dataset.m; render(); { const i = $('#todoInput'); if (i) i.focus(); } break;
    case 'editgoal': openGoal(); break;
    case 'cond': {
      const c = W().goal.conditions.find((x) => x.id === id);
      if (c) {
        c.done = !c.done;
        if (c.done) { toast(`✔ 条件クリア：${esc(c.text)}`); confetti(80); if (W().goal.conditions.every((x) => x.done)) celebrate('🏆', '達成条件をすべてクリア', 'ここまで積み上げてきた自分を誇っていい。'); }
        save(); render();
      }
      break;
    }
    case 'addmeeting': openMeeting(); break;
    case 'closeform': $('#formDialog').close(); break;
    case 'delcontract':
      if (confirm('この契約の記録と、未完了のフォロー予定を削除しますか？')) {
        W().contracts = W().contracts.filter((c) => c.id !== id);
        S.todos = S.todos.filter((t) => !(t.ref === id && !t.done));
        save(); render();
      }
      break;
    case 'abc': {
      const i = Number(b.dataset.i), a = W().abc;
      a.checked = a.checked.includes(i) ? a.checked.filter((x) => x !== i) : [...a.checked, i];
      if (a.checked.length === ABC_STEPS.length) toast('🔺 セットアップ完了。いい面談に');
      save(); render();
      break;
    }
    case 'abcreset': W().abc.checked = []; save(); render(); break;
    case 'addmetric': W().metrics.push({ id: uid(), name: '新しい項目', min: 1 }); save(); render(); break;
    case 'delmetric':
      if (confirm('この項目を削除しますか？（これまでの記録も数えられなくなります）')) { W().metrics = W().metrics.filter((m) => m.id !== id); save(); render(); }
      break;
    case 'copyday': copyDay(); break;
    case 'hypohit': case 'hypomiss': {
      const h = W().hypotheses.find((x) => x.id === id);
      if (h) {
        const inp = $(`#hr_${id}`);
        h.result = inp ? inp.value.trim() : '';
        h.status = act === 'hypohit' ? 'hit' : 'miss';
        h.doneAt = todayKey();
        toast(act === 'hypohit' ? '⭕ 仮説が当たった。続けて精度を上げよう' : '❌ 外れも収穫。次の仮説につなげよう');
        save(); render();
      }
      break;
    }
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
  else if (id === 'goalForm') { if (!saveGoal(e.target)) e.preventDefault(); }
  else if (id === 'meetingForm') { saveMeeting(e.target); }
  else if (id === 'contractForm') { e.preventDefault(); saveContract(e.target); }
  else if (id === 'reviewForm') {
    e.preventDefault();
    const a = REVIEW_QS.map((_, i) => e.target.elements.namedItem(`q${i}`).value.trim());
    if (!a.some(Boolean)) { toast('1つだけでも書いてみよう'); return; }
    const first = !W().reviews[reviewKey()];
    W().reviews[reviewKey()] = { a, savedAt: todayKey() };
    if (first) { celebrate('🗓️', '週1ふりかえり完了', '立ち止まって考えた時間が、来週の行動を変える。'); } else toast('保存しました');
    save(); render();
  } else if (id === 'metricsForm') {
    e.preventDefault();
    W().metrics.forEach((m) => {
      m.name = e.target.elements.namedItem(`n_${m.id}`).value.trim() || m.name;
      m.min = Math.max(0, Number(e.target.elements.namedItem(`v_${m.id}`).value) || 0);
    });
    save(); render(); toast('📊 最低ラインを保存しました。毎日このラインだけは守る');
  } else if (id === 'hypoForm') {
    e.preventDefault();
    const f = e.target.elements, text = f.namedItem('text').value.trim();
    if (!text) { toast('「こうしたら → こうなるはず」を書こう'); return; }
    W().hypotheses.push({ id: uid(), text, metric: f.namedItem('metric').value.trim(), until: f.namedItem('until').value, status: 'testing', result: '', createdAt: todayKey() });
    toast('🧪 仮説を立てた。数字で確かめよう');
    save(); render();
  } else if (id === 'reportForm') {
    e.preventDefault();
    const f = e.target.elements, k = todayKey();
    const a = REPORT_QS.map((_, i) => f.namedItem(`a${i}`).value.trim());
    W().reportTo = f.namedItem('to').value.trim();
    const prev = W().reports[k] || {};
    W().reports[k] = { ...prev, a, savedAt: Date.now() };
    const mode = e.submitter ? e.submitter.value : 'save';
    if (mode === 'send') {
      shareText(reportText(k)).then((r) => {
        if (r === 'cancel') { save(); render(); return; }
        W().reports[k].sentAt = Date.now();
        toast(r === 'shared' ? '📤 日報を送りました' : '📋 日報をコピーしました。LINEなどに貼り付けて送ってください');
        if (!prev.sentAt) confetti(60);
        save(); render();
      });
    } else { toast('📝 日報を保存しました'); save(); render(); }
  } else if (id === 'inputForm') {
    e.preventDefault();
    const text = e.target.elements.namedItem('text').value.trim();
    if (!text) return;
    W().inputs.push({ id: uid(), date: todayKey(), text });
    S.todos.push({ id: uid(), text: `「${text}」を人に話す・使ってみる`, frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: 'output', due: Date.now() + 86400000, date: null });
    toast('🎤 24時間以内にアウトプットしよう');
    save(); render();
  } else if (id === 'seminarForm') {
    e.preventDefault();
    const f = e.target.elements, date = f.namedItem('date').value;
    if (!date) { toast('まず日程だけ入れよう'); return; }
    W().seminar = { date, title: f.namedItem('title').value.trim() };
    S.todos.push({ id: uid(), text: `セミナー「${W().seminar.title || 'テーマ未定'}」を開催`, frog: false, done: false, doneAt: null, createdAt: todayKey(), kind: 'output', due: null, date });
    toast('🎤 日程を入れた。あとは当日までに2割でいいので準備しよう');
    save(); render();
  } else if (id === 'outputForm') {
    e.preventDefault();
    const f = e.target.elements, title = f.namedItem('title').value.trim();
    if (!title) { toast('内容をひとこと書こう'); return; }
    W().outputs.push({ id: uid(), date: todayKey(), type: f.namedItem('type').value, title, people: Number(f.namedItem('people').value) || 0 });
    toast('🎤 アウトプットを記録。話せた分だけ自分のものになる');
    confetti(50);
    save(); render();
  } else if (id === 'principlesForm') {
    e.preventDefault();
    W().principles = e.target.elements.namedItem('p').value;
    W().mentor = e.target.elements.namedItem('mentor').value.trim();
    const n = parsePrinciples(W().principles).length;
    save(); render(); toast(n ? `🧭 ${n}項目を登録。毎日1つ「今日の判断基準」に表示します` : '保存しました');
  }
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
  if (e.target.id === 'incomeInput') {
    const g = W().goal, ym = todayKey().slice(0, 7), v = Math.max(0, Number(e.target.value) || 0);
    const before = Number(g.income[ym] || 0);
    g.income[ym] = v;
    if (g.incomeTarget && v >= g.incomeTarget && before < g.incomeTarget) celebrate('💴', '今月の収入、基準クリア', '決めた基準を自分の力で超えた。');
    save(); render();
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
      <div><b>📝 日報・ふりかえりの時刻</b><div class="small muted">この時刻をすぎて未提出なら、通知と画面でお知らせ</div></div>
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
    tab = ['log', 'reflect', 'growth'].includes(p.get('tab')) ? 'log' : p.get('tab') === 'work' ? 'work' : 'today';
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
