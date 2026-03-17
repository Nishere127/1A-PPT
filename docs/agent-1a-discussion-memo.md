# 1A Agent 讨论备忘

本文档汇总联调与架构讨论结论，便于后续对产品与实现对齐。

---

## 1. 项目目标（1A 页在整体里的位置）

- **联调两条 Skill**：文档 → 提示词、提示词 → 出图。
- **正式产品由 Agent 调 API**；本页是 **人在环、验效果**，不要求替代完整 Agent 编排。
- **交付形态侧重**：**16:9 PPT 用图 / 整页视觉**，把个人写 PPT 的能力 **复用给他人**；不是单张「意境图」即可。
- **现实预期**：文生图难以稳定复刻 Keynote/人工排版；Agent 价值更现实的是 **高密度 brief + 可选底图**，精确版式仍可回到 PPT 里补。

---

## 2. 文档 → 提示词：任务定义对输出的影响

- **同一份文档、同输入**，若任务写成「一整段连续正文、少结构」则输出偏泛；若写成「一章一页、高密度」则质量更好——**输出差距主要来自任务定义，而非文档不同**。
- **图 2（分镜式）**：主题 / 人物 / 环境 / 色彩 / 构图… 偏大纲，易显「简单」。
- **图 1（单张节）**：【基本设定】【布局结构】【分区元素】+ HEX + 分区占比 + 可上屏短句，才贴近 **单页 PPT 规格书**。
- **工程侧已调整方向**（实现以代码为准）：
  - 提示词 Skill 默认按 **第 N 张 PPT** 分块输出（16:9、1920×1080、分区写满）。
  - 送入 LLM 的文档正文上限提高到 **10 万字符量级**（长工作文档）。
  - 前端「用正文出图」支持按 **第 N 张 PPT**（及原 **第 N 页**）**多次调用出图**。

---

## 3. 联调踩坑备忘（后端 / 前端）

| 现象 | 原因摘要 |
|------|----------|
| 502 + 出图无图 / 上游 data 空 | 出图 Base URL 缺 **`/v1`** 时，会打到 `…/images/generations` 返回 **HTML**，非 JSON；需统一 **`…/v1/images/generations`**。 |
| SSL | 「拉图 SSL」需与 **生成请求**（httpx）一致；HTML 问题多来自 **路径错误** 而非 SSL。 |
| `'str' object has no attribute 'data'` | `image_adapter` 内变量名勿与 SDK 响应对象冲突；拉图用独立变量名。 |
| document-to-prompts 502 / ConnectError | DNS 或 Base URL 错误（如域名拼写）；需可解析、可达。 |
| FastAPI Form | 需安装 **python-multipart**。 |
| 按页出图 | 单次 API + 整段正文 ≠ 自动按页；需 **按块多次请求** 或用户显式分块。 |

---

## 4. 两阶段 LLM：解析 vs 写提示词

- **结论**：在 **长文档 + 多页 16:9 + 高信息密度** 场景下，**先结构化解析、再专门写提示词**，通常比 **单次读完长文同时摘要+设计+写 prompt** 更稳。
- **阶段①（解析 / 要素）**：章节树、每节论点与可上屏短句、表图意摘要、建议页数；产出 **可消费的中间表示**（JSON/Markdown）。
- **阶段②（写作）**：只读①的结果，输出 **第 N 张 PPT** +【基本设定】【布局】【分区】。
- **注意**：① 太粗则② 仍空泛；① 不宜摘要过猛导致丢论点。

---

## 5. 1A Agent 架构建议：路由 + 短链 / 长链

- **文档进入后先做「快速判断」**（规则即可起步：字数阈值、页数、是否勾选「含大量图表/扫描」等）。
- **小文档（短链）**：现有工程 — 抽文本 + **单次** document-to-prompts（或等价）。
- **长文档 / 结构复杂（长链）**：
  1. **多模态解析基模**：版式、表、图、扫描；输出结构化蓝图（不必直接是最终 prompt）。
  2. **擅长写作的基模**：基于蓝图写 **按张 PPT 高密度提示词**。
