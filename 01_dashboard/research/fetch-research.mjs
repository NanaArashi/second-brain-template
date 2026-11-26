#!/usr/bin/env node
/* 01_dashboard/research/fetch-research.mjs — 看板「科研情报」卡的数据脚本
   与 news/fetch.mjs 完全独立：本脚本只服务科研情报卡。
   ① 抓：arXiv 布尔检索 + OpenAlex + Semantic Scholar 近期论文；读库内动态收件箱（未归档行）
   ② 复用：上一份 today.json 已总结过的条目直接沿用，只把新条目交给模型
   ③ 总结：火山方舟豆包模型一次调用，按 JSON 结构返回 8 字段 + A/B/C 评级
   ④ 写：~/.secondbrain-research/ 下 today.json / drafts.json / run.log（运行中多一个 run.lock）
   参数：--cap=字节  --force（不复用）  --no-llm（只抓不总结）  --draft（强制出一份双周档案草稿）
   环境变量：SB_RESEARCH_DIR（数据目录）、ARK_API_KEY、SB_ARK_MODEL（可选覆盖模型 ID） */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const DIR = process.env.SB_RESEARCH_DIR || path.join(HOME, ".secondbrain-research");
const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INBOX = path.join(VAULT, "06_tracks", "research", "动态收件箱.md");
const POOL = path.join(VAULT, "06_tracks", "research", "关注清单.md");
const ARCHIVE_DIR = path.join(VAULT, "06_tracks", "research", "归档");
const ARGS = new Set(process.argv.slice(2).filter(a => !a.includes("=")));
const ARGV = Object.fromEntries(process.argv.slice(2).filter(a => a.includes("=")).map(a => a.replace(/^--/, "").split("=")));
const CAP = +(ARGV.cap || 200 * 1024);

// ---------- 检索词簇（口径源头在 persona.md；按你自己的方向改这里的关键词） ----------
const CLUSTERS = {
  A: ["<topic-keyword-a1>", "<topic-keyword-a2>"],
  B: ["<topic-keyword-b1>", "<topic-keyword-b2>"],
  C: ["<topic-keyword-c1>", "<topic-keyword-c2>"],
};

