/* 01_dashboard/view.js — SecondBrain 看板 v1
   由根目录 看板.md 的 dataviewjs 块调用：await dv.view("01_dashboard")
   dv = Dataview 行内 API；input.raw 为 true 时只打印数据（见 debug.md）。
   分三层：collect*（取数）→ render*（拼 HTML）→ bind（点击、打勾、记一笔、新建）。 */

// 下面的路径是缺省值；自己 vault 的真实路径写在同目录的 config.json（不进公开仓库，格式见 config.example.json）
const V = {
  dailyDir: "02_daily",
  weeklyDir: "03_weekly",
  planPath: "04_learning/plan.md",
  stackPath: "04_learning/技术栈.md",
  rhythmPath: "04_learning/周节奏.md",
  tracksDir: "06_tracks",
  anchorsPath: "05_goals/目标锚点.md",
  todoPath: "To-do & inspiration.md",
  subjectsDir: "07_subjects",
  materialsDir: "08_materials",
  pipelineDir: "01_dashboard/pipeline",
  pipelineScript: "run_pipeline.py",
  dailyTemplate: "09_templates/daily.md",
  weeklyTemplate: "09_templates/weekly.md",
  fontDir: "01_dashboard/fonts",
  finishedDays: 30,
  ideasMax: 4,
  narrowBelow: 760,
  news: "placeholder", // false=整张卡关掉；"placeholder"=留空框架不接数据；true=接真实抓取（火山方舟豆包总结 + 联网，需 ARK_API_KEY）
  research: "placeholder", // 科研情报卡：false=关；"placeholder"=空框架；true=接 fetch-research.mjs（独立于旧资讯卡）
  row0: 220, // 第0行（学科目录 + 搜索）的高度
  row3: 300, // 第四行（灵感箱 + 目标锚点）的高度；前三行撑满一屏，底部两行往下滚才看到
  row4: 300, // 第五行（资讯 + 番茄钟）的高度
  row5: 320, // 第六行（科研情报卡）的高度
};
try { Object.assign(V, JSON.parse(await app.vault.adapter.read(`${V.dir || "01_dashboard"}/config.json`))); } catch (e) { /* 没有 config.json 就用缺省值 */ }
if (V.news === false) { V.row3 = 300; V.row4 = 220; } // 没有资讯卡，第四行只剩番茄钟，压矮（和 view.css 的 .no-news 对应）
if (V.research === false) { V.row5 = 0; } // 科研卡关掉，第六行不占高度（和 view.css 的 .no-research 对应）
const baseName = p => String(p).split("/").pop().replace(/\.md$/, "");

// ---------- 小工具 ----------
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const MON = addDays(TODAY, -((TODAY.getDay() + 6) % 7));
const SUN = addDays(MON, 6);
const WEEK = [...Array(7)].map((_, i) => addDays(MON, i));
const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/[，。、：:,.（(\s]+$/, "") + "…" : s);
// 任务文字去掉 markdown 外壳，只留人话
const plain = s => String(s ?? "")
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
  .replace(/\[\[([^\]]+)\]\]/g, (m, p) => p.split("/").pop().replace(/#.*$/, ""))
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\s*\[[^\]]*::[^\]]*\]/g, "")
  .replace(/\s*📅\s*[\d/\-年月.]+\s*/g, " ")
  .replace(/\s*⏳\s*[\d/\-年月.]+\s*/g, " ")
  .replace(/\s*🔺\s*/g, " ").replace(/\s*🔼\s*/g, " ").replace(/\s*🔽\s*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// 学科归类：先看【标签】，再看正文关键词；k 越小越靠前
function subjectOf(rawTag, body) {
  const tag = rawTag || "";
  // 任务文本的学科归类只用于排序；按你自己的课程往这里加正则与标签即可。
  const pairs = [];
  for (const [re, v] of pairs) if (re.test(tag)) return v;
  for (const [re, v] of pairs) if (re.test(body)) return v;
  return { k: 9, label: "" };
}

// 拆任务文本：【标签】→ 学科标；括号 / 冒号后细节 → 小字副注；标题只留主干
function parseTaskText(raw, link) {
  let text = plain(raw);
  let tag = "";
  const tm = text.match(/^【([^】]+)】/);
  if (tm) { tag = tm[1]; text = text.slice(tm[0].length).trim(); }
  const subs = [];
  text = text.replace(/[（(]([^（）()]*)[）)]/g, (m, p) => { const q = p.trim(); if (q) subs.push(q); return " "; });
  const ci = text.search(/[：:]/);
  if (ci >= 0) { const after = text.slice(ci + 1).trim(); if (after) subs.push(after); text = text.slice(0, ci).trim(); }
  if (link) {
    const bn = link.split("/").pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(bn, "g"), " ").replace(/\s+/g, " ").trim();
  }
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/^[，,；;、\s]+/, "").replace(/[，,；;、\s]+$/, "");
  const sub = subs.filter(Boolean).join("；").replace(/\s+/g, " ").trim();
  return { tag, subj: subjectOf(tag, text), title: text, sub };
}
const taskSubjK = t => parseTaskText(t.text, t.link).subj.k;
const sortTasks = items => [...items].sort((a, b) => taskSubjK(a) - taskSubjK(b) || (a.line - b.line));

// YAML 日期被 Dataview 转成 luxon DateTime，统一归一成 YYYY-MM-DD 字符串；空值返回 ""
const toDateStr = v => {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v.toFormat === "function") { try { return v.toFormat("yyyy-MM-dd"); } catch (e) {} }
  if (typeof v.toISO === "function") { try { return String(v.toISO()).slice(0, 10); } catch (e) {} }
  return String(v).trim();
};

const tfile = p => app.vault.getAbstractFileByPath(p);
const isFile = f => !!f && typeof f.extension === "string";
const headings = p => (isFile(tfile(p)) && app.metadataCache.getFileCache(tfile(p))?.headings) || [];

// ---------- 学科目录 / 复习队列 / 站内搜索索引 ----------
// 流水线收件箱识别用的已知学科；看板科目行按 07_subjects 实际目录自动发现，见 discoverSubjects()
const SUBJECTS = []; // 兜底学科目录；正常情况下 discoverSubjects() 会自动扫 07_subjects 下的实际目录
const REVIEW_INTERVALS = [1, 2, 4, 7, 15]; // stage 0→1天 1→2 2→4 3→7 4→15

// 自动发现 subjects 下的学科目录（下划线开头的 _归档/_模板 等不计）
function discoverSubjects() {
  const root = tfile(V.subjectsDir);
  if (!root || !Array.isArray(root.children)) return [...SUBJECTS];
  return root.children.filter(c => Array.isArray(c.children) && !c.name.startsWith("_")).map(c => c.name);
}

function walkFiles(dir, pred) {
  const d = tfile(dir), out = [];
  if (!d || !Array.isArray(d.children)) return out;
  const stack = [...d.children];
  while (stack.length) {
    const f = stack.pop();
    if (Array.isArray(f.children)) stack.push(...f.children);
    else if (isFile(f) && (!pred || pred(f))) out.push(f);
  }
  return out;
}

function parseCard(f) {
  const page = dv.page(f.path) || {};
  const cache = app.metadataCache.getFileCache(f);
  const fm = { ...(cache && cache.frontmatter ? cache.frontmatter : {}), ...(page.frontmatter && typeof page.frontmatter === "object" ? page.frontmatter : {}), ...page };
  const last = toDateStr(fm.last_review);
  const stage = Math.max(0, Math.min(4, parseInt(fm.stage, 10) || 0));
  const topic = String(fm.topic || baseName(f.path));
  const type = String(fm.type || "");
  const status = String(fm.status || "");
  // 章序：优先 chapter 字段，其次从 source 里取「第N章」，都没有排到最后
  const chFromSource = String(fm.source || "").match(/第\s*(\d+)\s*章/);
  const chapter = Number.isFinite(+fm.chapter) && +fm.chapter > 0
    ? +fm.chapter
    : (chFromSource ? parseInt(chFromSource[1], 10) : 9999);
  const order = Number.isFinite(+fm.order) && +fm.order > 0 ? +fm.order : 9999;
  let due = "", overdueDays = null;
  if (last && !Number.isNaN(+new Date(`${last}T00:00:00`))) {
    const dueD = addDays(new Date(`${last}T00:00:00`), REVIEW_INTERVALS[stage]);
    due = ymd(dueD);
    overdueDays = Math.round((TODAY - dueD) / 86400000);
  } else if (!last) {
    // 新卡：没有上次复习日期，当天到期进首刷
    due = ymd(TODAY);
    overdueDays = 0;
  }
  const overdue = overdueDays != null && overdueDays >= 0;
  return { path: f.path, topic, subject: fm.subject || "", stage, type, status, lastReview: last, due, overdue, overdueDays, chapter, order };
}

function collectSubjects() {
  const rows = [], allCards = [];
  for (const subject of discoverSubjects()) {
    const cardDirs = [`${V.subjectsDir}/${subject}/速查卡`, `${V.subjectsDir}/${subject}/产出/原子卡`];
    let cards = [];
    for (const d of cardDirs) cards.push(...walkFiles(d, f => f.extension === "md"));
    // 检验卷不是复习卡；原子卡只有「已验证」才进复习队列
    cards = cards.map(parseCard).filter(c => c.type !== "检验" && !(c.type === "原子卡" && c.status !== "已验证"));
    const due = cards.filter(c => c.overdue);
    const mats = walkFiles(`${V.materialsDir}/${subject}`, f => f.extension !== "md" && !f.path.includes("/_真题/"));
    rows.push({ subject, mainNote: `${V.subjectsDir}/${subject}/_主笔记.md`, materials: mats.length, review: due.length, cards });
    allCards.push(...cards);
  }
  // 复习顺序：章节 → 章内顺序 → 过期天数（第一章先刷，后面的按章滚动推进）
  const queue = allCards.filter(c => c.overdue).sort((a, b) =>
    (a.chapter - b.chapter) || (a.order - b.order) || (b.overdueDays - a.overdueDays));
  return { rows, queue, total: queue.length };
}

function collectNoteIndex() {
  return walkFiles(V.subjectsDir, f => f.extension === "md").map(f => ({ path: f.path, name: baseName(f.path) }));
}

// 某个标题管辖的行范围 [start, end)，end 是下一个同级或更高级标题的行
function sectionRange(path, match) {
  const hs = headings(path);
  const i = hs.findIndex(match);
  if (i < 0) return null;
  const start = hs[i].position.start.line;
  const next = hs.slice(i + 1).find(h => h.level <= hs[i].level);
  return { start, end: next ? next.position.start.line : Infinity };
}

// 一个文件里的顶层任务（缩进子项归父项，不单独算）。line 是 0 起的行号。
function tasksOf(path) {
  const page = dv.page(path);
  if (!page || !page.file || !page.file.tasks) return [];
  const arr = typeof page.file.tasks.array === "function" ? page.file.tasks.array() : Array.from(page.file.tasks);
  // 模板里留的空 `- [ ] ` 不算任务；正文里的 [[双链]] 抽成关联笔记 link，正文不显示链接语法
  return arr.filter(t => t.parent == null && String(t.text || "").trim() !== "").map(t => {
    const raw = String(t.text || "");
    const lm = raw.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/);
    const link = lm ? lm[1].trim() : "";
    // text 保留原始文本（含双链），供勾选按文字对账；显示时由 plain() 剥链接语法
    const text = raw.replace(/\s+/g, " ").trim();
    return { text, status: t.status, done: t.status === "x" || t.status === "X", line: t.line, path: t.path, link };
  });
}
const under = (items, r) => (r ? items.filter(t => t.line > r.start && t.line < r.end) : items);

// ---------- 取数 ----------
function collectDay(path) {
  if (!isFile(tfile(path))) return { path, exists: false, items: [], total: 0, done: 0 };
  const r = sectionRange(path, h => /^今日/.test(h.heading));
  const items = under(tasksOf(path), r);
  return { path, exists: true, hasSection: !!r, sectionLine: r ? r.start : 0, items, total: items.length, done: items.filter(t => t.done).length };
}

function collectToday() {
  const d = collectDay(`${V.dailyDir}/${ymd(TODAY)}.md`);
  return { ...d, date: ymd(TODAY), weekday: WD[TODAY.getDay()], shown: d.items };
}

// 「随手记」下的文字行（不含任务），给展开层用
async function collectNotes(path) {
  const f = tfile(path); if (!isFile(f)) return [];
  const r = sectionRange(path, h => /^随手记/.test(h.heading)); if (!r) return [];
  const lines = (await app.vault.cachedRead(f)).split("\n");
  return lines.slice(r.start + 1, r.end === Infinity ? undefined : r.end)
    .map(l => l.trim()).filter(l => l && !/^(?:[-*+]|\d+[.)])\s+\[.\]/.test(l) && !/^#/.test(l))
    .map(l => l.replace(/^(?:[-*+]|\d+[.)])\s+/, ""));
}

// 一到日 7 格：full 全勾完 / half 有没勾的 / none 没写当天或没定 / future 还没到
function collectDays() {
  return WEEK.map(d => {
    const key = ymd(d), path = `${V.dailyDir}/${key}.md`;
    if (d > TODAY) return { date: key, state: "future", items: [] };
    const day = collectDay(path);
    if (!day.exists) return { date: key, state: "none", items: [] };
    if (!day.total) return { date: key, state: "none", path, items: [] };
    return { date: key, state: day.done === day.total ? "full" : "half", path, done: day.done, total: day.total, items: day.items };
  });
}

function collectWeek() {
  const path = `${V.weeklyDir}/${ymd(MON)}.md`;
  const range = `${MON.getMonth() + 1}.${MON.getDate()} – ${SUN.getMonth() + 1}.${SUN.getDate()}`;
  const daysLeft = Math.round((SUN - TODAY) / 86400000);
  if (!isFile(tfile(path))) return { path, exists: false, items: [], total: 0, done: 0, range, daysLeft };
  const r = sectionRange(path, h => /^本周要完成/.test(h.heading));
  const all = under(tasksOf(path), r);
  const items = [...all.filter(t => !t.done), ...all.filter(t => t.done)];
  return { path, exists: true, sectionLine: r ? r.start : 0, items, total: all.length, done: all.filter(t => t.done).length, range, daysLeft };
}

