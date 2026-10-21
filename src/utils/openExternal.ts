import { invoke } from "@tauri-apps/api/core";

/**
 * 用系统默认浏览器打开外部链接。
 *
 * 走的是后端自建命令 `open_external_url`（src-tauri/src/external_open.rs），不再用
 * tauri-plugin-opener：它内部的 ShellExecuteExW 路径实测返回成功却打不开浏览器，
 * 自建命令用 `cmd /c start` 且会把失败原因返回给调用方。
 */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
