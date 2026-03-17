"""
出图工具 API：提供 /api/generate-image 与 /api/export-ppt，供前端调用。
运行方式（在项目根目录）：uvicorn api.main:app --reload --host localhost --port 8000
"""

import base64
import os
import sys
import tempfile
from pathlib import Path

# 确保项目根在 path 中，便于导入 image_adapter、image_gen_skill
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import json
import re

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from doc_parse import parse_document_bytes
from image_adapter import generate_image as image_adapter_generate_image
from image_gen_skill import export_images_to_ppt
from llm_adapter import call_llm

# 出图 Skill 内置固定风格（追加到每条 generate-image 提示词末尾，保证画面统一）
# 质感补丁 + 设计思路：自动前缀/质感词 + 显式负面，弥补「直译」与「单次生成」的差距（见 docs/画图Skill与设计思路比对.md）
IMAGE_STYLE_SUFFIX = (
    "作为顶尖的视觉设计总监，画面风格固定为：科技、商务、线条感、渐变、磨砂玻璃质感、2.5D 插图；"
    "高质感：清晰边缘、细腻渐变、专业排版感，sharp focus, highly detailed, 8k resolution, professional design, clean composition，避免模糊或廉价感。"
    "配色仅四种：白色背景、蓝色主色、紫色强调、灰色作说明或辅助，不要出现第五种主色。"
    "不要：模糊、低质量、水印、签名、业余感、草图感、裁切不当。"
)

# 与 IMAGE_STYLE_SUFFIX 同一套约束 —— 文档→提示词基模必须在每一张的【基本设定】里遵守，避免全稿色系乱
# 画图 Skill 优化：高质感正向 + 负向约束，与出图端后缀一致
IMAGE_SKILL_VISUAL_CONTRACT = """
## 【全稿强制】与出图 Skill 一致的视觉契约（每一张 PPT 提示词都必须遵守）

**正向（高质感）**
- **画风**（与出图接口自动追加的后缀一致）：科技、商务、线条感、渐变、磨砂玻璃质感、2.5D 插图；画面需**高质感**：清晰边缘、细腻渐变、专业排版感，适合投屏与印刷。
- **配色只允许四系**，全稿统一：
  1. **背景**：白或极浅灰 —— 如 `#FFFFFF`、`#F8FAFC`
  2. **主色（蓝）**：全稿只选一种蓝作主色 —— 如 `#2563EB` 或 `#1976D2` 或 `#1E40AF`（每张的标题、主图形描边、主按钮同色）
  3. **强调（紫）**：如 `#7C3AED`、`#6366F1`（高亮、次要强调）
  4. **说明/辅文/分割线（灰）**：如 `#64748B`、`#6B7280`、`#334155`
- **卡片/浅底**只允许上述四系的极浅变体：如浅蓝底 `#EFF6FF`、浅紫底 `#F5F3FF`、浅灰 `#F1F5F9`。
- 画面内出现的文字须为**可上屏短句**（来自文档的短语、金句或数据标签），可直接作为 PPT 上的文案，勿泛泛描述；每张提示词需**高密度**、可直接交给文生图执行。

**负向约束（禁止）**
- **禁止**仅写主题/人物/环境/色彩/构图等分镜式大纲；必须写出【基本设定】【布局结构】【分区元素】级描述，含分区占比与可上屏短句，形成单页 PPT 规格书。
- **禁止**每页换一套主色、**禁止**第五种主色大块出现；**禁止**大面积绿/橙/红作主色块（警示可用小面积红橙图标即可）。
- **禁止**模糊、低分辨率感、杂乱堆砌、与文档无关的装饰；每页信息密度高、可落地为画面。
- 每张【基本设定】里写 HEX 时按上表填写，与前后张一致。

**叙事逻辑 → 排版布局映射（写【布局结构】时必用，画风仍为上文 2.5D/线条/磨砂玻璃/渐变，不因版式改变）**
先判断本页的**叙事类型**，再选用对应的**布局结构**；一页一观点。
- **封面** → 全宽主视觉 + 主标题区 + 副标题块；页眉占比约 1/5～1/4。
- **情境/现状** → 左文右图或全幅数据，建立共识。
- **冲突/问题** → 对比数据、量化风险或机会，制造紧迫感；可用左右对比或上下分块。
- **建议/结论** → 3～5 条行动，带优先级或负责人；论点驱动：顶部 Action Title（完整结论句）+ 下方要点；或编号列表 + 简短说明。
- **执行摘要** → 左主右副：左侧核心结论文字，右侧关键图表或 KPI 卡片。
- **目录/议程** → 极简列表，主要章节 + 页码导航。
- **章节分隔** → 大字号章节标题 + 细分割线，可配全幅图占位。
- **MECE 拆解 / 方案对比** → 2 栏或 3 栏；每栏顶部深色块小标题 + 精炼要点；4 栏/6 栏用于流程步骤或业务模块。
- **定量数据** → 全幅图表或左图右文/下图上文；瀑布/甘特/气泡/趋势图须有 Call-out 指向核心发现；左下角可留数据来源（Source）。
- **战略/逻辑框架** → 2×2 矩阵、金字塔层级、环形/飞轮、价值链、逻辑树、7S 等；中央放射或层级连线。
- **流程/时间** → 横向时间轴或环形步骤，箭头与阶段色块；阶梯递进时用阶梯式上升布局。
- **对比/权衡** → 并列对比（左右或上下对称）、三列竞品 vs 我们、或天平式左右平衡。
- **案例/证言** → 左客户 Logo 或行业图标，右数据成果与客户证言；before/after 或数字高亮。
- **附录** → 支撑数据、方法论说明；多栏或全文本，留白充足。
排版时：严格对齐与留白，关键页标注来源与页码；**分区、占比、信息层级由上述映射决定，视觉风格（2.5D、线条感、磨砂玻璃、渐变、半透明）始终遵守本契约「正向」约定。**
"""

