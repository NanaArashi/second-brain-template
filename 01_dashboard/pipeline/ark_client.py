# -*- coding: utf-8 -*-
"""火山方舟豆包调用（标准库 urllib）。

复刻 01_dashboard/news/fetch.mjs 的约定：
- thinking 关闭、response_format=json_object、temperature 0.3、max_tokens 16384；
- JSON 解析前清洗字符串内原始控制字符、去掉 ```json 围栏；
- 解析失败重试 1 次；原始返回落 last-raw.txt 备查。
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

from pipeline_config import (
    ARK_MODEL,
    ARK_URL,
    DATA_DIR,
    MAX_TOKENS,
    REQUEST_TIMEOUT_SEC,
    TEMPERATURE,
)


def _sanitize_json(s):
    """转义字符串字面量内未转义的换行 / 回车 / 制表符。"""
    out = []
    in_str = False
    esc = False
    for c in s:
        if esc:
            out.append(c)
            esc = False
            continue
        if c == "\\":
            out.append(c)
            esc = True
            continue
        if c == '"':
            in_str = not in_str
            out.append(c)
            continue
        if in_str and c in ("\n", "\r", "\t"):
            out.append({"\n": "\\n", "\r": "\\r", "\t": "\\t"}[c])
            continue
        out.append(c)
    return "".join(out)


def _post(body_dict):
    data = json.dumps(body_dict).encode("utf-8")
    req = urllib.request.Request(
        ARK_URL,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {os.environ.get('ARK_API_KEY', '')}",
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as r:
        return json.loads(r.read().decode("utf-8"))


def run_ark(prompt, system=""):
    """调方舟，返回解析后的 dict。失败抛 RuntimeError。"""
    if not os.environ.get("ARK_API_KEY"):
        raise RuntimeError("未配置 ARK_API_KEY 环境变量")

    body = {
        "model": ARK_MODEL,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": system
                or "你是学科助教，只输出符合给定 JSON 结构的结果，不要输出 JSON 以外的解释或代码块。",
            },
            {"role": "user", "content": prompt},
        ],
    }

    last_err = None
    content = ""
    for attempt in (1, 2):
        try:
            j = _post(body)
            choice = (j.get("choices") or [{}])[0]
            content = (choice.get("message") or {}).get("content") or ""
            raw = re.sub(r"^```json\s*|\s*```$", "", content.strip())
            cleaned = _sanitize_json(raw)
            return json.loads(cleaned)
        except Exception as e:  # 网络 / HTTP / JSON 解析都走重试
            last_err = e
            try:
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                (DATA_DIR / "last-raw.txt").write_text(content or str(e), encoding="utf-8")
            except Exception:
                pass
            if attempt < 2:
                time.sleep(3)
                continue
            break
    raise RuntimeError(f"方舟调用失败：{last_err}")
