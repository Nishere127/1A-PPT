"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  IconSettings as Settings,
  IconKey as Key,
  IconLink as LinkIcon,
  IconBox as Box,
  IconShieldCheck as ShieldCheck,
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconSparkles as Sparkles,
  IconImages as Images,
  IconImageOff as ImageOff,
  IconCheckSquare as CheckSquare,
  IconDownload as Download,
  IconFileDown as FileDown,
  IconPaperclip as Paperclip,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { postFormWithUploadProgress } from "@/lib/upload-xhr";
import {
  loadImageListFromIdb,
  saveImageListToIdb,
  clearImageListIdb,
} from "@/lib/idb-images";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const STAGGER_MS = 140;

/** 刷新不丢：提示词正文 + 说明等存本机浏览器（仅本机，勿在公共电脑填 Key） */
const LS_DOC_PROMPT = "1a-doc-prompt-content-v1";
const LS_USER_PROMPT = "1a-user-prompt-v1";
const LS_IMAGE_SIZE = "1a-image-size-v1";
const LS_ASPECT_RATIO = "1a-aspect-ratio-v1";
const LS_SELECTED_IDS = "1a-export-selected-ids-v1";

/** size 给 OpenAI；aspectRatio 给 Gemini/GenerateContent（枚举，勿用 1792x1024） */
const ASPECT_PRESETS = [
  { id: "16:9", label: "16:9 横屏（PPT）", size: "1792x1024", aspectRatio: "16:9" },
  { id: "1:1", label: "1:1 方图", size: "1024x1024", aspectRatio: "1:1" },
  { id: "9:16", label: "9:16 竖屏", size: "1024x1792", aspectRatio: "9:16" },
  { id: "custom", label: "自定义…", size: "", aspectRatio: "" },
] as const;
const GEMINI_ASPECT_OPTIONS =
  "1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9 1:4 4:1 1:8 8:1".split(" ");

function loadStored(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function saveStored(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 配额满时忽略 */
  }
}

/** 出图前剥离整段中所有「第N张PPT」标题行（含段中重复），避免模型把标题当正文再画一遍。 */
function stripPptHeaderLine(raw: string): string {
  const lines = raw.split(/\r?\n/);
  // 匹配整行：可选前导 -/—/空白 + 第N张PPT + 本行剩余内容（分隔头或单独标题行）
  const headerRe = /^[-—\s]*第\s*\d+\s*张\s*PPT[^\n\r]*$/i;
  const out = lines.filter((line) => !headerRe.test(line.trim()));
  return out.join("\n").trim();
}

/**
 * 按「第N张PPT」或「第N页」切块，顺序与正文一致，每块单独调一次出图。
 * 注意：须匹配到至少两处「第N张PPT」才会拆；正则放宽为「换行后一行内出现第N张PPT」即可，
 * 避免模型没把分隔符写在行首导致整篇只请求一次。
 */