// 从周标题解析日期范围，如「第 2 周 · 11.23 – 11.29 ...」；跨年区间结束年份 +1
function weekRangeOf(heading) {
  const m = heading.match(/(\d{1,2})\.(\d{1,2})\s*[–~～-]\s*(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  const y = TODAY.getFullYear();
  const s = new Date(y, +m[1] - 1, +m[2]);
  let e = new Date(y, +m[3] - 1, +m[4]);
  if (e < s) e = new Date(y + 1, +m[3] - 1, +m[4]);
  return { s, e };
}

async function collectRoute() {
  const path = V.planPath;
  const hs = headings(path).filter(h => h.level === 2);
  const all = tasksOf(path);
  const text = isFile(tfile(path)) ? await app.vault.cachedRead(tfile(path)) : "";
  const lines = text.split("\n");
  const stations = [];
  hs.forEach((h, i) => {
    const m = h.heading.match(/^第\s*(\d+)\s*周(起)?\s*[·・]\s*(.+)$/);
    if (!m) return;
    const start = h.position.start.line;
    const end = hs[i + 1] ? hs[i + 1].position.start.line : Infinity;
    const items = all.filter(t => t.line > start && t.line < end);
    const range = weekRangeOf(h.heading);
    stations.push({
      n: +m[1], label: `第${m[1]}周${m[2] || ""}`, title: m[3].trim(), heading: h.heading, line: start, range,
      items, total: items.length, done: items.filter(t => t.done).length,
    });
  });
  // 选“当前站”：优先按标题日期范围匹配本周；找不到再退回第一个没做完的站
  let cur = stations.findIndex(s => s.range && TODAY >= s.range.s && TODAY <= s.range.e);
  if (cur < 0) cur = stations.findIndex(s => s.done < s.total);
  if (cur < 0) cur = stations.length - 1;
  const total = stations.reduce((a, s) => a + s.total, 0);
  const done = stations.reduce((a, s) => a + s.done, 0);
  const next = cur >= 0 ? stations[cur].items.filter(t => !t.done).slice(0, 3) : [];
  const block = cur >= 0 ? currentBlock(stations[cur], lines, hs) : null;
  // 接下来的站：先是本站后面的块，再是后面几周（只要名字和数量，任务文字在本周卡）
  const upcoming = [...(block && block.after ? block.after : []),
    ...stations.slice(cur + 1).map(s => ({ title: `${s.label.replace(/^第(\d+)周/, "第 $1 周")} · ${s.title}`, line: s.line, done: s.done, total: s.total }))].slice(0, 3);
  return { path, exists: isFile(tfile(path)), stations, cur, total, done, next, block, upcoming };
}

// 技术栈规划文档：四层框架 + 阶段 0–3 任务 + 里程碑 + 当前位置 / 硬规则
async function collectStack() {
  const path = V.stackPath;
  const f = tfile(path);
  const exists = isFile(f);
  const text = exists ? await app.vault.cachedRead(f) : "";
  const lines = text.split("\n");
  const hs = headings(path);
  const all = tasksOf(path);

  const stages = [];
  hs.forEach((h, i) => {
    const m = h.heading.match(/^阶段\s*(\d+)\s*[·・]\s*(.+)$/);
    if (!m) return;
    const start = h.position.start.line;
    const end = hs[i + 1] ? hs[i + 1].position.start.line : Infinity;
    const items = all.filter(t => t.line > start && t.line < end);
    stages.push({ n: +m[1], title: m[2].trim(), heading: h.heading, line: start,
      items, total: items.length, done: items.filter(t => t.done).length });
  });
  const cur = stages.findIndex(s => s.done < s.total);
  const curStage = cur >= 0 ? stages[cur] : (stages.length ? stages[stages.length - 1] : null);
  const total = stages.reduce((a, s) => a + s.total, 0);
  const done = stages.reduce((a, s) => a + s.done, 0);

  const bulletLines = re => {
    const r = sectionRange(path, h => re.test(h.heading));
    if (!r) return [];
    const out = [];
    for (let i = r.start + 1; i < r.end; i++) {
      const mm = lines[i].match(/^\s*[-*+]\s+(?:\*\*(.+?)\*\*[：:]\s*)?(.*)$/);
      if (mm) out.push({ k: mm[1] ? mm[1].trim() : "", text: mm[2].trim(), line: i });
    }
    return out;
  };

  const mileRange = sectionRange(path, h => /^里程碑/.test(h.heading));
  const milestones = [];
  if (mileRange) {
    for (let i = mileRange.start + 1; i < mileRange.end; i++) {
      const mm = lines[i].match(/^\s*[-*+]\s+\*\*(M\d[\d.]*)\s*·\s*([^*]+)\*\*[：:]\s*(.+)$/);
      if (mm) milestones.push({ id: mm[1].trim(), date: mm[2].trim(), text: mm[3].trim(), line: i });
    }
  }

  const layerRange = sectionRange(path, h => /^四层框架/.test(h.heading));
  const layers = [];
  if (layerRange) {
    for (let i = layerRange.start + 1; i < layerRange.end; i++) {
      const row = lines[i].trim();
      if (!/^\|/.test(row) || /^\|[\s-:|]+\|?$/.test(row)) continue;
      const cells = row.split("|").slice(1, -1).map(c => c.trim());
      if (cells[0] && cells[0] !== "层") layers.push({ k: cells[0], what: cells[1] || "", items: cells[2] || "" });
    }
  }

  const position = bulletLines(/^当前位置/);
  const rules = bulletLines(/^时间约束/);

  return { path, exists, stages, cur, curStage, total, done, milestones, layers, position, rules,
    nextMilestone: milestones[0] || null };
}

// 当前站里「正在做的那一块」。站内用粗体行（**Stage 1 · 某个主题**、**做**、**读**）分块：
// 第一个还有没勾条目的块是当前块；它是 Stage 就只给这一块；
// 不是 Stage（第 1 周起的 做 / 读 / 背，或第 0 周 Stage 之后的 出口测试 / 做 / 读 / 产出）就把后面同类的块一起给，分组显示。
function currentBlock(st, lines, hs) {
  const end = (() => { const i = hs.findIndex(h => h.position.start.line === st.line); const n = hs[i + 1]; return n ? n.position.start.line : lines.length; })();
  const marks = [];
  for (let i = st.line + 1; i < end; i++) { const m = lines[i].match(/^\s*\*\*(.+?)\*\*\s*(?:[（(].*)?$/); if (m) marks.push({ title: m[1].trim(), line: i }); }
  const blocks = [];
  const bounds = [{ title: "", line: st.line }, ...marks];
  bounds.forEach((b, k) => {
    const to = bounds[k + 1] ? bounds[k + 1].line : end;
    const items = st.items.filter(t => t.line > b.line && t.line < to);
    if (items.length) blocks.push({ title: b.title, line: b.line, items, done: items.filter(t => t.done).length, total: items.length, stage: /^stage\s*\d+/i.test(b.title) });
  });
  const i = blocks.findIndex(b => b.done < b.total);
  if (i < 0) return null;
  const wk = st.label.replace(/^第(\d+)周/, "第 $1 周");
  const after = blocks.slice(i + 1).map(b => ({ title: b.title || st.title, line: b.line, done: b.done, total: b.total }));
  if (blocks[i].stage) {
    const b = blocks[i];
    return { head: `${wk} · ${b.title}`, line: b.line, groups: [{ title: "", items: b.items }], done: b.done, total: b.total, after };
  }
  const rest = blocks.slice(i).filter(b => !b.stage && b.done < b.total);
  return { head: `${wk} · ${st.title}`, line: st.line, groups: rest.map(b => ({ title: b.title, items: b.items })),
    done: rest.reduce((a, b) => a + b.done, 0), total: rest.reduce((a, b) => a + b.total, 0), after: after.filter(b => b.stage) };
}

// 一行时段：抽出开头的时间（区间或单点），剩下是文字。无时间就整行进 text。
function parseSlot(line) {
  const s = String(line || "").trim();
  const m = s.match(/^(\d{1,2}:\d{2}(?:\s*[–~～-]\s*\d{1,2}:\d{2})?)\s*(.*)$/);
  if (!m) return { time: "", text: s };
  return { time: m[1].replace(/[~～]/g, "–"), text: m[2].trim() };
}
function slotMins(t) { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; }

// ---------- 周节奏：04_learning/周节奏.md 里「## 周一」…「## 周日」七块，取当天那块 ----------
// 每块四行：- 主线：… / - 时段：… / - 白天：… / - 保底：…；另有全局「## 固定流程」傍晚四格
async function collectRhythm() {
  const path = V.rhythmPath, f = tfile(path);
  if (!isFile(f)) return { path, exists: false, day: null, fixed: [] };
  const lines = (await app.vault.cachedRead(f)).split("\n");
  const blocks = {}; const fixed = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    const hFixed = l.match(/^##\s+固定流程\s*$/);
    const h = l.match(/^##\s+(周[一二三四五六日])\s*$/);
    if (hFixed) { cur = "fixed"; continue; }
    if (h) { cur = h[1]; blocks[cur] = {}; continue; }
    if (/^##\s+/.test(l)) { cur = null; continue; }
    if (!cur) continue;
    if (cur === "fixed") {
      const bullet = l.match(/^[-*]\s+(.+)$/);
      if (bullet) fixed.push(parseSlot(bullet[1]));
      continue;
    }
    const m = l.match(/^[-*]\s*(主线|时段|白天|保底|副线)\s*[:：]\s*(.+)$/);
    if (m) blocks[cur][m[1]] = m[2].trim();
  }
  const name = WD[TODAY.getDay()];
  return { path, exists: true, day: blocks[name] ? { weekday: name, ...blocks[name] } : null, days: blocks, fixed };
}

// 把当天节奏拼成按时间排的时段表：白天块 → 傍晚固定流程（主线那条替换成当天主线）→ 保底
function todaySchedule(r) {
  const out = [];
  if (!r || !r.day) return out;
  const d = r.day;
  if (d["白天"]) d["白天"].split(/[；;]/).map(s => s.trim()).filter(Boolean).forEach(s => {
    const p = parseSlot(s); out.push({ ...p, text: plain(p.text), kind: "day" });
  });
  (r.fixed || []).forEach(f => {
    if (/^当天主线/.test(f.text) && d["主线"]) {
      const mainTime = parseSlot(d["时段"]).time || f.time;
      out.push({ time: mainTime, text: plain(d["主线"]), kind: "main", tip: `时段：${plain(d["时段"] || "")}` });
    } else {
      out.push({ time: f.time, text: plain(f.text), kind: "fixed" });
    }
  });
  if (d["保底"]) out.push({ time: "", text: plain(d["保底"]), kind: "base" });
  out.sort((a, b) => slotMins(a.time) - slotMins(b.time));
  return out;
}

// 时段行和当天笔记里已有的任务按文字对账：命中就带上行号/完成态，没命中就是待新建的 fresh 行
function todayRows(t, r) {
  // 2026-11-20 起：右侧只显示当天日记里的真实任务，不再用周节奏自动排期拼条目
  const items = (t && t.items) || [];
  return { rows: [], rest: items };
}

function schedRowHTML(row, maxLen = 32) {
  const cls = row.done ? "done" : "todo";
  const lineAttr = row.line != null ? `data-line="${row.line}"` : "";
  const newAttr = row.fresh ? ' data-new="1"' : "";
  return `<li class="${cls}${row.kind ? ` ${row.kind}` : ""}" data-open="${esc(row.path)}" ${lineAttr}${newAttr} data-text="${esc(row.text)}" title="${esc(row.tip || row.text)}"><span class="box" data-toggle title="${row.done ? "改回未完成" : "标记完成"}"></span><span class="st-time">${row.time ? esc(row.time) : (row.kind === "base" ? "保底" : "—")}</span><span class="txt">${esc(cut(row.text, maxLen))}</span></li>`;
}

// 下一检验节点倒计时：无日期/日期解析失败 → 待定；今天 → 今天；未来 → 剩 X 天；过期 → 已到期 X 天
function checkpointCountdown(iso) {
  if (!iso) return { state: "none", label: "待定" };
  const raw = String(iso).trim();
  let d = new Date(raw.length > 10 ? raw : `${raw}T00:00:00`);
  if (Number.isNaN(+d)) { const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/); d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) : d; }
  if (Number.isNaN(+d)) return { state: "none", label: "待定" };
  const diff = Math.round((d - TODAY) / 86400000);
  if (diff === 0) return { state: "today", label: "今天" };
  if (diff > 0) return { state: "future", label: `剩 ${diff} 天` };
  return { state: "overdue", label: `已到期 ${-diff} 天` };
}

// 轨道 README 里 `## 四阶段` 下的表格 → 阶段表（阶段 / 日期 / 周投入 / 内容）
async function readStages(path) {
  const f = tfile(path); if (!isFile(f)) return [];
  const r = sectionRange(path, h => /^四阶段/.test(h.heading)); if (!r) return [];
  const lines = (await app.vault.cachedRead(f)).split("\n").slice(r.start + 1, r.end === Infinity ? undefined : r.end);
  const rows = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
    if (!cells.length || cells[0] === "阶段" || cells.length < 3) continue;
    rows.push({ stage: cells[0], date: cells[1], hours: cells[2], content: cells[3] || "" });
  }
  return rows;
}

// 周任务笔记里找今天所在的那一周：`## 第 N 周 · 2026-11-16 – 11-22 · 阶段名`
async function collectTrackWeeks(path) {
  const f = tfile(path); if (!isFile(f)) return null;
  const lines = (await app.vault.cachedRead(f)).split("\n");
  const secs = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw;
    if (/^##\s+第\s*\d+\s*周/.test(l)) {
      const n = +(l.match(/第\s*(\d+)\s*周/) || [])[1];
      const d = (l.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
      const stage = l.split(/[·・]/).slice(2).join("·").trim();
      cur = { n, start: d, stage, items: [] };
      secs.push(cur); continue;
    }
    if (/^##\s+/.test(l)) { cur = null; continue; }
    if (!cur) continue;
    const m = l.match(/^\s*-+\s*\[(.)\]\s*(.*)$/);
    if (m) { if (m[2].trim()) cur.items.push({ done: /x|X/.test(m[1]), text: m[2].trim() }); }
  }
  const current = secs.find(s => {
    if (!s.start) return false;
    const d = new Date(`${s.start}T00:00:00`); if (Number.isNaN(+d)) return false;
    return TODAY >= d && TODAY <= addDays(d, 6);
  }) || null;
  const all = secs.reduce((a, s) => a + s.items.length, 0);
  const done = secs.reduce((a, s) => a + s.items.filter(i => i.done).length, 0);
  return { path, cur: current, weeks: secs.length, total: all, done };
}

// 错题本三列表：题型 / 错因 / 正确切入点
async function readWrongBook(path) {
  const f = tfile(path); if (!isFile(f)) return null;
  const lines = (await app.vault.cachedRead(f)).split("\n");
  const rows = []; let head = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
    if (!head) { head = cells; continue; }
    if (!cells[0]) continue;
    rows.push(cells);
  }
  return { path, head, rows };
}

async function collectTracks() {
  const dir = tfile(V.tracksDir);
  const tracks = [];
  if (dir && Array.isArray(dir.children)) {
    for (const c of dir.children) {
      if (!Array.isArray(c.children)) continue; // 只看轨道文件夹
      const readmePath = `${c.path}/README.md`;
      const page = isFile(tfile(readmePath)) ? dv.page(readmePath) : null;
      const stage0 = page && page.stage != null ? String(page.stage) : "";
      const checkpoint = page && page.checkpoint != null ? String(page.checkpoint) : "";
      const nextCheckpoint = page ? toDateStr(page.nextCheckpoint) : "";
      const r = sectionRange(readmePath, h => /^里程碑/.test(h.heading));
      const items = under(tasksOf(readmePath), r);
      // 可选：README 的四阶段表、周任务笔记、错题本（没有就是空，不影响普通轨道）
      const plan = await readStages(readmePath);
      const weeks = await collectTrackWeeks(`${c.path}/周任务.md`);
      const wb = await readWrongBook(`${c.path}/错题本.md`);
      const stage = (weeks && weeks.cur && weeks.cur.stage) || stage0;
      tracks.push({
        name: c.name, path: c.path, readme: isFile(tfile(readmePath)) ? readmePath : null,
        stage, checkpoint, nextCheckpoint: nextCheckpoint.trim(),
        items, total: items.length, done: items.filter(t => t.done).length,
        plan, weeks, wb,
      });
    }
  }
  return { total: tracks.length, tracks };
}

// 时间轴进度：从入学起点到目标窗口的流逝比例（0~1），只表示走到哪一程
function timeFrac(startIso, endIso) {
  const s = new Date(`${startIso}T00:00:00`), e = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(+s) || Number.isNaN(+e) || e <= s) return 0;
  return Math.min(1, Math.max(0, (TODAY - s) / (e - s)));
}

async function collectAnchors() {
  const path = V.anchorsPath;
  const f = tfile(path);
  if (!isFile(f)) return { path, exists: false, anchors: [], total: 0, done: 0 };
  const page = dv.page(path);
  const timelineStart = toDateStr(page && page.timelineStart) || "2026-09-01";
  const lines = (await app.vault.cachedRead(f)).split("\n");
  const hs = headings(path);
  const l2 = hs.filter(h => h.level === 2);
  const allTasks = tasksOf(path);
  const anchors = l2.map(h => {
    const start = h.position.start.line;
    const idx = hs.indexOf(h);
    const next = hs.slice(idx + 1).find(x => x.level <= 2);
    const end = next ? next.position.start.line : Infinity;
    const mileH = hs.find(x => x.level === 3 && x.position.start.line > start && x.position.start.line < end && /里程碑/.test(x.heading));
    const metaEnd = mileH ? mileH.position.start.line : end;
    const meta = {};
    for (let i = start + 1; i < metaEnd; i++) {
      const m = lines[i].match(/^\s*-\s*([^:：]+)[:：]\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim();
    }
    const items = mileH ? under(allTasks, { start: mileH.position.start.line, end }) : [];
    const window = toDateStr(meta.window || "");
    delete meta.window;
    return { title: h.heading, line: start, meta, window, start: timelineStart,
      items, total: items.length, done: items.filter(t => t.done).length };
  });
  const total = anchors.reduce((a, x) => a + x.total, 0);
  const done = anchors.reduce((a, x) => a + x.done, 0);
  return { path, exists: true, anchors, total, done };
}

async function collectTodo() {
  const path = V.todoPath, f = tfile(path);
  if (!isFile(f)) return { path, exists: false, planned: [], ideas: [], total: 0 };
  const text = await app.vault.cachedRead(f);
  const lines = text.split("\n");
  const stripMark = l => l.replace(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[.\]\s*)?/, "").trim();
  const planned = lines.map((l, i) => ({ l, i })).filter(x => x.l.includes("下一期")).map(x => ({ text: stripMark(x.l), line: x.i }));
  // 段落 = 空行分开的一块
  const paras = []; let cur = null;
  lines.forEach((l, i) => {
    if (l.trim() === "") { cur = null; return; }
    if (!cur) { cur = { start: i, lines: [] }; paras.push(cur); }
    cur.lines.push(l);
  });
  const DATE1 = /^(\d{1,2})[.\-/](\d{1,2})\.?$/;            // 10.28
  const DATE2 = /^(\d{4})-(\d{2})-(\d{2})(?:\s*[·:：]\s*(.*))?$/; // 2026-10-30 · 文本
  const ideas = paras.map(p => {
    let date = null, body = p.lines, m;
    if ((m = p.lines[0].match(DATE1))) { date = `${pad(+m[1])}.${pad(+m[2])}`; body = p.lines.slice(1); }
    else if ((m = p.lines[0].match(DATE2))) { date = `${m[2]}.${m[3]}`; body = [m[4] || "", ...p.lines.slice(1)].filter(Boolean); }
    return { date, text: body.map(stripMark).join(" ").replace(/\s+/g, " ").trim(), line: p.start, isPlanned: p.lines.some(l => l.includes("下一期")) };
  }).filter(p => p.text);
  const shown = ideas.filter(p => !p.isPlanned).slice(-V.ideasMax).reverse();
  return { path, exists: true, planned, ideas: shown, total: ideas.length, lastLine: lines.length - 1, all: ideas.filter(p => !p.isPlanned).slice().reverse(),
    urls: [...text.matchAll(/https?:\/\/[^\s)）]+/g)].map(m => m[0]) }; // 资讯卡据此判断哪条已经「收进灵感」
}

// 资讯卡：读 01_dashboard/news/fetch.mjs 每天写在 vault 外的 today.json（方案 §13）。看板自己不联网
const NEWS_DIR = () => window.require("path").join(window.require("os").homedir(), ".secondbrain-news");
// 缩略图不用 <img src=网址> 直接加载：那样会存进 Obsidian 的网页缓存（在磁盘上，满 1.25GB 左右才清）。
// 改用 Node 下载到内存、做成 blob 地址给图片用，关掉 Obsidian 就没了，磁盘上不留
const thumbMap = () => window.__sbThumbs || (window.__sbThumbs = new Map()); // 原网址 → blob 地址（加载中是 null）
const thumbSrc = url => { const b = thumbMap().get(url); return typeof b === "string" ? b : ""; };
function loadThumbs() {
  const map = thumbMap();
  const want = [...new Set([...document.querySelectorAll(".sb-board img[data-thumb]")].map(i => i.dataset.thumb))];
  for (const url of want) {
    if (map.has(url)) continue;
    map.set(url, null);
    window.require("https").get(url, res => {
      if (res.statusCode !== 200) { res.resume(); map.delete(url); return; }
      const parts = []; res.on("data", c => parts.push(c));
      res.on("end", () => {
        const b = URL.createObjectURL(new Blob([Buffer.concat(parts)], { type: res.headers["content-type"] || "image/jpeg" }));
        map.set(url, b);
        document.querySelectorAll(`.sb-board img[data-thumb="${CSS.escape(url)}"]`).forEach(i => { i.src = b; });
      });
    }).on("error", () => map.delete(url));
  }
  // 只留今天数据里还在的，旧的释放掉内存
  for (const [url, b] of map) if (!want.includes(url) && b) { URL.revokeObjectURL(b); map.delete(url); }
}
function collectNews() {
  try {
    const fs = window.require("fs"), path = window.require("path"), dir = NEWS_DIR();
    let t = null;
    try { t = JSON.parse(fs.readFileSync(path.join(dir, "today.json"), "utf8")); } catch (e) { /* 还没跑过 */ }
    let running = false;
    try { running = Date.now() - fs.statSync(path.join(dir, "run.lock")).mtimeMs < 15 * 60e3; } catch (e) { /* 没在跑 */ }
    return { t, running, dir };
  } catch (e) { return { t: null, running: false, err: String(e.message || e) }; }
}

// ---------- 科研情报卡（独立数据目录 ~/.secondbrain-research，脚本 01_dashboard/research/fetch-research.mjs） ----------
const RESEARCH_DIR = () => window.require("path").join(window.require("os").homedir(), ".secondbrain-research");
function collectResearch() {
  try {
    const fs = window.require("fs"), path = window.require("path"), dir = RESEARCH_DIR();
    let t = null;
    try { t = JSON.parse(fs.readFileSync(path.join(dir, "today.json"), "utf8")); } catch (e) { /* 还没跑过 */ }
    let running = false;
    try { running = Date.now() - fs.statSync(path.join(dir, "run.lock")).mtimeMs < 15 * 60e3; } catch (e) { /* 没在跑 */ }
    return { t, running, dir };
  } catch (e) { return { t: null, running: false, err: String(e.message || e) }; }
}