- **合理性**：成本与延迟上避免小题大做；能力上解析与写作分离；调试时可区分「抽错」还是「写飘」。
- **落地顺序可选**：先做 **路由 + 长链第②段**；多模态解析在真实复杂 PDF 上再接入。

---

## 6. API Key 与多基模（待产品定案）

- 1A 依赖 **用户自带 Key**；若拆成 **解析基模 + 写作基模 + 出图**，会出现 **多把 Key 或多 Base URL** 的配置问题。
- **可选策略**（讨论用，未锁定）：
  - **同一聚合端**：用户只填一处 Key，后端按路由调不同 model（若平台支持）。
  - **分栏配置**：解析 / 写作 / 出图 各一组（Key + Base URL + Model），高级用户全填，简单用户可合并为同一组复用。
  - **服务端托管**（若以后做 SaaS）：运营方 Key，用户按套餐；与当前「用户 Key」模式不同。

---

## 7. 画图 Skill vs 文档→提示词 Skill（是不是同一个？）

- **接口上不是同一个**：文档→提示词调 **LLM**；画图调 **images/generations**（+ 每条末尾追加固定风格后缀）。
- **产品上可以看成同一套「视觉 Skill」的两段**：前段负责 **按契约写 prompt**（含固定四色 + 2.5D 科技商务风），后段负责 **调用 API 并再次用后缀锁画风**。若前段乱写色系，后段仅靠一句后缀拉不齐，所以 **基模输出必须遵守与出图 Skill 相同的配色与画风契约**（实现见 `api/main.py` 中 `IMAGE_SKILL_VISUAL_CONTRACT` 与 `IMAGE_STYLE_SUFFIX`）。

---

## 8. 分段出图与 Agent 对齐（调试台 + 1A）

- **调试台**：正文按 `splitPromptByPages` 拆段展示；用户 **多选段** 再「对选中出图」；每段 **单独** `POST /api/generate-image`，body 里 **`expand_slides: false`**，避免服务端对同一段再拆、多扣费。新图 **追加** 到结果列表（不重排替换）。
- **1A Agent**：与用户对齐后，可按段调用同一接口——**每次只传该段 prompt**，**`expand_slides: false`**，**`size`** 与用户选的横竖一致。若用户一次扔整包且希望服务端代拆，再使用 **`expand_slides: true`**（与直接出图整包行为一致）。
- **话术**：先展示整段 Prompt → 列出分段让用户确认 → 问「先试第几张还是全选出图」。

---

## 9. 相关代码与文档（索引）

- 文档正文长度、`document-to-prompts` 提示模板：`api/main.py`（常量 `DOC_TEXT_MAX_CHARS` 等）。
- 出图 Base URL `/v1`、SSL、原始 HTTP 回退：`image_adapter.py`。
- 文档任务阶段说明：`docs/agent-document-task-states.md`。
- NanoBanana / PPT 技能提炼：`docs/NanoBanana-PPT-Skills-核心提炼.md`。
- 出图后缀与文档提示词共用视觉契约：`api/main.py`（`IMAGE_STYLE_SUFFIX`、`IMAGE_SKILL_VISUAL_CONTRACT`）。

---

## 10. 近期实现变更（文档与代码对齐）

