import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStreamerSearch } from "../hooks/useStreamerSearch";
import {
  MAX_SAVED_ROOMS,
  type AppConfig,
  type SavedRoom,
} from "../types/config";
import {
  STREAMER_NOT_FOUND_HINT,
  type StreamerCandidate,
} from "../types/streamer";
import { roomIdFromInput } from "../utils/roomId";
import { Button, Input } from "./ui";
import { StatusBanner } from "./control/settings-ui";
import { StreamerCandidateList } from "./StreamerCandidateList";

type StreamerDialogOpened = {
  savedRoomId: string | null;
};

/** 与 useSavedRooms 同款 id 生成（窗口是独立 webview，拿不到主界面的 hook 实例）。 */
function createSavedRoomId() {
  return `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新主播排在列表最前（与 useSavedRooms 的 nextSavedRoomOrder 一致）。 */
function nextSavedRoomOrder(rooms: SavedRoom[]) {
  return rooms.reduce((min, room) => Math.min(min, room.order), 0) - 1;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 「主播信息」独立窗口：对齐 C# Views/StreamerDialog.xaml。
 * 新增和编辑共用；窗口内可搜主播名、填房间号/直播间链接、勾选分组，编辑时还能删除。
 */
export function StreamerDialogWindow() {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { candidates, clear, isSearching, search, searchError } =
    useStreamerSearch();

  const roomId = roomIdFromInput(roomInput);
  const groups = config?.savedRoomGroups ?? [];

  const loadConfig = useCallback(async () => {
    try {
      const loaded = await invoke<AppConfig>("load_app_config");
      setConfig(loaded);
      return loaded;
    } catch (loadError) {
      setError(errorMessage(loadError));
      return null;
    }
  }, []);

  const applyTarget = useCallback(
    (savedRoomId: string | null, loaded: AppConfig | null) => {
      setConfirmDelete(false);
      setError(null);
      clear();
      const room =
        savedRoomId && loaded
          ? loaded.savedRooms.find((candidate) => candidate.id === savedRoomId)
          : undefined;
      if (room) {
        setEditingId(room.id);
        setName(room.displayName);
        setRoomInput(room.roomId);
        setGroupIds(room.groupIds);
        return;
      }
      setEditingId(null);
      setName("");
      setRoomInput("");
      setGroupIds([]);
    },
    [clear],
  );

  function focusName() {
    window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 40);
  }

  useEffect(() => {
    // 窗口可能是刚建出来的，事件已经发过了，所以先主动取一次待处理目标。
    void (async () => {
      const loaded = await loadConfig();
      const pending = await invoke<string | null>(
        "streamer_dialog_target",
      ).catch(() => null);
      applyTarget(pending ?? null, loaded);
      focusName();
    })();

    const unlisten = listen<StreamerDialogOpened>(
      "streamer-dialog-opened",
      (event) => {
        const target = event.payload?.savedRoomId ?? null;
        void (async () => {
          const loaded = await loadConfig();
          applyTarget(target, loaded);
          focusName();
        })();
      },
    );

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void hideWindow();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      void unlisten.then((unlistenFn) => unlistenFn());
    };
  }, [applyTarget, loadConfig]);

  // 输入里明显是房间号/直播间链接时不搜主播，省一次接口调用。
  useEffect(() => {
    if (!name.trim() || roomIdFromInput(name)) {
      clear();
      return;
    }
    search(name);
  }, [clear, name, search]);

  async function hideWindow() {
    try {
      await invoke("hide_streamer_dialog_window");
    } catch (hideError) {
      setError(errorMessage(hideError));
    }
  }

  /** 点了候选主播：填名字和房间号（与 C# StreamerDialog.SelectCandidate 一致）。 */
  function selectCandidate(candidate: StreamerCandidate) {
    setName(candidate.name);
    if (candidate.roomId && candidate.roomId > 0) {
      setRoomInput(String(candidate.roomId));
      setError(null);
    } else {
      setRoomInput("");
      setError("该用户暂未开通直播间。");
    }
    clear();
  }

  function hintText() {
    if (searchError) {
      return `搜索主播失败：${searchError}`;
    }
    if (isSearching) {
      return "正在搜索主播…";
    }
    if (candidates.length > 0) {
      return `搜到 ${candidates.length} 个主播，按回车选第一个`;
    }
    if (name.trim() && !roomId) {
      return STREAMER_NOT_FOUND_HINT;
    }
    return "";
  }

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      setError("请输入主播名称。");
      return;
    }
    if (!roomId) {
      setError("请输入有效房间号或 live.bilibili.com 链接。");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const loaded = await invoke<AppConfig>("load_app_config");
      const duplicated = loaded.savedRooms.find(
        (room) => room.id !== editingId && room.roomId === roomId,
      );
      if (duplicated) {
        setError(`直播间 ${roomId} 已经在关注列表里了。`);
        return;
      }
      if (!editingId && loaded.savedRooms.length >= MAX_SAVED_ROOMS) {
        setError(`第一版最多支持同时关注 ${MAX_SAVED_ROOMS} 位主播。`);
        return;
      }

      const validGroupIds = new Set(
        loaded.savedRoomGroups.map((group) => group.id),
      );
      const nextGroupIds = groupIds.filter((groupId) =>
        validGroupIds.has(groupId),
      );
      const now = new Date().toISOString();
      const savedRooms = editingId
        ? loaded.savedRooms.map((room) =>
            room.id === editingId
              ? {
                  ...room,
                  displayName: nextName,
                  anchorName: nextName,
                  roomId,
                  groupIds: nextGroupIds,
                  updatedAt: now,
                }
              : room,
          )
        : [
            {
              id: createSavedRoomId(),
              roomId,
              displayName: nextName,
              anchorName: nextName,
              groupIds: nextGroupIds,
              order: nextSavedRoomOrder(loaded.savedRooms),
              isEnabled: true,
              liveState: "unknown" as const,
              updatedAt: now,
            },
            ...loaded.savedRooms,
          ];

      const saved = await invoke<AppConfig>("save_app_config", {
        config: { ...loaded, savedRooms },
      });
      setConfig(saved);
      await invoke("hide_streamer_dialog_window");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeRoom() {
    if (!editingId) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const loaded = await invoke<AppConfig>("load_app_config");
      const saved = await invoke<AppConfig>("save_app_config", {
        config: {
          ...loaded,
          savedRooms: loaded.savedRooms.filter((room) => room.id !== editingId),
          selectedSavedRoomIds: loaded.selectedSavedRoomIds.filter(
            (roomId) => roomId !== editingId,
          ),
        },
      });
      setConfig(saved);
      await invoke("hide_streamer_dialog_window");
    } catch (removeError) {
      setError(errorMessage(removeError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="drift-theme-transition box-border flex h-screen w-screen flex-col gap-3 bg-[var(--drift-ui-surface)] p-4 text-[var(--drift-ui-ink)]">
      <div className="grid gap-1">
        <h1 className="text-sm font-semibold">
          {editingId ? "编辑主播" : "添加主播"}
        </h1>
        <p className="text-[11px] text-[var(--drift-ui-muted)]">
          输入主播名可以搜 B 站，也可以直接填房间号或直播间链接。
        </p>
      </div>

      <div className="relative grid gap-2">
        <label
          className="text-[11px] text-[var(--drift-ui-muted)]"
          htmlFor="streamer-name"
        >
          主播名称（可直接搜索）
        </label>
        <Input
          aria-label="主播名称"
          autoFocus
          id="streamer-name"
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) {
              return;
            }
            if (!roomIdFromInput(name) && candidates.length > 0) {
              event.preventDefault();
              selectCandidate(candidates[0]);
            }
          }}
          placeholder="输入主播名搜索"
          ref={nameInputRef}
          value={name}
        />
        <StreamerCandidateList
          candidates={roomIdFromInput(name) ? [] : candidates}
          onSelect={selectCandidate}
        />
      </div>

      <div className="grid gap-2">
        <label
          className="text-[11px] text-[var(--drift-ui-muted)]"
          htmlFor="streamer-room"
        >
          房间号或直播间链接
        </label>
        <Input
          aria-label="房间号或直播间链接"
          id="streamer-room"
          onChange={(event) => setRoomInput(event.currentTarget.value)}
          placeholder="房间号或直播间链接"
          value={roomInput}
        />
        <span className="min-h-[16px] text-[11px] text-[var(--drift-ui-ink-soft)]">
          {hintText()}
        </span>
      </div>

      <div className="grid min-h-0 gap-2">
        <span className="text-[11px] text-[var(--drift-ui-muted)]">
          分组（可多选，都不选就是未分组）
        </span>
        <div className="flex max-h-[132px] min-h-[44px] flex-wrap content-start gap-1 overflow-y-auto rounded-xl border border-drift-line bg-[var(--drift-ui-surface-soft)] p-2">
          {groups.length === 0 ? (
            <span className="text-[11px] text-[var(--drift-ui-muted)]">
              还没有分组
            </span>
          ) : (
            groups.map((group) => {
              const selected = groupIds.includes(group.id);
              return (
                <button
                  aria-label={`选择分组 ${group.name}`}
                  aria-pressed={selected}
                  className={
                    selected
                      ? "drift-theme-transition rounded-full border border-drift-signal bg-drift-raised px-2 py-0.5 text-[11px] font-semibold text-drift-ink"
                      : "drift-theme-transition rounded-full border border-drift-line px-2 py-0.5 text-[11px] font-semibold text-[var(--drift-ui-muted)]"
                  }
                  key={group.id}
                  onClick={() =>
                    setGroupIds((current) =>
                      current.includes(group.id)
                        ? current.filter((groupId) => groupId !== group.id)
                        : [...current, group.id],
                    )
                  }
                  type="button"
                >
                  {group.name}
                </button>
              );
            })
          )}
        </div>
      </div>

      {error ? (
        <StatusBanner description={error} title="保存失败" tone="danger" />
      ) : null}

      {confirmDelete ? (
        <StatusBanner
          actions={
            <div className="flex gap-2">
              <Button onClick={() => setConfirmDelete(false)} size="sm">
                取消
              </Button>
              <Button
                disabled={isSaving}
                onClick={() => void removeRoom()}
                size="sm"
                variant="danger"
              >
                确认删除
              </Button>
            </div>
          }
          description="删除后不再监听这位主播，分组里的其它主播不受影响。"
          title="确定删除这个关注？"
          tone="warning"
        />
      ) : null}

      <div className="mt-auto flex items-center gap-2">
        {editingId ? (
          <Button
            disabled={isSaving}
            onClick={() => setConfirmDelete(true)}
            variant="danger"
          >
            删除
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button onClick={() => void hideWindow()}>取消</Button>
        {/* 对齐 C# 老版：按钮可点，缺什么就在下方横幅里说清楚，避免用户干瞪眼。 */}
        <Button
          disabled={isSaving}
          onClick={() => void save()}
          variant="primary"
        >
          {isSaving ? "保存中…" : "保存"}
        </Button>
      </div>
    </main>
  );
}