// ---------- 流水线（收件箱 → 速查卡）：状态读库外 ~/.secondbrain-kb，触发复用 child_process ----------
const KB_DIR = () => process.env.SB_KB_DIR || window.require("path").join(window.require("os").homedir(), ".secondbrain-kb");
function collectPipeline() {
  const fs = window.require("fs"), path = window.require("path"), dir = KB_DIR();
  const inbox = `${V.materialsDir}/_收件箱`;
  const files = walkFiles(inbox, f => f.extension);
  let pending = 0; const skipped = [], unknown = [];
  for (const f of files) {
    const rel = f.path.slice(inbox.length + 1);
    const seg = rel.split("/")[0];
    if (!SUBJECTS.includes(seg)) { unknown.push(rel); continue; }
    if (f.extension.toLowerCase() === ".pptx") pending++;
    else skipped.push(rel);
  }
  let running = false, lastLine = "", lastAt = "";
  try { running = Date.now() - fs.statSync(path.join(dir, "run.lock")).mtimeMs < 15 * 60e3; } catch (e) { /* 没在跑 */ }
  try {
    const lines = fs.readFileSync(path.join(dir, "run.log"), "utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length) { lastLine = lines[lines.length - 1]; const m = lastLine.match(/^\[(\d\d:\d\d:\d\d)\]/); if (m) lastAt = m[1]; }
  } catch (e) { /* 还没跑过 */ }
  return { pending, skipped, unknown, running, lastLine, lastAt, dir };
}
const plResult = line => {
  if (!line) return "";
  if (line.includes("--no-llm")) return "仅解析调试";
  if (line.includes("失败")) return "有失败，见日志";
  if (line.includes("全部完成")) return "已完成";
  if (line.includes("没有可解析")) return "收件箱空";
  return cut(line.replace(/^\[\d\d:\d\d:\d\d\]\s*/, ""), 24);
};

// ---------- 画 ----------
const SVG_EXPAND = `<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>`;
const chrome = kind => `<span class="handle"></span><span class="tools"><button class="tb" data-act="expand" title="展开">${SVG_EXPAND}</button><button class="tb" data-act="more" title="更多">⋯</button></span>`;

function glyphField(seed = 11) {
  const g = "▲×#●·+"; let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const rows = [];
  for (let y = 0; y < 4; y++) { let row = ""; for (let x = 0; x < 30; x++) row += rnd() < 0.42 ? g[Math.floor(rnd() * g.length)] : " "; rows.push(row); }
  return rows.join("\n");
}

function taskLiHTML(t, fallbackPath, maxLen = 60, extraCls = "") {
  const p = parseTaskText(t.text, t.link);
  const linkBtn = t.link ? `<button class="lnk" data-link="${esc(t.link)}" title="打开关联笔记：${esc(t.link)}">${esc(t.link.split("/").pop())}</button>` : "";
  const label = p.subj.label ? `<span class="tagk">${esc(p.subj.label)}</span>` : "";
  const sub = p.sub ? `<span class="sub">${esc(cut(p.sub, 120))}</span>` : "";
  return `<li class="${t.done ? "done" : "todo"}${extraCls ? ` ${extraCls}` : ""}" data-open="${esc(t.path || fallbackPath)}" data-line="${t.line}" data-text="${esc(t.text)}"><span class="box" data-toggle title="${t.done ? "改回未完成" : "标记完成"}"></span><div class="body"><span class="line">${label}<span class="txt">${esc(cut(p.title, maxLen))}</span></span>${sub}${linkBtn}</div></li>`;
}
function renderList(items, cls, fallbackPath, maxLen = 60) {
  return `<ul class="list ${cls}">${items.map(t => taskLiHTML(t, fallbackPath, maxLen)).join("")}</ul>`;
}

const dayDots = days => `<ol class="days">${days.map((d, k) =>
  `<li class="${d.state}${d.date === ymd(TODAY) ? " now" : ""}"${d.path ? ` data-open="${esc(d.path)}"` : ""} title="${d.date}${d.total ? ` · ${d.done}/${d.total}` : ""}"><span class="wd">${"一二三四五六日"[k]}</span><span class="dot"></span></li>`
).join("")}</ol>`;

// 今天卡里的「主线」条：从周节奏取当天那一条，时段靠右
function threadStrip(r) {
  const d = r && r.day;
  if (!d || !d["主线"]) return "";
  const tip = [`${d.weekday}主线：${plain(d["主线"])}`, d["时段"] ? `时段：${plain(d["时段"])}` : "", d["白天"] ? `白天：${plain(d["白天"])}` : "", d["保底"] ? `保底：${plain(d["保底"])}` : ""].filter(Boolean).join("\n");
  // 条上只留时间区间，括号里的说明放进 tooltip，免得挤掉主线文字
  const time = plain(d["时段"] || "").split(/[（(]/)[0].trim();
  return `<div class="thread" data-open="${esc(r.path)}" title="${esc(tip)}">
      <span class="th-lab">主线</span><b class="th-name">${esc(cut(plain(d["主线"]), 26))}</b><span class="th-time">${esc(time)}</span></div>`;
}

function cardDirsearch(D) {
  const rows = D.subjects.rows.map(r => {
    const rev = r.review > 0
      ? `<span class="ds-rev hot">待复习 ${r.review}</span>`
      : `<span class="ds-rev">—</span>`;
    return `<button class="ds-row" data-tab="${esc(r.mainNote)}" title="新标签页打开 ${esc(r.subject)} 主笔记">
      <span class="ds-name">${esc(r.subject)}</span>
      <span class="ds-meta">材料 ${r.materials} 份 · ${rev}</span></button>`;
  }).join("");
  const pl = D.pipeline;
  const plTip = [pl.skipped.length ? `${pl.skipped.length} 个暂不支持格式留在收件箱` : "", pl.unknown.length ? `${pl.unknown.length} 个未知学科目录` : ""].filter(Boolean).join(" · ");
  const plStatus = pl.running ? "流水线正在跑…" : pl.pending > 0 ? `收件箱待处理 ${pl.pending} 份` : "收件箱空";
  const plLast = pl.lastAt ? ` · 上次 ${pl.lastAt} ${plResult(pl.lastLine)}` : "";
  return `<section class="tile dirsearch" data-kind="dirsearch"><span class="handle"></span>
    <div class="h">学科目录 <span class="lab">点科目录开主笔记 · 右侧搜笔记</span></div>
    <div class="ds-body">
      <div class="ds-subjects">${rows}</div>
      <div class="ds-find">
        <input class="ds-input" type="text" placeholder="搜笔记 / 搜考点，回车全文搜" spellcheck="false" autocomplete="off">
        <ul class="ds-results"></ul>
      </div>
    </div>
    <div class="ds-pl" title="${esc(plTip)}">
      <span class="pl-status">${esc(plStatus)}${esc(plLast)}</span>
      <button class="btn pl-run" data-act="pipeline-run" ${pl.running ? "disabled" : ""}>${pl.running ? "正在跑…" : "跑流水线"}</button>
    </div>
    <span class="tag">00 · subjects</span></section>`;
}

function cardToday(D) {
  const t = D.today;
  const { rest: restItems } = todayRows(t, D.rhythm);
  const total = restItems.length;
  const done = restItems.filter(x => x.done).length;
  const left = total - done;
  const rev = D.review.total;
  const revLine = rev > 0 ? `<button class="rev-line" data-act="open-review">待复习 <b>${rev}</b> 篇</button>` : "";
  let big, hint;
  if (!t.exists && !total) { big = `今天<b>还没定</b>`; hint = `<button class="btn" data-act="create-today">按模板新建今天</button>`; }
  else if (!total) { big = `今天<b>还没定</b>`; hint = `在右边输入框写今天要做的，回车就进「今日」`; }
  else if (left > 0) { big = `还剩<b data-num="today-left">${left}</b>件<small>共 ${total} 条</small>`; hint = `已完成 ${done} 条，先啃第一条`; }
  else { big = `今天<b>清</b>了<small>${total} 条全做完</small>`; hint = `去定明天的三条`; }
  const lis = sortTasks(restItems).map(x => taskLiHTML(x, t.path, 48, "plain")).join("");
  const list = `<ul class="list today-list">${lis}</ul>`;
  return `<section class="tile today" data-kind="today" data-src="${esc(t.path)}" data-src-line="${t.sectionLine ?? ""}">${chrome("today")}
    <div class="left"><div class="h">今天 <span class="lab">${t.date.slice(5).replace("-", ".")} ${t.weekday}</span></div>
      <div class="big">${big}</div><div class="hint">${hint}</div>
      ${threadStrip(D.rhythm)}
      ${revLine}
      ${dayDots(D.days)}</div>
    <div class="right"><pre class="field">${glyphField()}</pre>${list}${carryLine(D.carry.today, "carry-today")}${jotBox("today")}</div>
    <span class="tag">01 · today</span></section>`;
}

function cardTracks(D) {
  const t = D.tracks;
  // 按最近节点排序：快到期的排前面，没有日期的排最后（五条都要在卡里露出来）
  const rank = iso => { const d = new Date(`${iso}T00:00:00`); return iso && !Number.isNaN(+d) ? +d : Infinity; };
  const list = [...t.tracks].sort((a, b) => rank(a.nextCheckpoint) - rank(b.nextCheckpoint)).map(tr => {
    const cd = checkpointCountdown(tr.nextCheckpoint);
    const pct = tr.total ? Math.round(tr.done / tr.total * 100) : 0;
    const tip = [tr.stage, tr.checkpoint || "下一节点待定", `里程碑 ${tr.done}/${tr.total}`].filter(Boolean).join(" · ");
    return `<div class="track" data-open="${esc(tr.readme || tr.path)}" title="${esc(tip)}">
      <div class="tr-top"><b>${esc(tr.name)}</b><span class="cd ${cd.state}">${cd.label}</span></div>
      <div class="tr-foot"><em>${esc(tr.stage || "未设阶段")}</em><div class="tr-bar"><i style="width:${pct}%"></i></div><span class="tr-num">${tr.done}/${tr.total}</span></div>
    </div>`;
  }).join("");
  return `<section class="tile dots tracks" data-kind="tracks" data-src="${esc(V.tracksDir)}">${chrome("tracks")}
    <div class="h">长期轨道 <span class="lab">${t.total} tracks</span></div>
    <div class="tracks-list">${list || `<span class="muted">还没有轨道，在 ${esc(V.tracksDir)}/ 下建文件夹和 README.md</span>`}</div>
    <span class="tag">02 · tracks</span></section>`;
}

function routeSvg(r) {
  const n = r.stations.length; if (!n) return "";
  const W = 520, H = 40, x0 = 12, x1 = W - 12, step = n > 1 ? (x1 - x0) / (n - 1) : 0, y = 9;
  let s = `<svg class="line" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  s += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="rail"/>`;
  s += `<line x1="${x0}" y1="${y}" x2="${x0 + step * r.cur}" y2="${y}" class="rail on"/>`;
  r.stations.forEach((w, i) => {
    const x = x0 + step * i, on = i === r.cur, past = i < r.cur;
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    s += `<g class="st ${on ? "on" : past ? "past" : "todo"}" data-open="${esc(r.path)}" data-line="${w.line}"><title>${esc(w.heading)}</title>`;
    s += on ? `<circle cx="${x}" cy="${y}" r="6" class="c1"/><circle cx="${x}" cy="${y}" r="2.6" class="c2"/>` : `<circle cx="${x}" cy="${y}" r="3.5" class="c0"/>`;
    s += `<text x="${x}" y="${y + 14}" text-anchor="${anchor}" class="wk">${esc(w.label)}</text>`;
    s += `<text x="${x}" y="${y + 26}" text-anchor="${anchor}" class="ct">${w.done}/${w.total}</text></g>`;
  });
  return s + `</svg>`;
}

function cardRoute(D) {
  const r = D.route, c = r.stations[r.cur];
  const pct = r.total ? Math.round(r.done / r.total * 100) : 0;
  const seg = [...Array(26)].map((_, i) => `<i class="${i < Math.round((r.total ? r.done / r.total : 0) * 26) ? "on" : ""}"></i>`).join("");
  const next = r.next.map((t, k) => `<li data-open="${esc(t.path)}" data-line="${t.line}"><b>${k === 0 ? "NEXT" : "THEN"}</b><span>${esc(cut(plain(t.text), 44))}</span></li>`).join("");
  const body = c ? `
    <div class="hero" data-open="${esc(r.path)}" data-line="${c.line}"><div class="n"><span data-num="route-done">${c.done}</span><small>/ ${c.total}</small></div><div class="where"><span class="lab">now at</span><b>${esc(c.label.replace(/^第(\d+)周/, "第 $1 周"))} · ${esc(c.title)}</b></div></div>
    ${routeSvg(r)}
    <div class="now-hint">${r.block ? `这一站还剩 ${r.block.total - r.block.done} 条 · 清单在本周卡` : "这一站全勾完了"}</div>
    <ol class="next">${r.upcoming.map((u, k) => `<li data-open="${esc(r.path)}" data-line="${u.line}"><b>${k === 0 ? "NEXT" : "THEN"}</b><span>${esc(cut(u.title, 40))} <em>${u.done}/${u.total}</em></span></li>`).join("")}</ol>`
    : `<div class="muted" data-open="${esc(r.path)}">没在《${esc(baseName(r.path))}》里找到「第 N 周 · 标题」的二级标题</div>`;
  return `<section class="tile dark route" data-kind="route" data-src="${esc(r.path)}" data-src-line="${c ? c.line : 0}">${chrome("route")}
    <div class="h">AI 学习路线 <span class="lab">6-week plan · ${r.stations.length} stops</span></div>
    ${body}
    <div class="totwrap"><span class="lab">total ${r.done} / ${r.total}</span><div class="seg">${seg}</div><span class="pct"><span data-num="route-pct">${pct}</span>%</span></div>
    <span class="tag">03 · ai route</span></section>`;
}

function cardStack(D) {
  const s = D.stack;
  const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
  const cur = s.curStage, ms = s.nextMilestone;
  const seg = [...Array(26)].map((_, i) => `<i class="${i < Math.round(pct / 100 * 26) ? "on" : ""}"></i>`).join("");
  const body = !s.exists
    ? `<div class="muted">技术栈规划文档还没建</div>`
    : `
      <div class="hero"><div class="n"><span data-num="stack-done">${s.done}</span><small>/ ${s.total}</small></div>
        <div class="where"><span class="lab">now at</span><b>${cur ? esc(cur.heading) : "阶段待排"}</b></div></div>
      <div class="stk-ms">${ms ? `<li><b>NEXT</b><span>${esc(ms.id)} · ${esc(ms.text)}</span></li>` : ""}</div>`;
  return `<section class="tile dark stack" data-kind="stack" data-src="${esc(s.path)}">${chrome("stack")}
    <div class="h">技术栈 <span class="lab">toolkit · ${s.stages.length} 阶段</span></div>
    ${body}
    <div class="totwrap"><span class="lab">total ${s.done} / ${s.total}</span><div class="seg">${seg}</div><span class="pct">${pct}%</span></div>
    <span class="tag">03 · toolkit</span></section>`;
}

// 本周 = 学习计划当前区块（只列没勾的，勾了直接写回计划文件）+ 我加的（weekly 文件，可在卡上输入）
function planBlockHTML(D, cls, maxLen, undoneOnly) {
  const r = D.route, b = r.block;
  const head = b
    ? `<div class="plan-h" data-open="${esc(r.path)}" data-line="${b.line}"><span class="lab">学习计划</span><b>${esc(b.head)}</b><span class="cnt">${b.done}/${b.total}</span></div>`
    : `<div class="plan-h"><span class="lab">学习计划</span><b class="muted">${r.exists ? "计划里的条目都勾完了" : `没找到《${esc(baseName(r.path))}》`}</b></div>`;
  const groups = b ? b.groups.map(g => {
    const items = undoneOnly ? g.items.filter(t => !t.done) : g.items;
    return (g.title ? `<div class="grp">${esc(g.title)}</div>` : "") + (items.length ? renderList(items, cls, r.path, maxLen) : "");
  }).join("") : "";
  return head + groups;
}
function cardWeek(D) {
  const w = D.week, b = D.route.block;
  const done = b ? b.done : 0, total = b ? b.total : 0;
  return `<section class="tile mint week" data-kind="week" data-src="${esc(w.path)}" data-src-line="${w.sectionLine ?? ""}">${chrome("week")}
    <div class="h">本周要完成 <span class="lab">${esc(w.range)}</span></div>
    <div class="top"><div class="n"><span data-num="week-done">${done}</span><small>/ ${total} 做完</small></div><div class="left">还有 ${w.daysLeft} 天<br>${total - done} 条没动</div></div>
    <div class="week-route rt" data-act="expand" title="点开看本周全部任务">${routeSvg(D.route)}</div>
    <div class="dayswrap"><div class="cap">每天定了没、做完没<br>■ 做完 ◧ 没做完 □ 没定</div>${dayDots(D.days)}</div>
    <span class="tag">04 · this week</span></section>`;
}

function cardIdeas(D) {
  const td = D.todo;
  const items = td.ideas.length
    ? td.ideas.map(i => `<li data-open="${esc(td.path)}" data-line="${i.line}"><span class="when">${i.date || "·"}</span><span class="txt">${esc(cut(i.text, 86))}</span></li>`).join("")
    : `<li><span class="when">·</span><span class="txt muted">还没有内容，先在下面记一笔</span></li>`;
  return `<section class="tile ideas" data-kind="ideas" data-src="${esc(td.path)}" data-src-line="${td.lastLine ?? ""}">${chrome("ideas")}
    <div class="h">灵感收件箱 <span class="cnt" data-open="${esc(td.path)}">${td.total} 段</span></div>
    <ul class="ideas-list">${items}</ul>
    ${jotBox("idea")}
    <div class="foot">05 · inbox · to-do &amp; inspiration.md</div></section>`;
}

function cardAnchors(D) {
  const a = D.anchors;
  const rows = a.anchors.map(x => {
    const cd = checkpointCountdown(x.window);
    const mpct = x.total ? Math.round(x.done / x.total * 100) : 0;
    const tf = Math.round(timeFrac(x.start, x.window) * 100);
    const dir = x.meta["方向"] || "";
    return `<div class="anc" data-open="${esc(a.path)}" data-line="${x.line}">
      <div class="anc-top"><b>${esc(x.title)}</b><em>${esc(dir)}</em></div>
      <div class="anc-cp"><span class="cp-name">${esc(x.meta["窗口"] || "窗口待定")}</span><span class="cd ${cd.state}">${cd.label}</span></div>
      <div class="anc-bars">
        <div class="abar"><i class="on" style="width:${mpct}%"></i></div>
        <div class="abar time"><i style="width:${tf}%"></i></div>
      </div>
      <div class="anc-num">${x.done}/${x.total} 里程碑 · 时间轴 ${tf}%</div>
    </div>`;
  }).join("");
  const body = a.exists && rows ? rows : `<span class="muted">还没有目标锚点，见 ${esc(baseName(a.path))}</span>`;
  return `<section class="tile anchors" data-kind="anchors" data-src="${esc(a.path)}">${chrome("anchors")}
    <div class="h">目标锚点 <span class="lab">${a.anchors.length} goals</span></div>
    <div class="anc-list">${body}</div>
    <span class="tag">08 · goals</span></section>`;
}

// ---------- 06 今天 AI 圈（资讯卡） ----------
const fmtViews = n => n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const fmtAgo = h => h == null ? "" : h < 1 ? "刚刚" : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
const xWhen = iso => { const d = new Date(iso), y = new Date(Date.now() - 864e5); if (Number.isNaN(+d)) return ""; const w = d.toDateString() === new Date().toDateString() ? "今天" : d.toDateString() === y.toDateString() ? "昨天" : `${d.getMonth() + 1}.${d.getDate()}`; return `${w} ${hhmm(iso)} 整理`; };
const hhmm = iso => { const d = new Date(iso); return Number.isNaN(+d) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const marks = it => `${it.xhs ? `<span class="mk xhs" title="能做成你的选题">✦ 选题</span>` : ""}${it.learn ? `<span class="mk learn" title="作为工程师值得学">学</span>` : ""}`;
const saveBtn = (D, ref, url) => (D.todo.urls || []).includes(url)
  ? `<span class="saved">已收进</span>` : `<button class="lnk save" data-act="news-save" data-ref="${esc(ref)}" title="追加到 ${esc(V.todoPath)}">收进灵感</button>`;
function newsStatus(N) {
  const t = N.t;
  if (N.running) return `<span class="upd run">正在更新…</span>`;
  if (!t) return `<span class="upd">${N.err ? "读不到数据" : "还没有数据"}</span>`;
  const stale = t.date && t.date !== ymd(TODAY) ? `<b class="stale">这是 ${t.date.slice(5).replace("-", ".")} 的</b>` : "";
  const err = t.lastError ? `<b class="stale" title="${esc(t.lastError.message)}">上次更新失败</b>` : "";
  return `<span class="upd">${stale}${err}${t.generatedAt ? `更新于 ${hhmm(t.generatedAt)}` : ""}</span>`;
}
function refLabel(t, ref) {
  const [k, id] = String(ref).split(/:(.+)/);
  if (k === "yt") { const v = (t.youtube || []).find(x => x.id === id); return v ? { label: v.title_zh || v.title, url: v.url, src: "YouTube · " + v.channel } : null; }
  if (k === "hn") { const h = (t.hn || []).find(x => x.id === id); return h ? { label: h.title_zh || h.title, url: h.hnUrl, src: "Hacker News" } : null; }
  if (k === "x") return { label: "@" + id, url: `https://x.com/${id}`, src: "X" };
  if (k === "pod") { const p = (t.podcasts || []).find(x => x.guid === id); return p ? { label: p.title_zh || p.title, url: p.url, src: "播客 · " + p.name } : null; }
  if (k === "arx") { const p = (t.arxiv || []).find(x => x.id === id); return p ? { label: p.title_zh || p.title, url: p.url, src: "arXiv" } : null; }
  return null;
}
const countLine = c => !c ? "" : [["YT", c.yt], ["X", c.x], ["HN", c.hn], ["播客", c.pod]].filter(x => x[1]).map(x => `${x[0]} ${x[1]}`).join(" · ");
function ytItem(D, v, full) {
  return `<li class="ni yt" data-url="${esc(v.url)}">
    <img class="th" data-thumb="${esc(v.thumb)}"${thumbSrc(v.thumb) ? ` src="${thumbSrc(v.thumb)}"` : ""} alt="">
    <div class="nb"><div class="nt" title="${esc(v.title)}">${esc(v.title_zh || v.title)}</div>
      <div class="nm">${esc(v.channel)} · ${fmtAgo(v.agoH)} · ${fmtViews(v.views)}${v.hot ? ` <b class="hot" title="播放量明显高于这个频道平时（中位数 ${fmtViews(v.median)}）">爆</b>` : ""}${marks(v)}</div>
      ${v.gist ? `<div class="ng">${esc(v.gist)}</div>` : ""}
      ${v.angle ? `<div class="na">✦ ${esc(v.angle)}</div>` : ""}
      ${full ? `<div class="orig">${esc(v.title)}</div>` : ""}
      <div class="nf">${saveBtn(D, "yt:" + v.id, v.url)}</div></div></li>`;
}
function xItem(D, x, full) {
  const url = (x.links && x.links[0] && x.links[0].url) || (x.who && x.who[0] ? `https://x.com/${x.who[0]}` : "");
  const who = (x.who || []).map(w => `<span class="who" data-url="https://x.com/${esc(w)}">@${esc(w)}</span>`).join(" ");
  const links = full && x.links && x.links.length ? `<div class="nf">${x.links.map((l, i) => `<span class="lnk" data-url="${esc(l.url)}">原推 ${i + 1} · @${esc(l.handle)}</span>`).join("")}</div>` : "";
  return `<li class="ni x"${url ? ` data-url="${esc(url)}"` : ""}><div class="nb"><div class="nt">${esc(x.title)}${marks(x)}</div>
    <div class="ng">${esc(x.summary)}</div><div class="nm">${who}</div>${links}
    ${url ? `<div class="nf">${saveBtn(D, "x:" + x.key, url)}</div>` : ""}</div></li>`;
}
function hnItem(D, h, full) {
  return `<li class="ni hn" data-url="${esc(h.hnUrl)}"><div class="nb">
    <div class="nt" title="${esc(h.title)}">${esc(h.title_zh || h.title)}</div>
    <div class="nm">${h.points} 分 · ${h.comments} 评论${marks(h)}</div>
    ${full && h.what ? `<div class="ng"><em>是什么</em>${esc(h.what)}</div>` : ""}
    ${h.engineer ? `<div class="ng">${full ? "<em>工程师角度</em>" : ""}${esc(h.engineer)}</div>` : ""}
    ${full && h.debate ? `<div class="ng"><em>评论区</em>${esc(h.debate)}</div>` : ""}
    ${full ? `<div class="orig">${esc(h.title)}</div><div class="nf"><span class="lnk" data-url="${esc(h.url)}">原文</span><span class="lnk" data-url="${esc(h.hnUrl)}">HN 讨论</span>${saveBtn(D, "hn:" + h.id, h.hnUrl)}</div>`
      : `<div class="nf">${saveBtn(D, "hn:" + h.id, h.hnUrl)}</div>`}</div></li>`;
}
function arxItem(D, p, full) {
  return `<li class="ni arx" data-url="${esc(p.url)}"><div class="nb">
    <div class="nt" title="${esc(p.title)}">${esc(p.title_zh || p.title)}</div>
    <div class="nm">arXiv · ${(p.authors || []).join(", ")}${marks(p)}</div>
    ${p.gist ? `<div class="ng">${full ? "<em>摘要解读</em>" : ""}${esc(p.gist)}</div>` : ""}
    ${full ? `<div class="orig">${esc(p.title)}</div><div class="nf"><span class="lnk" data-url="${esc(p.url)}">论文原文</span>${saveBtn(D, "arx:" + p.id, p.url)}</div>`
      : `<div class="nf">${saveBtn(D, "arx:" + p.id, p.url)}</div>`}</div></li>`;
}
function headItem(t, h, k, full) {
  const refs = full ? (h.refs || []).map(r => refLabel(t, r)).filter(Boolean) : [];
  return `<li class="hd"${full ? "" : ` data-act="expand"`}><span class="hk">${pad(k + 1)}</span>
    <div class="hb"><div class="ht">${esc(h.title)}${h.new ? `<span class="mk new" title="近 30 天第一次出现">新</span>` : ""}${marks(h)}<span class="hc">${countLine(h.count)}</span></div>
      <div class="hs">${esc(h.summary)}</div>
      ${refs.length ? `<div class="hr">${refs.map(r => `<span class="lnk" data-url="${esc(r.url)}" title="${esc(r.src)}">${esc(cut(r.label, 26))}</span>`).join("")}</div>` : ""}</div></li>`;
}
function cardNews(D) {
  const N = D.news, t = N.t || {};
  const tools = `<span class="tools"><button class="tb" data-act="news-refresh" title="现在就更新（约 1 分钟）">↻</button><button class="tb" data-act="expand" title="展开">${SVG_EXPAND}</button><button class="tb" data-act="more" title="更多">⋯</button></span>`;
  const empty = msg => `<div class="muted">${msg}</div>`;
  // 没抓成功过时把原因直接写在卡上（不只是鼠标悬停才看得到）；没配 ARK_API_KEY 是最常见的一种，单独说怎么办
  const fail = t.lastError ? (/ARK_API_KEY|方舟/.test(t.lastError.message)
    ? `总结需要火山方舟豆包接口，这台电脑上没读到 ARK_API_KEY 环境变量。用不上这张卡的话，在 01_dashboard/config.json 里写 "news": false 把它关掉`
    : `上次更新失败：${esc(t.lastError.message)}`) : "";
  const heads = (t.headlines || []).length ? `<ol class="heads">${t.headlines.slice(0, 3).map((h, k) => headItem(t, h, k, false)).join("")}</ol>`
    : empty(N.running ? "正在第一次抓取，大约 1 分钟" : fail || "还没有数据。点右上角 ↻ 抓一次（走火山方舟豆包，大约 1 分钟）");
  const ytN = (t.youtube || []).length;
  const yt = (t.youtube || []).map(v => ytItem(D, v, false)).join("");
  const xs = ((t.x && t.x.topics) || []).map(x => xItem(D, x, false)).join("");
  const pods = (t.podcasts || []).filter(p => p.gist).map(p => `<li class="ni pod" data-url="${esc(p.url)}"><div class="nb"><div class="nt">${esc(p.title_zh || p.title)}${marks(p)}</div><div class="nm">播客 · ${esc(p.name)}</div></div></li>`).join("");
  const hn = (t.hn || []).map(h => hnItem(D, h, false)).join("");
  const arxs = (t.arxiv || []).map(p => arxItem(D, p, false)).join("");
  const err = (t.sources && t.sources.youtube && t.sources.youtube.ok < t.sources.youtube.total) ? `<span class="warn" title="${esc((t.sources.youtube.errors || []).join("\n"))}">${t.sources.youtube.total - t.sources.youtube.ok} 个频道没抓到</span>` : "";
  return `<section class="tile news" data-kind="news" data-src="">${`<span class="handle"></span>`}${tools}
    <div class="h">今天 AI 圈 <span class="lab">${ytN ? "youtube · " : ""}x · hacker news · arxiv</span>${newsStatus(N)}</div>
    ${heads}
    <div class="ncols">
      ${ytN ? `<div class="ncol"><div class="nh">YouTube 博主在做什么 <em>${ytN}</em>${err}</div><ul class="nl">${yt}</ul></div>` : ""}
      <div class="ncol"><div class="nh">X 上大家在聊什么 <em>${t.x && t.x.generatedAt ? xWhen(t.x.generatedAt) : ""}</em></div><ul class="nl">${xs || `<li class="muted">没有数据</li>`}${pods}</ul></div>
      <div class="ncol"><div class="nh">Hacker News <em>工程师圈</em></div><ul class="nl">${hn || `<li class="muted">首页上暂时没有 AI 相关的帖子</li>`}</ul></div>
      <div class="ncol"><div class="nh">论文 · arXiv</div><ul class="nl">${arxs || `<li class="muted">近 10 天没有相关论文</li>`}</ul></div>
    </div>
    <span class="tag">06 · ai news</span></section>`;
}
function detailNews(D) {
  const N = D.news, t = N.t || {};
  const ytN = (t.youtube || []).length;
  const xs = ((t.x && t.x.topics) || []).map(x => xItem(D, x, true)).join("");
  const pods = (t.podcasts || []).map(p => `<li class="ni pod" data-url="${esc(p.url)}"><div class="nb"><div class="nt">${esc(p.title_zh || p.title)}${marks(p)}</div><div class="nm">播客 · ${esc(p.name)}</div>${p.gist ? `<div class="ng">${esc(p.gist)}</div>` : ""}<div class="orig">${esc(p.title)}</div></div></li>`).join("");
  const arxs = (t.arxiv || []).map(p => arxItem(D, p, true)).join("");
  return `
    <div class="stats">${stat((t.headlines || []).length, "要闻")}${ytN ? stat(ytN, "YouTube") : ""}${stat(((t.x && t.x.topics) || []).length, "X 话题")}${stat((t.hn || []).length, "HN")}${stat((t.arxiv || []).length, "论文")}${stat(t.generatedAt ? hhmm(t.generatedAt) : "—", t.date ? t.date.slice(5).replace("-", ".") + " 更新" : "更新")}</div>
    ${secH("要闻 · 按几个来源在聊排序")}<ol class="heads full">${(t.headlines || []).map((h, k) => headItem(t, h, k, true)).join("") || `<div class="muted">还没有数据</div>`}</ol>
    ${ytN ? `${secH("YouTube 博主在做什么 · 近 7 天")}<ul class="nl yt-grid">${(t.youtube || []).map(v => ytItem(D, v, true)).join("")}</ul>` : ""}
    <div class="cols">
      <div>${secH("X 上大家在聊什么")}<ul class="nl">${xs}${pods}</ul></div>
      <div>${secH("Hacker News · 工程师圈")}<ul class="nl">${(t.hn || []).map(h => hnItem(D, h, true)).join("")}</ul></div>
    </div>
    ${secH("arXiv 新论文")}<ul class="nl arx-grid">${arxs || `<div class="muted">近 10 天没有相关论文</div>`}</ul>
    <div class="muted news-foot">数据在 ${esc(N.dir || "~/.secondbrain-news")}，点 ↻ 手动更新（也可挂定时任务），总量不超过 200KB。${t.llm ? `上次总结用时 ${t.llm.seconds} 秒。` : ""}</div>`;
}

function researchStatus(R) {
  const t = R.t;
  if (R.running) return `<span class="upd run">正在更新…</span>`;
  if (!t) return `<span class="upd">${R.err ? "读不到数据" : "还没有数据"}</span>`;
  const stale = t.date && t.date !== ymd(TODAY) ? `<b class="stale">这是 ${t.date.slice(5).replace("-", ".")} 的</b>` : "";
  const err = t.lastError ? `<b class="stale" title="${esc(t.lastError.message)}">上次更新失败</b>` : "";
  return `<span class="upd">${stale}${err}${t.generatedAt ? `更新于 ${hhmm(t.generatedAt)}` : ""}</span>`;
}
function researchPaperItem(D, p, full) {
  const gc = p.grade === "A" ? "gA" : p.grade === "B" ? "gB" : "gC";
  const tags = (p.tags || []).map(t => `<span class="tag-cl">${esc(t)}</span>`).join("");
  const meta = `${esc(p.org || "机构未注明")} · ${esc(p.pi || "PI 未注明")}`;
  const venue = `${esc(p.venue || "")}${p.codeData ? ` · <span class="lnk" data-url="${esc(p.codeData)}">代码/数据</span>` : ""}`;
  const rows = full ? `
    <div class="ng"><em>做了什么</em>${esc(p.what || "")}</div>
    <div class="nm">${meta}</div>
    <div class="nm">${venue}</div>
    <div class="ng">${tags}${p.dataSource ? ` · 数据：${esc(p.dataSource)}` : ""}${p.relation ? ` · 关系：${esc(p.relation)}` : ""}</div>
    <div class="ng"><em>局限</em>${esc(p.limitation || "")}</div>`
    : `<div class="ng">${esc(p.what || "")}</div><div class="nm">${meta}</div>`;
  return `<li class="ni rs" data-url="${esc(p.url)}">
    <div class="nb"><div class="nt"><span class="grade ${gc}">${esc(p.grade || "C")}</span>${p.reviewed === false ? `<span class="mk" title="未评审预印本">未评审</span>` : ""}${esc(p.title_zh || p.title)}</div>
    ${rows}
    ${full ? `<div class="orig">${esc(p.title)}</div><div class="nf"><span class="lnk" data-url="${esc(p.url)}">论文原文</span></div>` : ""}</div></li>`;
}
function rsGroupItem(g) {
  return `<li class="ni grp">
    <div class="nb"><div class="nt">${esc(g.event || "（空条目）")}</div>
    <div class="nm">${[g.pi, g.org, g.date].filter(Boolean).map(esc).join(" · ")}</div>
    ${g.pending && g.pending !== "—" ? `<div class="ng"><em>待核实</em>${esc(g.pending)}</div>` : ""}
    ${g.link ? `<div class="nf"><span class="lnk" data-url="${esc(g.link)}">链接</span></div>` : ""}</div></li>`;
}
function cardResearch(D) {
  const R = D.research, t = R.t || {};
  const tools = `<span class="tools"><button class="tb" data-act="research-refresh" title="现在就更新（约 1 分钟）">↻</button><button class="tb" data-act="expand" title="展开">${SVG_EXPAND}</button><button class="tb" data-act="more" title="更多">⋯</button></span>`;
  const fail = t.lastError ? (/ARK_API_KEY|方舟/.test(t.lastError.message)
    ? `总结需要火山方舟豆包接口，这台电脑上没读到 ARK_API_KEY 环境变量。用不上这张卡的话，在 01_dashboard/config.json 里写 "research": false 把它关掉`
    : `上次更新失败：${esc(t.lastError.message)}`) : "";
  const papers = t.papers || [];
  const a = papers.filter(p => p.grade === "A"), b = papers.filter(p => p.grade !== "A");
  const groups = t.groups || [];
  const body = papers.length || groups.length ? `
    <div class="ncols rs-cols">
      <div class="ncol"><div class="nh">A · 必读 <em>${a.length}</em></div><ul class="nl">${a.map(p => researchPaperItem(D, p, false)).join("") || `<li class="muted">暂无</li>`}</ul></div>
      <div class="ncol"><div class="nh">B · 读摘要 <em>${b.length}</em></div><ul class="nl">${b.map(p => researchPaperItem(D, p, false)).join("") || `<li class="muted">暂无</li>`}</ul></div>
      <div class="ncol"><div class="nh">组 / 招生动态 <em>${groups.length}</em></div><ul class="nl">${groups.map(rsGroupItem).join("") || `<li class="muted">收件箱暂无未归档动态</li>`}</ul></div>
    </div>
    ${t.conclusion ? `<div class="rs-concl">今天最该记住的一句结论：${esc(t.conclusion)}</div>` : ""}`
    : `<div class="rs-empty">${R.running ? "正在第一次抓取，大约 1 分钟" : fail || "还没有数据。点右上角 ↻ 抓一次（走火山方舟豆包，大约 1 分钟）"}</div>`;
  return `<section class="tile research" data-kind="research" data-src=""><span class="handle"></span>${tools}
    <div class="h">科研情报 <span class="lab">arxiv · openalex · s2 · 收件箱</span>${researchStatus(R)}</div>
    ${body}
    <span class="tag">06 · research</span></section>`;
}
function detailResearch(D) {
  const R = D.research, t = R.t || {};
  const papers = t.papers || [];
  const groups = t.groups || [];
  const cBrief = t.cBrief || [];
  const draftPath = t.draft ? `06_tracks/${t.draft}` : "";
  return `
    <div class="stats">${stat(papers.filter(p => p.grade === "A").length, "A 必读")}${stat(papers.filter(p => p.grade === "B").length, "B 摘要")}${stat(groups.length, "机构动态")}${stat(cBrief.length, "C 汇总")}${stat(t.generatedAt ? hhmm(t.generatedAt) : "—", t.date ? t.date.slice(5).replace("-", ".") + " 更新" : "更新")}</div>
    ${secH("A · 必读（机构+PI 明确 · 真实患者数据 · 落 A/D 簇）")}<ul class="nl">${papers.filter(p => p.grade === "A").map(p => researchPaperItem(D, p, true)).join("") || `<div class="muted">暂无 A 级</div>`}</ul>
    ${secH("B · 读摘要（方法创新，仅公开数据集验证）")}<ul class="nl">${papers.filter(p => p.grade === "B").map(p => researchPaperItem(D, p, true)).join("") || `<div class="muted">暂无 B 级</div>`}</ul>
    ${secH("C · 一周汇总一行（综述 / 观点 / 纯仿真无数据）")}<ul class="nl">${cBrief.map(c => `<li class="ni"><div class="nb"><div class="nt">${esc(c.title_zh || c.title)}</div><div class="ng">${esc(c.what || "")}</div></div></li>`).join("") || `<div class="muted">暂无</div>`}</ul>
    ${secH("机构 / 招生动态（来自动态收件箱，未归档）")}<ul class="nl">${groups.map(rsGroupItem).join("") || `<div class="muted">收件箱暂无未归档动态</div>`}</ul>
    ${t.conclusion ? `<div class="rs-concl">今天最该记住的一句结论：${esc(t.conclusion)}</div>` : ""}
    ${draftPath ? `<div class="muted news-foot">双周档案草稿：<span class="lnk" data-open="${esc(draftPath)}">${esc(t.draft)}</span>，需人工核对官网后定稿。</div>` : ""}
    <div class="muted news-foot">数据在 ${esc(R.dir || "~/.secondbrain-research")}，点 ↻ 手动更新。${t.llm ? `上次总结用时 ${t.llm.seconds} 秒。` : ""}</div>`;
}

// 点「收进灵感」：往 To-do & inspiration.md 末尾追加一段，灵感卡当场多一条
function newsRefText(D, ref) {
  const t = D.news.t || {}, [k, id] = String(ref).split(/:(.+)/);
  if (k === "yt") { const v = (t.youtube || []).find(x => x.id === id); if (v) return `【YouTube · ${v.channel}】${v.title_zh || v.title}${v.angle ? `——角度：${v.angle}` : v.gist ? `——${v.gist}` : ""} ${v.url}`; }
  if (k === "hn") { const h = (t.hn || []).find(x => x.id === id); if (h) return `【Hacker News】${h.title_zh || h.title}${h.engineer ? `——${h.engineer}` : ""} ${h.hnUrl}`; }
  if (k === "x") { const x = ((t.x && t.x.topics) || []).find(o => o.key === id); if (x) { const u = (x.links && x.links[0] && x.links[0].url) || `https://x.com/${(x.who || [])[0] || ""}`; return `【X】${x.title}——${x.summary} ${u}`; } }
  if (k === "arx") { const p = (t.arxiv || []).find(x => x.id === id); if (p) return `【arXiv】${p.title_zh || p.title}${p.gist ? `——${p.gist}` : ""} ${p.url}`; }
  return null;
}
async function saveNews(root, D, btn) {
  const text = newsRefText(D, btn.dataset.ref); if (!text) return;
  const f = tfile(V.todoPath); if (!isFile(f)) return;
  root.querySelectorAll(`[data-act="news-save"][data-ref="${CSS.escape(btn.dataset.ref)}"]`).forEach(b => { b.outerHTML = `<span class="saved">已收进</span>`; });
  const ul = root.querySelector(".ideas .ideas-list");
  if (ul) {
    ul.querySelectorAll("li .muted").forEach(m => m.closest("li").remove());
    ul.insertAdjacentHTML("afterbegin", `<li><span class="when">${pad(TODAY.getMonth() + 1)}.${pad(TODAY.getDate())}</span><span class="txt">${esc(cut(text, 86))}</span></li>`);
    while (ul.children.length > V.ideasMax) ul.lastElementChild.remove();
    const cnt = root.querySelector(".ideas .cnt"); if (cnt) cnt.textContent = `${(parseInt(cnt.textContent, 10) || 0) + 1} 段`;
  }
  await app.vault.process(f, data => data.replace(/\s+$/, "") + `\n\n${ymd(TODAY)} · ${text}\n`);
}

// 跑一次抓取脚本（刷新按钮 / 数据不是今天的时自动补跑）。跑完 today.json 一变，下面的文件监视会让看板重画
const NODE_BIN = () => {
  const fs = window.require("fs"), path = window.require("path");
  const win = process.platform === "win32";
  const cands = [
    process.env.SB_NODE,
    ...(win ? ["C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files (x86)\\nodejs\\node.exe"]
            : ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]),
  ];
  const sep = win ? ";" : ":";
  for (const dir of (process.env.PATH || "").split(sep).filter(Boolean)) cands.push(path.join(dir, win ? "node.exe" : "node"));
  return cands.filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
};
const PYTHON_BIN = () => {
  const fs = window.require("fs"), path = window.require("path"), os = window.require("os");
  const win = process.platform === "win32";
  const names = win ? ["python.exe", "py.exe"] : ["python3", "python"];
  const cands = [
    process.env.SB_PYTHON,
    path.join(os.homedir(), "secondbrain-python", "python.exe"), // 库外固定目录的搬迁版 CPython（带 python-pptx）
  ];
  const sep = win ? ";" : ":";
  for (const dir of (process.env.PATH || "").split(sep).filter(Boolean)) for (const n of names) cands.push(path.join(dir, n));
  return cands.filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
};
function runNews(root) {
  // 演示库（config.json 里 newsReadOnly: true）只显示资讯、不更新，免得用演示版读者介绍覆盖真实数据
  if (V.newsReadOnly) { if (typeof Notice === "function") new Notice("这个库只显示资讯，不更新"); return; }
  const node = NODE_BIN(), base = app.vault.adapter.basePath;
  if (!node || !base) { new Notice("没找到 node，没法更新资讯（请把 node 装到 PATH，或在环境变量 SB_NODE 里指定 node 路径）"); return; }
  const home = window.require("os").homedir();
  const env = { ...window.process.env };
  if (process.platform !== "win32") env.PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${home}/.local/bin:${env.PATH || ""}`;
  const p = window.require("child_process").spawn(node, [`${base}/01_dashboard/news/fetch.mjs`], {
    cwd: base, stdio: "ignore", env });
  p.on("close", () => { try { dv.index.touch(); } catch (e) { /* 忽略 */ } });
  p.on("error", e => console.warn("[sb-board] 资讯更新失败", e));
  root.querySelectorAll(".news .upd").forEach(u => { u.className = "upd run"; u.textContent = "正在更新…"; });
}
// 跑一次流水线：扫收件箱 → 解析 pptx → 调模型写速查卡/地图 → 原件归档。日志写库外 run.log
function setPipelineRunning(root, on) {
  const btn = root.querySelector(".pl-run"); if (!btn) return;
  btn.disabled = on; btn.classList.toggle("run", on);
  btn.textContent = on ? "正在跑…" : "跑流水线";
}
function runPipeline(root) {
  const py = PYTHON_BIN(), base = app.vault.adapter.basePath;
  if (!py || !base) { new Notice("没找到 python，没法跑流水线（把 python 装到 PATH，或设环境变量 SB_PYTHON）"); return; }
  const env = { ...window.process.env };
  const p = window.require("child_process").spawn(py, [V.pipelineScript], {
    cwd: `${base}/${V.pipelineDir}`, stdio: "ignore", env });
  setPipelineRunning(root, true);
  p.on("close", () => { setPipelineRunning(root, false); try { dv.index.touch(); } catch (e) { /* 忽略 */ } });
  p.on("error", e => { console.warn("[sb-board] 流水线启动失败", e); setPipelineRunning(root, false); new Notice("流水线启动失败：" + (e.message || e)); });
}
// 盯着流水线数据目录：跑完写 run.log / 释放 lock，看板自己重画
function watchPipeline() {
  try {
    const fs = window.require("fs"), dir = KB_DIR();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (window.__sbKbWatch) window.__sbKbWatch.close();
    let t = null;
    window.__sbKbWatch = fs.watch(dir, (ev, name) => {
      if (name !== "run.log" && name !== "run.lock") return;
      clearTimeout(t); t = setTimeout(() => { try { dv.index.touch(); } catch (e) { /* 忽略 */ } }, 800);
    });
  } catch (e) { console.warn("[sb-board] 监视流水线目录失败", e); }
}
// 盯着数据文件夹：定时任务或刷新按钮写完 today.json，看板自己重画（只装一个监视器，代码更新后换新的）
function watchNews() {
  if (V.news !== true) return;
  try {
    const fs = window.require("fs"), dir = NEWS_DIR();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (window.__sbNewsWatch) window.__sbNewsWatch.close();
    let t = null;
    window.__sbNewsWatch = fs.watch(dir, (ev, name) => {
      if (name !== "today.json" && name !== "run.lock") return;
      clearTimeout(t); t = setTimeout(() => { try { dv.index.touch(); } catch (e) { /* 忽略 */ } }, 800);
    });
  } catch (e) { console.warn("[sb-board] 监视资讯文件夹失败", e); }
}
// 数据不是今天的、已经过了 8:30、没在跑：自动补跑一次（Mac 关机错过定时任务时）。同一天只试一次
function maybeAutoNews(root, N) {
  const now = new Date(), day = ymd(TODAY);
  // 一次都没抓过（新装的）不自动跑：第一次要自己点 ↻，免得一打开看板就替人花一次模型额度
  if (V.news !== true || V.newsReadOnly || !N.t || N.running || N.t.date === day || window.__sbNewsAuto === day) return;
  if (now.getHours() * 60 + now.getMinutes() < 8 * 60 + 30) return;
  window.__sbNewsAuto = day;
  runNews(root);
}

// ---------- 科研情报：刷新 / 监视 / 自动补跑（独立脚本、独立数据目录） ----------
function runResearch(root) {
  if (V.newsReadOnly) { if (typeof Notice === "function") new Notice("这个库只显示资讯，不更新"); return; }
  const node = NODE_BIN(), base = app.vault.adapter.basePath;
  if (!node || !base) { new Notice("没找到 node，没法更新科研情报（请把 node 装到 PATH，或在环境变量 SB_NODE 里指定 node 路径）"); return; }
  const env = { ...window.process.env };
  const p = window.require("child_process").spawn(node, [`${base}/01_dashboard/research/fetch-research.mjs`], {
    cwd: base, stdio: "ignore", env });
  p.on("close", () => { try { dv.index.touch(); } catch (e) { /* 忽略 */ } });
  p.on("error", e => console.warn("[sb-board] 科研情报更新失败", e));
  root.querySelectorAll(".research .upd").forEach(u => { u.className = "upd run"; u.textContent = "正在更新…"; });
}
function watchResearch() {
  if (V.research !== true) return;
  try {
    const fs = window.require("fs"), dir = RESEARCH_DIR();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (window.__sbResearchWatch) window.__sbResearchWatch.close();
    let t = null;
    window.__sbResearchWatch = fs.watch(dir, (ev, name) => {
      if (name !== "today.json" && name !== "run.lock") return;
      clearTimeout(t); t = setTimeout(() => { try { dv.index.touch(); } catch (e) { /* 忽略 */ } }, 800);
    });
  } catch (e) { console.warn("[sb-board] 监视科研情报文件夹失败", e); }
}
function maybeAutoResearch(root, R) {
  const now = new Date(), day = ymd(TODAY);
  if (V.research !== true || V.newsReadOnly || !R.t || R.running || R.t.date === day || window.__sbResearchAuto === day) return;
  if (now.getHours() * 60 + now.getMinutes() < 8 * 60 + 30) return;
  window.__sbResearchAuto = day;
  runResearch(root);
}

// ---------- 07 番茄钟：25 分专注 / 5 分休息。按结束时间戳算剩余，存 localStorage，看板重画、切笔记、重启 Obsidian 都接得上 ----------
const POMO_KEY = "sb-pomo";
const POMO_MS = () => window.__sbPomoMs || { focus: 25 * 60e3, brk: 5 * 60e3 }; // 测试时可在控制台改短
function pomoLoad() {
  try { const s = JSON.parse(localStorage.getItem(POMO_KEY)); if (s && s.phase) return s; } catch (e) { /* 没有或读不了 */ }
  return { phase: "focus", running: false, endsAt: 0, left: POMO_MS().focus, day: ymd(new Date()), count: 0 };
}
function pomoSave(s) { try { localStorage.setItem(POMO_KEY, JSON.stringify(s)); } catch (e) { /* 存不了就只在这次会话里有效 */ } }
const pomoTotal = s => s.phase === "focus" ? POMO_MS().focus : POMO_MS().brk;
const pomoLeft = s => s.running ? Math.max(0, s.endsAt - Date.now()) : s.left;
// 到点：专注结束 → 计数 +1、自动开始休息；休息结束 → 回到专注、停着等你点开始。离开太久错过的只补状态，不补发通知
function pomoStep(s) {
  const today = ymd(new Date());
  let changed = false;
  if (s.day !== today) { s.day = today; s.count = 0; changed = true; }
  while (s.running && Date.now() >= s.endsAt) {
    const late = Date.now() - s.endsAt > 60e3;
    if (s.phase === "focus") {
      s.count++; s.phase = "break"; s.endsAt += POMO_MS().brk;
      if (!late) pomoNotify("专注 25 分钟完成", `今天第 ${s.count} 个。休息 5 分钟，起来走走`);
    } else {
      s.phase = "focus"; s.running = false; s.left = POMO_MS().focus;
      if (!late) pomoNotify("休息结束", "回来点「开始」进入下一个番茄");
    }
    changed = true;
  }
  return changed;
}
function pomoNotify(title, body) {
  try { new Notification(title, { body }); } catch (e) { console.warn("[sb-board] 通知发不出来", e); }
}
const pomoFmt = ms => { const sec = Math.ceil(ms / 1000); return { mm: Math.floor(sec / 60), ss: sec % 60 }; };
const pad2 = n => pad(n);
function pomoPaint(el, s) {
  const left = pomoLeft(s), total = pomoTotal(s), { mm, ss } = pomoFmt(left);
  const set = (k, v, fmt) => { const n = el.querySelector(`[data-pomo="${k}"]`); if (!n) return; const want = fmt ? fmt(v) : String(v); if ((n.firstChild && n.firstChild.textContent) !== want) rollTo(n, v, fmt); };
  set("mm", mm, pad2); set("ss", ss, pad2); set("count", s.count);
  const arc = el.querySelector(".arc"); if (arc) arc.style.strokeDashoffset = String(553 * (1 - (total ? (total - left) / total : 0)));
  el.classList.toggle("running", !!s.running); el.classList.toggle("brk", s.phase === "break");
  const ph = el.querySelector(".ph"); const phT = s.phase === "break" ? "休息" : s.running ? "专注中" : left < total ? "暂停" : "专注"; if (ph && ph.textContent !== phT) ph.textContent = phT;
  const btn = el.querySelector('[data-act="pomo-toggle"]'); const bT = s.running ? "暂停" : left < total ? "继续" : "开始"; if (btn && btn.textContent !== bT) btn.textContent = bT;
}
function pomoTick() {
  const s = pomoLoad();
  if (pomoStep(s)) pomoSave(s);
  document.querySelectorAll(".sb-board:not(.sb-ghost) .pomo").forEach(el => pomoPaint(el, s));
}
function pomoAct(name) {
  const s = pomoLoad(); pomoStep(s);
  if (name === "pomo-toggle") {
    if (s.running) { s.left = Math.max(0, s.endsAt - Date.now()); s.running = false; }
    else { s.endsAt = Date.now() + s.left; s.running = true; }
  } else if (name === "pomo-reset") { s.phase = "focus"; s.running = false; s.left = POMO_MS().focus; }
  pomoSave(s); pomoTick();
}
function startPomo() {
  if (window.__sbPomoTimer) clearInterval(window.__sbPomoTimer); // 代码更新后换成新的；只留一个
  window.__sbPomoTimer = setInterval(pomoTick, 250);
}
function cardPomo() {
  const s = pomoLoad(); pomoStep(s);
  const left = pomoLeft(s), total = pomoTotal(s), { mm, ss } = pomoFmt(left);
  const off = 553 * (1 - (total ? (total - left) / total : 0));
  const phT = s.phase === "break" ? "休息" : s.running ? "专注中" : left < total ? "暂停" : "专注";
  return `<section class="tile dark pomo${s.running ? " running" : ""}${s.phase === "break" ? " brk" : ""}" data-kind="pomo"><span class="handle"></span>
    <div class="h">番茄钟 <span class="lab">25 / 5</span></div>
    <div class="ring"><svg viewBox="0 0 200 200"><circle class="trk" cx="100" cy="100" r="88"/><circle class="arc" cx="100" cy="100" r="88" style="stroke-dashoffset:${off}"/></svg>
      <div class="clock"><span data-pomo="mm">${pad(mm)}</span><i>:</i><span data-pomo="ss">${pad(ss)}</span></div><div class="ph">${phT}</div></div>
    <div class="ctl"><button class="pbtn main" data-act="pomo-toggle">${s.running ? "暂停" : left < total ? "继续" : "开始"}</button><button class="pbtn" data-act="pomo-reset" title="回到 25:00">重置</button></div>
    <div class="pcnt">今天完成 <b data-pomo="count">${s.count}</b> 个</div>
    <span class="tag">07 · pomodoro</span></section>`;
}

// 资讯卡预留位：只画空框架，不接抓取、不联网；以后把 config.json 的 news 改成 true 再接原版资讯卡
function cardNewsPlaceholder() {
  return `<section class="tile news" data-kind="news" data-src=""><span class="handle"></span>
    <div class="h">今天 AI 圈 <span class="lab">预留位 · 以后接入</span></div>
    <div class="news-ph">这张卡先留框架。<br>以后接上资讯来源和模型后，这里显示每日要闻 / YouTube / X / HN。</div>
    <span class="tag">06 · ai news</span></section>`;
}

// 科研情报卡预留位：空框架，config.json 里 research 改 true 后接 fetch-research.mjs
function cardResearchPlaceholder() {
  return `<section class="tile research" data-kind="research" data-src=""><span class="handle"></span>
    <div class="h">科研情报 <span class="lab">预留位 · 以后接入</span></div>
    <div class="news-ph">这张卡先留框架。<br>接上后显示你关注方向的论文、机构动态与阶段性归档草稿。</div>
    <span class="tag">06 · research</span></section>`;
}

const renderAll = D => cardDirsearch(D) + cardToday(D) + cardTracks(D) + cardStack(D) + cardWeek(D) + cardIdeas(D) + (V.news === false ? "" : (V.news === "placeholder" ? cardNewsPlaceholder() : cardNews(D))) + cardAnchors(D) + cardPomo() + (V.research === false ? "" : (V.research === "placeholder" ? cardResearchPlaceholder() : cardResearch(D)));

// ---------- 字体：把 fonts/*.css 里的相对 url 换成 Obsidian 资源路径 ----------
async function ensureFonts() {
  if (document.getElementById("sb-fonts")) return;
  const files = ["doto.css", "spacemono.css"];
  let css = "";
  for (const name of files) {
    try {
      const raw = await app.vault.adapter.read(`${V.fontDir}/${name}`);
      css += raw.replace(/url\(([^)]+)\)/g, (m, u) => `url("${app.vault.adapter.getResourcePath(`${V.fontDir}/${u.replace(/['"]/g, "")}`)}")`) + "\n";
    } catch (e) { console.warn("[sb-board] 字体文件读不到", name, e); }
  }
  const st = document.createElement("style"); st.id = "sb-fonts"; st.textContent = css;
  document.head.appendChild(st);
}

