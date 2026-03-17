"""
出图 Skill：提示词出图 + 已出图导出为 PPT。
可被任意 Agent 挂载；出图 API 由调用方通过 image_caller 注入。
"""

from image_gen_skill.generate import generate_image
from image_gen_skill.ppt_export import ensure_blank_template, export_images_to_ppt

__all__ = [
    "generate_image",
    "export_images_to_ppt",
    "ensure_blank_template",
]
