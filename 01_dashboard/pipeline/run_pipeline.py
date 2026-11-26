# -*- coding: utf-8 -*-
"""SecondBrain 知识库流水线主脚本。

流程：扫收件箱（按学科子目录定科）→ 本地解析 pptx → 读该科模板 + 真题 + 旧速查卡
→ 调方舟豆包 → 写速查卡 / 更新 _地图.md → 回填索引 → 原件归档到 _已处理/日期/。

口径：
- AI 只读收件箱；收件箱空即退出，不调模型。
- 学科由收件箱一级子目录名决定（必须是六科之一），脚本不猜学科。
- 幂等：处理成功原件才离开收件箱；失败留在收件箱，下次重试。

用法：
  python run_pipeline.py                 # 处理收件箱全部可解析文件
  python run_pipeline.py --no-llm       # 只解析，不调模型、不写产物（调试）
  python run_pipeline.py --only=文件名  # 只处理指定文件名
"""
import argparse
import json
import os
import re
import shutil
import time
from datetime import date

from pipeline_config import (
    DATA_DIR,
    DONE,
    INDEX,
    LOCK_STALE_SEC,
    LOG_MAX_LINES,
    MATERIALS,
    SKIP_EXTS,
    SUBJECTS,
    SUBJECTS_ROOT,
    SUPPORTED_EXTS,
    INBOX,
)
from extract_pptx import extract_pptx, render_source
from ark_client import run_ark

LOG = []


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    LOG.append(line)
    print(line, flush=True)


def read_text(path):
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


# ---------- 上下文读取 ----------

def read_exam(subject):
    """读该科 _真题 目录下的 md/txt 文本；其余格式只计数跳过。返回 (文本, 跳过数)。"""
    exam_dir = MATERIALS / subject / "_真题"
    parts, skipped = [], 0
    if exam_dir.exists():
        for f in sorted(exam_dir.iterdir()):
            if not f.is_file():
                continue
            if f.suffix.lower() in (".md", ".txt"):
                parts.append(f"【{f.name}】\n{read_text(f)}")
            else:
                skipped += 1
    return "\n\n".join(parts).strip(), skipped


def existing_card_titles(subject):
    card_dir = SUBJECTS_ROOT / subject / "速查卡"
    titles = []
    if card_dir.exists():
        for f in sorted(card_dir.glob("*.md")):
            txt = read_text(f)
            m = re.search(r"^topic:\s*(.+)$", txt, re.M)
            if m:
                titles.append(m.group(1).strip())
                continue
            h = re.search(r"^#\s+(.+)$", txt, re.M)
            if h:
                titles.append(h.group(1).strip())
    return titles


def existing_atomic_titles(subject):
    """C 语言：读产出\\原子卡 下已有卡标题，避免重复造同一实操点。"""
    card_dir = SUBJECTS_ROOT / subject / "产出" / "原子卡"
    titles = []
    if card_dir.exists():
        for f in sorted(card_dir.glob("*.md")):
            txt = read_text(f)
            m = re.search(r"^topic:\s*(.+)$", txt, re.M)
            if m:
                titles.append(m.group(1).strip())
    return titles


# ---------- 产物写盘 ----------

def safe_name(title):
    s = re.sub(r"[\x00-\x1f]", "", title)
    s = re.sub(r'[\\/:*?"<>|]', "", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:40] or "未命名"


def chapter_of(source):
    """从 source 里取「第N章」，拿不到返回 0。"""
    m = re.search(r"第\s*(\d+)\s*章", source or "")
    return int(m.group(1)) if m else 0


def next_order(card_dir, chapter):
    """同一章里已有的最大 order + 1。"""
    top = 0
    if chapter:
        for p in card_dir.glob("*.md"):
            try:
                head = p.read_text(encoding="utf-8", errors="ignore")[:400]
            except OSError:
                continue
            m = re.search(r"^chapter:\s*(\d+)", head, re.M)
            if m and int(m.group(1)) == chapter:
                o = re.search(r"^order:\s*(\d+)", head, re.M)
                if o:
                    top = max(top, int(o.group(1)))
    return top + 1


def _strip_label(text, label):
    """模型有时把段名前缀写进值里，去掉重复前缀。"""
    t = (text or "").strip()
    for p in (f"{label}：", f"{label}:"):
        if t.startswith(p):
            t = t[len(p):].strip()
    return t