const LIMIT = { papers: 3, candidates: 12, arxivPerQ: 6, oaPerQ: 5, s2PerQ: 5, windowH: 240, logLines: 200 };
const LOG_BUDGET = Math.min(20 * 1024, Math.floor(CAP / 10));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- 小工具 ----------
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date(), TODAY = ymd(NOW);
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const LOG = [];
const log = (...a) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${a.join(" ")}`; LOG.push(l); console.error(l); };
const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return dflt; } };
const writeJSON = (f, obj) => { const p = path.join(DIR, f), tmp = p + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); };
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const unhtml = s => String(s || "").replace(/<p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");

async function get(url, as = "text") {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return as === "json" ? r.json() : r.text();
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all([...Array(Math.min(n, items.length))].map(async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
function sanitizeJson(s) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr && (c === "\n" || c === "\r" || c === "\t")) { out += c === "\n" ? "\\n" : c === "\r" ? "\\r" : "\\t"; continue; }
    out += c;
  }
  return out;
}

// ---------- 预排除（粗筛，最终 skip 由模型判） ----------
const EXCLUDE_RE = /(motor imagery|movement imagination|SSVEP|EMG|electromyography|electrode material|coil material|chip fabrication|blood biomarker|tumor segmentation|radiomics|prostate cancer|breast cancer|retinal segmentation)/i;

// ---------- 抓 arXiv：三组布尔优先级 ----------
const arxGroup = terms => `(${terms.map(t => `all:"${t.replace(/"/g, "")}"`).join(" OR ")})`;
const ARXIV_QUERIES = [
  { pri: 1, q: `${arxGroup(CLUSTERS.A)} AND ${arxGroup(CLUSTERS.C)}` },
  { pri: 2, q: `${arxGroup([...CLUSTERS.A, ...CLUSTERS.B])} AND ${arxGroup(CLUSTERS.D)}` },
  { pri: 3, q: `${arxGroup(CLUSTERS.C)} AND ${arxGroup(CLUSTERS.B)}` },
];
function parseAtomEntries(xml, pri) {
  const blocks = [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
  return blocks.map(b => {
    const id = (b.match(/<id>([^<]+)<\/id>/) || [])[1] || "";
    const arxId = (id.match(/abs\/([^v\s]+)/) || [])[1] || id;
    const title = cut(unhtml((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""), 200);
    const summary = cut(unhtml((b.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || ""), 600);
    const published = (b.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    const authors = [...b.matchAll(/<name>([^<]+)<\/name>/g)].map(m => unhtml(m[1])).slice(0, 6);
    return { id: `arxiv:${arxId}`, source: "arxiv", pri, title, abstract: summary, authors, year: published ? published.slice(0, 4) : "", venue: "arXiv 预印本", published, url: `https://arxiv.org/abs/${arxId}`, reviewed: false };
  }).filter(p => p.id && p.title);
}
async function fetchArxiv(prev) {
  const cutoff = NOW - LIMIT.windowH * 3600e3;
  const prevBy = new Map((prev.papers || []).map(p => [p.id, p]));
  const lists = await pool(ARXIV_QUERIES, 3, async g => {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(g.q)}&sortBy=submittedDate&sortOrder=descending&max_results=${LIMIT.arxivPerQ}`;
    try {
      const xml = await get(url, "text");
      const list = parseAtomEntries(xml, g.pri).filter(p => !p.published || Date.parse(p.published) >= cutoff);
      for (const p of list) { const o = prevBy.get(p.id); if (o && o.grade && !ARGS.has("--force")) Object.assign(p, pick(o, ["title_zh", "what", "org", "pi", "venue", "codeData", "tags", "dataSource", "relation", "limitation", "grade", "reviewed", "skip"]), { old: true }); }
      log("arXiv", `优先级 ${g.pri} 候选 ${list.length} 篇`);
      return list;
    } catch (e) { log("arXiv 失败", `优先级 ${g.pri}`, e.message); return []; }
  });
  return { list: lists.flat(), ok: lists.some(l => l.length) };
}

// ---------- 抓 OpenAlex（期刊/会议年份、机构、通讯作者元数据更全） ----------
function reconstructAbstract(inv) {
  if (!inv) return "";
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return cut(words.join(" "), 600);
}
const OA_QUERIES = ["<topic query a>", "<topic query b>", "<topic query c>"];
async function fetchOpenAlex(prev) {
  const prevBy = new Map((prev.papers || []).map(p => [p.id, p]));
  const lists = await pool(OA_QUERIES, 3, async q => {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${LIMIT.oaPerQ}&select=id,title,publication_year,authorships,primary_location,open_access,abstract_inverted_index,doi,type`;
    try {
      const j = await get(url, "json");
      const list = (j.results || []).map(w => {
        const auth = (w.authorships || []).map(a => ({ name: a.author?.display_name || "", inst: (a.institutions || []).map(i => i.display_name).join(" / "), corr: !!a.is_corresponding }));
        const corr = auth.find(a => a.corr)?.name || "";
        const inst = auth.map(a => a.inst).filter(Boolean).join("; ");
        const venue = w.primary_location?.source?.display_name || "";
        return {
          id: `openalex:${w.id.split("/").pop()}`, source: "openalex", pri: 3,
          title: cut(w.title || "", 200), abstract: reconstructAbstract(w.abstract_inverted_index),
          authors: auth.map(a => a.name).filter(Boolean).slice(0, 6), pi: corr, org: cut(inst, 120),
          year: String(w.publication_year || ""), venue: cut(venue, 80), published: w.publication_year ? `${w.publication_year}-01-01` : "",
          url: w.doi ? `https://doi.org/${w.doi.replace(/^https:\/\/doi\.org\//, "")}` : w.id,
          codeData: w.open_access?.oa_url || "", reviewed: w.type !== "preprint",
        };
      }).filter(p => p.title);
      for (const p of list) { const o = prevBy.get(p.id); if (o && o.grade && !ARGS.has("--force")) Object.assign(p, pick(o, ["title_zh", "what", "org", "pi", "venue", "codeData", "tags", "dataSource", "relation", "limitation", "grade", "reviewed", "skip"]), { old: true }); }
      log("OpenAlex", `「${q}」候选 ${list.length} 篇`);
      return list;
    } catch (e) { log("OpenAlex 失败", q, e.message); return []; }
  });
  return { list: lists.flat(), ok: lists.some(l => l.length) };
}