// ---------- 打开原文：在看板右边分一栏，之后一直复用那一栏 ----------
function boardLeaf(root) {
  return app.workspace.getLeavesOfType("markdown").find(l => l.view?.containerEl?.contains(root)) || app.workspace.activeLeaf;
}
function sideLeaf(root) {
  const alive = l => l && app.workspace.getLeafById(l.id);
  if (alive(window.__sbSideLeaf)) return window.__sbSideLeaf;
  const bl = boardLeaf(root);
  const inMain = bl && bl.getRoot && bl.getRoot() === app.workspace.rootSplit;
  const leaf = inMain ? app.workspace.createLeafBySplit(bl, "vertical") : app.workspace.getLeaf(false);
  window.__sbSideLeaf = leaf;
  return leaf;
}
// 新标签页打开（学科目录行用，不走侧栏分栏）
async function openTab(path) {
  const f = tfile(path); if (!isFile(f)) return;
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f, { active: true });
}

// 按双链名（或路径片段）找笔记并在侧栏打开；支持 [[笔记名#标题]] 里的标题锚点
async function openNoteByName(root, name) {
  const raw = String(name || "").trim(); if (!raw) return;
  let anchor = "";
  let target = raw;
  const h = target.match(/^([^#]+)#(.+)$/);
  if (h) { target = h[1].trim(); anchor = h[2].trim(); }
  const wantBase = baseName(target);
  // 先按完整路径，再按文件名兜底
  let f = tfile(target);
  if (!isFile(f)) {
    const all = walkFiles(V.subjectsDir, x => x.extension === "md");
    const hit = all.find(x => x.path === target) || all.find(x => baseName(x.path) === wantBase);
    f = hit || null;
  }
  if (!isFile(f)) { new Notice(`找不到关联笔记：${wantBase}`); return; }
  let line;
  if (anchor) {
    const hd = headings(f.path).find(x => plain(x.heading) === plain(anchor));
    if (hd) line = hd.position.start.line;
  }
  const leaf = sideLeaf(root);
  await leaf.openFile(f, { active: true, eState: line != null ? { line, scroll: line } : undefined });
}

// 已复习：stage +1（封顶 4），last_review 改今天；当场从队列拿掉，再刷索引
async function markReviewed(root, D, btn) {
  const path = btn.dataset.open, f = tfile(path); if (!isFile(f)) return;
  const stage = parseInt(btn.dataset.stage, 10) || 0;
  const nextStage = Math.min(4, stage + 1);
  await app.vault.process(f, data => {
    const lines = data.split("\n");
    let inFm = false, hasStage = false, hasLast = false;
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && /^---\s*$/.test(lines[i])) { inFm = true; continue; }
      if (inFm && /^---\s*$/.test(lines[i])) break;
      if (!inFm) continue;
      if (/^stage:\s*/.test(lines[i])) { lines[i] = `stage: ${nextStage}`; hasStage = true; }
      else if (/^last_review:\s*/.test(lines[i])) { lines[i] = `last_review: ${ymd(TODAY)}`; hasLast = true; }
    }
    if (inFm && (!hasStage || !hasLast)) {
      if (!hasStage) lines.splice(1, 0, `stage: ${nextStage}`);
      if (!hasLast) lines.splice(1, 0, `last_review: ${ymd(TODAY)}`);
    }
    return lines.join("\n");
  });
  root.querySelectorAll(".rv-item").forEach(x => { if (x.dataset.open === path) x.remove(); });
  const list = root.querySelector(".review-list");
  if (list && !list.children.length) list.innerHTML = `<li class="muted">今天没有待复习的速查卡。</li>`;
  const st = root.querySelector(".sb-modal .stats .st b");
  if (st) { const n = parseInt(st.textContent, 10); if (!Number.isNaN(n) && n > 0) st.textContent = n - 1; }
  try { dv.index.touch(); } catch (_) {}
  new Notice("已复习，进下一档");
}

async function openAt(root, path, line) {
  const f = tfile(path);
  if (!f) return;
  if (!isFile(f)) { // 文件夹：找里面的 README 或第一个 md
    const md = f.children.find(c => c.name === "README.md") || f.children.find(c => isFile(c) && c.extension === "md");
    if (!md) return; return openAt(root, md.path, undefined);
  }
  const leaf = sideLeaf(root);
  await leaf.openFile(f, { active: true, eState: line != null && !Number.isNaN(line) ? { line, scroll: line } : undefined });
}

// ---------- 三种写入 ----------
async function toggleTask(path, line, text) {
  const f = tfile(path); if (!isFile(f)) return;
  const want = String(text || "").trim();
  let missed = false;
  await app.vault.process(f, data => {
    const lines = data.split("\n");
    const box = l => (l || "").match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])\]\s*(.*)$/);
    const same = m => !want || m[3].trim() === want;
    // 看板画好之后笔记可能被改过（自己加了一行、agent 插了一行），行号会错位：先核对这一行是不是那条任务，不是就按文字找，找不到唯一的一条就不动
    let i = line, m = box(lines[i]);
    if (!m || !same(m)) {
      const hits = lines.map((l, k) => [k, box(l)]).filter(([, x]) => x && same(x));
      if (hits.length !== 1) { missed = true; return data; }
      [i, m] = hits[0];
    }
    lines[i] = lines[i].slice(0, m[1].length) + (/x/i.test(m[2]) ? " " : "x") + lines[i].slice(m[1].length + 1);
    return lines.join("\n");
  });
  if (missed) { new Notice("这篇笔记刚被改过，没找到这条任务，没有改动。等看板刷新后再点一次"); try { dv.index.touch(); } catch (e) { /* 忽略 */ } }
}
// 三种输入框：idea → To-do 文件末尾；today → 今天 daily 的「今日」；week → 本周 weekly 的「本周要完成」
const JOT_META = {
  idea:  { ph: "记一笔，回车就进收件箱", title: "写进收件箱", done: "记下了" },
  today: { ph: "加一条今天要做的，回车", title: "写进今天的「今日」", done: "加上了" },
  week:  { ph: "这周还要做什么，回车", title: "写进「本周要完成」", done: "加上了" },
};
const jotBox = kind => `<div class="jot" data-jot="${kind}"><input type="text" placeholder="${JOT_META[kind].ph}" spellcheck="false"><button class="add" data-act="jot" title="${JOT_META[kind].title}">+</button></div>`;
async function submitJot(inp) {
  const text = inp.value.trim(); if (!text) return;
  const kind = inp.closest(".jot")?.dataset.jot || "idea";
  if (kind === "idea") {
    const f = tfile(V.todoPath); if (!isFile(f)) return;
    await app.vault.process(f, data => data.replace(/\s+$/, "") + `\n\n${ymd(TODAY)} · ${text}\n`);
  } else {
    optimisticAdd(inp.closest(".sb-board"), kind, [text]);
    await appendUnder(kind, [`- [ ] ${text}`]);
  }
  inp.value = ""; window.__sbJot[kind] = ""; inp.placeholder = JOT_META[kind].done;
  window.__sbJotFocus = { kind, inModal: !!inp.closest(".sb-modal"), at: Date.now() }; // 重画后把焦点放回来
}
async function createFromTemplate(root, path, tplPath, dateStr) {
  if (isFile(tfile(path))) return openAt(root, path, 0);
  const tpl = tfile(tplPath);
  let body = isFile(tpl) ? await app.vault.read(tpl) : "## 今日\n\n- [ ] \n\n## 随手记\n";
  body = body.replace(/{{\s*date[^}]*}}/g, dateStr).replace(/{{\s*title\s*}}/g, dateStr);
  await app.vault.create(path, body);
  await openAt(root, path, 2);
}