# 顶尖解决方案 PPT 架构师（独立 Skill）：勾选时在写提示词 prompt 前注入，方法论约束；视觉仍遵守后文视觉契约。
# 设计依据：麦肯锡/BCG/Duarte 方法论，侧重结构化约束+故事线+正反例+页面类型，见 docs/解决方案架构师Skill分析与优化建议.md
SOLUTION_ARCHITECT_SKILL = """
你是 **顶尖解决方案 PPT 架构师**，融合麦肯锡、BCG、Duarte 的方法论。**核心原则**：先问「客户看完这页会做什么决定？」，再问「这页要放什么内容」。在撰写每张 PPT 提示词之前，请先运用以下原则规划结构与叙事，再交给后文的「企业级 PPT 配图专家」格式输出；**视觉**（画幅 16:9、四色、2.5D）必须遵守后文「视觉契约」，不在此处重复。

**输入与故事线**
- 动笔前先做：受众（决策者层级与背景）、目标（看完后应采取的具体行动）、冲突（痛点与认知鸿沟）、数据清单。
- **禁止直接开始写单页**。先按标准故事线规划：封面 → 危机/痛点 → 愿景 → 解决方案 → 技术/产品 → 实施路径 → 价值论证 → 行动号召，再落到每页。

**SCQA**：情境—冲突—问题—答案，用于引言与破题页。
**MECE**：不重不漏拆解论点；每页一个核心主张，避免堆砌。

**Action Title**：每页标题必须是完整结论句，禁止名词式标签。❌ 错误：「市场分析」「产品优势」。✅ 正确：「市场规模达千亿，但碎片化导致效率损失 40%」「AI Docs 通过原生权限架构实现零成本知识迁移」。标题建议 20 字以内。

**逻辑破局 → FAB**：从问题/现状抓核心矛盾（出血点），再做价值建模。❌ 错误：「支持 VLM 插件」。✅ 正确：「凭借 VLM 视觉解析引擎（F），能深度理解研报复杂图表（A），从而将分析师录入时间缩短 80%（B）」。

**叙事可视化与页面类型**：按页选择类型并体现在【布局结构】与主视觉描述中。
- **对比型**：竞品 PK、前后对比 → 三列对比、左文右图。
- **层进型**：ROI 金字塔、阶段递进 → 时间轴、分层金字塔。
- **神经元型**：技术/架构关系 → 中央放射、连接线。
对应页面倾向：洞察页（左文右图/结论在上）；架构页（中央放射/金字塔）；流程页（时间轴/环形步骤）；对比页（三列对比）；案例页（数据+证言）。

**溯源与核查**：关键数据与 ROI 必须可追溯，标注为「该数据来源于 [文档名] 第 X 页」或等价出处，避免无出处断言。

**风格禁令**：专业、干练；多用动词（击穿、赋能、重塑），少用形容词（非常好的、强大的）；严禁「等等」「相关内容」等模糊词；每页信息密度高、可落地为画面。

你只负责方法论与故事线级规划；具体每页的【基本设定】【布局结构】【分区元素】由后文「企业级 PPT 配图专家」按固定格式输出。
"""

