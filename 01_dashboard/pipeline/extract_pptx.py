# -*- coding: utf-8 -*-
"""pptx → 结构化纯文本（本地 python-pptx，解析方式 A）。

按幻灯片顺序抽取文本框、表格、备注；图片跳过并计数。
位图截图里的文字取不到，这是本方案的已知边界。
"""
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from pipeline_config import MAX_SOURCE_CHARS


def _iter_shapes(shapes):
    """递归展开组合图形里的形状。"""
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _iter_shapes(shape.shapes)
        else:
            yield shape


def _shape_lines(shape, out):
    if shape.has_table:
        for row in shape.table.rows:
            cells = [c.text.strip() for c in row.cells]
            line = " | ".join(c for c in cells if c)
            if line:
                out.append(line)
    elif shape.has_text_frame:
        txt = "\n".join(p.text for p in shape.text_frame.paragraphs).strip()
        if txt:
            out.append(txt)


def extract_pptx(path):
    """返回 {slides, pictures, pages:[{index,text,note}]}。"""
    prs = Presentation(str(path))
    pages = []
    n_pics = 0
    for idx, slide in enumerate(prs.slides, 1):
        lines = []
        for shape in _iter_shapes(slide.shapes):
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                n_pics += 1
            _shape_lines(shape, lines)
        note = ""
        if slide.has_notes_slide:
            note = slide.notes_slide.notes_text_frame.text.strip()
        pages.append({"index": idx, "text": "\n".join(lines).strip(), "note": note})
    return {"slides": len(pages), "pictures": n_pics, "pages": pages}


def render_source(extracted):
    """拼成给模型的课件文本。

    返回 (text, full_chars, truncated)。超长时首尾保留、中间注明省略。
    """
    blocks = []
    for p in extracted["pages"]:
        if not p["text"] and not p["note"]:
            continue
        block = f"【第 {p['index']} 页】\n{p['text']}"
        if p["note"]:
            block += f"\n[备注] {p['note']}"
        blocks.append(block)
    full = "\n\n".join(blocks)
    if len(full) <= MAX_SOURCE_CHARS:
        return full, len(full), False
    head = int(MAX_SOURCE_CHARS * 0.6)
    tail = MAX_SOURCE_CHARS - head
    omitted = len(full) - MAX_SOURCE_CHARS
    trimmed = (
        full[:head]
        + f"\n……（中间省略 {omitted} 字）……\n"
        + full[-tail:]
    )
    return trimmed, len(full), True
