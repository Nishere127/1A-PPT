# 出图工具前端（image-tool-ui）

独立前端项目：出图工具 UI，基于 Next.js + Tailwind + Shadcn 风格 + Glassmorphism。仅负责界面与交互，所有出图与导出 PPT 请求发往后端 API。

## 依赖后端

本前端需要**后端 API** 才能完成出图与导出。后端在另一个项目（Solution Agentic / Agent 项目）中提供：

- `POST /api/generate-image`：根据提示词出图，返回 base64 图片
- `POST /api/export-ppt`：将选中的图片导出为 PPT 文件

## 本地运行

```bash
# 安装依赖
npm install

# 开发
npm run dev
```

浏览器打开 http://localhost:3000。

## 环境变量

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_API_URL` | 后端 API 根地址，默认 `http://localhost:8000` |

可复制 `.env.example` 为 `.env` 后修改。先启动后端（见 Agent 项目 README），再启动本前端。

## 脚本

- `npm run dev`：开发模式
- `npm run build`：生产构建
- `npm run start`：运行生产构建
- `npm run lint`：ESLint 检查

## 技术栈

- Next.js 14（App Router）
- TypeScript
- Tailwind CSS
- Shadcn 设计系统（CSS 变量 + 自实现组件）
- Glassmorphism 风格
