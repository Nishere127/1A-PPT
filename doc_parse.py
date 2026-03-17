"""
从上传文件解析纯文本（代码解析，不丢给大模型当二进制）。
支持 .txt / .md；.pdf 需 pypdf。
"""

def parse_document_bytes(data: bytes, filename: str | None) -> str:
    name = (filename or "").lower()
    if name.endswith(".txt") or name.endswith(".md"):
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="replace")
    if name.endswith(".pdf"):
        try:
            from io import BytesIO
            from pypdf import PdfReader
        except ImportError:
            raise ValueError("解析 PDF 请安装: pip install pypdf")
        reader = PdfReader(BytesIO(data))
        parts: list[str] = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        return "\n\n".join(parts) if parts else ""
    raise ValueError("暂支持 .txt / .md / .pdf，其它格式请另存为文本后上传")