- **仅提示词拆成多页**：`document-to-prompts` 在 **无文档**（不传 file、不传 document_text）时，仅根据 `user_context` 一条说明生成多张「第 N 张 PPT」块。后端在构造 LLM 提示时区分 `only_prompt_no_doc`，插入「本次无文档，仅根据用户补充说明拆成多张…」类说明。前端在未选文件时按钮文案为「根据说明拆成多页」，placeholder 提示可只填一条说明。
- **分段勾选、对选中出图**：前端 `splitPromptByPages` 拆段 → 每段可勾选 →「对选中出图」仅请求选中段，单段单次 `generate-image`、`expand_slides: false`，结果追加（不替换）。详见 §8。
- **出图比例**：请求体支持 `size`（OpenAI WxH）与 `aspect_ratio`（Gemini 枚举）；`image_adapter` 在提供 `aspect_ratio` 时走 `generation_config.image_config` 请求体。前端主区比例选择、侧栏「Gemini/中转」开关。
- **出图结果持久化**：前端 `frontend/src/lib/idb-images.ts` 用 IndexedDB 存 `imageList`，刷新恢复；可选「清空本机出图」。
- **部分成功**：多段时服务端可 `expand_slides: true` 逐段请求，某段失败仍 200 返回已成功张 + `partial_warning`，避免已扣费却整单无图。
- **顶尖解决方案 PPT 架构师（独立 Skill）**：`document-to-prompts` 支持参数 `use_solution_architect`（表单传 `"true"`/`"false"`）。为 true 时在现有「企业级 PPT 配图专家」提示前注入麦肯锡/BCG/Duarte 融合方法论：SCQA、MECE、Action Title、逻辑破局→FAB 价值建模→叙事可视化（对比型/层进型/神经元型）、溯源核查、风格禁令；视觉仍沿用项目四色/16:9/2.5D。前端在「说明与文件」区提供勾选「顶尖解决方案 PPT 架构师（麦肯锡/BCG/Duarte）」；勾选后拉提示词即走该 Skill。
- **nano-banana + aspect_ratio 出图超时与解析增强**：`/api/generate-image` 与 `/api/direct-generate` 在使用 `aspect_ratio`（如 16:9）调 `nano-banana-2-2k` 等中转模型时，单张出图超时统一提高到 180s，多张按张数递增，上限 300s，以匹配上游常见 140s+ 延迟。`image_adapter.generate_image` 在 `use_gemini_shape` 分支下补全了对 `data`、`result`、`url`、`image_url`、`images` 等字段的解析逻辑（含 base64 字符串数组），避免上游 200 成功但本地因取不到 data 而 502 或「未返回图片」。

---

## 11. 三 Skill 的调用顺序与编排关系（便于日后回顾）

- **三个「Skill」在代码中的含义**：
  - **写提示词 Skill**：把文档/说明变成多段「第 N 张 PPT」的 LLM 提示与输出格式；落在 `document-to-prompts` 的 prompt 里（企业级 PPT 配图专家 + 视觉契约 + 按张输出）。
  - **解决方案架构师 Skill**：麦肯锡/BCG/Duarte 方法论（SCQA、MECE、FAB、溯源等）；**不是单独一步**，而是同一 `document-to-prompts` 调用里、在写提示词 prompt **前**的可选前缀（`use_solution_architect=true` 时注入）。
  - **画图 Skill**：用「一段提示词 + 固定风格后缀」调文生图 API；落在 `generate-image`（每段提示 + `IMAGE_STYLE_SUFFIX`）与 `direct-generate`（融合成一段后再加后缀）。

- **编排由前端驱动**：没有单独的「Agent 进程」决定顺序；用户点不同按钮走不同路径。

- **两条路径与调用顺序**：
  - **路径 A（拉提示词 → 对选中出图）**：用户点「拉提示词」或「根据说明拆成多页」→ 前端调 `document-to-prompts`（若勾选「顶尖解决方案 PPT 架构师」则请求带 `use_solution_architect=true`，后端在写提示词前拼上解决方案架构师全文）→ 得到多段「第 N 张 PPT」→ 用户勾选段落 → 点「对选中出图」→ 对每段调 `generate-image`（画图 Skill）。顺序：**（可选）解决方案架构师 → 写提示词 → 画图**；解决方案架构师与写提示词是**同一次** document-to-prompts 调用的前后关系。
  - **路径 B（直接出图）**：用户点「直接出图」→ 有文档时后端 `direct-generate` 内用 `_fuse_direct_image_prompt` 把文档+说明合成一段再出图（此处无写提示词完整流程、也无解决方案架构师），无文档则直接用用户说明 → 画图 Skill。顺序：**只有画图**（若有文档则前面有一次「简单融合写一段」的 LLM，但不是写提示词 Skill 也不是解决方案架构师）。

- **结论**：当前调度顺序合理；解决方案架构师仅作为写提示词步骤的「增强模式」存在，画图始终在已有提示词之后；编排逻辑在前端（用户操作 + 勾选），后端只根据参数决定是否注入解决方案架构师前缀。

---

*备忘整理自联调与架构讨论；实现以仓库最新代码为准。*
