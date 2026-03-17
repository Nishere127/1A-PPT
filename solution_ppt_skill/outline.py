"""
根据客户信息（+ 可选企业文档）生成解决方案 PPT 大纲。
不依赖具体 LLM 实现：由调用方注入 llm_caller(prompt) -> text。
"""

import json
import re
from collections.abc import Callable


def build_outline_prompt(client_info: str, doc_chunks: list | None = None) -> str:
    """组装生成大纲的 prompt，可选带入企业文档片段。"""
    doc_section = ""
    if doc_chunks:
        parts = []
        for i, chunk in enumerate(doc_chunks[:20], 1):
            title = chunk.get("title") or chunk.get("source") or f"文档{i}"
            content = chunk.get("content") or chunk.get("text") or str(chunk)
            if isinstance(content, str) and len(content) > 800:
                content = content[:800] + "..."
            parts.append(f"【{title}】\n{content}")
        doc_section = "\n\n参考以下企业文档内容（可选用）：\n" + "\n---\n".join(parts) + "\n\n"
    return f"""你是一个专业的售前方案撰写助手。根据下面的客户/场景信息{'与参考文档' if doc_section else ''}，生成一份解决方案 PPT 的大纲。
要求：
1. 严格输出一个 JSON 数组，不要包含任何其他文字、markdown 代码块或说明。
2. 数组长度为 5，即 5 页 PPT。
3. 每一项格式为：{{"title": "本页标题", "points": ["要点1", "要点2", "要点3"]}}
4. 大纲结构建议：第1页封面/主题，第2页需求与痛点，第3页解决方案概述，第4页核心能力/产品，第5页总结与下一步。
5. 内容要贴合客户场景，专业、简洁。
{doc_section}
客户/场景信息：
{client_info}

请直接输出 JSON 数组："""


def generate_outline(client_info: str, llm_caller: Callable[[str], str], doc_chunks: list | None = None) -> list:
    """
    生成解决方案 PPT 大纲。返回 [{"title": "...", "points": ["...", ...]}, ...]，最多 5 项。
    llm_caller: 由调用方注入，签名为 (prompt: str) -> str，内部负责联通具体 LLM/中转，本模块不包含任何 LLM 联通逻辑。
    doc_chunks: 可选，企业文档片段 [{"title","content"}]，用于后续对接 WPS 365 等。
    """
    prompt = build_outline_prompt(client_info, doc_chunks)
    text = llm_caller(prompt)
    if "```" in text:
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    data = json.loads(text)
    if not isinstance(data, list):
        data = [data]
    return data[:5]