// ---------- 右上两个按钮：⤢ 打开来源，⋯ 小菜单 ----------
async function revealInExplorer(f) {
  const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
  if (!leaf) return;
  await app.workspace.revealLeaf(leaf); // 侧栏收着就展开，并切到文件列表
  if (typeof leaf.view.revealInFolder === "function") leaf.view.revealInFolder(f);
}
async function openSource(root, tile) {
  const { kind, src, srcLine } = tile.dataset;
  if (!src) return;
  const f = tfile(src);
  if (!f) { // 文件还没建：今天 / 本周按模板建
    if (kind === "today") return createFromTemplate(root, src, V.dailyTemplate, ymd(TODAY));
    if (kind === "week") return createFromTemplate(root, src, V.weeklyTemplate, ymd(MON));
    return;
  }
  if (!isFile(f)) return revealInExplorer(f); // 文件夹（小红书）：在文件列表里展开
  return openAt(root, src, srcLine != null && srcLine !== "" ? +srcLine : undefined);
}
function closeMenu() {
  document.querySelectorAll(".sb-menu").forEach(m => m.remove());
  document.removeEventListener("pointerdown", menuDocDown, true);
  document.removeEventListener("keydown", menuEsc, true);
}
function menuDocDown(e) {
  if (e.target.closest(".sb-menu")) return;
  // 点的是"同一张卡"的 ⋯ 才记时间（让它表现成开关）；点别的卡的 ⋯ 要能直接换过去
  const more = e.target.closest("[data-act=more]"), open = document.querySelector(".sb-menu");
  if (more && open && more.closest(".tile") === open.closest(".tile")) window.__sbMenuClosedAt = Date.now();
  closeMenu();
}
function menuEsc(e) { if (e.key === "Escape") closeMenu(); }
function showMenu(root, tile) {
  if (Date.now() - (window.__sbMenuClosedAt || 0) < 300) return; // 刚被同一次点击关掉，别马上又弹开
  closeMenu();
  const { kind, src } = tile.dataset;
  const f = src ? tfile(src) : null;
  const items = [];
  if (f && !isFile(f)) items.push(["在文件列表里显示这个文件夹", () => revealInExplorer(f)]);
  else if (f) { items.push(["打开来源笔记", () => openSource(root, tile)]); items.push(["在文件列表里显示", () => revealInExplorer(f)]); }
  else if (kind === "today" || kind === "week") items.push([kind === "today" ? "按模板新建今天" : "按模板新建本周", () => openSource(root, tile)]);
  if (kind === "news") {
    items.push(["现在就更新资讯（约 1 分钟）", () => runNews(root)]);
    items.push(["打开数据文件夹", () => { try { window.require("electron").shell.openPath(NEWS_DIR()); } catch (e) { console.warn(e); } }]);
  }
  if (kind === "research") {
    items.push(["现在就更新科研情报（约 1 分钟）", () => runResearch(root)]);
    items.push(["打开数据文件夹", () => { try { window.require("electron").shell.openPath(RESEARCH_DIR()); } catch (e) { console.warn(e); } }]);
  }
  items.push(["刷新看板", () => { try { dv.index.touch(); } catch (e) { console.warn("[sb-board] 刷新失败", e); } }]);
  const m = document.createElement("div"); m.className = "sb-menu";
  m.innerHTML = items.map((it, i) => `<button class="mi" data-i="${i}">${esc(it[0])}</button>`).join("") + (src ? `<div class="mf">${esc(src)}</div>` : "");
  m.addEventListener("click", e => { e.stopPropagation(); const b = e.target.closest(".mi"); if (!b) return; closeMenu(); items[+b.dataset.i][1](); });
  tile.appendChild(m);
  document.addEventListener("pointerdown", menuDocDown, true);
  document.addEventListener("keydown", menuEsc, true);
}

