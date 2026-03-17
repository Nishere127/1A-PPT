"""
LLM 适配层（与 PPT Skill 解耦）：负责根据配置联通各类大模型/中转。
由前端或 Agent 使用，再将要用的「调用函数」注入给 PPT Skill，Skill 内不包含任何 LLM 联通逻辑。
"""

import os
import re
import time
from urllib.parse import urlparse

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    from google import genai
except Exception:
    genai = None


def _normalize_base_url(base_url: str) -> str:
    """OpenAI 客户端会自行追加 /chat/completions，若用户填了完整路径则截取 base。"""
    u = (base_url or "").strip()
    if not u:
        return ""
    if "/chat/completions" in u.rstrip("/"):
        u = u.rstrip("/").rsplit("/chat/completions", 1)[0].rstrip("/") or u
    return u


def _use_native_gemini(api_config: dict) -> bool:
    """仅当显式选 Gemini 且 Key 为 AIza、base_url 为空时用 Gemini SDK，否则一律走 OpenAI 兼容。"""
    provider = (api_config.get("provider") or "openai").strip().lower()
    if provider != "gemini":
        return False
    key = (api_config.get("api_key") or "").strip()
    base_url = (api_config.get("base_url") or "").strip()
    if not key.startswith("AIza"):
        return False
    if base_url:
        return False
    return True


class LLMTimeoutError(Exception):
    """请求大模型超时，便于调用方记录错误码与日志。"""
    def __init__(self, message: str, timeout_sec: float):
        super().__init__(message)
        self.timeout_sec = timeout_sec


def _text_from_openai_response(resp) -> str:
    """兼容 OpenAI 标准对象、部分中转直接返回 str、或非标准 JSON。"""
    if resp is None:
        return ""
    if isinstance(resp, str):
        s = resp.strip()
        if s.startswith("{") and '"choices"' in s:
            try:
                import json
                d = json.loads(s)
                ch = d.get("choices") or []
                if ch and isinstance(ch[0], dict):
                    msg = ch[0].get("message") or {}
                    c = msg.get("content")
                    if isinstance(c, str):
                        return c.strip()
            except Exception:
                pass
        return s
    choices = getattr(resp, "choices", None)
    if choices and len(choices) > 0:
        msg = getattr(choices[0], "message", None) or {}
        if isinstance(msg, dict):
            return (msg.get("content") or "").strip()
        content = getattr(msg, "content", None) if msg else None
        return (content or "").strip() if isinstance(content, str) else ""
    return ""


def call_llm(prompt: str, api_config: dict, max_retries: int = 2, timeout_sec: float = 120.0) -> str:
    """
    根据 api_config 联通对应大模型，发送 prompt 并返回模型文本。
    api_config: {"api_key", "base_url", "model", "provider"}
    timeout_sec: 单次请求超时秒数，超时抛 LLMTimeoutError，便于前端/Agent 提示与日志错误码。
    """
    cfg = api_config or {}
    api_key = (cfg.get("api_key") or "").strip() or os.environ.get("API_KEY", "") or os.environ.get("OPENAI_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_GENAI_API_KEY", "")
    if not api_key:
        raise ValueError("请提供 api_key（或在环境变量 API_KEY / OPENAI_API_KEY 等中配置）")
    base_url = (cfg.get("base_url") or "").strip()
    model = (cfg.get("model") or "").strip()

    def _gemini_call():
        if genai is None:
            raise RuntimeError("使用 Gemini 官方需安装: pip install google-genai")
        client = genai.Client(api_key=api_key)
        model_name = model or "gemini-2.0-flash"
        response = client.models.generate_content(model=model_name, contents=prompt)
        text = getattr(response, "text", None) or ""
        if not text and getattr(response, "candidates", None):
            parts = response.candidates[0].content.parts if response.candidates else []
            text = (parts[0].text if parts else "") or ""
        return (text or "").strip()

    # Gemini 路径：主线程同步调用，避免 ThreadPoolExecutor 与 Streamlit 的 asyncio 事件循环冲突导致 RuntimeError: Event loop is closed
    if _use_native_gemini(cfg):
        last_err = None
        for attempt in range(max_retries):
            try:
                return _gemini_call()
            except Exception as e:
                last_err = e
                err_str = str(e)
                if attempt < max_retries - 1 and ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower()):
                    match = re.search(r"retry in (\d+(?:\.\d+)?)\s*s", err_str, re.I)
                    wait = min(float(match.group(1)) + 1, 30) if match else 15
                    time.sleep(wait)
                    continue
                raise last_err
        raise last_err

    # OpenAI 兼容（含任意中转）
    if OpenAI is None:
        raise RuntimeError("请安装: pip install openai（适用绝大多数大模型与中转）")
    openai_base = _normalize_base_url(base_url) or "https://api.openai.com/v1"
    if openai_base and openai_base != "https://api.openai.com/v1":
        try:
            p = urlparse(openai_base if "://" in openai_base else f"https://{openai_base}")
            if not p.hostname or len(p.hostname.strip()) < 3:
                raise ValueError("LLM Base URL 缺少有效主机名，例如 https://api.silira.cn/v1")
        except Exception as ex:
            raise ValueError(f"LLM Base URL 无效: {ex}") from ex
    is_custom_base = bool(openai_base and openai_base != "https://api.openai.com/v1")
    if not model:
        if is_custom_base:
            raise ValueError(
                "使用自定义 Base URL（国内中转等）时，请在「Model」中填写该服务支持的模型名（如 gpt-4o、gpt-4o-mini、gpt-3.5-turbo 等），留空无法自动匹配。"
            )
        model = "gpt-4o-mini"
    client = OpenAI(api_key=api_key, base_url=openai_base, timeout=timeout_sec)
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model, messages=[{"role": "user", "content": prompt}]
            )
            text = _text_from_openai_response(resp)
            if not text:
                raise RuntimeError(
                    "大模型返回为空或非标准格式；请检查 Base URL 是否为 OpenAI 兼容 /chat/completions，且 Model 填写正确。"
                )
            return text
        except Exception as e:
            err_str = str(e)
            if "timeout" in err_str.lower() or "timed out" in err_str.lower():
                raise LLMTimeoutError(f"请求大模型超时（{timeout_sec} 秒）。可检查网络或稍后重试。", timeout_sec=timeout_sec)
            last_err = e
            if attempt < max_retries - 1 and ("429" in err_str or "rate" in err_str.lower() or "quota" in err_str.lower()):
                match = re.search(r"retry in (\d+(?:\.\d+)?)\s*s", err_str, re.I)
                wait = min(float(match.group(1)) + 1, 30) if match else 15
                time.sleep(wait)
                continue
            raise last_err
    raise last_err
