# -*- coding: utf-8 -*-
"""SecondBrain 知识库流水线 · 路径与常量配置。

脚本位于 01_dashboard/pipeline/，库根为其上两级。
流水线口径：AI 只读收件箱；收件箱按学科分子目录，脚本按子目录名定科，不猜学科。
"""
import os
from pathlib import Path

# ---- 库内路径 ----
VAULT = Path(__file__).resolve().parent.parent.parent

INBOX = VAULT / "08_materials" / "_收件箱"
DONE = VAULT / "08_materials" / "_已处理"
MATERIALS = VAULT / "08_materials"
SUBJECTS_ROOT = VAULT / "07_subjects"
INDEX = SUBJECTS_ROOT / "_索引.md"

# 学科目录名；留空则流水线按 07_subjects 下实际目录处理。08_materials 与 07_subjects 两层目录名需一致。
SUBJECTS = []

# 第一版只解析 pptx；pdf / 图片留在收件箱并提示，不调模型
SUPPORTED_EXTS = {".pptx"}
SKIP_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".md", ".txt"}

# ---- 库外运行数据（日志 / 锁 / 模型原始返回），与资讯线 ~/.secondbrain-news 同惯例 ----
DATA_DIR = Path(os.environ.get("SB_KB_DIR", str(Path.home() / ".secondbrain-kb")))

# ---- 方舟模型约定（复刻 01_dashboard/news/fetch.mjs）----
ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
ARK_MODEL = os.environ.get("SB_ARK_MODEL", "doubao-seed-evolving")  # 旧默认 turbo: doubao-seed-2-1-turbo-260628
MAX_TOKENS = 16384
TEMPERATURE = 0.3
REQUEST_TIMEOUT_SEC = 8 * 60

# 复习间隔（天），stage 索引：0→1，1→2，2→4，3→7，4→15
REVIEW_INTERVALS = [1, 2, 4, 7, 15]

# 课件解析文本总字数封顶；超出则首尾保留、中间省略
MAX_SOURCE_CHARS = 24000

# 锁过期时间（秒）：超过视为上次异常退出
LOCK_STALE_SEC = 15 * 60
LOG_MAX_LINES = 200