def inline_clean(text):
    """行内字段：JSON 解码后的真实换行转回字面 \\n，去掉其余控制符，压平空白。"""
    t = (text or "").replace("\r", "")
    t = t.replace("\n", "\\n")
    t = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def write_card(subject, card, source, today):
    card_dir = SUBJECTS_ROOT / subject / "速查卡"
    card_dir.mkdir(parents=True, exist_ok=True)
    title = (card.get("title") or "").strip() or "未命名考点"
    base = safe_name(title)
    chapter = chapter_of(source)
    order = next_order(card_dir, chapter) if chapter else 0
    prefix = f"第{chapter:02d}章-{order:02d} " if chapter else ""
    fname = prefix + base + ".md"
    n = 2
    while (card_dir / fname).exists():
        fname = f"{prefix}{base}-{n}.md"
        n += 1

    fm = [
        "---",
        "cssclasses:",
        "  - checklist-notes",
        f"subject: {subject}",
        f"topic: {title}",
        f"last_review: {today}",
        "stage: 0",
        f"source: {source}",
    ]
    if chapter:
        fm += [f"chapter: {chapter}", f"order: {order}"]
    fm += ["---"]
    body = [f"# {title}", ""]
    for sec in card.get("sections", []):
        heading = (sec.get("heading") or "").strip()
        b = (sec.get("body") or "").strip()
        if not heading or not b:
            continue
        body += [f"## {heading}", "", b, ""]
    analogy = (card.get("analogy") or "").strip()
    if analogy:
        body += [f"> 类比：{analogy}", ""]

    md = "\n".join(fm + [""] + body).rstrip() + "\n"
    out = card_dir / fname
    out.write_text(md, encoding="utf-8")
    return out


# ---------- C 语言新口径：章节笔记 + 原子卡（待上机，不进复习队列） ----------

def write_atomic(subject, card, source, today):
    """写一张原子卡到 产出\\原子卡\\；不带 last_review/stage，不进间隔重复。"""
    d = SUBJECTS_ROOT / subject / "产出" / "原子卡"
    d.mkdir(parents=True, exist_ok=True)
    title = (card.get("title") or "").strip() or "未命名原子卡"
    base = safe_name(title)
    fname = base + ".md"
    n = 2
    while (d / fname).exists():
        fname = f"{base}-{n}.md"
        n += 1

    fm = [
        "---",
        f"subject: {subject}",
        "type: 原子卡",
        f"topic: {title}",
        "status: 待上机",
        f"source: {source}",
        "---",
    ]
    body = [f"# {title}", ""]

    problem = (card.get("problem") or "").strip()
    if problem:
        body += ["## 问题", "", problem, ""]

    demo = (card.get("demo") or "").strip()
    if demo:
        body += ["## 最小 Demo", "", "```c", demo, "```", ""]

    pitfalls = (card.get("pitfalls") or "").strip()
    if pitfalls:
        body += ["## 边界 / 高频易错", "", pitfalls, ""]

    variant = (card.get("variant") or "").strip()
    if variant:
        body += ["## 变体思考题", "", variant, ""]

    links = [safe_name(x.strip()) for x in (card.get("links") or []) if x and x.strip()]
    if links:
        body += ["## 关联", ""]
        body += [f"- [[{x}]]" for x in links]
        body += [""]

    md = "\n".join(fm + [""] + body).rstrip() + "\n"
    out = d / fname
    out.write_text(md, encoding="utf-8")
    return out


