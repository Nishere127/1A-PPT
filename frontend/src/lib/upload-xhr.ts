/**
 * multipart POST + 上传进度（Agent/前端均可复用同一逻辑感知 uploading 阶段）
 */
export function postFormWithUploadProgress(
  url: string,
  form: FormData,
  onProgress: (percent: number) => void
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((100 * e.loaded) / e.total)));
      } else {
        onProgress(0);
      }
    };
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body: xhr.responseText || "",
      });
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("请求超时"));
    xhr.timeout = 600_000; // 10 分钟，大文件 + 慢盘
    xhr.send(form);
  });
}