// ---------- 展开层：⤢ 把一张卡放大成盖住整个看板的大窗（照 Kimi 的做法：遮罩压暗、约 140ms 淡入、关闭即时） ----------
const DETAIL_META = {
  review: { tag: "00 · review", name: "待复习", skin: "" },
  today: { tag: "01 · today", name: "今天", skin: "" },
  tracks: { tag: "02 · tracks", name: "长期轨道", skin: "dots" },
  route: { tag: "03 · ai route", name: "AI 学习路线", skin: "dark" },
  stack: { tag: "03 · toolkit", name: "技术栈", skin: "dark" },
  week:  { tag: "04 · this week", name: "本周", skin: "mint" },
  ideas: { tag: "05 · inbox", name: "灵感收件箱", skin: "" },
  news:  { tag: "06 · ai news", name: "今天 AI 圈", skin: "" },
  research: { tag: "06 · research", name: "科研情报", skin: "" },
  anchors: { tag: "08 · goals", name: "目标锚点", skin: "" },
};
const stat = (n, label) => `<div class="st"><b>${n}</b><span>${esc(label)}</span></div>`;
const secH = t => `<div class="sec-h">${esc(t)}</div>`;

function detailReview(D) {
  const q = D.review.queue;
  if (!q.length) return `<div class="muted">今天没有待复习的速查卡，间隔到了会自动出现在这里。</div>`;
  const items = q.map(c => `
    <li class="rv-item" data-open="${esc(c.path)}">
      <div class="rv-main"><b>${esc(c.topic)}</b><span class="rv-subj">${esc(c.subject)}</span></div>
      <div class="rv-meta">${c.overdueDays > 0 ? `过期 ${c.overdueDays} 天` : "今天到期"} · 上次 ${esc(c.lastReview || "—")} · 第 ${c.stage + 1} 档</div>
      <button class="btn rv-done" data-act="reviewed" data-open="${esc(c.path)}" data-stage="${c.stage}">已复习</button>
    </li>`).join("");
  return `<div class="stats">${stat(q.length, "待复习")}</div><ul class="review-list">${items}</ul>`;
}

function detailToday(D) {
  const t = D.today;
  const notes = (t.notes || []).length
    ? `<ul class="notes">${t.notes.map(n => `<li data-open="${esc(t.path)}">${esc(n)}</li>`).join("")}</ul>`
    : `<div class="muted">「随手记」下还没有内容</div>`;
  const { rest: restItems } = todayRows(t, D.rhythm);
  const total = restItems.length;
  const done = restItems.filter(x => x.done).length;
  const left = total - done;
  const lis = sortTasks(restItems).map(x => taskLiHTML(x, t.path, 200, "plain")).join("");
  const tasks = `<ul class="list today-full">${lis}</ul>`;
  return `
    <div class="stats">${stat(left, "还剩")}${stat(done, "做完")}${stat(total, "共")}${stat(t.date.slice(5).replace("-", "."), t.weekday)}</div>
    <div class="cols"><div>${secH("今日")}${tasks}${carryLine(D.carry.today, "carry-today")}${jotBox("today")}</div><div>${secH("随手记")}${notes}</div></div>
    <div class="days-wrap">${secH("这一周")}${dayDots(D.days)}</div>`;
}

function detailWeek(D) {
  const w = D.week, days = D.days;
  const defined = days.filter(d => d.total).length;
  const b = D.route.block, done = b ? b.done : 0, total = b ? b.total : 0;
  return `
    <div class="stats">${stat(`${done}<small>/ ${total}</small>`, "本周 · 做完")}${stat(w.daysLeft, "还有几天")}${stat(`${defined}<small>/ 7</small>`, "定了任务的天数")}${stat(esc(w.range), "日期")}</div>
    <div class="cols cols-one"><div>${planBlockHTML(D, "week-full plan-list", 200, false)}</div></div>`;
}

function detailRoute(D) {
  const r = D.route, pct = r.total ? Math.round(r.done / r.total * 100) : 0, c = r.stations[r.cur];
  const stations = r.stations.map((s, i) => {
    const p = s.total ? Math.round(s.done / s.total * 100) : 0;
    const state = i === r.cur ? "on" : i < r.cur ? "past" : "todo";
    return `<div class="stn ${state}">
      <div class="sth" data-open="${esc(r.path)}" data-line="${s.line}"><b>${esc(s.label)}</b><span>${esc(s.title)}</span><span class="cnt">${s.done}/${s.total}</span></div>
      <div class="bar"><i style="width:${p}%"></i></div>
      ${s.items.length ? renderList(s.items, "stn-list", r.path, 200) : `<div class="muted">这一周下面没有任务行</div>`}
    </div>`;
  }).join("");
  return `
    <div class="stats">${stat(`${r.done}<small>/ ${r.total}</small>`, "total")}${stat(c ? esc(c.label) : "—", "now at")}${stat(`${pct}%`, "进度")}${stat(r.stations.length, "stops")}</div>
    ${stations || `<div class="muted">没在计划里找到「第 N 周 · 标题」的二级标题</div>`}`;
}

function detailStack(D) {
  const s = D.stack, pct = s.total ? Math.round(s.done / s.total * 100) : 0;
  const layers = s.layers.length
    ? `<div class="cols"><div>${secH("四层框架")}<div class="stk-layers">${s.layers.map(l =>
        `<div class="stk-layer"><b>${esc(l.k)}</b><span>${esc(l.what)}</span><em>${esc(l.items)}</em></div>`).join("")}</div></div></div>`
    : "";
  const stages = s.stages.map((st, i) => {
    const p = st.total ? Math.round(st.done / st.total * 100) : 0;
    const state = i === s.cur ? "on" : i < s.cur ? "past" : "todo";
    return `<div class="stn ${state}">
      <div class="sth" data-open="${esc(s.path)}" data-line="${st.line}"><b>${esc(st.heading)}</b><span class="cnt">${st.done}/${st.total}</span></div>
      <div class="bar"><i style="width:${p}%"></i></div>
      ${st.items.length ? renderList(st.items, "stn-list", s.path, 200) : `<div class="muted">这一阶段下面没有任务行</div>`}
    </div>`;
  }).join("");
  const miles = s.milestones.length
    ? `<div class="cols"><div>${secH("里程碑")}<ul class="stk-ms-list">${s.milestones.map(m =>
        `<li><b>${esc(m.id)}</b><span class="stk-date">${esc(m.date)}</span><span>${esc(m.text)}</span></li>`).join("")}</ul></div></div>`
    : "";
  const notes = (arr, h) => arr.length ? secH(h) + `<ul class="stk-notes">${arr.map(p =>
    `<li>${p.k ? `<b>${esc(p.k)}</b>：` : ""}${esc(p.text)}</li>`).join("")}</ul>` : "";
  return `
    <div class="stats">${stat(`${s.done}<small>/ ${s.total}</small>`, "任务")}${stat(s.curStage ? esc(s.curStage.title) : "—", "当前阶段")}${stat(`${pct}%`, "进度")}${stat(s.milestones.length, "里程碑")}</div>
    ${layers}
    ${secH("阶段任务")}${stages || `<div class="muted">规划文档里还没排阶段任务</div>`}
    ${miles}
    ${notes(s.position, "当前位置")}${notes(s.rules, "时间约束与硬规则")}`;
}

// 轨道若额外带了「四阶段表 / 周任务 / 错题本」，在里程碑下面接着展开（普通轨道这几项是空的，不受影响）
function trackExtra(tr) {
  const out = [];
  if (tr.plan && tr.plan.length) {
    out.push(secH("四阶段"));
    out.push(`<div class="stages">${tr.plan.map(s =>
      `<div class="srow"><span class="sk">${esc(s.stage)}</span><span class="sv">${esc(s.date)}</span><span class="sh">${esc(s.hours)}</span></div>` +
      (s.content ? `<div class="sc">${esc(s.content)}</div>` : "")).join("")}</div>`);
  }
  if (tr.weeks) {
    const w = tr.weeks.cur;
    out.push(secH(w ? `本周 · 第 ${w.n} 周${w.stage ? " · " + w.stage : ""}` : "本周"));
    out.push(w && w.items.length
      ? `<ul class="wlist">${w.items.map(i => `<li class="${i.done ? "done" : ""}"><span class="wbox"></span><span class="wtxt">${esc(i.text)}</span></li>`).join("")}</ul>`
      : `<div class="muted link" data-open="${esc(tr.weeks.path)}">共 ${tr.weeks.weeks} 周的排期在笔记里；今天这一周没有对应任务</div>`);
  }
  if (tr.wb && tr.wb.rows.length) {
    out.push(secH(`错题本 · ${tr.wb.rows.length} 条`));
    const head = tr.wb.head || ["题型", "错因", "正确切入点"];
    out.push(`<div class="wbl">${tr.wb.rows.slice(0, 12).map(r =>
      `<div class="wb"><div class="wb-q">${esc(r[0] || "")}</div><div class="wb-e"><span class="wb-k">${esc(head[1] || "错因")}</span>${esc(r[1] || "")}</div><div class="wb-a"><span class="wb-k">${esc(head[2] || "切入点")}</span>${esc(r[2] || "")}</div></div>`).join("")}</div>`);
  }
  return out.join("");
}