def write_chapter(subject, chapter, source, atomic_titles):
    """写章节笔记（地图索引）到 产出\\；完整 Demo 不下放。"""
    d = SUBJECTS_ROOT / subject / "产出"
    d.mkdir(parents=True, exist_ok=True)
    title = (chapter.get("title") or "").strip() or "未命名章节"
    base = safe_name(title)
    fname = base + ".md"
    n = 2
    while (d / fname).exists():
        fname = f"{base}-{n}.md"
        n += 1

    fm = [
        "---",
        f"subject: {subject}",
        "type: 章节笔记",
        f"topic: {base}",
        "status: 学习中",
        f"source: {source}",
        "---",
    ]
    lines = ["", f"# {title}", ""]

    goal = (chapter.get("goal") or "").strip()
    if goal:
        lines += ["> [!blue] 本章解决什么问题", f"> {goal}", ""]

    outline = chapter.get("outline") or []
    if outline:
        lines += ["## 核心语法提纲", ""]
        for it in outline:
            point = inline_clean(it.get("point"))
            if not point:
                continue
            frag = inline_clean(it.get("fragment"))
            boundary = inline_clean(it.get("boundary"))
            card = safe_name((it.get("card") or "").strip())
            line = f"- **{point}**"
            if frag:
                line += f"：`{frag}`"
            if boundary:
                line += f"｜{boundary}"
            if card:
                line += f" → [[{card}]]"
            lines.append(line)
        lines.append("")

    lines += ["> [!danger] 本章核心风险点"]
    for r in chapter.get("risks") or []:
        risk = inline_clean(r.get("risk"))
        if not risk:
            continue
        card = safe_name((r.get("card") or "").strip())
        line = f"- {risk}"
        if card:
            line += f" → [[{card}]]"
        lines.append(f"> {line}")
    lines += ["> 其余高频坑汇总见 [[_报错册]]", ""]

    prereq = _strip_label(chapter.get("prereq"), "前置基础")
    followup = _strip_label(chapter.get("followup"), "引出后续")
    lines += [
        "> [!info] 🔗 前后依赖连接",
        f"> - 前置基础：{prereq or '（待补）'}",
        f"> - 引出后续：{followup or '（待补）'}",
        "",
    ]

    if atomic_titles:
        lines += ["## 原子卡索引（按学习顺序）", ""]
        lines += [f"- [[{safe_name(t)}]]" for t in atomic_titles]
        lines.append("")

    lines += ["## 待上机卡片", "", "- [ ] 本章关联原子卡已逐张上机验证", ""]

    lines += [
        "> [!success] 本章自检",
        "- [ ] 能独立写出核心最小 Demo",
        "- [ ] 能解释本章典型易错现象的根源",
        "- [ ] 能讲清本章与前后章节的概念关联",
        "- [ ] 全部关联原子卡 status 更新为 已验证",
        "",
    ]

    md = "\n".join(fm + lines).rstrip() + "\n"
    out = d / fname
    out.write_text(md, encoding="utf-8")
    return out


def upsert_map(subject, map_data, today):
    """合并考点到该科 _地图.md：按考点名去重，新条目追加，不删旧条目。"""
    map_path = SUBJECTS_ROOT / subject / "_地图.md"
    rows = {}  # title -> (note, exam)
    if map_path.exists():
        for line in read_text(map_path).splitlines():
            m = re.match(r"^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$", line)
            if not m:
                continue
            head = m.group(1).strip()
            if head in ("考点",) or set(head) <= set("-: "):
                continue
            rows[head] = (m.group(2).strip(), m.group(3).strip())

    for pt in map_data.get("points", []) or []:
        t = (pt.get("title") or "").strip()
        if not t:
            continue
        rows[t] = ((pt.get("note") or "").strip(), (pt.get("exam") or "").strip())

    summary = (map_data.get("summary") or "").strip() or "（待补充本章脉络）"
    lines = [
        "---",
        f"subject: {subject}",
        "type: 学科地图",
        f"updated: {today}",
        "---",
        "",
        f"# {subject} · 考点地图",
        "",
        summary,
        "",
        "| 考点 | 一句话 | 真题 |",
        "| --- | --- | --- |",
    ]
    for t, (note, exam) in rows.items():
        lines.append(f"| {t} | {note} | {exam} |")
    map_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return map_path


def refresh_index():
    """回填 _索引.md 各科速查卡数；复习日期第一版不动。"""
    if not INDEX.exists():
        return
    text = read_text(INDEX)

    def count(subj):
        d = SUBJECTS_ROOT / subj / "速查卡"
        return len(list(d.glob("*.md"))) if d.exists() else 0

    def repl(m):
        subj = m.group(1)
        return f"| {subj} | {count(subj)} |"

    text = re.sub(
        r"^\|\s*(" + "|".join(SUBJECTS) + r")\s*\|\s*\d+\s*\|",
        repl,
        text,
        flags=re.M,
    )
    INDEX.write_text(text, encoding="utf-8")


def archive(src, today):
    dest_dir = DONE / today
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    n = 2
    while dest.exists():
        dest = dest_dir / f"{src.stem}-{n}{src.suffix}"
        n += 1
    shutil.move(str(src), str(dest))
    return dest


# ---------- 提示词 ----------

