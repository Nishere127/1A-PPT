"""
出图 Skill：根据提示词生成单张图片，由调用方注入 image_caller，本模块不包含 API 联通逻辑。
"""

from collections.abc import Callable


def generate_image(prompt: str, image_caller: Callable[[str], bytes]) -> bytes:
    """
    调用 image_caller(prompt) 返回图片字节。
    image_caller 由调用方根据出图 API 配置提供，签名为 (prompt: str) -> bytes。
    """
    return image_caller(prompt)
