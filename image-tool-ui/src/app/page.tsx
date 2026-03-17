"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ImageItem {
  id: string;
  prompt: string;
  imageBase64: string;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [sslVerify, setSslVerify] = useState(true);
  const [imageList, setImageList] = useState<ImageItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastError, setLastError] = useState<string | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [lastPptBlob, setLastPptBlob] = useState<Blob | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      setLastError("请输入提示词");
      return;
    }
    if (!apiKey.trim()) {
      setLastError("请填写出图 API Key");
      return;
    }
    setLastError(null);
    setGenerateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: p,
          api_key: apiKey.trim(),
          base_url: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
          ssl_verify: sslVerify,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastError(data.detail || `请求失败 ${res.status}`);
        return;
      }
      const item: ImageItem = {
        id: `img_${Date.now()}`,
        prompt: p,
        imageBase64: data.image_base64,
      };
      setImageList((prev) => [...prev, item]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setGenerateLoading(false);
    }
  }, [prompt, apiKey, baseUrl, model, sslVerify]);

  const handleExport = useCallback(async () => {
    const selected = imageList.filter((x) => selectedIds.has(x.id));
    if (selected.length === 0) return;
    setLastError(null);
    setExportLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/export-ppt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selected.map((x) => ({
            prompt: x.prompt,
            image_base64: x.imageBase64,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLastError(data.detail || `导出失败 ${res.status}`);
        return;
      }
      const blob = await res.blob();
      setLastPptBlob(blob);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setExportLoading(false);
    }
  }, [imageList, selectedIds]);

  const selectedCount = imageList.filter((x) => selectedIds.has(x.id)).length;

  const pptDownloadUrl = useMemo(() => {
    if (!lastPptBlob) return null;
    return URL.createObjectURL(lastPptBlob);
  }, [lastPptBlob]);
  useEffect(() => {
    return () => {
      if (pptDownloadUrl) URL.revokeObjectURL(pptDownloadUrl);
    };
  }, [pptDownloadUrl]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* 侧边栏：API 配置（玻璃卡片） */}
      <aside className="w-full md:w-72 shrink-0 p-4 md:p-6">
        <Card className="glass-card border-white/20 bg-white/10 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex items-center justify-between text-left w-full"
            >
              <CardTitle className="text-lg">出图 API</CardTitle>
              <span className="text-muted-foreground text-sm">
                {settingsOpen ? "收起" : "展开"}
              </span>
            </button>
          </CardHeader>
          {settingsOpen && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key</Label>
                <Input
                  id="api_key"
                  type="password"
                  placeholder="必填"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="bg-white/5 border-white/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_url">Base URL（可选）</Label>
                <Input
                  id="base_url"
                  placeholder="留空即官方"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="bg-white/5 border-white/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model（可选）</Label>
                <Input
                  id="model"
                  placeholder="如 dall-e-2、dall-e-3"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-white/5 border-white/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ssl_verify"
                  checked={sslVerify}
                  onCheckedChange={(v) => setSslVerify(!!v)}
                />
                <Label htmlFor="ssl_verify" className="cursor-pointer text-sm">
                  校验拉取图片时的 SSL 证书
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                国内中转请填兼容 /v1/images/generations 的地址。
              </p>
            </CardContent>
          )}
        </Card>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 p-4 md:p-8 max-w-4xl w-full mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            出图工具
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            使用您自己的出图 API（OpenAI DALL·E 或兼容接口），密钥仅用于请求、不落盘。
          </p>
        </header>

        {/* 创作区：玻璃卡片 */}
        <Card className="glass-card border-white/20 bg-white/10 backdrop-blur-xl mb-8">
          <CardHeader>
            <CardTitle className="text-lg">描述画面</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="例如：一只在咖啡馆看书的柴犬，暖光，水彩风格…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[100px] bg-white/5 border-white/20 resize-y"
            />
            <div className="flex gap-3">
              <Button
                onClick={handleGenerate}
                disabled={generateLoading}
                loading={generateLoading}
                className="flex-1 md:flex-none"
              >
                出图
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setLastError(null);
                  handleGenerate();
                }}
                disabled={generateLoading}
                className="border-white/20 bg-white/5"
              >
                重试
              </Button>
            </div>
          </CardContent>
        </Card>

        {lastError && (
          <Alert variant="destructive" className="mb-6">
            {lastError}
          </Alert>
        )}

        {/* 已出图列表 */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-foreground">
            已出图
          </h2>
          {imageList.length === 0 ? (
            <Card className="glass-card border-white/20 bg-white/5 backdrop-blur-xl">
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                暂无图片。
                <br />
                在上方输入提示词并点击「出图」，生成的图片会出现在这里。
                <br />
                勾选多张后可点击「导出为 PPT」打包下载。
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-4">
              {imageList.map((item) => (
                <li key={item.id}>
                  <Card className="glass-card border-white/20 bg-white/5 backdrop-blur-xl overflow-hidden">
                    <CardContent className="p-4 flex flex-col sm:flex-row gap-4 items-start">
                      <div className="flex items-center gap-3 shrink-0">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                          aria-label="选入 PPT"
                        />
                        <span className="text-sm font-medium whitespace-nowrap">
                          选入 PPT
                        </span>
                      </div>
                      <div className="relative w-full sm:w-48 h-48 shrink-0 rounded-md overflow-hidden bg-muted">
                        <img
                          src={`data:image/png;base64,${item.imageBase64}`}
                          alt={item.prompt.slice(0, 50)}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                        {item.prompt.length > 200
                          ? `${item.prompt.slice(0, 200)}…`
                          : item.prompt}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 导出区 */}
        {imageList.length > 0 && (
          <Card className="glass-card border-white/20 bg-white/10 backdrop-blur-xl">
            <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                已选 <strong className="text-foreground">{selectedCount}</strong> 张，勾选后点击导出。
              </p>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  onClick={handleExport}
                  disabled={selectedCount === 0 || exportLoading}
                  loading={exportLoading}
                  className="flex-1 sm:flex-none"
                >
                  导出为 PPT
                </Button>
                {pptDownloadUrl && (
                  <a
                    href={pptDownloadUrl}
                    download="images_export.pptx"
                    className="inline-flex items-center justify-center rounded-md font-medium h-10 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors border border-input"
                  >
                    下载 PPT
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