import logging

logging.getLogger("uvicorn.access").setLevel(logging.INFO)
# 访问日志仅一行「客户端IP:临时端口 → 本服务:8000」，不记录 Body，Key 不会进日志

app = FastAPI(title="出图工具 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 请求/响应模型 ----------


class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="出图提示词")
    api_key: str = Field(..., min_length=1, description="出图 API Key")
    base_url: str | None = Field(default=None, description="Base URL，留空为官方")
    model: str | None = Field(default=None, description="模型名，如 dall-e-2")
    ssl_verify: bool | None = Field(default=True, description="拉取图片时是否校验 SSL")
    n: int = Field(1, ge=1, le=20, description="单次出图张数，1～20（部分模型仅支持 n=1，如 dall-e-3）")
    # 为 true 且正文含多段「第N张PPT」时，服务端按段逐张出图；某张失败仍返回已成功张，避免已扣费却整张不落盘
    expand_slides: bool = Field(
        default=True,
        description="多段 PPT 时服务端逐张出图；失败时部分返回（建议保持 true）",
    )
    size: str | None = Field(
        default=None,
        description="OpenAI/DALL·E 用 WxH，如 1792x1024。Gemini 类请传 aspect_ratio。",
    )
    aspect_ratio: str | None = Field(
        default=None,
        description="Gemini/GenerateContent 出图必填枚举：1:1、16:9、9:16 等；传则优先按该格式请求，不传则仅用 size（OpenAI）。",
    )


def resolve_image_size(explicit: str | None) -> str:
    """出图像素尺寸由调用方或环境决定，禁止在业务里写死 1:1。"""
    s = (explicit or "").strip().lower().replace("×", "x")
    if s and re.match(r"^\d{2,4}x\d{2,4}$", s):
        return s
    env = (os.environ.get("IMAGE_GENERATION_SIZE") or "").strip().lower()
    if env and re.match(r"^\d{2,4}x\d{2,4}$", env):
        return env
    return "1792x1024"


def resolve_aspect_ratio(explicit: str | None) -> str | None:
    s = (explicit or "").strip()
    if not s:
        return None
    allowed = (
        "1:1 1:4 1:8 2:3 3:2 3:4 4:1 4:3 4:5 5:4 8:1 9:16 16:9 21:9".split()
    )
    return s if s in allowed else None