// ---------- 抓 Semantic Scholar（补摘要、PDF 链接） ----------
const S2_QUERIES = ["<topic query a>", "<topic query b>", "<topic query c>"];
async function fetchS2(prev) {
  const prevBy = new Map((prev.papers || []).map(p => [p.id, p]));
  const lists = await pool(S2_QUERIES, 3, async q => {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${LIMIT.s2PerQ}&fields=title,abstract,year,venue,authors,externalIds,openAccessPdf,publicationDate`;
    try {
      const j = await get(url, "json");
      const list = (j.data || []).map(w => ({
        id: `s2:${w.paperId}`, source: "s2", pri: 3,
        title: cut(w.title || "", 200), abstract: cut(w.abstract || "", 600),
        authors: (w.authors || []).map(a => a.name).slice(0, 6),
        year: String(w.year || ""), venue: cut(w.venue || "", 80), published: w.publicationDate || "",
        url: w.externalIds?.DOI ? `https://doi.org/${w.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${w.paperId}`,
        codeData: w.openAccessPdf?.url || "", reviewed: !!(w.year && w.venue),
      })).filter(p => p.title);
      for (const p of list) { const o = prevBy.get(p.id); if (o && o.grade && !ARGS.has("--force")) Object.assign(p, pick(o, ["title_zh", "what", "org", "pi", "venue", "codeData", "tags", "dataSource", "relation", "limitation", "grade", "reviewed", "skip"]), { old: true }); }
      log("S2", `「${q}」候选 ${list.length} 篇`);
      return list;
    } catch (e) { log("S2 失败", q, e.message); return []; }
  });
  return { list: lists.flat(), ok: lists.some(l => l.length) };
}

// ---------- 读动态收件箱（只取未归档行） ----------
function parseInbox() {
  let md = "";
  try { md = fs.readFileSync(INBOX, "utf8"); } catch (e) { log("收件箱读取失败", e.message); return []; }
  const out = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*[-*+]\s+(.+)/);
    if (!m) continue;
    const f = m[1].split("｜").map(s => cut(s.trim(), 120));
    if (f.length < 7) continue;
    const [date, pi, org, event, link, pending, status] = f;
    if (status !== "未归档") continue;
    if (!pi && !event) continue;
    out.push({ date, pi, org, event, link, pending, status });
  }
  log("收件箱", `未归档动态 ${out.length} 条`);
  return out;
}

// ---------- 读关注清单（供档案草稿匹配，不写死在代码里） ----------
function parsePoolPIs() {
  try {
    const md = fs.readFileSync(POOL, "utf8");
    const pis = []; let inPool = false;
    for (const line of md.split("\n")) {
      if (/^###\s+P\d/.test(line)) { inPool = true; continue; }
      if (/^##\s+/.test(line)) inPool = false;
      if (!inPool) continue;
      const m = line.match(/^-\s+\*\*(.+?)\*\*：(.+)$/);
      if (!m) continue;
      for (let n of m[2].split(/[/、]/)) {
        n = n.replace(/[（(].*?[）)]/g, "").trim();
        if (n) pis.push(n);
      }
    }
    return [...new Set(pis)];
  } catch { return []; }
}

// ---------- 读者画像 ----------
const DEFAULT_PERSONA = `读者是一名在校学生，按 persona.md 里的方向与口径筛选论文。不确定的机构、作者、数据、代码链接一律写「未注明」，不许编造。`;
const PERSONA = (() => { try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "persona.md"), "utf8").trim(); } catch { return DEFAULT_PERSONA; } })();

// ---------- 交给火山方舟豆包总结 ----------
const S = { type: "string" }, B = { type: "boolean" }, ARR = { type: "array", items: S };
const obj = (props, req) => ({ type: "object", properties: props, required: req || Object.keys(props), additionalProperties: false });
const SCHEMA = obj({
  papers: { type: "array", items: obj({
    id: S, title_zh: S, what: S, org: S, pi: S, venue: S, codeData: S,
    tags: ARR, dataSource: S, relation: S, limitation: S, grade: S, reviewed: B, skip: B,
  }) },
  conclusion: S,
});

