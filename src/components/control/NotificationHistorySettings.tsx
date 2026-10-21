import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openExternalUrl } from "../../utils/openExternal";
import {
  formatNotificationTime,
  notificationDisplayTitle,
  notificationRoomUrl,
  type NotificationRecord,
} from "../../types/notification";
import { avatarSrc } from "../../utils/avatar";
import { Button } from "../ui";
import {
  EmptyState,
  SettingsPage,
  SettingsSection,
  StatusBanner,
} from "./settings-ui";

export function NotificationHistorySettings() {
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [showRead, setShowRead] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await invoke<NotificationRecord[]>("notifications_list");
      setRecords(next);
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
    const unlistenPromise = listen("notifications-changed", () => {
      void load();
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [load]);

  const unreadCount = records.filter((record) => !record.isRead).length;
  const visibleRecords = showRead
    ? records
    : records.filter((record) => !record.isRead);

  async function openRecord(record: NotificationRecord) {
    try {
      if (!record.isRead) {
        await invoke("notifications_mark_read", { id: record.id });
      }
    } catch (markError) {
      setError(String(markError));
    }
    const url = notificationRoomUrl(record.roomId);
    if (url) {
      void openExternalUrl(url).catch(() => undefined);
    }
  }

  async function markAllRead() {
    try {
      await invoke("notifications_mark_all_read");
      await load();
    } catch (markError) {
      setError(String(markError));
    }
  }

  async function clearAll() {
    try {
      await invoke("notifications_clear");
      setConfirmingClear(false);
      await load();
    } catch (clearError) {
      setError(String(clearError));
    }
  }

  return (
    <SettingsPage>
      {/* 确认条放在页面顶部：列表很长时它原本会落在最底下，点「清空」后根本看不见。 */}
      {confirmingClear ? (
        <StatusBanner
          actions={
            <div className="flex items-center gap-1.5">
              <Button onClick={() => setConfirmingClear(false)} size="sm">
                取消
              </Button>
              <Button
                onClick={() => void clearAll()}
                size="sm"
                variant="danger"
              >
                确认清空
              </Button>
            </div>
          }
          description="清空后无法恢复，将删除全部开播提醒记录"
          title="确认清空全部开播提醒记录？"
          tone="danger"
        />
      ) : null}

      {error ? (
        <StatusBanner description={error} title="提醒记录操作失败" tone="danger" />
      ) : null}

      <SettingsSection
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button onClick={() => setShowRead((current) => !current)} size="sm">
              {showRead ? "只看未读" : "显示已读"}
            </Button>
            <Button
              disabled={unreadCount === 0}
              onClick={() => void markAllRead()}
              size="sm"
            >
              全部标为已读
            </Button>
            <Button
              disabled={records.length === 0}
              onClick={() => setConfirmingClear(true)}
              size="sm"
              variant="danger"
            >
              清空
            </Button>
          </div>
        }
        description={`共 ${records.length} 条，未读 ${unreadCount > 99 ? "99+" : unreadCount} 条`}
        title="开播提醒记录"
      >
        {visibleRecords.length === 0 ? (
          <div className="p-3">
            <EmptyState
              description={
                showRead
                  ? "还没有任何开播提醒记录"
                  : "没有未读提醒，点上方“显示已读”查看全部记录"
              }
              title="暂无提醒"
            />
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {visibleRecords.map((record) => (
              <li
                className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-t border-drift-line px-3 py-2 first:border-t-0"
                key={record.id}
              >
                {/* 头像对齐 C# 老版通知列表：42px 圆形，取主播头像缓存。 */}
                <NotificationAvatar
                  name={record.streamerName}
                  path={record.avatarPath}
                />
                <button
                  className="grid min-w-0 cursor-pointer gap-0.5 border-0 bg-transparent p-0 text-left"
                  onClick={() => void openRecord(record)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {!record.isRead ? (
                      <span
                        aria-label="未读"
                        className="size-1.5 shrink-0 rounded-full bg-[var(--drift-ui-signal)]"
                      />
                    ) : null}
                    <strong className="drift-theme-transition truncate text-[11px] text-drift-ink">
                      {record.streamerName} 已开播！
                    </strong>
                    <span className="drift-data-text shrink-0 text-[9px] text-[var(--drift-ui-subtle)]">
                      {formatNotificationTime(record.time)}
                    </span>
                  </span>
                  <span className="drift-theme-transition truncate text-[10px] text-[var(--drift-ui-ink-soft)]">
                    {notificationDisplayTitle(record)}
                  </span>
                </button>
                <div className="flex items-center gap-1.5">
                  {!record.isRead ? (
                    <Button
                      onClick={(event) => {
                        event.stopPropagation();
                        void invoke("notifications_mark_read", {
                          id: record.id,
                        }).catch((markError) => setError(String(markError)));
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      标为已读
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void openRecord(record)}
                    size="sm"
                    variant="secondary"
                  >
                    打开直播间
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

/** 42px 圆形头像，对齐 C# 老版通知列表；没有缓存图（或加载失败）时退回主播名首字。 */
function NotificationAvatar({
  name,
  path,
}: {
  name: string;
  path?: string | null;
}) {
  const src = avatarSrc(path);
  const [failed, setFailed] = useState(false);

  return (
    <span className="grid size-[42px] shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--drift-ui-selected)] text-[15px] font-semibold text-[var(--drift-ui-ink-soft)]">
      {src && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}
