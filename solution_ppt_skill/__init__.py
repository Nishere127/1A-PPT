"""
解决方案 PPT Skill：面向售前/解决方案，根据客户信息（+ 可选企业文档）生成大纲与 PPT。
可被任意 Agent 挂载；不包含 LLM 联通逻辑，由调用方注入 llm_caller(prompt) -> text。
"""

from collections.abc import Callable

from solution_ppt_skill.outline import generate_outline
from solution_ppt_skill.ppt_builder import create_ppt_from_outline, ensure_blank_template


def generate_solution_ppt(
    client_info: str,
    llm_caller: Callable[[str], str],
    doc_chunks: list | None = None,
    template_path: str | None = None,
    output_path: str | None = None,
):
    """
    一站式：生成大纲并写出 PPT。返回 {"outline": list, "ppt_path": str}。
    llm_caller: (prompt: str) -> str，由调用方根据自身 LLM/中转配置提供。
    """
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent
    outline = generate_outline(client_info, llm_caller, doc_chunks)
    outline = outline[:5]
    tpl = template_path or ensure_blank_template(base)
    out_dir = base / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = output_path or str(out_dir / "solution.pptx")
    create_ppt_from_outline(outline, tpl, path)
    return {"outline": outline, "ppt_path": path}


__all__ = [
    "generate_outline",
    "create_ppt_from_outline",
    "ensure_blank_template",
    "generate_solution_ppt",
]