function buildPrompt(candidates) {
  const input = candidates.map(p => p.old
    ? { id: p.id, old: true, title: p.title, title_zh: p.title_zh, grade: p.grade, skip: p.skip }
    : { id: p.id, source: p.source, title: p.title, abstract: p.abstract, authors: p.authors, pi: p.pi || "", org: p.org || "", year: p.year, venue: p.venue, codeData: p.codeData || "" });
  return `${PERSONA}

下面是今天抓到的候选论文（JSON）。标 old:true 的已总结过，不要重新输出。

按需求逐条判断并输出 papers 数组，顺序与候选一致；id 原样照抄候选里的 id。每条 8 字段：
1. title_zh：标题中文意译（≤30 字，不直译腔）
2. what：一句话做了什么，用能懂的话（≤70 字，说清对象、方法、主要结论，不写空话）
3. org：机构 + 课题组；pi：通讯作者/PI（点名到人名，查不到写「未注明」）
4. venue：期刊/会议 + 年份；codeData：开源代码/数据链接，没有写空字符串
5. tags：从 A/B/C/D 四簇选，可多选
6. dataSource：公开数据集 / 自有临床队列 / 仿真
7. relation：直接对口 / 方法可借用 / 仅背景
8. limitation：一句局限（≤50 字）
grade：A=机构+PI 明确+真实患者数据+方法落 A/D 簇；B=方法创新但仅公开数据集；C=综述/观点/纯仿真无数据。
reviewed：非预印本或已正式发表=true；未评审预印本=false。
skip=true：命中硬性排除（纯 BCI 解码/运动想象/SSVEP/肌电、纯器械无模型、AD 血标志物/肿瘤分割/影像组学、纯问卷行为实验、泛综述），或与方向无关。
conclusion：今天最该记住的一句结论（≤40 字，从 A/B 级条目里提炼；没有值得记的就写空字符串）。

候选：
${JSON.stringify(input)}`;
}

const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_MODEL = process.env.SB_ARK_MODEL || "doubao-seed-evolving"; // 旧默认 turbo: doubao-seed-2-1-turbo-260628
const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

async function runArk(prompt) {
  if (!ARK_API_KEY) throw new Error("未配置 ARK_API_KEY 环境变量");
  const body = {
    model: ARK_MODEL, temperature: 0.3, max_tokens: 12000,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "你是一个科研情报编辑，只输出符合给定 JSON 结构的结果，不要输出 JSON 以外的解释或代码块。" },
      { role: "user", content: prompt },
    ],
  };
  const t0 = Date.now(); let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r;
    try {
      r = await fetch(ARK_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ARK_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8 * 60e3) });
    } catch (e) {
      lastErr = new Error(`方舟网络错误：${e.cause?.code || e.name} ${cut(e.message, 200)}`);
      if (attempt < 2) { await new Promise(s => setTimeout(s, 3000)); continue; }
      throw lastErr;
    }
    if (!r.ok) { lastErr = new Error(`Ark HTTP ${r.status}：${cut(await r.text(), 300)}`); if (attempt < 2) { await new Promise(s => setTimeout(s, 3000)); continue; } throw lastErr; }
    const j = await r.json();
    const choice = j.choices?.[0] || {};
    const content = choice.message?.content || "";
    try { return { r: JSON.parse(sanitizeJson(String(content).replace(/^```json\s*|\s*```$/g, ""))), ms: Date.now() - t0 }; }
    catch (e) {
      try { fs.writeFileSync(path.join(DIR, "last-raw.txt"), content); } catch { /* 落盘失败不影响报错 */ }
      lastErr = new Error(`豆包返回的不是合法 JSON：${e.message}（finish=${choice.finish_reason || "?"}，原始长度 ${content.length}）`);
      if (attempt < 2) { await new Promise(s => setTimeout(s, 3000)); continue; }
      throw lastErr;
    }
  }
  throw lastErr;
}

