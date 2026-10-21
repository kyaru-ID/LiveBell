import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 本地头像路径 → webview 能加载的 URL。
 *
 * 后端把主播头像下载缓存到程序旁的 Data/Avatars（见 src-tauri/src/bilibili/avatar_cache.rs），
 * webview 出于安全不能直接读文件系统，必须走 convertFileSrc 转成 asset 协议地址。
 * 路径缺失或不在 Tauri 环境（单元测试）时返回 undefined，调用方自行回退到首字占位。
 */
export function avatarSrc(path?: string | null): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return convertFileSrc(trimmed);
  } catch {
    return undefined;
  }
}
