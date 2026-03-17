"""
出图适配层（与 Skill 解耦）：根据 api_config 调用图像生成接口，返回图片字节。
兼容 OpenAI /v1/images/generations 及国内出图中转。
"""

import base64
import json
import logging
import os
import ssl
import time
from io import BytesIO
from urllib.request import urlopen, Request

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import httpx
except Exception:
    httpx = None

try:
    import certifi
except Exception:
    certifi = None

logger = logging.getLogger(__name__)

# Gemini / 部分中转 GenerateContent 出图仅接受枚举，不接受 WxH size
GEMINI_ASPECT_RATIOS = frozenset(
    "1:1 1:4 1:8 2:3 3:2 3:4 4:1 4:3 4:5 5:4 8:1 9:16 16:9 21:9".split()
)

def _normalize_base_url(base_url: str) -> str:
    """若用户填了完整 path 则只保留 base。"""
    u = (base_url or "").strip()
    if not u:
        return ""
    for suffix in ("/images/generations", "/v1/images/generations"):
        if suffix in u.rstrip("/"):
            u = u.rstrip("/").rsplit(suffix, 1)[0].rstrip("/") or u
            break
    return u


def _openai_v1_base(base_url: str) -> str:
    """
    OpenAI SDK / 原始 POST 都会拼「base + /images/generations」。
    用户常填 https://api.xxx.cn 缺 /v1，会变成 …/images/generations 打到网站根路径，返回 HTML 而非 JSON。
    统一为「…/v1」；若已写 …/v1/chat/ 则截断到 …/v1。
    """
    u = (base_url or "").strip().rstrip("/")
    if not u:
        return "https://api.openai.com/v1"
    if "/v1" in u:
        i = u.find("/v1")
        return u[: i + 3]
    return u + "/v1"


