/** 内联 SVG 图标，不依赖 lucide-react，避免 npm 未装齐时编译失败 */
import type { ReactNode } from "react";

function Svg({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconSettings({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </Svg>
  );
}
export function IconKey({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </Svg>
  );
}
export function IconLink({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}
export function IconBox({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </Svg>
  );
}
export function IconShieldCheck({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}
export function IconChevronDown({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}
export function IconChevronUp({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  );
}
export function IconPenLine({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}
export function IconSparkles({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    </Svg>
  );
}
export function IconRefreshCw({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Svg>
  );
}
export function IconImages({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M18 22H4a2 2 0 0 1-2-2V6" />
      <path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18" />
      <circle cx="12" cy="8" r="2" />
      <rect width="16" height="16" x="6" y="2" rx="2" />
    </Svg>
  );
}
export function IconImageOff({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
      <path d="M13.5 13.5 6 21" />
      <path d="m18 18 4 4" />
      <path d="M6.5 6.5 4 4" />
      <path d="m9 3 6 6" />
      <path d="M3 3h.01" />
      <path d="m21 21 .01-.01" />
      <path d="M12 12h.01" />
      <path d="M16 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    </Svg>
  );
}
export function IconCheckSquare({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Svg>
  );
}
export function IconDownload({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Svg>
  );
}
export function IconFileDown({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </Svg>
  );
}
/** 回形针，附件 */
export function IconPaperclip({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.38-8.38a4 4 0 0 1 5.66 5.66l-8.38 8.38a2 2 0 0 1-2.83-2.83l7.07-7.07" />
    </Svg>
  );
}
/** 向上箭头发送 */
export function IconArrowUp({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <line x1="12" x2="12" y1="19" y2="8" />
      <path d="m6 12 6-6 6 6" />
    </Svg>
  );
}
