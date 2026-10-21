import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 开机自启状态：后端直接读写 HKCU 的 Run 项（对齐 C# AutoStartService），
 * 所以这里不做本地持久化，每次挂载都从注册表读一次真值。
 */
export function useAutoStart() {
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);
  const [isAutoStartBusy, setIsAutoStartBusy] = useState(false);
  const disposedRef = useRef(false);

  const refreshAutoStart = useCallback(async () => {
    try {
      const enabled = await invoke<boolean>("autostart_is_enabled");
      if (disposedRef.current) {
        return;
      }
      setAutoStartEnabled(enabled);
      setAutoStartError(null);
    } catch (error) {
      if (!disposedRef.current) {
        setAutoStartError(String(error));
      }
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    void refreshAutoStart();
    return () => {
      disposedRef.current = true;
    };
  }, [refreshAutoStart]);

  const toggleAutoStart = useCallback(async (enabled: boolean) => {
    setIsAutoStartBusy(true);
    setAutoStartError(null);
    try {
      await invoke("autostart_set_enabled", { enabled });
      if (!disposedRef.current) {
        setAutoStartEnabled(enabled);
      }
    } catch (error) {
      if (!disposedRef.current) {
        setAutoStartError(String(error));
      }
    } finally {
      if (!disposedRef.current) {
        setIsAutoStartBusy(false);
      }
    }
  }, []);

  return {
    autoStartEnabled,
    autoStartError,
    isAutoStartBusy,
    refreshAutoStart,
    toggleAutoStart,
  };
}