def split_prompt_into_slides(raw: str) -> list[str]:
    t = (raw or "").strip()
    if not t:
        return []
    by_ppt = re.split(
        r"(?=(?:^|\r?\n)[^\n]{0,60}第\s*\d+\s*张\s*PPT)", t, flags=re.IGNORECASE | re.MULTILINE
    )
    by_ppt = [s.strip() for s in by_ppt if s.strip()]
    if len(by_ppt) < 2:
        by_ppt = re.split(r"(?=第\s*(?:[2-9]|\d{2,})\s*张\s*PPT)", t, flags=re.IGNORECASE)
        by_ppt = [s.strip() for s in by_ppt if s.strip()]
    if len(by_ppt) >= 2:
        return by_ppt
    parts = re.split(r"(?=第\s*\d+\s*页)", t)
    chunks: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if re.match(r"^第\s*\d+\s*页", part):
            chunks.append(part)
        elif not chunks:
            chunks.append(part)
        else:
            chunks[-1] = chunks[-1] + "\n\n" + part
    if len(chunks) >= 2:
        return chunks
    return [t]


class GenerateImageResponse(BaseModel):
    images: list[str] = Field(..., description="图片 base64 列表，与请求 n 一致或更少")
    image_base64: str | None = Field(
        default=None,
        description="兼容旧客户端：仅第一张，与 images[0] 相同",
    )
    partial_warning: str | None = Field(
        default=None,
        description="多段出图未全部成功时说明（已成功张仍在 images 里）",
    )


class ExportPptItem(BaseModel):
    prompt: str = Field(default="", description="该图对应提示词/标题")
    image_base64: str = Field(..., min_length=1, description="图片 base64")


class ExportPptRequest(BaseModel):
    items: list[ExportPptItem] = Field(..., min_length=1, description="要导出的图片列表")


# ---------- 路由 ----------


@app.post("/api/generate-image", response_model=GenerateImageResponse)
def generate_image_endpoint(body: GenerateImageRequest):
    """
    单次出图；若 expand_slides 且正文含多段「第N张PPT」，服务端按段逐张出图。
    **部分成功**：前面已成的图一律返回，仅后续失败时带 partial_warning（避免已扣费却 502 空返回）。
    """
    api_config = {
        "api_key": body.api_key.strip(),
        "base_url": (body.base_url or "").strip() or None,
        "model": (body.model or "").strip() or None,
        "ssl_verify": body.ssl_verify if body.ssl_verify is not None else True,
    }
    n = min(max(body.n, 1), 20)
    size = resolve_image_size(body.size)
    aspect_ratio = resolve_aspect_ratio(body.aspect_ratio)
    chunks = split_prompt_into_slides(body.prompt)
    multi = body.expand_slides and len(chunks) >= 2
    all_raw: list[bytes] = []
    partial_warning: str | None = None

    if multi:
        per = min(180.0, 90.0 + 25.0 * len(chunks))
        for i, chunk in enumerate(chunks):
            full_prompt = (chunk + IMAGE_STYLE_SUFFIX).strip()
            try:
                imgs = image_adapter_generate_image(
                    full_prompt,
                    api_config,
                    n=1,
                    size=size,
                    aspect_ratio=aspect_ratio,
                    timeout_sec=per,
                )
            except Exception as e:
                msg = safe_detail(str(e))
                if all_raw:
                    partial_warning = (
                        f"第 {i + 1}/{len(chunks)} 张起失败（已返回前 {len(all_raw)} 张，钱若已扣请联系渠道对账）。原因摘要：{msg[:300]}"
                    )
                    log.warning("出图部分成功 %d 张后失败: %s", len(all_raw), msg[:200])
                    break
                raise HTTPException(status_code=502, detail=msg)
            if not imgs:
                if all_raw:
                    partial_warning = (
                        f"第 {i + 1}/{len(chunks)} 张上游未返回图（已返回前 {len(all_raw)} 张）。"
                    )
                    break
                raise HTTPException(
                    status_code=502,
                    detail=f"第 {i + 1}/{len(chunks)} 张未返回图；请查余额/配额。",
                )
            all_raw.extend(imgs)
        if not all_raw:
            raise HTTPException(status_code=502, detail="出图均未成功。")
        b64_list = [base64.b64encode(b).decode("ascii") for b in all_raw]
        return GenerateImageResponse(
            images=b64_list,
            image_base64=b64_list[0],
            partial_warning=partial_warning,
        )

    timeout_sec = min(60.0 + 15.0 * (n - 1), 180.0)
    full_prompt = (body.prompt.strip() + IMAGE_STYLE_SUFFIX).strip()
    try:
        images = image_adapter_generate_image(
            full_prompt,
            api_config,
            n=n,
            size=size,
            aspect_ratio=aspect_ratio,
            timeout_sec=timeout_sec,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        msg = safe_detail(str(e))
        if "nodename nor servname" in msg or "Name or service not known" in msg:
            msg += "（多为 Base URL 域名不可解析，如 silira / silra 拼写）"
        raise HTTPException(status_code=502, detail=msg)

    if not images:
        raise HTTPException(
            status_code=502,
            detail="出图接口未返回图片。可检查 Base URL、余额/配额，或按「第N张PPT」分块逐张请求。",
        )
    b64_list = [base64.b64encode(b).decode("ascii") for b in images]
    return GenerateImageResponse(
        images=b64_list,
        image_base64=b64_list[0] if b64_list else None,
        partial_warning=None,
    )


@app.post("/api/export-ppt")
def export_ppt_endpoint(body: ExportPptRequest):
    """将多张图片导出为 PPT，返回二进制文件。"""
    image_items: list[dict] = []
    for it in body.items:
        try:
            raw = base64.b64decode(it.image_base64)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"无效的图片 base64: {e}")
        image_items.append({"bytes": raw, "prompt": (it.prompt or "").strip()})

    out_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pptx", delete=False) as f:
            out_path = f.name
        export_images_to_ppt(image_items, out_path, base_dir=_ROOT)
        with open(out_path, "rb") as f:
            content = f.read()
        Path(out_path).unlink(missing_ok=True)
    except Exception as e:
        if out_path:
            Path(out_path).unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=safe_detail(str(e)))

    from fastapi.responses import Response

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": "attachment; filename=images_export.pptx"},
    )


