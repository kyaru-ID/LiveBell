import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openExternalUrl } from "../utils/openExternal";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { avatarSrc } from "../utils/avatar";
import {
  formatNotificationTime,
  notificationDisplayTitle,
  notificationRoomUrl,
  type NotificationRecord,
} from "../types/notification";

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_SECONDS = 6;
// 尺寸对齐 C# 老版 NotificationWindow.xaml 的「大档」：窗口 460x166（含四周 18px 外边距），
// 卡片本体 424x130。窗口按内容高度自适应，只覆盖提醒卡片本身，避免透明区域挡住用户点击。
const WINDOW_WIDTH = 460;
const WINDOW_MIN_HEIGHT = 166;
const WINDOW_MARGIN = 18;

type NotificationConfigShape = {
  notificationDurationSeconds?: number;
  soundEnabled?: boolean;
  autoConnectOnClick?: boolean;
};

export function NotificationWindow() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const durationRef = useRef(DEFAULT_DURATION_SECONDS);
  const soundRef = useRef(true);
  const autoConnectRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef(new Map<string, number>());
  const seenRef = useRef(new Set<string>());

  const hideWhenEmpty = useCallback(() => {
    void invoke("notifications_hide_window").catch(() => undefined);
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timersRef.current.delete(id);
      }
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        if (next.length === 0) {
          hideWhenEmpty();
        }
        return next;
      });
    },
    [hideWhenEmpty],
  );

  const enqueue = useCallback(
    (record: NotificationRecord) => {
      if (!record?.id || seenRef.current.has(record.id)) {
        return;
      }
      seenRef.current.add(record.id);
      setItems((prev) => [record, ...prev].slice(0, MAX_VISIBLE));

      if (soundRef.current && audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => undefined);
      }

      const timer = window.setTimeout(() => {
        // 超时自动消失不标记已读，与 C# 行为一致。
        removeItem(record.id);
      }, Math.max(1, durationRef.current) * 1000);
      timersRef.current.set(record.id, timer);
    },
    [removeItem],
  );

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const config = await invoke<{ notification?: NotificationConfigShape }>(
          "load_app_config",
        );
        if (disposed) return;
        const notification = config?.notification;
        if (notification) {
          durationRef.current =
            notification.notificationDurationSeconds ?? DEFAULT_DURATION_SECONDS;
          soundRef.current = notification.soundEnabled ?? true;
          autoConnectRef.current = notification.autoConnectOnClick ?? true;
        }
      } catch {
        // 读取失败时退回默认值。
      }

      try {
        const pending = await invoke<NotificationRecord[]>(
          "notifications_take_pending",
        );
        if (disposed) return;
        for (const record of [...pending].reverse()) {
          enqueue(record);
        }
      } catch {
        // 无待展示通知时忽略。
      }
    })();

    const unlistenPromise = listen<NotificationRecord>(
      "notification-push",
      (event) => enqueue(event.payload),
    );
    const unlistenConfigPromise = listen("app-config-changed", () => {
      void invoke<{ notification?: NotificationConfigShape }>("load_app_config")
        .then((config) => {
          const notification = config?.notification;
          if (!notification) return;
          durationRef.current =
            notification.notificationDurationSeconds ?? DEFAULT_DURATION_SECONDS;
          soundRef.current = notification.soundEnabled ?? true;
          autoConnectRef.current = notification.autoConnectOnClick ?? true;
        })
        .catch(() => undefined);
    });

    return () => {
      disposed = true;
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
      void unlistenPromise.then((unlisten) => unlisten());
      void unlistenConfigPromise.then((unlisten) => unlisten());
    };
  }, [enqueue]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let cancelled = false;

    const apply = () => {
      // 多留 1px：内容高度与窗口高度完全相等时，WebView 偶发出现覆盖式滚动条，
      // 而卡片在滚动条出现时会被顶宽、最右侧的 × 按钮跟着被裁掉。
      const height = Math.max(
        WINDOW_MIN_HEIGHT,
        Math.ceil(element.getBoundingClientRect().height) + 1,
      );
      void (async () => {
        try {
          const win = getCurrentWindow();
          await win.setSize(new LogicalSize(WINDOW_WIDTH, height));
          const monitor = await currentMonitor();
          if (!monitor || cancelled) return;
          const area = monitor.workArea;
          // 不再读 outerSize()：setSize 之后它常常还是旧值，用旧宽度算右下角会把窗口摆到屏幕外、
          // 右侧被屏幕边缘切掉。这里拿已知的逻辑尺寸乘缩放比直接换算成物理像素。
          const scale = monitor.scaleFactor || 1;
          const physicalWidth = Math.round(WINDOW_WIDTH * scale);
          const physicalHeight = Math.round(height * scale);
          const margin = Math.round(WINDOW_MARGIN * scale);
          const x = area.position.x + area.size.width - physicalWidth - margin;
          const y = area.position.y + area.size.height - physicalHeight - margin;
          await win.setPosition(
            new PhysicalPosition(
              Math.max(area.position.x, x),
              Math.max(area.position.y, y),
            ),
          );
        } catch {
          // 窗口正在隐藏或已销毁时忽略。
        }
      })();
    };

    apply();
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  async function handleOpen(record: NotificationRecord) {
    void invoke("notifications_mark_read", { id: record.id }).catch(
      () => undefined,
    );
    const url = notificationRoomUrl(record.roomId);
    if (url) {
      void openExternalUrl(url).catch(() => undefined);
      if (autoConnectRef.current) {
        void invoke("connect_bilibili_room", {
          requestedRoomId: Number(record.roomId),
        }).catch(() => undefined);
      }
    }
    removeItem(record.id);
  }

  function handleDismiss(record: NotificationRecord) {
    void invoke("notifications_mark_read", { id: record.id }).catch(
      () => undefined,
    );
    removeItem(record.id);
  }

  return (
    <div
      className="pointer-events-none box-border flex w-full flex-col justify-end gap-2 overflow-hidden p-[18px]"
      ref={rootRef}
    >
      <audio preload="auto" ref={audioRef} src="/notification.mp3" />
      {items.map((record) => {
        const cover = avatarSrc(record.avatarPath);
        return (
          // 卡片规格照搬 C# 老版 NotificationWindow.xaml：白底、圆角 20、
          // 网格列 48|14|*（48x48 圆角 14 的头像 + 14px 间隔 + 文字列）、
          // "《主播》 已开播！" 16px #18191C、直播间标题 13px #6B7280、
          // "点击进入直播间" 11px #FB7299、右上角 24x24 的 × 关闭。
          <div
            className="pointer-events-auto relative box-border grid min-h-[130px] w-full cursor-pointer select-none grid-cols-[48px_minmax(0,1fr)] items-center gap-x-[14px] rounded-[20px] border border-white/10 bg-white p-5 text-left shadow-[0_6px_26px_rgba(0,26,42,0.34)] transition hover:bg-[#fcfdff]"
            key={record.id}
            onClick={() => void handleOpen(record)}
            role="button"
            tabIndex={0}
          >
            {/* mb-[22px] 复刻老版头像的 Margin="0,0,0,22"：让头像只跟上面两行（主播名 + 标题）居中，
                而不是跟「点击进入直播间」那行一起居中，否则头像会明显偏低。 */}
            <span className="mb-[22px] grid size-12 shrink-0 place-items-center self-center overflow-hidden rounded-[14px] bg-[#eaf7ff] text-base font-black text-[#2b7fa8]">
              {cover ? (
                <img
                  alt=""
                  className="h-12 w-12 object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                  src={cover}
                />
              ) : (
                record.streamerName.slice(0, 1) || "诶"
              )}
            </span>
            <div className="mr-[26px] flex min-w-0 flex-col self-center">
              <p className="m-0 truncate text-[16px] text-[#18191c]">
                <strong className="font-bold">{record.streamerName}</strong>
                <span className="font-semibold"> 已开播！</span>
              </p>
              <p className="mt-2 mb-0 truncate text-[13px] text-[#6b7280]">
                {notificationDisplayTitle(record)}
              </p>
              <p className="mt-[7px] mb-0 flex items-center gap-2 text-[11px] text-[#fb7299]">
                点击进入直播间
                <span className="text-[10px] text-[#a0a5ad]">
                  {formatNotificationTime(record.time)}
                </span>
              </p>
            </div>
            {/* 老版把 × 放在卡片 Padding=0 的内层 Grid 里、Margin 0,6,6,0 贴卡片右上角；
                这里用绝对定位复刻，避免它参与网格列宽计算而被挤出视口。 */}
            <button
              aria-label="关闭提醒"
              className="absolute top-[6px] right-[6px] size-6 cursor-pointer rounded-md border-0 bg-transparent p-0 text-center text-sm leading-6 text-[#9aa1a9] hover:bg-black/5 hover:text-[#4b5563]"
              onClick={(event) => {
                event.stopPropagation();
                handleDismiss(record);
              }}
              type="button"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function currentWindowLabel() {
  return getCurrentWindow().label;
}