function detailTracks(D) {
  const t = D.tracks;
  const blocks = t.tracks.map(tr => {
    const cd = checkpointCountdown(tr.nextCheckpoint);
    const pct = tr.total ? Math.round(tr.done / tr.total * 100) : 0;
    const items = tr.items.length ? renderList(tr.items, "stn-list", tr.readme, 200) : `<div class="muted">这个轨道还没写里程碑</div>`;
    return `<div class="pc" data-open="${esc(tr.readme || tr.path)}">
      <div class="sth"><b>${esc(tr.name)}</b><span>${esc(tr.stage || "")}</span><span class="cnt">${tr.done}/${tr.total}</span></div>
      <div class="tr-cp"><span class="cp-name">${esc(tr.checkpoint || "下一节点待定")}</span><span class="cd ${cd.state}">${cd.label}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${items}
      ${trackExtra(tr)}
    </div>`;
  }).join("");
  return `
    <div class="stats">${stat(t.total, "长期轨道")}</div>
    <div class="pgrid-wrap">${secH("全部轨道 · 里程碑")}<div class="pgrid">${blocks || `<div class="muted">还没有轨道</div>`}</div></div>`;
}

function detailAnchors(D) {
  const a = D.anchors;
  const blocks = a.anchors.map(x => {
    const cd = checkpointCountdown(x.window);
    const mpct = x.total ? Math.round(x.done / x.total * 100) : 0;
    const tf = Math.round(timeFrac(x.start, x.window) * 100);
    const metaRows = Object.entries(x.meta).map(([k, v]) => `<div class="arow"><span class="ak">${esc(k)}</span><span class="av">${esc(v)}</span></div>`).join("");
    const items = x.items.length ? renderList(x.items, "stn-list", a.path, 200) : `<div class="muted">还没写里程碑</div>`;
    return `<div class="pc" data-open="${esc(a.path)}" data-line="${x.line}">
      <div class="sth"><b>${esc(x.title)}</b><span class="cnt">${x.done}/${x.total}</span></div>
      <div class="arows">${metaRows}<div class="arow"><span class="ak">目标窗口</span><span class="av">${esc(x.window || "待定")} · <span class="cd ${cd.state}">${cd.label}</span></span></div></div>
      <div class="bar-label">里程碑进度 ${mpct}%</div><div class="bar"><i style="width:${mpct}%"></i></div>
      <div class="bar-label">时间轴 ${tf}%</div><div class="bar time"><i style="width:${tf}%"></i></div>
      ${items}
    </div>`;
  }).join("");
  return `
    <div class="stats">${stat(a.anchors.length, "锚点")}${stat(`${a.done}<small>/ ${a.total}</small>`, "里程碑")}</div>
    ${blocks || `<div class="muted">锚点笔记还没建</div>`}`;
}

function detailIdeas(D) {
  const td = D.todo, all = td.all || [];
  const items = all.length
    ? `<ul class="ideas-full">${all.map(i => `<li data-open="${esc(td.path)}" data-line="${i.line}"><span class="when">${i.date || "·"}</span><span class="txt">${esc(i.text)}</span></li>`).join("")}</ul>`
    : `<div class="muted">还没有内容，先在下面记一笔</div>`;
  const latest = all.find(i => i.date);
  return `
    <div class="stats">${stat(td.total, "段")}${stat(latest ? latest.date : "—", "最近一条带日期的")}</div>
    ${items}
    ${jotBox("idea")}`;
}

function detailHTML(kind, D, src) {
  const m = DETAIL_META[kind]; if (!m) return "";
  const body = { review: detailReview, today: detailToday, week: detailWeek, route: detailRoute, stack: detailStack, tracks: detailTracks, ideas: detailIdeas, news: detailNews, research: detailResearch, anchors: detailAnchors }[kind](D);
  return `<div class="sb-backdrop" data-act="close-detail"></div>
    <section class="tile sb-sheet ${m.skin}" data-kind="${kind}" data-src="${esc(src.src || "")}" data-src-line="${esc(src.srcLine || "")}">
      <header class="sh"><span class="lab">${esc(m.tag)}</span><b>${esc(m.name)}</b><span class="sp"></span><button class="tb" data-act="more" title="更多">⋯</button><button class="tb" data-act="close-detail" title="关闭 (Esc)">✕</button></header>
      <div class="sbody">${body}</div>
    </section>`;
}

function closeDetail(root) {
  root.querySelectorAll(".sb-modal").forEach(m => m.remove());
  window.__sbDetail = null;
  const sc = root.closest(".markdown-preview-view"); if (sc) sc.classList.remove("sb-lock");
}
// 看板比一屏高（第三行资讯卡 + 番茄钟），大窗要盖住「现在看得见的这一屏」，并且开着时外面不滚
function placeModal(root) {
  const m = root.querySelector(".sb-modal"), sc = root.closest(".markdown-preview-view");
  if (!m || !sc) return;
  const top = Math.max(0, sc.getBoundingClientRect().top - root.getBoundingClientRect().top);
  m.style.top = top + "px"; m.style.bottom = "auto"; m.style.height = sc.clientHeight + "px";
  sc.classList.add("sb-lock");
}
// restore=true 是看板重画后把刚才开着的大窗原样放回来（不做淡入，滚动位置也回到原处）
function openDetail(root, kind, D, src, restore) {
  closeMenu();
  root.querySelectorAll(".sb-modal").forEach(m => m.remove());
  const m = document.createElement("div");
  m.className = "sb-modal" + (restore ? " in restore" : "");
  m.dataset.kind = kind; m.tabIndex = -1;
  m.innerHTML = detailHTML(kind, D, src || {});
  root.appendChild(m);
  placeModal(root);
  const body = m.querySelector(".sbody");
  if (restore && window.__sbDetail && window.__sbDetail.scroll) body.scrollTop = window.__sbDetail.scroll;
  window.__sbDetail = { kind, src: src || {}, scroll: body.scrollTop };
  bindModal(root, m);
  if (!restore) { void m.offsetWidth; m.classList.add("in"); } // 强制一次排版再加 in，淡入从初始态起步；不用 rAF，窗口没焦点时 rAF 可能不跑
  m.focus({ preventScroll: true });
  loadThumbs();
  refocusJot(m); // 放在 m.focus 之后，不然刚在大窗输入框回车、重画后焦点会被大窗本身抢走
}
function bindModal(root, m) {
  m.querySelectorAll(".jot input").forEach(bindJot);
  if (m.__sbBound) return; m.__sbBound = true;
  const body = m.querySelector(".sbody");
  body.addEventListener("scroll", () => { if (window.__sbDetail) window.__sbDetail.scroll = body.scrollTop; });
  m.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); closeDetail(root); } });
}

function bindJot(inp) {
  if (inp.__sbBound) return; inp.__sbBound = true; // 原位修补会留下原来的输入框，别重复绑、别把正在输的内容冲掉
  const kind = inp.closest(".jot")?.dataset.jot || "idea";
  window.__sbJot = window.__sbJot && typeof window.__sbJot === "object" ? window.__sbJot : {};
  inp.value = window.__sbJot[kind] || "";
  inp.addEventListener("input", () => { window.__sbJot[kind] = inp.value; const r = inp.closest(".sb-board"); if (r) r.__sbFocus = inp; }); // 正在打字的框也记成焦点所在（窗口没系统焦点时 focusin 不会发）
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submitJot(inp); } });
}