// ---------- 双周档案草稿（每 14 天出一份） ----------
const DRAFT_ANCHOR = new Date("2026-11-22T00:00:00+08:00");
function dueForDraft() {
  const days = Math.floor((NOW - DRAFT_ANCHOR) / 864e5);
  if (days < 0) return false;
  const dow = NOW.getDay(); // 0=周日
  return dow === 0 && days % 14 === 0;
}
function existingDrafts() {
  try { return fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith(".md") && f.startsWith("档案_")); } catch { return []; }
}
function writeGroupDraft(pis, groups, papers) {
  const drafts = existingDrafts();
  const target = pis.find(name => !drafts.some(d => d.includes(name))) || pis[0];
  if (!target) { log("档案", "关注清单里没有待建档的对象"); return null; }
  const myGroups = groups.filter(g => !g.pi || g.pi.includes(target) || target.includes(g.pi));
  const myPapers = papers.filter(p => (p.pi || "").includes(target) || p.authors?.some(a => a.includes(target)));
  const fname = `档案_${target}_${TODAY}.md`;
  const body = `---
track: 科研
type: 档案草稿
pi: ${target}
created: ${TODAY}
status: 待人工核对
---

# 档案：${target}（${TODAY} 草稿）

> 本稿由脚本按收件箱动态 + 近期论文汇总生成，**招生口径、名额、临床合作必须人工核对官网后再定稿**；待核实项不许编。

## PI / 课题组

- **PI**：${target}
- **所属院系**：待核实
- **职称 / 职务**：待核实

## 招生口径

- **专业代码与门类**：待核实（注意区分工学 08 与医学技术类 101011T，后者不是工学）
- **招硕士 / 只招直博**：待核实
- **推免名额**：待核实

## 近 3 年 3 篇代表作

${myPapers.slice(0, 3).map(p => `- ${cut(p.title, 120)}（${p.year || "年份待核实"}，${p.venue || " venue 待核实"}）${p.url ? ` · [链接](${p.url})` : ""}`).join("\n") || "- 待补：从 arXiv / OpenAlex 检索该 PI 近 3 年代表作"}

## 临床数据管道

- **合作机构 / 数据来源**：待核实（先看数据从哪来）
- **影像 / 随访量表来源**：待核实

## 代码仓库

- 待核实（未公开则写「未公开」）

## 收件箱待核实项

${myGroups.map(g => `- ${g.date || "日期待补"} ｜ ${g.event} ｜ 待核实：${g.pending || "—"}${g.link ? ` ｜ [链接](${g.link})` : ""}`).join("\n") || "- 暂无"}

## 一句话判断

- 待核对：模型 + 数据两头占 / 仅公开数据集方法学 / 纯仿真观察档

## 关联

- [[关注清单]] · [[动态收件箱]]
`;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARCHIVE_DIR, fname), body);
  log("档案草稿", `已生成 ${fname}`);
  return fname;
}