def build_prompt(subject, template, exam_text, existing, source, meta):
    exam_block = exam_text or "（暂无真题参照，「真题出现过几次」这一段留空。）"
    exist_block = "、".join(existing) if existing else "（还没有速查卡，没有重复顾虑。）"
    return f"""你是{subject}的学科助教，把下面这份课件提炼成考前速查卡。

【该科速查卡模板（段序与硬规则，必须遵守）】
{template}

【该科真题参照】
{exam_block}

【已有的速查卡标题（不要重复造同一考点）】
{exist_block}

【课件解析全文】
{source}

【课件元信息】共 {meta['slides']} 页，图片 {meta['pictures']} 张；可提取文本 {meta['chars']} 字{f"，已省略 {meta['omitted']} 字" if meta['truncated'] else ""}。

要求：
1. 拆成 2–4 张原子速查卡，每张只讲一个考点；标题 ≤20 字，是考点名。
2. 每张卡的 sections 段名必须严格用模板里的段名，按模板顺序排列；某段这节课没内容就省略该段，不许写「暂无」「待补」。
3. 正文用清单体（有序列表或对照表），一页能扫完；中文直白口语，不编真题、不补课件里没有的结论。
4. analogy 给一个讲清概念的类比，没有就空字符串。

只输出 JSON，结构：
{{
  "cards": [
    {{
      "title": "考点短标题",
      "sections": [{{"heading": "模板段名", "body": "markdown 片段"}}],
      "analogy": "一句类比，可空"
    }}
  ],
  "map": {{
    "summary": "本章脉络一段话",
    "points": [{{"title": "考点", "note": "一句话", "exam": "真题命中情况，无真题空字符串"}}]
  }}
}}"""


def build_c_prompt(subject, template, existing, source, meta):
    exist_block = "、".join(existing) if existing else "（还没有原子卡，没有重复顾虑。）"
    return f"""你是{subject}的学科助教，把下面这份课件提炼成「章节地图笔记 + 原子卡初稿」。

【该科结构模板（段序与硬规则，必须遵守）】
{template}

【已有的原子卡标题（不要重复造同一实操点）】
{exist_block}

【课件解析全文】
{source}

【课件元信息】共 {meta['slides']} 页，图片 {meta['pictures']} 张；可提取文本 {meta['chars']} 字{f"，已省略 {meta['omitted']} 字" if meta['truncated'] else ""}。

要求：
1. 一章一篇章节笔记：title 用 `<学科>第N章_<主题>`；goal 一句话能力目标；outline 每条只给极简语法片段 + 一句边界提示，完整可运行 Demo 全部下沉到原子卡，章节笔记里不贴完整程序。
2. 拆成若干张原子卡，每张只解决一个会独立卡住的实操点；标题 ≤20 字；demo 是完整可编译的最小片段，不长于 15 行；这些代码是待上机初稿，不要声称已在本机跑通。
3. pitfalls 写写错时编译器 / 运行时的真实表现；variant 给一个改一行参数的思考题；links 填相关原子卡标题。
4. 不编课件里没有的结论；中文直白口语；章节提纲与原子卡标题保持一一对应。

只输出 JSON，结构：
{{
  "chapter": {{
    "title": "<学科>第6章_<主题>",
    "goal": "一句话本章能力目标",
    "outline": [{{"point": "语法要点", "fragment": "极简语法片段", "boundary": "一句边界提示", "card": "对应原子卡标题"}}],
    "risks": [{{"risk": "坑描述", "card": "对应原子卡标题或空"}}],
    "prereq": "前置基础",
    "followup": "引出后续"
  }},
  "cards": [
    {{"title": "原子卡标题", "problem": "要解决的实操问题", "demo": "最小可编译代码", "pitfalls": "边界/高频易错", "variant": "变体思考题", "links": ["相关原子卡标题"]}}
  ]
}}"""


# ---------- 单文件处理 ----------