// ---------- 接过来：把最近一天 / 上周没做完的任务复制进今天 / 本周（原文件不动，条目不加标记） ----------
// kind = today：往前找最近一个「今日」下有任务的 daily；kind = week：上周一的 weekly
function collectCarry(kind, cur) {
  const have = new Set((cur.items || []).map(t => plain(t.text)));
  if (kind === "today") {
    for (let i = 1; i <= 30; i++) {
      const d = addDays(TODAY, -i), path = `${V.dailyDir}/${ymd(d)}.md`;
      if (!isFile(tfile(path))) continue;
      const day = collectDay(path);
      if (!day.total) continue;
      const seen = new Set(); // 同一条任务在那天的笔记里写了好几遍，只算一条
      const items = day.items.filter(t => { const k = plain(t.text); if (t.done || have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
      return { from: path, date: ymd(d), label: i === 1 ? "昨天" : `${d.getMonth() + 1}.${d.getDate()} `, items, to: cur.path };
    }
    return null;
  }
  const prevMon = addDays(MON, -7), path = `${V.weeklyDir}/${ymd(prevMon)}.md`;
  if (!isFile(tfile(path))) return null;
  const r = sectionRange(path, h => /^本周要完成/.test(h.heading));
  const items = under(tasksOf(path), r).filter(t => !t.done && !have.has(plain(t.text)));
  return { from: path, date: ymd(prevMon), label: "上周", items, to: cur.path };
}

const carryLine = (c, act) => (!c || !c.items.length) ? ""
  : `<div class="carry">${esc(c.label)}还有 ${c.items.length} 条没做完<button class="lnk" data-act="${act}" title="复制到${act === "carry-today" ? "今天" : "本周"}的清单里，原文件不动">接过来</button></div>`;

// 把若干行插到某个标题管辖的段落末尾；模板留的空 `- [ ] ` 直接被第一条顶掉；没有这个标题就在文末补一个
function insertUnder(text, headRe, heading, lines) {
  const L = text.split("\n");
  const h = L.findIndex(l => headRe.test(l));
  if (h < 0) return text.replace(/\s*$/, "") + `\n\n## ${heading}\n\n${lines.join("\n")}\n`;
  const level = (L[h].match(/^#+/) || ["##"])[0].length;
  let end = L.length;
  for (let i = h + 1; i < L.length; i++) { const m = L[i].match(/^(#+)\s/); if (m && m[1].length <= level) { end = i; break; } }
  let last = -1;
  for (let i = h + 1; i < end; i++) if (L[i].trim() !== "") last = i;
  if (last >= 0 && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s*$/.test(L[last])) L.splice(last, 1, ...lines);
  else if (last >= 0) L.splice(last + 1, 0, ...lines);
  else L.splice(h + 1, 0, "", ...lines);
  return L.join("\n");
}

// 把几行任务写进今天 daily 的「今日」/ 本周 weekly 的「本周要完成」；文件不存在就按模板建好再插
async function appendUnder(kind, lines) {
  const heading = kind === "today" ? "今日" : "本周要完成";
  const headRe = new RegExp(`^#{1,6}\\s*${heading}`);
  const path = kind === "today" ? `${V.dailyDir}/${ymd(TODAY)}.md` : `${V.weeklyDir}/${ymd(MON)}.md`;
  const f = tfile(path);
  if (isFile(f)) {
    await app.vault.process(f, text => insertUnder(text, headRe, heading, lines));
  } else {
    const tplPath = kind === "today" ? V.dailyTemplate : V.weeklyTemplate, dateStr = kind === "today" ? ymd(TODAY) : ymd(MON);
    const tpl = tfile(tplPath);
    let body = isFile(tpl) ? await app.vault.read(tpl) : (kind === "today" ? "## 今日\n\n- [ ] \n\n## 随手记\n" : "## 本周要完成\n\n- [ ] \n");
    body = body.replace(/{{\s*date[^}]*}}/g, dateStr).replace(/{{\s*title\s*}}/g, dateStr);
    await app.vault.create(path, insertUnder(body, headRe, heading, lines));
  }
}
async function carryTasks(root, kind, D) {
  const c = D.carry && D.carry[kind]; if (!c || !c.items.length) return;
  const lines = c.items.map(t => `- [ ] ${String(t.text).trim()}`);
  const target = kind === "today" ? `${V.dailyDir}/${ymd(TODAY)}.md` : `${V.weeklyDir}/${ymd(MON)}.md`; // 和 appendUnder 写的是同一篇
  if (c.from === target) { new Notice("看板还停在旧的一天，没有接过来。关掉看板再打开后再点一次"); try { dv.index.touch(); } catch (e) { /* 忽略 */ } return; }
  optimisticAdd(root, kind, c.items.map(t => String(t.text)));
  await appendUnder(kind, lines);
  root.querySelectorAll(`.carry .lnk[data-act="carry-${kind}"]`).forEach(b => { b.closest(".carry").textContent = `接过来了 ${lines.length} 条`; });
}

// ---------- 当场改屏幕：点勾 / 回车那一刻就把卡上的清单和数字改掉，2.5 秒后 Dataview 的重画只是悄悄对账 ----------
const numOf = el => parseInt((el && el.firstChild && el.firstChild.textContent) || (el && el.textContent) || "", 10);
const REDUCED = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
// 数字滚动：旧值翻出去、新值升进来，0.32s；减少时方向反过来。只在值真的变了时动。fmt 用来显示成 05 这种格式（番茄钟）
function rollTo(el, to, fmt) {
  const show = v => (fmt ? fmt(v) : String(v));
  const from = numOf(el);
  el.querySelectorAll(".num-old").forEach(o => o.remove());
  if (Number.isNaN(from) || from === to || REDUCED() || document.hidden) { el.textContent = show(to); return; }
  const dn = to < from;
  el.textContent = show(to);
  const old = document.createElement("span"); old.className = "num-old" + (dn ? " dn" : ""); old.textContent = show(from);
  el.appendChild(old);
  el.classList.remove("num-in-up", "num-in-dn"); void el.offsetWidth;
  el.classList.add(dn ? "num-in-dn" : "num-in-up");
  const clean = () => { old.remove(); el.classList.remove("num-in-up", "num-in-dn"); };
  old.addEventListener("animationend", clean, { once: true });
  setTimeout(clean, 700);
}
const readToday = root => { const lis = [...root.querySelectorAll(".today .today-list li")]; return { total: lis.length, done: lis.filter(l => l.classList.contains("done")).length }; };
const weekTotal = root => parseInt(((root.querySelector(".week .top .n small") || {}).textContent || "").replace(/[^\d]/g, ""), 10);
function setTodayBig(root, left, total) {
  if (!(total > 0)) return;
  const big = root.querySelector(".today .big"), hint = root.querySelector(".today .hint");
  const cur = big && big.querySelector('[data-num="today-left"]');
  if (cur && left > 0) { rollTo(cur, left); const sm = big.querySelector("small"); if (sm) sm.textContent = `共 ${total} 条`; }
  else if (big) big.innerHTML = left > 0 ? `还剩<b data-num="today-left">${left}</b>件<small>共 ${total} 条</small>` : `今天<b>清</b>了<small>${total} 条全做完</small>`;
  if (hint) hint.textContent = left > 0 ? `已完成 ${total - left} 条，先啃第一条` : "去定明天的三条";
}
function setWeekTop(root, done, total) {
  const n = root.querySelector(".week .top .n"), cur = n && n.querySelector('[data-num="week-done"]');
  if (cur) { rollTo(cur, done); const sm = n.querySelector("small"); if (sm) sm.textContent = `/ ${total} 做完`; }
  else if (n) n.innerHTML = `<span data-num="week-done">${done}</span><small>/ ${total} 做完</small>`;
  const l = root.querySelector(".week .top .left"); if (l) l.innerHTML = l.innerHTML.replace(/\d+ 条没动/, `${Math.max(0, total - done)} 条没动`);
}
function bumpRoute(root, d) { const el = root.querySelector('[data-num="route-done"]'); const n = numOf(el); if (el && !Number.isNaN(n)) rollTo(el, n + d); }
// 大窗开着时，顶上的统计块也跟着改
function setModalStats(root) {
  const m = root.querySelector(".sb-modal"); if (!m) return;
  const sts = m.querySelectorAll(".stats .st b");
  if (m.dataset.kind === "today" && sts.length >= 3) { const c = readToday(root); sts[0].textContent = c.total - c.done; sts[1].textContent = c.done; sts[2].textContent = c.total; }
  if (m.dataset.kind === "week" && sts[0]) { const n = numOf(root.querySelector('[data-num="week-done"]')), tot = weekTotal(root); if (!Number.isNaN(n) && !Number.isNaN(tot)) sts[0].innerHTML = `${n}<small>/ ${tot}</small>`; }
}
// 点了勾：同一条在卡上和大窗里的另一份也一起变，然后按它属于哪个文件改对应的数字
function afterTick(root, D, li) {
  const path = li.dataset.open, line = li.dataset.line, done = li.classList.contains("done"), d = done ? 1 : -1;
  root.querySelectorAll("li[data-open][data-line]").forEach(o => {
    if (o.dataset.open !== path || o.dataset.line !== line) return;
    if (o !== li) { o.classList.toggle("done", done); o.classList.toggle("todo", !done); }
    const b = o.querySelector("[data-toggle]"); if (b) b.title = done ? "改回未完成" : "标记完成"; // 提示文字也当场改成对账后的那句，不然 2.5 秒后会被换掉
  });
  // 这条是不是本周卡里学习计划块的一条，要在下面把它从卡上拿掉之前判断，不然卡上没了就查不到、本周数字不会当场动
  const inPlanBlock = path === D.route.path && [...root.querySelectorAll(".plan-list li")].some(o => o.dataset.line === line);
  // 本周「我加的」清单是没做完在上、做完在下（各自按文件顺序），勾了就当场挪到对账后的位置；卡上的学习计划块只列没勾的，勾了就当场拿掉
  root.querySelectorAll("li[data-open][data-line]").forEach(o => {
    if (o.dataset.open !== path || o.dataset.line !== line) return;
    const ul = o.parentElement;
    if (ul.matches(".week-list:not(.plan-list), .week-full:not(.plan-list)")) placeByStatus(ul, o);
    else if (ul.matches(".week .plan-list") && done) o.remove();
  });
  // 大窗里把学习计划的一条改回未完成：卡上的块按行号把它插回去
  if (!done && path === D.route.path && li.closest(".sb-modal .plan-list")) {
    const cardUl = root.querySelector(".week .plan-list");
    if (cardUl && ![...cardUl.children].some(x => x.dataset.line === line)) {
      const c = li.cloneNode(true); c.querySelector(".txt").textContent = cut(plain(li.querySelector(".txt").textContent), 38);
      cardUl.insertBefore(c, [...cardUl.children].find(x => +x.dataset.line > +line) || null);
    }
  }
  if (path === D.today.path) { const c = readToday(root); setTodayBig(root, c.total - c.done, c.total); }
  if (path === D.week.path || inPlanBlock) { const n = numOf(root.querySelector('[data-num="week-done"]')), tot = weekTotal(root); if (!Number.isNaN(n) && !Number.isNaN(tot)) setWeekTop(root, n + d, tot); }
  if (path === D.route.path) bumpRoute(root, d);
  setModalStats(root);
}
// 把一条放到"没做完在上、做完在下、组内按文件行号"的位置上
function placeByStatus(ul, li) {
  const done = li.classList.contains("done"), line = +li.dataset.line;
  const others = [...ul.children].filter(x => x !== li && x.tagName === "LI");
  const group = others.filter(x => x.classList.contains("done") === done);
  const next = group.find(x => x.classList.contains("pending") ? false : +x.dataset.line > line);
  if (next) ul.insertBefore(li, next);
  else if (done) ul.appendChild(li);
  else { const firstDone = others.find(x => x.classList.contains("done")); ul.insertBefore(li, firstDone || null); }
}
// 加了几条（回车 / 接过来）：先画到清单末尾，标成 pending（还没有行号，等对账后才能勾），数字跟着加
// 本周「我加的」清单是没做完在上、做完在下，新条目要插在第一条已勾的前面，和 2.5 秒后重画出来的位置一样，不然会往上跳一下
function insertAboveDone(ul, html) {
  const firstDone = ul.querySelector("li.done");
  if (firstDone) firstDone.insertAdjacentHTML("beforebegin", html); else ul.insertAdjacentHTML("beforeend", html);
}
function optimisticAdd(root, kind, texts) {
  if (!root || !texts.length) return;
  const lis = texts.map(t => `<li class="todo pending" title="刚加的，看板对账后才能勾"><span class="box static"></span><span class="txt">${esc(cut(plain(t), kind === "today" ? 48 : 44))}</span></li>`).join("");
  if (kind === "today") {
    const right = root.querySelector(".today .right"); if (!right) return;
    let ul = right.querySelector(".today-list");
    if (!ul) { ul = document.createElement("ul"); ul.className = "list today-list"; right.insertBefore(ul, right.querySelector(".carry, .jot")); }
    ul.insertAdjacentHTML("beforeend", lis);
    const full = root.querySelector(".sb-modal .today-full"); if (full) full.insertAdjacentHTML("beforeend", lis);
    const c = readToday(root); setTodayBig(root, c.total - c.done, c.total);
  } else {
    const sec = root.querySelector(".week .sections");
    if (sec) {
      let ul = sec.querySelector(".week-list:not(.plan-list)");
      if (!ul) { ul = document.createElement("ul"); ul.className = "list week-list"; const empty = sec.querySelector(".empty"); if (empty) empty.replaceWith(ul); else sec.insertBefore(ul, sec.querySelector(".carry")); }
      insertAboveDone(ul, lis);
    }
    const full = root.querySelector(".sb-modal .week-full:not(.plan-list)"); if (full) insertAboveDone(full, lis);
    const n = numOf(root.querySelector('[data-num="week-done"]')), tot = weekTotal(root);
    if (!Number.isNaN(n) && !Number.isNaN(tot)) setWeekTop(root, n, tot + texts.length);
  }
  setModalStats(root);
}

// ---------- B. 顶住重画的空白：Dataview 重画前会把旧看板整个拆掉、几十毫秒后新的才画好。这里盯着容器，旧看板一被拆就立刻放回去当占位，新看板画好后一步换掉 ----------
function armGhost(root) {
  const cont = root.parentElement; if (!cont) return;
  if (root.__sbGhostMO) root.__sbGhostMO.disconnect();
  let readds = 0;
  const mo = new MutationObserver(ms => {
    for (const m of ms) for (const n of m.removedNodes) {
      if (n !== root) continue;
      if (window.__sbGhostOff || !cont.isConnected || cont.querySelector(".sb-board") || readds >= 3) { mo.disconnect(); return; }
      readds++; root.classList.add("sb-ghost"); cont.appendChild(root);
      // 被拆下来的那一下，正在输入框里的光标会丢；放回去后立刻还给同一个元素
      const f = root.__sbFocus; if (f && root.contains(f) && document.activeElement !== f) { try { f.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
      return;
    }
  });
  mo.observe(cont, { childList: true });
  root.__sbGhostMO = mo;
}
const findGhost = () => [...dv.container.children].find(x => x.classList && x.classList.contains("sb-board") && x.classList.contains("sb-ghost"));
function swapInRoot(root) {
  const ghost = findGhost();
  if (ghost && ghost.__sbGhostMO) ghost.__sbGhostMO.disconnect();
  if (ghost) ghost.replaceWith(root); else dv.container.appendChild(root);
}

// 整块换新（非幽灵修补）路径下 DOM 被替换，外层阅读视图和卡内清单的滚动位置会归零。这里先记下来，新板挂好后还上。
const SCROLL_BOX_SEL = ".today .right .list, .sections, .tracks-list, .anc-list, .ds-subjects, .ds-results, .nl, .ideas-list, .week-list";
function captureScroll(oldRoot) {
  const st = { outer: [], inner: [] };
  if (!oldRoot) return st;
  if (!oldRoot.isConnected) return st;
  let el = oldRoot.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) st.outer.push(el.scrollTop);
    el = el.parentElement;
  }
  oldRoot.querySelectorAll(SCROLL_BOX_SEL).forEach(b => { if (b.scrollTop > 0) st.inner.push(b.scrollTop); });
  return st;
}
function restoreScroll(root, st) {
  if (!st) return;
  if (!st.outer.length && !st.inner.length) return;
  const apply = () => {
    let i = 0; let el = root.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && i < st.outer.length) el.scrollTop = st.outer[i++];
      el = el.parentElement;
    }
    const boxes = root.querySelectorAll(SCROLL_BOX_SEL);
    st.inner.forEach((t, k) => { if (boxes[k]) boxes[k].scrollTop = t; });
  };
  requestAnimationFrame(apply); setTimeout(apply, 120);
}

// ---------- C. 原位修补：新画好的看板不整块换上去，而是和屏幕上这块逐节点比对，只改有差异的地方 ----------
// 没变的节点原样留着：鼠标正停着的那条不会被换掉（原生提示气泡不会闪一下）、清单滚进去的位置、输入框的光标都保得住。
// 匹配规则：任务行按「文件#行号」认，卡 / 大窗 / 输入框按 data-kind / data-jot 认，其余按同一标签名就近认；对不上的插新删旧。
const keyOf = n => n.nodeType !== 1 ? "" : n.tagName + "|" + (n.dataset.line != null && n.dataset.open ? n.dataset.open + "#" + n.dataset.line : n.dataset.kind || n.dataset.jot || n.dataset.num || "");
function morph(oldEl, newEl) {
  if (oldEl.nodeType !== 1) { if (oldEl.nodeValue !== newEl.nodeValue) oldEl.nodeValue = newEl.nodeValue; return; }
  for (const a of [...oldEl.attributes]) if (!newEl.hasAttribute(a.name)) oldEl.removeAttribute(a.name);
  for (const a of newEl.attributes) if (oldEl.getAttribute(a.name) !== a.value) oldEl.setAttribute(a.name, a.value);
  morphChildren(oldEl, newEl);
}
function morphChildren(oldEl, newEl) {
  const want = [...newEl.childNodes];
  want.forEach((n, i) => {
    const key = keyOf(n), cur = oldEl.childNodes[i];
    let match = null;
    for (let j = i; j < oldEl.childNodes.length; j++) { const c = oldEl.childNodes[j]; if (c.nodeType === n.nodeType && keyOf(c) === key) { match = c; break; } }
    if (!match) { oldEl.insertBefore(n, cur || null); return; } // 新树里的节点直接搬过来
    if (match !== cur) oldEl.insertBefore(match, cur || null);
    morph(match, n);
  });
  while (oldEl.childNodes.length > want.length) oldEl.lastChild.remove(); // 没对上的旧节点都被挤到了末尾
}

// ---------- 事件 ----------
function bind(root, D) {
  root.__sbD = D; // 原位修补后还是同一个 root，数据换新的，点击处理读这里
  if (!root.__sbBound) {
    root.__sbBound = true;
    root.addEventListener("click", e => onClick(root, root.__sbD, e));
    // 记住看板里最后一个拿到焦点的元素（重画拆下来再放回去时还给它）；焦点真的离开看板就忘掉，别把焦点从别处抢回来
    root.addEventListener("focusin", e => { root.__sbFocus = e.target; });
    root.addEventListener("focusout", e => { const t = e.target; queueMicrotask(() => { if (root.isConnected && t.isConnected && !root.contains(document.activeElement)) root.__sbFocus = null; }); });
  }
  root.querySelectorAll(".jot input").forEach(bindJot);
  bindFind(root, D);
  refocusJot(root);
}
// 目录卡右侧：内存里筛文件名 / 路径，≤6 条；回车交 Obsidian 全局搜索
function renderFind(root, D, q) {
  const ul = root.querySelector(".ds-results"); if (!ul) return;
  const s = q.trim().toLowerCase();
  const hits = !s ? [] : D.notes.filter(n => n.path.toLowerCase().includes(s) || n.name.toLowerCase().includes(s)).slice(0, 6);
  ul.innerHTML = hits.length
    ? hits.map(n => `<li data-open="${esc(n.path)}"><span class="ds-fname">${esc(n.name)}</span><span class="ds-fpath">${esc(n.path)}</span></li>`).join("")
    : `<li class="muted">${s ? "没有匹配的笔记" : "输入文件名或考点关键词"}</li>`;
}
// 回车：交 Obsidian 原生全局搜索（search 视图带查询词；没有就退命令）
function openGlobalSearch(q) {
  try {
    if (typeof app.workspace.openGlobalSearch === "function") return app.workspace.openGlobalSearch(q);
    const leaf = app.workspace.getLeaf("tab");
    leaf.setViewState({ type: "search", state: { query: q } });
  } catch (err) {
    try { app.commands.executeCommandById("global-search:open"); } catch (_) {}
  }
}
function bindFind(root, D) {
  const inp = root.querySelector(".ds-input");
  if (!inp || inp.__sbBound) return;
  inp.__sbBound = true;
  inp.addEventListener("input", () => renderFind(root, root.__sbD || D, inp.value));
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      const q = inp.value.trim();
      if (q) { e.preventDefault(); openGlobalSearch(q); }
    }
  });
}
async function onClick(root, D, e) {
  {
    const act = e.target.closest("[data-act]");
    if (act) {
      e.preventDefault();
      const name = act.dataset.act;
      if (name === "create-today") return createFromTemplate(root, `${V.dailyDir}/${ymd(TODAY)}.md`, V.dailyTemplate, ymd(TODAY));
      if (name === "create-week") return createFromTemplate(root, `${V.weeklyDir}/${ymd(MON)}.md`, V.weeklyTemplate, ymd(MON));
      if (name === "jot") { const inp = act.closest(".jot")?.querySelector("input"); if (inp) return submitJot(inp); }
      if (name === "expand") { const tile = act.closest(".tile"); return openDetail(root, tile.dataset.kind, D, { src: tile.dataset.src, srcLine: tile.dataset.srcLine }); }
      if (name === "close-detail") return closeDetail(root);
      if (name === "carry-today" || name === "carry-week") return carryTasks(root, name.slice(6), D);
      if (name === "more") return showMenu(root, act.closest(".tile"));
      if (name === "news-refresh") return runNews(root);
      if (name === "research-refresh") return runResearch(root);
      if (name === "pipeline-run") return runPipeline(root);
      if (name === "news-save") return saveNews(root, D, act);
      if (name === "pomo-toggle" || name === "pomo-reset") return pomoAct(name);
      if (name === "open-review") { e.stopPropagation(); return openDetail(root, "review", D, {}); }
      if (name === "reviewed") { e.stopPropagation(); return markReviewed(root, D, act); }
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) { e.preventDefault(); e.stopPropagation(); return openTab(tab.dataset.tab); }
    const box = e.target.closest("[data-toggle]");
    if (box) {
      e.preventDefault(); e.stopPropagation();
      const li = box.closest("[data-open]");
      li.classList.toggle("done"); li.classList.toggle("todo");
      afterTick(root, D, li);
      if (li.dataset.new === "1") { await appendUnder("today", [`- [ ] ${li.dataset.text}`]); li.removeAttribute("data-new"); }
      return toggleTask(li.dataset.open, li.dataset.line != null && li.dataset.line !== "" ? +li.dataset.line : 0, li.dataset.text);
    }
    // 关联笔记按钮：在侧栏打开对应学科笔记，不触发日记任务跳转
    const lnk = e.target.closest("[data-link]");
    if (lnk) { e.preventDefault(); e.stopPropagation(); return openNoteByName(root, lnk.dataset.link); }
    // 资讯条目：在系统浏览器里打开（不进 Obsidian 的网页标签）
    const u = e.target.closest("[data-url]");
    if (u) { e.preventDefault(); try { window.require("electron").shell.openExternal(u.dataset.url); } catch (err) { window.open(u.dataset.url); } return; }
    const o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); return openAt(root, o.dataset.open, o.dataset.line != null ? +o.dataset.line : undefined); }
  }
}
// 刚在某个输入框回车过（5 秒内），看板重画后把焦点还给同一个框，能连着输
function refocusJot(scope) {
  const f = window.__sbJotFocus; if (!f || Date.now() - f.at > 5000) return;
  const inModal = !!scope.closest(".sb-modal") || scope.classList.contains("sb-modal");
  if (inModal !== f.inModal) return;
  const inp = scope.querySelector(`.jot[data-jot="${f.kind}"] input`);
  if (inp) { inp.placeholder = JOT_META[f.kind].done; inp.focus({ preventScroll: true }); window.__sbJotFocus = null; }
}

// 让看板撑满所在的面板；窄栏（侧栏）里不撑
function fitHeight(root, tries = 0) {
  const vc = root.closest(".view-content");
  if (!vc) { if (tries < 20) setTimeout(() => fitHeight(root, tries + 1), 100); return; }
  const apply = () => {
    const pw = root.parentElement ? root.parentElement.clientWidth : 0;
    const w = pw > 0 ? Math.min(vc.clientWidth, pw) : vc.clientWidth, h = vc.clientHeight;
    root.classList.toggle("narrow", w > 0 && w < V.narrowBelow);
    if (w >= V.narrowBelow) {
      // vc 暂时高度为 0（隐藏分栏 / 编辑视图尚未挂载）时不要清空已有高度，否则 fr 轨道与卡内清单会按内容无限撑开
      if (h > 0) root.style.height = Math.max(680, h) + V.row0 + V.row3 + V.row4 + V.row5 + 28 + "px";
    } else {
      root.style.height = "";
    }
  };
  apply();
  // 也盯着看板自己：阅读模式下藏着的编辑视图里有一份宽度为 0 的看板，用户切到编辑模式时它从 0 变宽，这里顺手把视图切回阅读
  // 不直接盯 root：apply() 会改 root 的高度，盯自己会触发 "ResizeObserver loop" 警告；盯外层的编辑视图容器就够了
  const sv = root.closest(".markdown-source-view");
  const ro = new ResizeObserver(() => { if (!root.isConnected) { ro.disconnect(); return; } apply(); if (sv && sv.offsetWidth > 0) setTimeout(() => ensureReadingView(root), 0); }); // 切视图放到观察回调之外，否则浏览器报 ResizeObserver loop
  ro.observe(vc); if (sv) ro.observe(sv);
}

// 过了零点但没人改笔记时，Dataview 不会重画，看板会停在昨天。
// 每分钟看一眼日期，变了就碰一下 Dataview 索引（revision+1），它会在刷新间隔后自己重画。
function watchMidnight(root) {
  const day = ymd(TODAY);
  const t = setInterval(() => {
    if (!root.isConnected) { clearInterval(t); return; }
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (ymd(now) !== day) { clearInterval(t); try { dv.index.touch(); } catch (e) { console.warn("[sb-board] 跨日刷新失败", e); } }
  }, 60 * 1000);
}

// 看板只在阅读视图里排版。Homepage 打开时会强制阅读视图，但从文件列表 / 最近文件 / 搜索点开会落到编辑模式，
// 这里发现自己被渲染在编辑视图里，就把这一栏切回阅读视图（控制台设 window.__sbAllowEdit = true 可临时关掉，用来编辑这篇笔记）。
function ensureReadingView(el) {
  if (window.__sbAllowEdit) return false;
  if (!el.closest(".markdown-source-view")) return false;
  const leaf = app.workspace.getLeavesOfType("markdown").find(l => l.view?.containerEl?.contains(el));
  if (!leaf || leaf.view.getMode?.() !== "source") return false;
  const st = leaf.getViewState();
  leaf.setViewState({ ...st, state: { ...st.state, mode: "preview" } });
  return true;
}

// ---------- 主流程 ----------
async function main() {
  const subjects = collectSubjects();
  const D = {
    today: collectToday(), days: collectDays(), week: collectWeek(), route: await collectRoute(), stack: await collectStack(), rhythm: await collectRhythm(), tracks: await collectTracks(), anchors: await collectAnchors(), todo: await collectTodo(),
    subjects, review: subjects, notes: collectNoteIndex(),
    generatedAt: new Date().toISOString(),
  };
  D.today.notes = await collectNotes(D.today.path);
  D.carry = { today: collectCarry("today", D.today), week: collectCarry("week", D.week) };
  D.news = collectNews();
  D.research = collectResearch();
  D.pipeline = collectPipeline();
  if (input && input.raw) {
    const pre = document.createElement("pre"); pre.className = "sb-raw";
    pre.textContent = JSON.stringify(D, null, 2);
    dv.container.appendChild(pre);
    return;
  }
  if (ensureReadingView(dv.container)) return; // 切视图后 Dataview 会在阅读视图里重新跑一遍这个脚本
  await ensureFonts();
  const oldRoot = dv.container.querySelector(".sb-board") || findGhost();
  const scrollState = captureScroll(oldRoot);
  const fresh = document.createElement("div");
  fresh.className = [V.news === false ? "no-news" : "", V.research === false ? "no-research" : ""].filter(Boolean).reduce((cls, c) => cls + " " + c, "sb-board").trim();
  fresh.innerHTML = renderAll(D);
  // 代码版本戳：view.js / view.css 改过之后，旧看板上绑的还是旧代码的处理函数，这时不能修补复用，必须整块换新
  // 日期也算进去：点击处理是第一次整块画时绑上的，记着那天的「今天」。跨了天还修补复用，接过来 / 加一条会写回昨天的笔记
  const ver = ["view.js", "view.css"].map(n => { const f = tfile(`${V.dir || "01_dashboard"}/${n}`); return f && f.stat ? f.stat.mtime : 0; }).join("-") + "-" + ymd(TODAY);
  fresh.dataset.sbVer = ver;
  const ghost = window.__sbNoMorph ? null : findGhost();
  if (ghost && ghost.dataset.sbVer === ver) {
    // 屏幕上还顶着重画前的旧看板：把新看板逐节点修补上去，旧看板继续当正主
    const det = window.__sbDetail;
    if (det) { const m = document.createElement("div"); m.className = "sb-modal in"; m.dataset.kind = det.kind; m.tabIndex = -1; m.innerHTML = detailHTML(det.kind, D, det.src || {}); fresh.appendChild(m); }
    morphChildren(ghost, fresh);
    ghost.classList.remove("sb-ghost");
    armGhost(ghost);
    bind(ghost, D);
    const m = ghost.querySelector(".sb-modal");
    if (m) { placeModal(ghost); bindModal(ghost, m); if (!m.contains(document.activeElement)) m.focus({ preventScroll: true }); refocusJot(m); }
    setTimeout(() => ensureReadingView(ghost), 300);
    startPomo(); watchNews(); watchResearch(); watchPipeline(); loadThumbs(); maybeAutoNews(ghost, D.news); maybeAutoResearch(ghost, D.research);
    return;
  }
  const root = fresh;
  swapInRoot(root);
  armGhost(root);
  bind(root, D);
  fitHeight(root);
  restoreScroll(root, scrollState);
  watchMidnight(root);
  setTimeout(() => ensureReadingView(root), 300); // 容器刚才可能还没挂进 DOM，补查一次
  if (window.__sbDetail) openDetail(root, window.__sbDetail.kind, D, window.__sbDetail.src, true); // 重画前开着大窗，就原样放回去
  startPomo(); watchNews(); watchResearch(); watchPipeline(); loadThumbs(); maybeAutoNews(root, D.news); maybeAutoResearch(root, D.research);
}

try { await main(); }
catch (e) {
  const pre = document.createElement("pre"); pre.className = "sb-error";
  pre.textContent = "看板出错：" + (e && e.stack || e);
  const g = findGhost(); if (g) g.remove();
  dv.container.appendChild(pre);
  console.error("[sb-board]", e);
}