// ---------- 合并、截断、写盘 ----------
function folderSize() { return fs.readdirSync(DIR).filter(f => f !== "run.log").reduce((a, f) => { try { const s = fs.statSync(path.join(DIR, f)); return a + (s.isFile() ? s.size : 0); } catch { return a; } }, 0); }

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const lock = path.join(DIR, "run.lock");
  try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs < 15 * 60e3) { console.error("已经有一个在跑，退出"); process.exit(0); } } catch { /* 没有锁 */ }
  fs.writeFileSync(lock, String(process.pid));
  const t0 = Date.now();
  const prev = readJSON("today.json", {});
  const drafts = readJSON("drafts.json", { lastDraft: null });
  let today;
  try {
    log(`开始；数据目录 ${DIR}，上限 ${CAP} 字节`);
    const llmReady = !!ARK_API_KEY && !ARGS.has("--no-llm");
    if (!llmReady) log("未启用模型总结（无 ARK_API_KEY 或 --no-llm），只抓原始标题");

    const [arx, oa, s2] = await Promise.all([fetchArxiv(prev), fetchOpenAlex(prev), fetchS2(prev)]);
    // 去重（按标题小写归一）+ 粗排除
    const seen = new Set();
    const candidates = [...arx.list, ...oa.list, ...s2.list].filter(p => {
      const k = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(k)) return false;
      seen.add(k);
      if (EXCLUDE_RE.test(`${p.title} ${p.abstract}`)) return false;
      return true;
    }).sort((a, b) => (a.pri || 9) - (b.pri || 9));

    const groups = parseInbox();
    const promptCandidates = candidates.slice(0, LIMIT.candidates);
    const needLLM = promptCandidates.some(p => !p.old) || !(prev.papers || []).length || ARGS.has("--force");
    let r = null, llm = null;
    if (needLLM && llmReady) {
      const prompt = buildPrompt(promptCandidates);
      log(`交给豆包总结：提示词 ${prompt.length} 字，候选 ${promptCandidates.length} 篇（共 ${candidates.length} 篇）`);
      llm = await runArk(prompt);
      r = llm.r;
      try { writeJSON("last-llm.json", r); } catch { /* 调试落盘失败不影响主流程 */ }
      log(`豆包完成：${Math.round(llm.ms / 1000)} 秒`);
    } else log(needLLM ? "跳过总结（未启用模型）" : "没有新内容，沿用上次的总结");

    const byId = new Map((r?.papers || []).map(x => [x.id, x]));
    const rByIndex = r?.papers || [];
    const gradeRank = { A: 0, B: 1, C: 2 };
    const papers = candidates.map((p, k) => {
      const s = byId.get(p.id) || rByIndex[k] || {};
      const t = p.old ? p : s;
      return {
        id: p.id, source: p.source, url: p.url, title: cut(p.title, 160), published: p.published, authors: p.authors || [],
        title_zh: cut(t.title_zh, 40), what: cut(t.what, 120), org: cut(t.org, 120), pi: cut(t.pi, 60),
        venue: cut(t.venue, 80), codeData: cut(t.codeData, 120), tags: (t.tags || []).slice(0, 4),
        dataSource: cut(t.dataSource, 30), relation: cut(t.relation, 30), limitation: cut(t.limitation, 80),
        grade: ["A", "B", "C"].includes(t.grade) ? t.grade : "B", reviewed: t.reviewed !== false, skip: !!t.skip,
      };
    }).filter(p => !p.skip && (p.old || p.title_zh || p.what))
      .sort((a, b) => (gradeRank[a.grade] ?? 9) - (gradeRank[b.grade] ?? 9));

    const aB = papers.filter(p => p.grade !== "C").slice(0, LIMIT.papers);
    const cBrief = papers.filter(p => p.grade === "C").map(p => ({ id: p.id, title_zh: p.title_zh || p.title, what: p.what, url: p.url }));

    // 双周档案草稿：到锚点周日且本周还没出过稿
    let draftFile = null;
    const pis = parsePoolPIs();
    if ((dueForDraft() || ARGS.has("--draft")) && drafts.lastDraft !== TODAY) {
      draftFile = writeGroupDraft(pis, groups, papers);
      if (draftFile) drafts.lastDraft = TODAY;
    }

    today = {
      v: 1, date: TODAY, generatedAt: new Date().toISOString(),
      sources: { arxiv: { ok: arx.ok }, openalex: { ok: oa.ok }, s2: { ok: s2.ok }, candidates: candidates.length },
      papers: aB, cBrief, groups,
      conclusion: cut(r?.conclusion || prev.conclusion || "", 80),
      draft: draftFile,
      llm: llm ? { seconds: Math.round(llm.ms / 1000) } : prev.llm || null,
    };
    writeJSON("drafts.json", drafts);
    writeJSON("today.json", today);
    const size = folderSize();
    if (size > CAP) log(`警告：数据 ${size} 字节，超过上限 ${CAP}`);
    log(`完成：论文 A/B ${aB.length} 篇，C 级汇总 ${cBrief.length} 条，动态 ${groups.length} 条；文件夹 ${size} 字节；用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
  } catch (e) {
    log("失败：", e.message);
    if (prev && prev.date) { prev.lastError = { at: new Date().toISOString(), message: cut(e.message, 200) }; writeJSON("today.json", prev); }
    else writeJSON("today.json", { v: 1, date: null, lastError: { at: new Date().toISOString(), message: cut(e.message, 200) }, papers: [], cBrief: [], groups: [], conclusion: "" });
    process.exitCode = 1;
  } finally {
    const old = (() => { try { return fs.readFileSync(path.join(DIR, "run.log"), "utf8").split("\n").filter(Boolean); } catch { return []; } })();
    const lines = [...old, `—— ${new Date().toISOString()}`, ...LOG].slice(-LIMIT.logLines);
    while (lines.length > 1 && Buffer.byteLength(lines.join("\n") + "\n") > LOG_BUDGET) lines.shift();
    fs.writeFileSync(path.join(DIR, "run.log"), lines.join("\n") + "\n");
    try { fs.unlinkSync(lock); } catch { /* 已经没了 */ }
  }
}

main();