function splitPromptByPages(raw: string): { label: string; prompt: string }[] {
  const t = raw.trim();
  if (!t) return [];
  // 在「行首或换行后」且该行前 60 字内出现 第N张PPT 处切开（兼容 ---------- 同行或下一行）
  const pptHeader = /(?=(?:^|\r?\n)[^\n]{0,60}第\s*\d+\s*张\s*PPT)/gi;
  let byPpt = t.split(pptHeader).map((s) => s.trim()).filter((s) => s.length > 0);
  // 仍只有一块时：在「第2张PPT」及以后每张前再切（不依赖必须在行首）
  if (byPpt.length < 2) {
    byPpt = t
      .split(/(?=第\s*(?:[2-9]|\d{2,})\s*张\s*PPT)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (byPpt.length >= 2) {
    const blocks = byPpt.map((part) => {
      const lines = part.split(/\r?\n/);
      const headerRe = /^[-—\s]*第\s*\d+\s*张\s*PPT[^\n\r]*$/i;
      let firstNonEmpty = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          firstNonEmpty = trimmed;
          break;
        }
      }
      const isRealSlide = headerRe.test(firstNonEmpty);
      const m = part.match(/第\s*\d+\s*张\s*PPT[^\n\r]*/i);
      const label = m ? m[0].replace(/\s+/g, " ").trim().slice(0, 48) : "PPT";
      return { label, prompt: part, isRealSlide };
    });
    // 仅保留首行就是「第N张PPT」头的块，丢弃首行非头部的自检/说明段
    const realSlides = blocks.filter((b) => b.isRealSlide);
    const mapped = (realSlides.length > 0 ? realSlides : blocks).map(
      ({ label, prompt }) => ({ label, prompt })
    );
    return mapped;
  }
  const parts = t.split(/(?=第\s*\d+\s*页)/).map((s) => s.trim());
  const chunks = parts.filter((s) => s.length > 0);
  const out: { label: string; prompt: string }[] = [];
  for (const part of chunks) {
    const m = part.match(/^(第\s*\d+\s*页)([：:、\s]*)([\s\S]*)/);
    if (m) {
      const label = m[1].replace(/\s/g, "");
      const body = (m[3] || "").trim();
      out.push({
        label,
        prompt: body ? `${m[1]}${m[2] || "："}${body}` : part,
      });
    } else if (out.length === 0) {
      out.push({ label: "全文", prompt: part });
    } else {
      out[out.length - 1].prompt += "\n\n" + part;
    }
  }
  if (out.length >= 2) return out;
  if (out.length === 1 && /^第\s*\d+\s*页/.test(out[0].prompt)) return out;
  return [{ label: "出图", prompt: t }];
}

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
  /** 比例菜单：两路出图共用，再解析成上游 size */
  const [aspectRatioId, setAspectRatioId] =
    useState<(typeof ASPECT_PRESETS)[number]["id"]>("16:9");
  const [customImageSize, setCustomImageSize] = useState("1792x1024");
  const [customAspectRatio, setCustomAspectRatio] = useState("16:9");
  /** Gemini/中转须传 aspect_ratio；纯 OpenAI 出图请关 */
  const [useAspectRatioApi, setUseAspectRatioApi] = useState(true);
  const [countN, setCountN] = useState(1);
  const [llmOpen, setLlmOpen] = useState(false);
  const [useSolutionArchitect, setUseSolutionArchitect] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docPromptContent, setDocPromptContent] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [docPromptLoading, setDocPromptLoading] = useState(false);
  /** 文档任务：上传进度 + 阶段（与 docs/agent-document-task-states.md 一致） */
  const [docTaskPhase, setDocTaskPhase] = useState<
    "idle" | "uploading" | "parsing" | "llm" | "done" | "error"
  >("idle");
  const [docUploadPct, setDocUploadPct] = useState(0);
  const [docTaskHint, setDocTaskHint] = useState("");
  const [genTaskPhase, setGenTaskPhase] = useState<
    "idle" | "uploading" | "processing" | "done" | "error"
  >("idle");
  const [genUploadPct, setGenUploadPct] = useState(0);
  const [genTaskHint, setGenTaskHint] = useState("");

  const [imageList, setImageList] = useState<ImageItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastError, setLastError] = useState<string | null>(null);
  /** 多段出图未全部成功时后端 partial_warning（图仍已展示） */
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [lastPptBlob, setLastPptBlob] = useState<Blob | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);
  /** 正文拆段后，哪些段参与出图（与导出勾图 selectedIds 无关） */
  const [slideBlockSelected, setSlideBlockSelected] = useState<Set<number>>(
    () => new Set()
  );
  /** 分段卡片展开全文（折叠时仅预览，减轻长文滚动） */
  const [segmentExpanded, setSegmentExpanded] = useState<Set<number>>(
    () => new Set()
  );
  const staggerTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fusionFileRef = useRef<HTMLInputElement>(null);
  const saveDocPromptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveUserPromptTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const saveImagesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 已从 IndexedDB 恢复，避免首屏空列表覆盖掉已存图 */
  const [imagesHydrated, setImagesHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadImageListFromIdb();
      if (cancelled) return;
      setImageList(list);
      const s = loadStored(LS_SELECTED_IDS);
      if (s) {
        try {
          const ids = JSON.parse(s) as string[];
          if (Array.isArray(ids)) {
            const idSet = new Set(
              ids.filter((id) => list.some((i) => i.id === id))
            );
            setSelectedIds(idSet);
          }
        } catch {
          /* ignore */
        }
      }
      setImagesHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!imagesHydrated) return;
    if (saveImagesTimer.current) clearTimeout(saveImagesTimer.current);
    saveImagesTimer.current = setTimeout(() => {
      saveImageListToIdb(imageList).catch(() => {
        setLastError(
          "出图存本机失败（空间不足或浏览器限制），请尽快导出 PPT 备份"
        );
      });
      saveStored(LS_SELECTED_IDS, JSON.stringify([...selectedIds]));
    }, 800);
    return () => {
      if (saveImagesTimer.current) clearTimeout(saveImagesTimer.current);
    };
  }, [imageList, selectedIds, imagesHydrated]);

  useEffect(() => {
    const d = loadStored(LS_DOC_PROMPT);
    const u = loadStored(LS_USER_PROMPT);
    const sz = loadStored(LS_IMAGE_SIZE);
    const ar = loadStored(LS_ASPECT_RATIO);
    if (d) setDocPromptContent(d);
    if (u) setPrompt(u);
    if (ar === "1:1" || ar === "9:16" || ar === "16:9" || ar === "custom")
      setAspectRatioId(ar);
    if (sz && /^\d{2,4}x\d{2,4}$/i.test(sz)) setCustomImageSize(sz.toLowerCase());
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    if (saveDocPromptTimer.current) clearTimeout(saveDocPromptTimer.current);
    saveDocPromptTimer.current = setTimeout(() => {
      saveStored(LS_DOC_PROMPT, docPromptContent);
    }, 400);
    return () => {
      if (saveDocPromptTimer.current) clearTimeout(saveDocPromptTimer.current);
    };
  }, [docPromptContent, draftRestored]);

  useEffect(() => {
    if (!draftRestored) return;
    if (saveUserPromptTimer.current) clearTimeout(saveUserPromptTimer.current);
    saveUserPromptTimer.current = setTimeout(() => {
      saveStored(LS_USER_PROMPT, prompt);
    }, 400);
    return () => {
      if (saveUserPromptTimer.current) clearTimeout(saveUserPromptTimer.current);
    };
  }, [prompt, draftRestored]);

  useEffect(() => {
    if (!draftRestored) return;
    saveStored(LS_ASPECT_RATIO, aspectRatioId);
    if (aspectRatioId === "custom" && /^\d{2,4}x\d{2,4}$/i.test(customImageSize))
      saveStored(LS_IMAGE_SIZE, customImageSize.trim().toLowerCase());
  }, [aspectRatioId, customImageSize, draftRestored]);

  const resolvedImageSize = useMemo(() => {
    if (aspectRatioId === "custom") return customImageSize.trim().toLowerCase();
    const p = ASPECT_PRESETS.find((x) => x.id === aspectRatioId);
    return (p?.size || "1792x1024").toLowerCase();
  }, [aspectRatioId, customImageSize]);

  const resolvedAspectRatio = useMemo(() => {
    if (!useAspectRatioApi) return null as string | null;
    if (aspectRatioId === "custom")
      return GEMINI_ASPECT_OPTIONS.includes(customAspectRatio)
        ? customAspectRatio
        : null;
    const p = ASPECT_PRESETS.find((x) => x.id === aspectRatioId);
    return p?.aspectRatio || null;
  }, [useAspectRatioApi, aspectRatioId, customAspectRatio]);

  function validateSizeBeforeGenerate(): boolean {
    if (useAspectRatioApi) {
      if (!resolvedAspectRatio) {
        setLastError("请选择合法比例枚举（Gemini 通道）");
        return false;
      }
      return true;
    }
    if (!/^\d{2,4}x\d{2,4}$/i.test(resolvedImageSize)) {
      setLastError(
        "OpenAI 通道请填合法 size，如 1792x1024；或开启「Gemini 比例枚举」"
      );
      return false;
    }
    return true;
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runGenerate = useCallback(
    async (
      p: string,
      n: number,
      opts?: { expandSlides?: boolean }
    ) => {
      const res = await fetch(`${API_BASE}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: p,
          api_key: apiKey.trim(),
          base_url: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
          ssl_verify: sslVerify,
          n,
          /** 前端已按段拆好时必 false，避免服务端二次拆段多扣费；整包直出可为 true */
          expand_slides: opts?.expandSlides ?? false,
          size: useAspectRatioApi ? undefined : resolvedImageSize || undefined,
          aspect_ratio: resolvedAspectRatio || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : `请求失败 ${res.status}`
        );
      }
      const rawList: string[] = Array.isArray(data.images)
        ? data.images
        : data.image_base64
          ? [data.image_base64]
          : [];
      if (!rawList.length) throw new Error("接口未返回图片");
      if (typeof data.partial_warning === "string" && data.partial_warning) {
        setPartialWarning(data.partial_warning);
      }
      const baseTime = Date.now();
      rawList.forEach((b64, i) => {
        const t = setTimeout(() => {
          setImageList((prev) => [
            ...prev,
            {
              id: `img_${baseTime}_${i}_${Math.random()}`,
              prompt: p,
              imageBase64: b64,
            },
          ]);
        }, i * STAGGER_MS);
        staggerTimerRef.current.push(t);
      });
      await new Promise((r) =>
        setTimeout(r, rawList.length * STAGGER_MS + 300)
      );
    },
    [
      apiKey,
      baseUrl,
      model,
      sslVerify,
      resolvedImageSize,
      resolvedAspectRatio,
      useAspectRatioApi,
    ]
  );

  /** 分支②：不确认提示词直接出图（无文档 = 用户原文；有文档 = 走后端融合 + 出图） */
  const handleDirectGenerate = useCallback(async () => {
    const ctx = prompt.trim();
    if (!ctx && !docFile) {
      setLastError("请填写说明，或上传文档后出图");
      return;
    }
    if (!apiKey.trim()) {
      setLastError("请填写出图 API Key");
      return;
    }
    if (!validateSizeBeforeGenerate()) return;
    if (docFile && !llmApiKey.trim()) {
      setLastError("带文档直接出图需要 LLM API Key（侧栏）");
      return;
    }
    staggerTimerRef.current.forEach(clearTimeout);
    staggerTimerRef.current = [];
    setLastError(null);
    setPartialWarning(null);
    setGenerateLoading(true);
    setGenTaskPhase("idle");
    setGenUploadPct(0);
    setGenTaskHint("");
    const displayPrompt = ctx || "（文档直出）";
    try {
      if (docFile) {
        const fd = new FormData();
        fd.append("user_context", ctx || "根据文档生成配图");
        fd.append("file", docFile);
        fd.append("llm_api_key", llmApiKey.trim());
        fd.append("llm_base_url", llmBaseUrl.trim());
        fd.append("llm_model", llmModel.trim());
        fd.append("api_key", apiKey.trim());
        fd.append("base_url", baseUrl.trim());
        fd.append("model", model.trim());
        fd.append("ssl_verify", String(sslVerify));
        fd.append("n", String(countN));
        fd.append("size", useAspectRatioApi ? "" : resolvedImageSize || "1792x1024");
        fd.append("aspect_ratio", resolvedAspectRatio || "");
        setGenTaskPhase("uploading");
        setGenTaskHint("正在上传文档…");
        const x = await postFormWithUploadProgress(
          `${API_BASE}/api/direct-generate`,
          fd,
          (p) => {
            setGenUploadPct(p);
            setGenTaskHint(`正在上传… ${p}%`);
          }
        );
        setGenTaskPhase("processing");
        setGenTaskHint("融合文档并出图中（可能较久）…");
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(x.body) as Record<string, unknown>;
        } catch {
          throw new Error("响应非 JSON");
        }
        if (!x.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : `请求失败 ${x.status}`
          );
        }
        const rawList: string[] = Array.isArray(data.images)
          ? data.images
          : data.image_base64
            ? [data.image_base64]
            : [];
        if (!rawList.length) throw new Error("接口未返回图片");
        const baseTime = Date.now();
        rawList.forEach((b64, i) => {
          const t = setTimeout(() => {
            setImageList((prev) => [
              ...prev,
              {
                id: `img_${baseTime}_${i}_${Math.random()}`,
                prompt: displayPrompt,
                imageBase64: b64,
              },
            ]);
          }, i * STAGGER_MS);
          staggerTimerRef.current.push(t);
        });
        await new Promise((r) =>
          setTimeout(r, rawList.length * STAGGER_MS + 300)
        );
        setGenTaskPhase("done");
        setGenTaskHint("出图完成");
      } else {
        setGenTaskPhase("processing");
        setGenTaskHint("出图中…");
        await runGenerate(ctx, countN, { expandSlides: true });
        setGenTaskPhase("done");
        setGenTaskHint("完成");
      }
    } catch (e) {
      setGenTaskPhase("error");
      setGenTaskHint("");
      setLastError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setGenerateLoading(false);
    }
  }, [
    prompt,
    docFile,
    apiKey,
    baseUrl,
    model,
    sslVerify,
    countN,
    resolvedImageSize,
    resolvedAspectRatio,
    useAspectRatioApi,
    llmApiKey,
    llmBaseUrl,
    llmModel,
    runGenerate,
  ]);

  /** 结合补充说明 + 可选文档 → LLM 生成多条提示词（与直接出图同一套流程） */
  const handleDocToPrompts = useCallback(async () => {
    const ctx = prompt.trim();
    if (!ctx && !docFile) {
      setLastError("请填写补充说明，或上传文档");
      return;
    }
    if (!llmApiKey.trim()) {
      setLastError("请填写 LLM API Key（生成提示词）");
      return;
    }
    setLastError(null);
    setDocPromptLoading(true);
    setDocPromptContent("");
    setDocTaskPhase("idle");
    setDocUploadPct(0);
    setDocTaskHint("");
    try {
      let documentText = "";
      if (docFile) {
        setDocTaskPhase("uploading");
        setDocTaskHint("正在上传文档到服务器…");
        const ex = new FormData();
        ex.append("file", docFile);
        const xr = await postFormWithUploadProgress(
          `${API_BASE}/api/extract-document-text`,
          ex,
          (p) => {
            setDocUploadPct(p);
            setDocTaskHint(`上传中 ${p}%`);
          }
        );
        setDocTaskPhase("parsing");
        setDocTaskHint("正在解析正文…");
        let ej: Record<string, unknown> = {};
        try {
          ej = JSON.parse(xr.body) as Record<string, unknown>;
        } catch {
          throw new Error("提取接口返回异常");
        }
        if (!xr.ok) {
          throw new Error(
            typeof ej.detail === "string"
              ? ej.detail
              : `提取失败 ${xr.status}`
          );
        }
        documentText = typeof ej.text === "string" ? ej.text : "";
        if (!documentText) {
          throw new Error("未能提取正文（扫描版 PDF 需 OCR）");
        }
        setDocTaskHint("解析完成，正在调用大模型生成提示词…");
      } else {
        setDocTaskPhase("llm");
        setDocTaskHint("正在调用大模型…");
      }
      setDocTaskPhase("llm");
      const fd = new FormData();
      if (documentText) fd.append("document_text", documentText);
      fd.append("user_context", ctx);
      fd.append("llm_api_key", llmApiKey.trim());
      fd.append("llm_base_url", llmBaseUrl.trim());
      fd.append("llm_model", llmModel.trim());
      fd.append("use_solution_architect", useSolutionArchitect ? "true" : "false");
      const res = await fetch(`${API_BASE}/api/document-to-prompts`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : `失败 ${res.status}`
        );
      }
      const text =
        typeof data.content === "string"
          ? data.content
          : Array.isArray(data.prompts)
            ? data.prompts.join("\n\n")
            : "";
      setDocPromptContent(text);
      setDocTaskPhase("done");
      setDocTaskHint("提示词已生成");
      setDocUploadPct(100);
    } catch (e) {
      setDocTaskPhase("error");
      setLastError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setDocPromptLoading(false);
    }
  }, [docFile, prompt, llmApiKey, llmBaseUrl, llmModel, useSolutionArchitect]);

  const promptBlocks = useMemo(
    () => splitPromptByPages(docPromptContent.trim()),
    [docPromptContent]
  );
  const promptBlocksKey = useMemo(
    () =>
      `${promptBlocks.length}\n${promptBlocks.map((b) => b.label).join("\n")}`,
    [promptBlocks]
  );
  useEffect(() => {
    setSlideBlockSelected(new Set(promptBlocks.map((_, i) => i)));
    setSegmentExpanded(new Set([0]));
  }, [promptBlocksKey]);

  /**
   * 对**已勾选**的段落出图：每段单独请求、expand_slides false，结果**追加**（4.1 A）。
   */
  const handleGenerateFromContent = useCallback(async () => {
    const p = docPromptContent.trim();
    if (!p) {
      setLastError("请先拉提示词或粘贴内容");
      return;
    }
    if (!validateSizeBeforeGenerate()) return;
    if (!apiKey.trim()) {
      setLastError("请填写出图 API Key");
      return;
    }
    const blocks = splitPromptByPages(p);
    const indices = blocks
      .map((_, i) => i)
      .filter((i) => slideBlockSelected.has(i));
    if (indices.length === 0) {
      setLastError("请至少勾选一段再出图");
      return;
    }
    setLastError(null);
    setPartialWarning(null);
    setGenerateLoading(true);
    try {
      let done = 0;
      for (const i of indices) {
        done++;
        setGenTaskHint(`${blocks[i].label}（${done}/${indices.length}）`);
        const n =
          blocks.length === 1 && indices.length === 1 ? countN : 1;
        const cleaned = stripPptHeaderLine(blocks[i].prompt);
        await runGenerate(cleaned, n, { expandSlides: false });
      }
      setGenTaskHint("");
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "出图失败");
    } finally {
      setGenerateLoading(false);
      setGenTaskHint("");
    }
  }, [
    apiKey,
    docPromptContent,
    runGenerate,
    resolvedImageSize,
    slideBlockSelected,
    countN,
  ]);

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
        setLastError(
          typeof data.detail === "string"
            ? data.detail
            : `导出失败 ${res.status}`
        );
        return;
      }
      setLastPptBlob(await res.blob());
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

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewImage]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gradient-to-b from-zinc-100/80 to-zinc-50">
      <aside className="w-full md:w-[300px] shrink-0 border-b md:border-b-0 md:border-r border-zinc-200/80 bg-white/95 md:bg-zinc-50/95 backdrop-blur-xl p-3 md:p-4 space-y-3 overflow-y-auto max-h-[38vh] md:max-h-screen md:sticky md:top-0 md:self-start z-20 shadow-sm md:shadow-none">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-1">
          1A · 调试台
        </p>
        <p className="text-[11px] text-zinc-500 px-1 -mt-1 leading-snug">
          侧栏配置 Key；主区按步骤操作
        </p>
        <Card className="border border-zinc-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2 pt-3 px-3">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex items-center justify-between gap-2 text-left w-full rounded-lg px-1 py-0.5 hover:bg-zinc-50"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-zinc-600" />
                <CardTitle className="text-sm font-semibold">出图 Skill</CardTitle>
              </span>
              {settingsOpen ? (
                <ChevronUp className="h-4 w-4 text-zinc-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              )}
            </button>
            <p className="text-[10px] text-zinc-400 pt-1">
              generate-image / direct-generate
            </p>
          </CardHeader>
          {settingsOpen && (
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-zinc-700">
                  <Key className="h-3.5 w-3.5" />
                  API Key
                </Label>
                <Input
                  type="password"
                  placeholder="必填"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="bg-white/80 border-zinc-200/80 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-zinc-700">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Base URL
                </Label>
                <Input
                  placeholder="可选"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="bg-white/80 border-zinc-200/80 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-zinc-700">
                  <Box className="h-3.5 w-3.5" />
                  Model
                </Label>
                <Input
                  placeholder="dall-e-2 / dall-e-3"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-white/80 border-zinc-200/80 rounded-xl"
                />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/40 px-2 py-2">
                <Checkbox
                  checked={useAspectRatioApi}
                  onCheckedChange={(v) => setUseAspectRatioApi(!!v)}
                />
                <Label className="cursor-pointer text-xs text-zinc-700">
                  Gemini/中转（aspect_ratio 枚举）— 关则仅用 OpenAI size
                </Label>
              </div>
              <p className="text-[10px] text-zinc-500">
                当前：{useAspectRatioApi ? resolvedAspectRatio : resolvedImageSize}
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-white/40 px-2 py-2">
                <Checkbox
                  checked={sslVerify}
                  onCheckedChange={(v) => setSslVerify(!!v)}
                />
                <Label className="cursor-pointer text-sm flex items-center gap-1.5 text-zinc-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  校验拉图 SSL
                </Label>
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="border border-zinc-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2 pt-3 px-3">
            <button
              type="button"
              onClick={() => setLlmOpen((o) => !o)}
              className="flex items-center justify-between w-full text-left rounded-lg px-1 py-0.5 hover:bg-zinc-50"
            >
              <CardTitle className="text-sm font-semibold">
                文档→提示词 Skill
              </CardTitle>
              {llmOpen ? (
                <ChevronUp className="h-4 w-4 text-zinc-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              )}
            </button>
            <p className="text-[10px] text-zinc-400 pt-1">
              document-to-prompts · 须 LLM Key
            </p>
          </CardHeader>
          {llmOpen && (
            <CardContent className="space-y-3 pt-0">
              <Input
                type="password"
                placeholder="LLM API Key"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="bg-white/80 rounded-xl"
              />
              <Input
                placeholder="LLM Base URL（可选）"
                value={llmBaseUrl}
                onChange={(e) => setLlmBaseUrl(e.target.value)}
                className="bg-white/80 rounded-xl"
              />
              <Input
                placeholder="LLM Model（如 gpt-4o-mini）"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="bg-white/80 rounded-xl"
              />
            </CardContent>
          )}
        </Card>
      </aside>

      <main className="main-design flex-1 min-w-0 flex flex-col md:min-h-screen">
        <div className="flex-1 w-full max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10 pb-28 md:pb-12">
          {/* 三步流程条 */}
          <nav
            className="mb-8 flex flex-wrap items-center justify-center gap-1 text-[11px] text-zinc-500"
            aria-label="流程"
          >
            {[
              ["1", "说明 / 拉提示词"],
              ["2", "分段 / 选中出图"],
              ["3", "结果 / 导出"],
            ].map(([n, t], i) => (
              <span key={n} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="mx-1 text-zinc-300 hidden sm:inline">→</span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 shadow-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
                    {n}
                  </span>
                  {t}
                </span>
              </span>
            ))}
          </nav>
          <header
            className="mb-8 flex items-stretch justify-center gap-3 md:gap-4"
            aria-label="1A Agent"
          >
            <div
              className="logo-1a logo-1a-stage logo-1a-hero flex min-h-[4.5rem] w-[4.25rem] shrink-0 items-end justify-center self-stretch rounded-xl select-none md:min-h-[5.25rem] md:w-[5rem]"
              aria-hidden
            >
              <div className="logo-1a-buddies h-full w-full">
                <div className="logo-buddy logo-buddy-1">
                  <div className="logo-buddy-arm logo-buddy-arm-l" />
                  <div className="logo-buddy-arm logo-buddy-arm-r" />
                  <div className="logo-buddy-head" />
                  <span className="logo-buddy-body">1</span>
                  <div className="logo-buddy-feet">
                    <span />
                    <span />
                  </div>
                </div>
                <div className="logo-buddy logo-buddy-a">
                  <div className="logo-buddy-arm logo-buddy-arm-l" />
                  <div className="logo-buddy-arm logo-buddy-arm-r" />
                  <div className="logo-buddy-head" />
                  <span className="logo-buddy-body">A</span>
                  <div className="logo-buddy-feet">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </div>
            <div
              className="flex min-h-[4.5rem] flex-col justify-center gap-1 md:min-h-[5.25rem] md:gap-1.5"
            >
              <span className="w-fit rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-zinc-500 md:text-[11px]">
                调试台
              </span>
              <h1 className="text-3xl font-bold leading-none tracking-tight text-zinc-900 md:text-4xl md:leading-none">
                1A Agent
              </h1>
            </div>
          </header>
          <p className="mx-auto mb-8 max-w-lg text-center text-sm text-zinc-600 leading-relaxed">
            文档 → 提示词 → 按段出图 → 导出 PPT。侧栏填 Key，主区按顺序点即可。
          </p>

          <input
            ref={fusionFileRef}
            type="file"
            accept=".txt,.md,.pdf"
            className="hidden"
            onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
          />
          <div className="mx-auto mb-6 max-w-2xl overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] ring-1 ring-zinc-100">
            <div className="border-b border-zinc-100 bg-gradient-to-r from-zinc-50 to-white px-4 py-3 flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white">
                1
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-zinc-900">说明与文件</h2>
                <p className="text-[11px] text-zinc-500">
                  填一条提示词可「拉提示词」拆成多页；或上传文档 + 说明 → 拉提示词 / 直接出图
                </p>
              </div>
            </div>
            <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fusionFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" />
                上传 txt / md / pdf
              </button>
              {docFile ? (
                <span className="truncate text-xs font-medium text-emerald-700" title={docFile.name}>
                  {docFile.name}
                </span>
              ) : (
                <span className="text-xs text-zinc-400">未选文件</span>
              )}
            </div>
            <div className="flex gap-3">
              <textarea
                placeholder="例如：做 5 张产品介绍 PPT，每页一个卖点；或：按文档做 5 张配图，风格商务科技…（不上传文件时，仅根据此处说明拆成多页提示词）"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[108px] flex-1 resize-y rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-300"
                rows={4}
              />
            </div>
            <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[11rem] flex-1 space-y-1">
                  <label className="text-xs font-medium text-zinc-700">
                    画布比例
                  </label>
                  <select
                    value={aspectRatioId}
                    onChange={(e) =>
                      setAspectRatioId(
                        e.target.value as (typeof ASPECT_PRESETS)[number]["id"]
                      )
                    }
                    className="mt-0.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800"
                  >
                    {ASPECT_PRESETS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                        {useAspectRatioApi && opt.aspectRatio
                          ? ` → ${opt.aspectRatio}`
                          : opt.size
                            ? ` → ${opt.size}`
                            : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {aspectRatioId === "custom" && useAspectRatioApi && (
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    <label className="text-xs font-medium text-zinc-600">
                      比例枚举（Gemini）
                    </label>
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm"
                      value={customAspectRatio}
                      onChange={(e) => setCustomAspectRatio(e.target.value)}
                    >
                      {GEMINI_ASPECT_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {aspectRatioId === "custom" && !useAspectRatioApi && (
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    <label className="text-xs font-medium text-zinc-600">
                      size WxH（OpenAI）
                    </label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="1792x1024"
                      value={customImageSize}
                      onChange={(e) => setCustomImageSize(e.target.value)}
                    />
                  </div>
                )}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
                  请求参数{" "}
                  <span className="font-mono font-medium text-zinc-900">
                    {useAspectRatioApi ? resolvedAspectRatio : resolvedImageSize}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline"
                >
                  {advancedOpen ? "收起" : "高级 · 单次 n 张"}
                </button>
                <div className="flex items-center gap-2 rounded-xl bg-white/60 px-2 py-1.5 border border-zinc-200/80">
                  <Checkbox
                    id="solution-architect"
                    checked={useSolutionArchitect}
                    onCheckedChange={(v) => setUseSolutionArchitect(!!v)}
                  />
                  <Label htmlFor="solution-architect" className="cursor-pointer text-xs text-zinc-700">
                    顶尖解决方案 PPT 架构师（麦肯锡/BCG/Duarte）
                  </Label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={docPromptLoading}
                  loading={docPromptLoading}
                  className="gap-1.5 rounded-xl border-zinc-300"
                  onClick={handleDocToPrompts}
                  title={docFile ? "根据文档 + 说明生成分页提示词" : "仅根据上方说明拆成多页提示词（无需上传文件）"}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {docFile ? "拉提示词" : "根据说明拆成多页"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={generateLoading}
                  loading={generateLoading}
                  className="gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 shadow-sm"
                  onClick={handleDirectGenerate}
                >
                  <Images className="h-3.5 w-3.5" />
                  直接出图
                </Button>
              </div>
            </div>
            {advancedOpen && (
              <div className="mt-2 flex items-center gap-2 border-t border-dashed border-zinc-100 pt-2 text-xs text-zinc-500">
                <span>direct-generate / 无文档单次 n</span>
                <select
                  value={countN}
                  onChange={(e) => setCountN(Number(e.target.value))}
                  className="rounded border border-zinc-200 bg-white px-2 py-1"
                >
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      n={n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(docTaskPhase !== "idle" || genTaskPhase !== "idle") && (
              <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-xs">
                {docTaskPhase !== "idle" && (
                  <div>
                    <div className="mb-1 flex justify-between font-medium text-zinc-800">
                      <span>拉提示词</span>
                      <span className="text-violet-700">{docTaskHint}</span>
                    </div>
                    {(docTaskPhase === "uploading" || docUploadPct > 0) && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                        <div
                          className="h-full rounded-full bg-zinc-800 transition-[width] duration-150"
                          style={{ width: `${docUploadPct}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-zinc-400">
                      {docTaskPhase === "uploading" && "阶段: uploading"}
                      {docTaskPhase === "parsing" && "阶段: parsing"}
                      {docTaskPhase === "llm" && "阶段: llm"}
                      {docTaskPhase === "done" && "阶段: done"}
                      {docTaskPhase === "error" && "阶段: error"}
                    </div>
                  </div>
                )}
                {genTaskPhase !== "idle" && (
                  <div>
                    <div className="mb-1 flex justify-between font-medium text-zinc-800">
                      <span>出图</span>
                      <span className="text-violet-700">{genTaskHint}</span>
                    </div>
                    {genTaskPhase === "uploading" && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                        <div
                          className="h-full rounded-full bg-violet-600 transition-[width] duration-150"
                          style={{ width: `${genUploadPct}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-zinc-400">
                      {genTaskPhase === "uploading" && "阶段: uploading"}
                      {genTaskPhase === "processing" && "阶段: processing"}
                      {genTaskPhase === "done" && "阶段: done"}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {docPromptContent.length > 0 && (
            <div className="mx-auto mb-6 max-w-2xl overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] ring-1 ring-zinc-100">
              <div className="border-b border-zinc-100 bg-gradient-to-r from-emerald-50/80 to-white px-4 py-3 flex flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-xs font-bold text-white">
                  2
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-zinc-900">提示词与分段</h2>
                  <p className="text-[11px] text-zinc-500">改正文 · 勾选段落 · 对选中出图（追加）</p>
                </div>
              </div>
              <div className="p-4">
              <p className="mb-2 text-xs font-medium text-zinc-600">
                全文编辑
                <span className="font-normal text-emerald-700/90">
                  {" "}
                  · 已自动存本机，刷新/关页再开不丢
                </span>
                <span className="font-normal text-zinc-400">
                  。下方按段勾选再出图，可与 Agent「先试一张 / 全选」一致；结果追加、不覆盖。
                </span>
              </p>
              <textarea
                className="mb-4 max-h-72 min-h-[140px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-900/10"
                value={docPromptContent}
                onChange={(e) => setDocPromptContent(e.target.value)}
              />
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-800">
                  分段 {promptBlocks.length} 段
                  <span className="ml-2 font-normal text-zinc-500">
                    勾选后出图 · 单段单请求
                  </span>
                </p>
                <button
                  type="button"
                  className="text-[11px] text-emerald-700 hover:underline"
                  onClick={() =>
                    setSegmentExpanded((prev) => {
                      if (prev.size === promptBlocks.length)
                        return new Set([0]);
                      return new Set(promptBlocks.map((_, j) => j));
                    })
                  }
                >
                  {segmentExpanded.size >= promptBlocks.length ? "全部折叠" : "全部展开"}
                </button>
              </div>
              <div className="mb-4 max-h-[min(70vh,520px)] space-y-2 overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50/50 p-2">
                {promptBlocks.map((blk, i) => (
                  <div
                    key={`${i}-${blk.label}`}
                    className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-shadow hover:shadow"
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={slideBlockSelected.has(i)}
                        onCheckedChange={() => {
                          setSlideBlockSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-800">
                            {blk.label}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {blk.prompt.length} 字
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-emerald-700 hover:underline"
                            onClick={() =>
                              setSegmentExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              })
                            }
                          >
                            {segmentExpanded.has(i) ? "折叠" : "展开全文"}
                          </button>
                        </div>
                        <pre
                          className={`mt-2 w-full whitespace-pre-wrap break-words rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-700 ${
                            segmentExpanded.has(i)
                              ? "max-h-[min(50vh,360px)] overflow-auto"
                              : "max-h-[4.5rem] overflow-hidden"
                          }`}
                        >
                          {blk.prompt}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() =>
                    setSlideBlockSelected(new Set(promptBlocks.map((_, i) => i)))
                  }
                >
                  全选
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setSlideBlockSelected(new Set())}
                >
                  全不选
                </Button>
              </div>
              <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <Button
                  type="button"
                  size="sm"
                  disabled={generateLoading || slideBlockSelected.size === 0}
                  loading={generateLoading}
                  className="rounded-xl bg-emerald-700 hover:bg-emerald-800 shadow-md"
                  onClick={handleGenerateFromContent}
                >
                  对选中出图 · 已选 {slideBlockSelected.size} 段
                </Button>
                {generateLoading && genTaskHint && (
                  <span className="text-xs text-violet-600">{genTaskHint}</span>
                )}
                <button
                  type="button"
                  className="ml-auto text-xs text-zinc-400 hover:text-red-600"
                  onClick={() => {
                    setDocPromptContent("");
                    saveStored(LS_DOC_PROMPT, "");
                  }}
                >
                  清除正文
                </button>
              </div>
              </div>
            </div>
          )}

          {partialWarning && (
            <Alert className="relative mb-6 rounded-2xl border-amber-200 bg-amber-50 pr-10 text-amber-950">
              <button
                type="button"
                className="absolute right-3 top-3 rounded-lg p-1 text-amber-800 hover:bg-amber-100"
                aria-label="关闭"
                onClick={() => setPartialWarning(null)}
              >
                ×
              </button>
              <strong className="block text-sm">部分成功</strong>
              <p className="mt-1 text-sm opacity-90">{partialWarning}</p>
            </Alert>
          )}
          {lastError && (
            <Alert
              variant="destructive"
              className="relative mb-6 rounded-2xl border-red-200 bg-red-50 pr-10"
            >
              <button
                type="button"
                className="absolute right-3 top-3 rounded-lg p-1 text-red-800 hover:bg-red-100"
                aria-label="关闭"
                onClick={() => setLastError(null)}
              >
                ×
              </button>
              <p className="text-sm">{lastError}</p>
            </Alert>
          )}

          <section className="mx-auto mb-8 max-w-4xl overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm md:p-5">
            <div className="mb-4 flex flex-wrap items-start gap-2 border-b border-zinc-100 pb-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white">
                3
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-zinc-900">
                  出图结果
                  {imageList.length > 0 && (
                    <span className="ml-2 font-normal text-zinc-500">
                      {imageList.length} 张
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-[11px] text-emerald-700/90">
                  本机 IndexedDB 自动保存，刷新/关页再开仍在（勿用无痕/清站数据）
                </p>
              </div>
              {imageList.length > 0 && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                  onClick={async () => {
                    await clearImageListIdb();
                    saveStored(LS_SELECTED_IDS, "[]");
                    setImageList([]);
                    setSelectedIds(new Set());
                    setLastPptBlob(null);
                  }}
                >
                  清空本机出图
                </button>
              )}
            </div>
            {imageList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 py-14 text-center">
                <ImageOff className="mx-auto mb-3 h-12 w-12 text-zinc-300" />
                <p className="text-sm font-medium text-zinc-600">还没有图</p>
                <p className="mt-1 text-xs text-zinc-400">
                  出图后会自动存本机；刷新不丢
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {imageList.map((item) => (
                  <div
                    key={item.id}
                    className="group rounded-2xl border border-zinc-200 bg-white overflow-hidden shadow-sm transition hover:shadow-md hover:border-zinc-300"
                  >
                    <div
                      className={`relative bg-zinc-100 ${
                        useAspectRatioApi && resolvedAspectRatio === "16:9"
                          ? "aspect-video"
                          : useAspectRatioApi && resolvedAspectRatio === "9:16"
                            ? "aspect-[9/16] max-h-64 mx-auto w-2/3"
                            : "aspect-square"
                      }`}
                    >
                      <button
                        type="button"
                        className="absolute inset-0 z-0 cursor-zoom-in border-0 bg-transparent p-0"
                        aria-label="放大预览"
                        onClick={() => setPreviewImage(item)}
                      />
                      <img
                        src={`data:image/png;base64,${item.imageBase64}`}
                        alt=""
                        className="pointer-events-none relative z-0 h-full w-full object-contain"
                      />
                      <div className="absolute top-2 left-2 z-20 flex items-center gap-1 rounded-lg border border-zinc-200 bg-white/95 px-2 py-1 shadow-sm">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />
                        <span className="text-xs font-medium text-zinc-700 flex items-center gap-0.5">
                          <CheckSquare className="h-3 w-3" />
                          PPT
                        </span>
                      </div>
                    </div>
                    <div className="p-2">
                      <p
                        className="text-xs text-zinc-600 line-clamp-2"
                        title={item.prompt}
                      >
                        {item.prompt}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {imageList.length > 0 && (
            <div className="rounded-2xl border border-white/30 bg-white/35 backdrop-blur-xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <p className="text-sm text-zinc-600 flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  已选 <strong>{selectedCount}</strong> 张
                </p>
                <div className="flex gap-3 flex-wrap">
                  <Button
                    onClick={handleExport}
                    disabled={selectedCount === 0 || exportLoading}
                    loading={exportLoading}
                    className="gap-2 min-w-[120px]"
                  >
                    <Download className="h-4 w-4" />
                    导出 PPT
                  </Button>
                  {pptDownloadUrl && (
                    <a
                      href={pptDownloadUrl}
                      download="images_export.pptx"
                      className="inline-flex items-center justify-center gap-2 rounded-full font-medium h-10 px-6 min-w-[120px] bg-zinc-100 border border-zinc-200"
                    >
                      <FileDown className="h-4 w-4" />
                      下载 PPT
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {previewImage && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
          aria-label="图片预览"
          onClick={() => setPreviewImage(null)}
        >
          <div className="flex shrink-0 justify-end pb-2">
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              onClick={() => setPreviewImage(null)}
            >
              关闭 Esc
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={`data:image/png;base64,${previewImage.imageBase64}`}
              alt=""
              className="max-h-[85vh] max-w-full object-contain shadow-2xl"
            />
          </div>
          <p className="mt-2 max-h-24 shrink-0 overflow-y-auto text-center text-xs text-zinc-300">
            {previewImage.prompt}
          </p>
        </div>
      )}
    </div>
  );
}
