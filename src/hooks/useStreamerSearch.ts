import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StreamerCandidate } from "../types/streamer";

/** 敲字后延迟这么久才真的去搜，避免每敲一字打一次接口（对齐 C# StreamerDialog 的 400ms）。 */
export const STREAMER_SEARCH_DEBOUNCE_MS = 400;

/**
 * 按主播名搜 B 站（后端走主站 search/type + 兜底 search/all/v2）。
 * 只保留最后一次输入的结果，旧请求回来时会被丢弃。
 */
export function useStreamerSearch(debounceMs = STREAMER_SEARCH_DEBOUNCE_MS) {
  const [candidates, setCandidates] = useState<StreamerCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const timerRef = useRef<number | null>(null);
  const versionRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    versionRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsSearching(false);
    setCandidates([]);
    setSearchError("");
  }, []);

  const search = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      versionRef.current += 1;
      const version = versionRef.current;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setCandidates([]);
      setSearchError("");
      if (!trimmed) {
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void (async () => {
          try {
            const results = await invoke<StreamerCandidate[]>(
              "streamer_search",
              { keyword: trimmed },
            );
            if (version !== versionRef.current) {
              return;
            }
            setCandidates(Array.isArray(results) ? results : []);
          } catch (error) {
            if (version !== versionRef.current) {
              return;
            }
            setCandidates([]);
            setSearchError(
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            if (version === versionRef.current) {
              setIsSearching(false);
            }
          }
        })();
      }, debounceMs);
    },
    [debounceMs],
  );

  return { candidates, clear, isSearching, search, searchError };
}