def generate_image(
    prompt: str,
    api_config: dict,
    *,
    n: int = 1,
    size: str = "1792x1024",
    aspect_ratio: str | None = None,
    model: str | None = None,
    timeout_sec: float = 60.0,
) -> list[bytes]:
    """
    调用图像生成 API，返回图片字节列表（通常为单张）。
    - OpenAI/DALL·E：传 size（如 1792x1024），勿传 aspect_ratio。
    - Gemini/GenerateContent 类中转：传 aspect_ratio（如 16:9），请求体带 generation_config.image_config。
    api_config: {"api_key", "base_url", "model"}
    """
    if OpenAI is None:
        raise RuntimeError("请安装: pip install openai（出图接口兼容 OpenAI images/generations）")
    cfg = api_config or {}
    api_key = (cfg.get("api_key") or "").strip() or os.environ.get("IMAGE_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise ValueError("请提供出图 API 的 api_key（或环境变量 IMAGE_API_KEY / OPENAI_API_KEY）")
    base_url = _normalize_base_url((cfg.get("base_url") or "").strip())
    model = (model or (cfg.get("model") or "").strip() or "dall-e-2").strip()
    openai_base = _openai_v1_base(base_url)
    # Silra nano-banana 等模型在高质量模式下推理耗时可达 200～260s，官方示例建议 timeout=600。
    # 若检测到是 api.silra.cn 且模型名以 nano-banana 开头，则确保 timeout 至少 600s，避免读超时但上游仍成功计费。
    try:
        from urllib.parse import urlparse

        host = urlparse(openai_base if "://" in openai_base else f"https://{openai_base}").hostname or ""
    except Exception:
        host = ""
    if "api.silra.cn" in host and model.lower().startswith("nano-banana"):
        if timeout_sec < 600.0:
            timeout_sec = 600.0
    ssl_verify = cfg.get("ssl_verify")
    if ssl_verify is None:
        ssl_verify = os.environ.get("IMAGE_SSL_VERIFY", "true").lower() not in ("0", "false", "no")
    # 与拉图一致：关闭校验时，生成请求与拉 URL 均不校验 HTTPS（仅调试用）
    if httpx is None and not ssl_verify:
        raise RuntimeError("关闭 SSL 校验需安装 httpx: pip install httpx")

    def _normalize_data_list(d0):
        if isinstance(d0, list):
            return d0
        if isinstance(d0, dict) and (
            d0.get("url") or d0.get("b64_json") or d0.get("image_url")
        ):
            return [d0]
        return []

    ar = (aspect_ratio or "").strip()
    if ar and ar not in GEMINI_ASPECT_RATIOS:
        ar = ""
    use_gemini_shape = bool(ar) and httpx is not None

    def _post_openai_shape(prompt_in: str) -> tuple[dict, list]:
        g: dict | object = {}
        if httpx is not None:
            with httpx.Client(verify=bool(ssl_verify), timeout=timeout_sec) as http_client:
                client = OpenAI(
                    api_key=api_key,
                    base_url=openai_base,
                    timeout=timeout_sec,
                    http_client=http_client,
                )
                try:
                    g = client.images.generate(
                        prompt=prompt_in, model=model, n=n, size=size
                    )
                except Exception as e:
                    logger.warning("OpenAI images.generate 异常: %s", e)
                    g = {}
        else:
            try:
                client = OpenAI(
                    api_key=api_key, base_url=openai_base, timeout=timeout_sec
                )
                g = client.images.generate(
                    prompt=prompt_in, model=model, n=n, size=size
                )
            except Exception as e:
                logger.warning("OpenAI images.generate 异常: %s", e)
                g = {}
        if isinstance(g, str):
            try:
                g = json.loads(g)
            except json.JSONDecodeError:
                g = {}
        if g is not None and hasattr(g, "model_dump") and not isinstance(g, dict):
            try:
                g = g.model_dump()
            except Exception:
                g = {}
        if not isinstance(g, dict):
            g = {}
        return g, _normalize_data_list(g.get("data"))

    gen: dict = {}
    data_list: list = []

    if use_gemini_shape:
        url = openai_base.rstrip("/") + "/images/generations"
        payload = {
            "model": model,
            "prompt": prompt,
            "n": n,
            "generation_config": {
                "image_config": {"aspect_ratio": ar},
            },
        }
        started = time.time()
        try:
            with httpx.Client(verify=bool(ssl_verify), timeout=timeout_sec) as hc:
                r = hc.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            elapsed = time.time() - started
            logger.info(
                "aspect_ratio 出图 HTTP %s，耗时 %.1fs", r.status_code, elapsed
            )
            body_preview = (r.text or "")[:1200]
            if r.status_code >= 400:
                raise RuntimeError(f"出图 HTTP {r.status_code}: {body_preview[:800]}")
            try:
                raw = r.json()
            except json.JSONDecodeError:
                raw = {}
            if isinstance(raw, dict):
                data_list = _normalize_data_list(raw.get("data"))
                gen = raw
                # 中转（如 silra）可能不用 data 数组，用 result/images 等，与下方原始 POST 回退一致
                if not data_list:
                    if isinstance(raw.get("data"), dict):
                        inner = raw["data"]
                        if isinstance(inner, dict) and (
                            inner.get("url") or inner.get("b64_json") or inner.get("b64")
                        ):
                            data_list = [inner]
                    if not data_list and raw.get("url"):
                        data_list = [{"url": raw["url"]}]
                    if not data_list and raw.get("image_url"):
                        data_list = [{"url": raw["image_url"]}]
                    if not data_list and isinstance(raw.get("result"), str):
                        b = raw["result"].strip()
                        if b.startswith("http"):
                            data_list = [{"url": b}]
                        elif len(b) > 100:
                            data_list = [{"b64_json": b}]
                    if not data_list and isinstance(raw.get("images"), list) and raw["images"]:
                        data_list = _normalize_data_list(raw["images"])
                    if not data_list and isinstance(raw.get("images"), list):
                        for img in raw["images"][:n]:
                            if isinstance(img, str) and len(img) > 100:
                                data_list.append({"b64_json": img})
                                if len(data_list) >= n:
                                    break
        except RuntimeError:
            raise
        except Exception as e:
            logger.warning("aspect_ratio 出图 POST 失败: %s", e)
            data_list = []

    if not use_gemini_shape:
        gen, data_list = _post_openai_shape(prompt)

    # 部分中转返回 list[dict] 但字段非 url/b64_json，打日志便于排查（不含 Key）
    if not data_list and httpx is not None and not use_gemini_shape:
        # SDK 得到空 data 时常见原因：上游 JSON 与 OpenAI 标准不一致；改走原始 POST 并打全量键名
        url = openai_base.rstrip("/") + "/images/generations"
        try:
            with httpx.Client(verify=bool(ssl_verify), timeout=timeout_sec) as hc:
                r = hc.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": model, "prompt": prompt, "n": n, "size": size},
                )
            body_preview = (r.text or "")[:1200]
            logger.warning(
                "出图原始 HTTP: url=%s status=%s body_prefix=%s",
                url,
                r.status_code,
                body_preview,
            )
            if r.status_code >= 400:
                raise RuntimeError(
                    f"出图 HTTP {r.status_code}: {body_preview[:500]}"
                )
            try:
                raw = r.json()
            except json.JSONDecodeError:
                raw = {}
            if isinstance(raw, dict):
                data_list = _normalize_data_list(raw.get("data"))
                if not data_list and isinstance(raw.get("data"), dict):
                    inner = raw["data"]
                    if isinstance(inner, dict) and (
                        inner.get("url") or inner.get("b64_json")
                    ):
                        data_list = [inner]
                if not data_list and raw.get("url"):
                    data_list = [{"url": raw["url"]}]
                if not data_list and raw.get("image_url"):
                    data_list = [{"url": raw["image_url"]}]
                if not data_list and isinstance(raw.get("result"), str):
                    b = raw["result"].strip()
                    if b.startswith("http"):
                        data_list = [{"url": b}]
                    elif len(b) > 100:
                        data_list = [{"b64_json": b}]
                if not data_list and isinstance(raw.get("choices"), list):
                    for ch in raw["choices"][:n]:
                        if not isinstance(ch, dict):
                            continue
                        msg = ch.get("message") or {}
                        if isinstance(msg, dict) and msg.get("content"):
                            data_list.append({"b64_json": msg["content"]})
                        if ch.get("url"):
                            data_list.append({"url": ch["url"]})
                gen = raw
        except RuntimeError:
            raise
        except Exception as e:
            logger.warning("出图原始 HTTP 回退失败: %s", e)
    if not data_list:
        logger.warning(
            "出图上游 data 仍为空: base_url=%s model=%s prompt_len=%d n=%s gen_keys=%s",
            openai_base,
            model,
            len(prompt),
            n,
            list(gen.keys()) if isinstance(gen, dict) else None,
        )
    out: list[bytes] = []
    if ssl_verify and certifi:
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    elif ssl_verify:
        ssl_ctx = ssl.create_default_context()
    else:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    def _url(it) -> str | None:
        if isinstance(it, dict):
            return it.get("url") or it.get("image_url") or it.get("imageUrl")
        return getattr(it, "url", None) or getattr(it, "image_url", None)

    def _b64(it) -> str | None:
        if isinstance(it, dict):
            return it.get("b64_json") or it.get("b64") or it.get("base64")
        return getattr(it, "b64_json", None)

    for item in data_list[:n]:
        url = _url(item)
        if url:
            req = Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; ImageFetcher/1.0)"},
            )
            # 禁止用名 resp，否则会覆盖 SDK 的 ImagesResponse，下一轮若再访问 .data 会报 str/object 无 data
            with urlopen(req, timeout=int(timeout_sec), context=ssl_ctx) as http_resp:
                out.append(http_resp.read())
            continue
        b64 = _b64(item)
        if b64:
            out.append(base64.b64decode(b64))
    if not out and data_list:
        first = data_list[0]
        keys = list(first.keys()) if isinstance(first, dict) else []
        logger.warning(
            "出图 data 有条目但无法拉图/decode: base_url=%s model=%s first_item_keys=%s first_item_sample=%s",
            openai_base,
            model,
            keys,
            str(first)[:500] if not isinstance(first, dict) else {k: (str(v)[:80] + "…") if len(str(v)) > 80 else v for k, v in list(first.items())[:8]},
        )
    return out
