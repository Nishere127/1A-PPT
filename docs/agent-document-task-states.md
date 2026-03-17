# Agent：文档任务状态约定（上传 / 解析 / 大模型）

供 Agent 与前端统一向用户反馈进度；**服务端除 HTTP 状态外不推送流式进度**，阶段由 **客户端按步骤** 划分。

## 单文件上限

- **100MB**（`POST` body 总大小受 uvicorn/反向代理限制时需自行调大，如 `--limit-max-requests` 不限制 body；Nginx 需 `client_max_body_size 100m`）。

## 推荐两阶段（大文件、可感知进度）

| 阶段 ID       | 含义           | 何时结束                         | Agent 话术示例           |
|---------------|----------------|----------------------------------|--------------------------|
| `uploading`   | 字节正在发到 API | 收到 `extract-document-text` 响应 | 「正在上传文档…{pct}%」   |
| `parsing`     | 服务端解析 PDF/文本 | 同上响应 200 且 body 含 `text`   | 「正在解析文档…」         |
| `llm`         | 调用大模型写提示词 | `document-to-prompts` 返回 200   | 「正在生成提示词，约 1～3 分钟」 |

1. **`POST /api/extract-document-text`**（multipart，`file`）  
   - 客户端用 **XHR/fetch 可监听 upload 进度** → 展示 `uploading` + 百分比。  
   - 成功后 → `parsing` 结束（解析与上传在同一请求内完成，无单独解析进度）。  
   - 响应：`{ "text": "…", "truncated": bool }`

2. **`POST /api/document-to-prompts`**（仅小表单：`document_text` + `user_context` + LLM 字段，**不再带 file**）  
   - 阶段 **`llm`**：无上传进度条；建议 **转圈 + 预估文案**。  
   - 成功：`{ "content": "…" }`

## 单阶段（小文件可选）

- 一次 **`POST /api/document-to-prompts`** 带 `file`：  
  - 仅 **`uploading`**（XHR upload 进度）+  **`processing`**（解析+LLM 合并，无法拆分）。  

## 状态枚举（供 Agent 状态机）

```text
idle | uploading | parsing | llm | processing | done | error
```

- `error`：HTTP 4xx/5xx 或网络失败；`detail` 可展示给用户（已脱敏）。

## 直接出图（带文档）

- **`POST /api/direct-generate`**：先 **`uploading`**（若带 file），再 **`llm_fuse`**（融合说明+文档）+ **`image`**（出图）；后两段可在 Agent 侧合并为「生成中…」。

## 前端调试台

- 与本表一致：上传进度条 + 文案阶段；Agent 实现时复用同一套枚举即可。