def safe_detail(msg: str) -> str:
    """HTTP 响应 detail 脱敏：不把 Key、Token 等写回客户端。"""
    if not msg or not isinstance(msg, str):
        return "请求失败，请检查配置与网络。"
    lower = msg.lower()
    needles = (
        "api_key",
        "apikey",
        "sk-",
        "aiza",  # AIza* Gemini key
        "bearer ",
        "authorization",
        "secret",
        "invalid_api_key",
        "incorrect api key",
    )
    for n in needles:
        if n in lower:
            return "上游或配置异常，请检查 Key / Base URL / 模型名（详情已隐藏）。"
    return msg[:500] if len(msg) > 500 else msg


@app.get("/api/health")
def health():
    return {"status": "ok"}


MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100MB；大文件建议先 extract 再 document_text，避免单次 POST 过久
# 送入「文档→提示词」LLM 的正文上限（字符）。10 万字符量级可覆盖多数长工作文档；更长仍会被截断并标注。
DOC_TEXT_MAX_CHARS = 100_000

log = logging.getLogger("api.document")


@app.post("/api/extract-document-text")
async def extract_document_text(file: UploadFile = File(...)):
    """仅解析正文并截断，不调用 LLM。大 PDF 可先调本接口，再把返回的 text 交给 document-to-prompts。"""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限",
        )
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    try:
        text = parse_document_bytes(raw, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="未能从文件中提取到文本（扫描版 PDF 需 OCR）")
    truncated = len(text) > DOC_TEXT_MAX_CHARS
    if truncated:
        text = text[:DOC_TEXT_MAX_CHARS] + "\n…（已截断）"
    return {"text": text, "truncated": truncated}