def process_file(path, subject, today, no_llm, only):
    if only and path.name != only:
        return

    log(f"开始处理：[{subject}] {path.name}")
    extracted = extract_pptx(path)
    source, full_chars, truncated = render_source(extracted)
    meta = {
        "slides": extracted["slides"],
        "pictures": extracted["pictures"],
        "chars": full_chars,
        "omitted": max(0, full_chars - len(source)),
        "truncated": truncated,
    }
    log(f"解析：{meta['slides']} 页，图片 {meta['pictures']} 张，文本 {full_chars} 字")

    if no_llm:
        log("(--no-llm) 跳过模型，不写产物、不归档")
        return

    template = read_text(SUBJECTS_ROOT / subject / "_模板.md")
    if not template:
        raise RuntimeError(f"缺少该科模板：07_subjects/{subject}/_模板.md")
    exam_text, exam_skipped = read_exam(subject)
    if exam_skipped:
        log(f"真题目录有 {exam_skipped} 个暂不可读格式（图片/PDF），未纳入参照")

    if subject == "C语言":
        existing = existing_atomic_titles(subject)
        prompt = build_c_prompt(subject, template, existing, source, meta)
        log(f"交给豆包（C 语言口径）：提示词 {len(prompt)} 字")
        result = run_ark(prompt)

        cards = result.get("cards") or []
        if not cards:
            raise RuntimeError("模型没返回任何原子卡")
        written = [write_atomic(subject, c, path.name, today) for c in cards]
        atomic_titles = [
            (c.get("title") or "").strip() for c in cards if (c.get("title") or "").strip()
        ]
        chapter_path = write_chapter(subject, result.get("chapter") or {}, path.name, atomic_titles)
        log(f"完成：{len(written)} 张原子卡（待上机），章节笔记 → {chapter_path.name}")
    else:
        existing = existing_card_titles(subject)
        prompt = build_prompt(subject, template, exam_text, existing, source, meta)
        log(f"交给豆包：提示词 {len(prompt)} 字")
        result = run_ark(prompt)

        cards = result.get("cards") or []
        if not cards:
            raise RuntimeError("模型没返回任何速查卡")
        written = [write_card(subject, c, path.name, today) for c in cards]
        upsert_map(subject, result.get("map") or {}, today)
        log(f"完成：{len(written)} 张速查卡，地图已更新")

    refresh_index()
    dest = archive(path, today)
    log(f"原件归档 → {dest.name}")


# ---------- 入口 ----------

def collect_tasks():
    """返回 (tasks, pending)。tasks: [(subject, path)]；pending: 待人工处理提示。"""
    tasks, pending = [], []
    if not INBOX.exists():
        return tasks, pending
    for entry in sorted(INBOX.iterdir()):
        if entry.is_dir():
            if entry.name in SUBJECTS:
                for f in sorted(entry.iterdir()):
                    if f.is_file():
                        tasks.append((entry.name, f))
            else:
                pending.append(f"未知学科目录「{entry.name}」，跳过（目录名须是六科之一）")
        else:
            pending.append(f"收件箱根目录散落文件「{entry.name}」，请放进对应学科子目录")
    return tasks, pending


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-llm", action="store_true", help="只解析，不调模型、不写产物")
    ap.add_argument("--only", default="", help="只处理指定文件名")
    args = ap.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lock = DATA_DIR / "run.lock"
    if lock.exists():
        age = time.time() - lock.stat().st_mtime
        if age < LOCK_STALE_SEC:
            print("已有一个流水线在跑，退出。", flush=True)
            return
    lock.write_text(str(os.getpid()), encoding="utf-8")

    today = date.today().isoformat()
    t0 = time.time()
    try:
        tasks, pending = collect_tasks()
        for p in pending:
            log(p)

        runnable, skipped = [], []
        for subject, f in tasks:
            if f.suffix.lower() in SUPPORTED_EXTS:
                runnable.append((subject, f))
            else:
                skipped.append(f"暂不支持 {f.suffix.lower()}：{f.name}，留在收件箱")
        for s in skipped:
            log(s)

        if not runnable:
            log("收件箱没有可解析的文件，退出（不调模型）。")
            return

        log(f"待处理 {len(runnable)} 个文件")
        failures = []
        for subject, f in runnable:
            try:
                process_file(f, subject, today, args.no_llm, args.only)
            except Exception as e:
                failures.append((f.name, str(e)))
                log(f"失败：{f.name} —— {e}（原件留在收件箱，下次重试）")

        if failures:
            log(f"结束：{len(failures)} 个失败，{len(runnable) - len(failures)} 个成功")
            raise SystemExit(1)
        log(f"全部完成，用时 {round(time.time() - t0)} 秒")
    finally:
        old = []
        logf = DATA_DIR / "run.log"
        if logf.exists():
            old = [l for l in read_text(logf).splitlines() if l]
        lines = (old + LOG)[-LOG_MAX_LINES:]
        logf.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            lock.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()
