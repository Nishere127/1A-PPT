# 1A Agent · 出图与文档 Skill

沉淀两块能力，供 Agent 挂载（本仓库以 **FastAPI + 可调试前端** 验效果，**不是最终用户产品形态**）。

## 核心 Skill（你要沉淀的）

| Skill | 作用 | 代码入口 |
|-------|------|----------|
| **文档 / 提示词 → 出图提示词** | 有文档时：文档 + 说明 → 分页提示词；**无文档时**：仅根据一条说明（如「做 5 张产品介绍 PPT」）拆成多页。大 PDF 可先 `POST /api/extract-document-text` 再 `document-to-prompts` 只传 `document_text` | `POST /api/document-to-prompts`（响应 `content`） |
| **出图** | 提示词 → 图像 API；支持 OpenAI `size` 与 Gemini 类 `aspect_ratio`；画风在服务端统一追加；多段可 `expand_slides` 部分成功返回 | `api/main.py` → `POST /api/generate-image`、`POST /api/direct-generate` |
| **导出 PPT** | 多图 → pptx | `image_gen_skill/ppt_export.py` + `POST /api/export-ppt` |

## 调试台近期能力（前端 + 接口）

- **仅输入提示词拆成多页**：不上传文件，在「说明」框填一条（如「做 5 张产品介绍 PPT」），点「根据说明拆成多页」→ LLM 按无文档分支生成多块「第 N 张 PPT」提示词，落入下方正文区。
- **分段勾选再出图**：提示词正文按「第 N 张 PPT」拆段展示，用户全选/勾选部分 →「对选中出图」只请求选中段，每段单次请求、`expand_slides: false`，结果追加到列表。
- **画布比例**：主区选 16:9 / 1:1 / 9:16 等；侧栏可开关「Gemini/中转（aspect_ratio 枚举）」以适配不同出图 API。
- **出图结果持久化**：结果存浏览器 IndexedDB，刷新不丢；可「清空本机出图」。
- **三步流程**：1 说明与文件 → 2 提示词与分段 → 3 出图结果与导出。

- `doc_parse.py`：文档正文解析  
- `llm_adapter.py`：LLM 调用（与 Skill 解耦）  
- `image_adapter.py`：文生图 API 适配  
- `image_gen_skill/`：出图与 PPT 封装  

## 运行（调试台）

**后端**（项目根目录）：

```bash
pip install -r requirements.txt
uvicorn api.main:app --reload --host localhost --port 8000
```

**前端**（Next.js，仅作调试/看效果）：

```bash
cd frontend
npm install && npm run dev
```

打开 http://localhost:3000。侧栏填 Key；主区测「拉提示词」与「出图」两条链路。

## 环境变量（可选）

- `NEXT_PUBLIC_API_URL`：默认 `http://localhost:8000`

## 安全与隐私（API Key）

- **不落盘**：本服务不把 Key 写入文件；仅当次请求内存中使用。
- **响应脱敏**：出错时 `detail` 会过滤含 `sk-`、`api_key`、Bearer 等字样，避免把上游错误原文回给浏览器。
- **日志**：Uvicorn 访问日志只有 `客户端IP:端口 → 方法 路径 状态码`，**不会打印 Form/JSON 里的 Key**（请勿自行加 `print(body)`）。
- **58396 一类端口**：日志里 `localhost:58396` 是**浏览器本机分配的临时源端口**，用来连你的 **8000**；不是多开了一个服务端口。
- **上线**：务必 HTTPS + 仅内网或鉴权访问本 API，Key 改由服务端环境变量注入，勿长期放在前端。
- **大文件**：单文件上限 **100MB**；Nginx 等需 `client_max_body_size 100m`。
- **Agent 进度约定**：见 [docs/agent-document-task-states.md](docs/agent-document-task-states.md)。
- **502 + Connection error**：多为本机连不上 LLM Base URL（`nodename nor servname` = DNS 失败）。终端可 `ping api.silira.cn`、`curl -I https://api.silira.cn/v1` 自查；勿在 Base URL 留空格或缺 `https://`。

## 已移除

- **Streamlit**（`app.py`、`ppt_agent.py`）已删除，避免双入口与维护成本；正式交互由 Agent + 上述 API 承接。