@app.post("/api/document-to-prompts")
async def document_to_prompts(
    file: UploadFile | None = File(None),
    llm_api_key: str = Form(...),
    llm_base_url: str = Form(""),
    llm_model: str = Form(""),
    user_context: str = Form(""),
    document_text: str = Form(""),
    use_solution_architect: str = Form("false"),
):
    """
    文档 + 用户说明 → 16:9 PPT 用高密度出图提示（按张/按节输出）。
    大文件建议：先 POST /api/extract-document-text，再本接口只传 document_text。
    """
    doc_block = ""
    document_text = (document_text or "").strip()
    if document_text:
        t = document_text[:DOC_TEXT_MAX_CHARS] + (
            "\n…（正文已截断，最长 " + str(DOC_TEXT_MAX_CHARS) + " 字）"
            if len(document_text) > DOC_TEXT_MAX_CHARS
            else ""
        )
        doc_block = f"\n\n【文档正文】\n{t}\n"
    elif file is not None and file.filename:
        raw = await file.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="超过 100MB 上限")
        if raw:
            try:
                text = parse_document_bytes(raw, file.filename)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            text = (text or "").strip()
            if text:
                if len(text) > DOC_TEXT_MAX_CHARS:
                    text = (
                        text[:DOC_TEXT_MAX_CHARS]
                        + f"\n…（正文已截断，最长 {DOC_TEXT_MAX_CHARS} 字）"
                    )
                doc_block = f"\n\n【文档正文】\n{text}\n"
    user_context = (user_context or "").strip()
    if not doc_block and not user_context:
        raise HTTPException(
            status_code=400,
            detail="请填写补充说明，或上传文档（.txt / .md / .pdf）",
        )
    if not user_context:
        user_context = (
            "（用户未额外说明：请通读文档，按章节结构拆成多张 16:9 PPT 出图提示，"
            "每章/每节至少一张，信息写满。）"
        )
    use_architect = (use_solution_architect or "").strip().lower() == "true"
    only_prompt_no_doc = not doc_block
    input_note = (
        "- **本次无文档**：仅根据【用户补充说明】拆成多张 16:9 PPT 出图提示，每张独立一块。\n"
        if only_prompt_no_doc
        else ""
    )
    user_prompt = f"""你是 **企业级 PPT 配图 / 整页视觉** 提示词专家。交付物用于 **16:9 幻灯片**（1920×1080）的文生图；写出后会被 **同一套出图 Skill** 调用，因此提示词里的色系与画风必须与出图端追加的固定风格 **完全一致**，否则成图会花、会乱。

{IMAGE_SKILL_VISUAL_CONTRACT}

## 输入
{input_note}- 【用户补充说明】：页数意图、风格、必须出现的论点或金句等。
- 【文档正文】：完整工作文档（可能很长），你必须 **自己归纳章节结构**，再为 **每一张要出的 PPT** 写 **独立一块** 提示词。

## 输出格式（强制）
1. **按张、按节输出**：每一张 PPT 单独一块，块与块之间用一行分隔线，格式如下（必须保留「第N张PPT」行，便于程序按页出图）：

---------- 第1张PPT：〈本页标题，如 引言—危机诊所〉 ----------
【基本设定】
- 画幅：16:9，1920×1080
- 背景、主色（蓝）、强调（紫）、辅文（灰）：**仅允许上文「视觉契约」四系 + 极浅变体**，每张写明 HEX 且全稿统一
- 文字主色以深灰 `#334155` / `#1E293B` 为主，标题可用主色蓝

【布局结构】
- 自上而下或分区的 **占比**（如顶部标题区约 12%～18% 高；中央主视觉；底部论证区/三卡等）
- 左文右图 / 全幅主视觉 / 三列卡片区等，写清

【分区元素】（信息密度要高，可直接照着生成）
- **顶部标题区**：主标题原文（可来自文档）、副标题、建议字号层级（如主标题 36～44px 量级描述即可）
- **主视觉区**：具体画什么（示意图、隐喻、数据流、孤岛/闭环等），**细节到可画**：元素清单、相对位置、关键标签文案（短句，来自文档）
- **底部或侧栏**：若有三列卡片/要点，每张卡：小标题 + 一句论证文案（摘自或压缩文档，勿空泛）
- **风格**：与整份 PPT 统一（扁平 2.5D / 商务插画 / 磨砂玻璃等），写一句即可

然后下一张：

---------- 第2张PPT：〈章节名〉 ----------
（同上结构，以此类推）

2. **章数与张数**：
   - 若【用户补充说明】或【文档正文】中出现了明确的页数/章节数意图（例如「做 30 页 PPT」「共 18 页」「分成 4 章、每章 3～4 页」等），你必须先理解这类约束，并在合理范围内尽量对齐（必要时可以略微调整单章页数，使整体结构更顺畅，但总页数应接近用户/文档要求）。
   - 若用户和文档都**未**给出明确页数/章节数，则根据文档长度与章节结构自行规划，总页数**通常控制在 20～30 页**：
     - 关键章节（如「现状/危机」「方案总览」「实施路线」「价值/ROI」等）可各 2～3 页；
     - 细节章节（如功能拆解、附录）可合并或精简为 1～2 页；
     - 始终遵守「每页信息满」「不要几张图糊成一段散文」，而不是为了凑页数空白填充。
   - 无论哪种情况，都优先按文档的 **一级/二级标题** 拆分结构，必要时可将一大节拆成多页（每页聚焦一个核心论点）。
3. **禁止**：输出 HTML、`<!doctype`、整页网页代码；不要空泛形容词堆砌而无具体物体与文案。
4. **允许**：Markdown 小标题、列表；引用文档中的关键短语作画面内文字说明。

【用户补充说明】
{user_context}
{doc_block}
"""
    if use_architect:
        user_prompt = SOLUTION_ARCHITECT_SKILL.strip() + "\n\n" + user_prompt
    llm_cfg = {
        "api_key": llm_api_key.strip(),
        "base_url": (llm_base_url or "").strip() or None,
        "model": (llm_model or "").strip() or None,
    }
    try:
        out = call_llm(user_prompt, llm_cfg, max_retries=2, timeout_sec=600.0)
    except Exception as e:
        log.exception("document_to_prompts LLM 失败（已打栈，不含 Key）")
        msg = str(e)
        if "nodename nor servname" in msg or "ConnectError" in type(e).__name__:
            raise HTTPException(
                status_code=502,
                detail="无法连接 LLM 服务：本机 DNS 解析失败或 Base URL 不可达。请检查侧栏「LLM Base URL」（如 https://api.silira.cn/v1）、网络与代理。",
            )
        if "APIConnectionError" in type(e).__name__ or "Connection error" in msg:
            raise HTTPException(
                status_code=502,
                detail="无法连接大模型接口（网络/防火墙/URL）。请确认 LLM Base URL 在浏览器或可 curl 访问。",
            )
        raise HTTPException(status_code=502, detail=safe_detail(msg))
    raw_out = (out or "").strip()
    # 去掉误生成的 HTML 头行；若删光则退回原文，避免误报 502
    lines = []
    for line in raw_out.splitlines():
        s = line.strip()
        if s.lower().startswith("<!doctype") or s.lower() == "<html":
            continue
        if s.startswith("<") and s.endswith(">") and len(s) < 80:
            continue
        lines.append(line)
    content = "\n".join(lines).strip() or raw_out
    if len(content) < 10:
        raise HTTPException(
            status_code=502,
            detail="模型几乎无有效正文；请换模型或在说明里要求「只写画面描述、不要代码」",
        )
    if len(content) > 200_000:
        content = content[:200_000] + "\n…（输出已截断）"
    return {"content": content}


def _fuse_direct_image_prompt(user_context: str, doc_text: str | None, llm_cfg: dict) -> str:
    """分支②：不展示中间提示词时，由 LLM 把用户说明 + 文档压成一段文生图描述。"""
    doc_part = ""
    if doc_text and doc_text.strip():
        t = doc_text.strip()
        if len(t) > DOC_TEXT_MAX_CHARS:
            t = t[:DOC_TEXT_MAX_CHARS] + "\n…"
        doc_part = f"\n\n【文档正文】\n{t}\n"
    prompt = f"""你是文生图提示词撰写助手。根据【用户要求】与【文档正文】（若有），写出**唯一一段**可直接用于文生图的画面描述（中文，80～300 字），要具体可视化，不要列条、不要 markdown、不要前缀说明。

【用户要求】
{user_context.strip()}
{doc_part}
只输出这一段描述本身。"""
    out = call_llm(prompt, llm_cfg, max_retries=2, timeout_sec=90.0)
    line = (out or "").strip()
    line = re.sub(r"^[\"']|[\"']$", "", line).strip()
    if len(line) < 15:
        raise HTTPException(status_code=502, detail="模型未能生成有效出图描述")
    return line[:2000]


@app.post("/api/direct-generate", response_model=GenerateImageResponse)
async def direct_generate(
    user_context: str = Form(...),
    file: UploadFile | None = File(None),
    llm_api_key: str = Form(""),
    llm_base_url: str = Form(""),
    llm_model: str = Form(""),
    api_key: str = Form(...),
    base_url: str = Form(""),
    model: str = Form(""),
    ssl_verify: str = Form("true"),
    n: int = Form(1),
    size: str = Form(""),
    aspect_ratio: str = Form(""),
):
    """
    分支②：直接出图（用户不经过「生成多条提示词 → 确认」）。
    - 仅有用户说明：以此出图（Skill 内追加固定画风）。
    - 有上传文档：须填 LLM 配置，服务端解析文档后与说明融合为一段再出图。
    """
    user_context = (user_context or "").strip()
    doc_text: str | None = None
    if file is not None and file.filename:
        raw = await file.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="超过 100MB 上限")
        if raw:
            try:
                doc_text = parse_document_bytes(raw, file.filename)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            doc_text = (doc_text or "").strip() or None

    if not user_context and not doc_text:
        raise HTTPException(status_code=400, detail="请填写说明或上传文档")

    if doc_text and not user_context:
        user_context = "根据文档内容生成合适的配图场景。"

    if doc_text:
        if not (llm_api_key or "").strip():
            raise HTTPException(
                status_code=400,
                detail="已上传文档时直接出图需要 LLM API Key，用于合并文档与说明",
            )
        llm_cfg = {
            "api_key": llm_api_key.strip(),
            "base_url": (llm_base_url or "").strip() or None,
            "model": (llm_model or "").strip() or None,
        }
        try:
            image_prompt = _fuse_direct_image_prompt(user_context, doc_text, llm_cfg)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=safe_detail(str(e)))
    else:
        image_prompt = user_context

    api_config = {
        "api_key": api_key.strip(),
        "base_url": (base_url or "").strip() or None,
        "model": (model or "").strip() or None,
        "ssl_verify": str(ssl_verify).lower() in ("1", "true", "yes"),
    }
    n = min(max(n, 1), 20)
    img_size = resolve_image_size(size or None)
    ar = resolve_aspect_ratio(aspect_ratio or None)
    timeout_sec = min(60.0 + 15.0 * (n - 1), 180.0)
    full_prompt = (image_prompt.strip() + IMAGE_STYLE_SUFFIX).strip()
    try:
        images = image_adapter_generate_image(
            full_prompt,
            api_config,
            n=n,
            size=img_size,
            aspect_ratio=ar,
            timeout_sec=timeout_sec,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=safe_detail(str(e)))
    if not images:
        raise HTTPException(
                status_code=502,
                detail="出图接口未返回图片（上游 data 为空或无法拉图）。请确认正文已按「第N张PPT」分成多块再出图（整篇一次请求易空 data）；或可取消「校验拉图 SSL」、检查 Base URL / Model。",
            )
    b64_list = [base64.b64encode(b).decode("ascii") for b in images]
    return GenerateImageResponse(
        images=b64_list,
        image_base64=b64_list[0] if b64_list else None,
    )
