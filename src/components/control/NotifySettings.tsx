import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, NotificationConfig } from "../../types/config";
import { Button, Input, Toggle } from "../ui";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusBanner,
} from "./settings-ui";

type NotifySettingsProps = {
  config: AppConfig;
  onUpdateNotification: (patch: Partial<NotificationConfig>) => void;
};

type LiveStatusUpdate = {
  roomId?: string;
  isLive?: boolean;
};

export function NotifySettings({
  config,
  onUpdateNotification,
}: NotifySettingsProps) {
  const notification = config.notification;
  const enabledRooms = config.savedRooms.filter((room) => room.isEnabled);
  const [draftInterval, setDraftInterval] = useState(
    String(notification.monitorIntervalSeconds),
  );
  const [draftDuration, setDraftDuration] = useState(
    String(notification.notificationDurationSeconds),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  function parseClamped(value: string, min: number, max: number, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function saveInterval() {
    const next = parseClamped(
      draftInterval,
      2,
      60,
      notification.monitorIntervalSeconds,
    );
    setDraftInterval(String(next));
    onUpdateNotification({ monitorIntervalSeconds: next });
    setMessage(`开播检测间隔已保存：${next} 秒`);
    setError(null);
  }

  function saveDuration() {
    const next = parseClamped(
      draftDuration,
      1,
      60,
      notification.notificationDurationSeconds,
    );
    setDraftDuration(String(next));
    onUpdateNotification({ notificationDurationSeconds: next });
    setMessage(`提醒停留时长已保存：${next} 秒`);
    setError(null);
  }

  async function testNotification() {
    setError(null);
    setMessage(null);
    try {
      await invoke("notifications_test");
      setMessage("已发送一条测试提醒");
    } catch (testError) {
      setError(String(testError));
    }
  }

  async function checkNow() {
    setIsChecking(true);
    setError(null);
    setMessage(null);
    try {
      const updates = await invoke<LiveStatusUpdate[]>("live_check_now");
      const liveCount = updates.filter((update) => update.isLive).length;
      setMessage(`已检测 ${updates.length} 个直播间，其中 ${liveCount} 个正在直播`);
    } catch (checkError) {
      setError(String(checkError));
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <SettingsPage>
      <SettingsSection
        description={`当前 ${config.savedRooms.length} 个关注里有 ${enabledRooms.length} 个开着提醒；全部关注都会检测开播状态，关掉提醒的直播间只更新状态、不弹提醒`}
        title="开播提醒"
      >
        <SettingsRow
          control={
            <div className="grid min-w-[220px] grid-cols-[minmax(0,1fr)_64px] gap-2 max-[519px]:min-w-0">
              <Input
                id="notify-interval-input"
                inputMode="numeric"
                max={60}
                min={2}
                onChange={(event) => setDraftInterval(event.currentTarget.value)}
                type="number"
                value={draftInterval}
              />
              <Button onClick={saveInterval}>保存</Button>
            </div>
          }
          description="检测间隔，单位秒（2 - 60）"
          htmlFor="notify-interval-input"
          label="检测间隔"
        />
        <SettingsRow
          control={
            <div className="grid min-w-[220px] grid-cols-[minmax(0,1fr)_64px] gap-2 max-[519px]:min-w-0">
              <Input
                id="notify-duration-input"
                inputMode="numeric"
                max={60}
                min={1}
                onChange={(event) => setDraftDuration(event.currentTarget.value)}
                type="number"
                value={draftDuration}
              />
              <Button onClick={saveDuration}>保存</Button>
            </div>
          }
          description="软件内提醒自动消失的时间，单位秒（1 - 60）"
          htmlFor="notify-duration-input"
          label="停留时长"
        />
        <SettingsRow
          control={
            <Toggle
              aria-label="提醒声音"
              checked={notification.soundEnabled}
              onCheckedChange={(checked) =>
                onUpdateNotification({ soundEnabled: checked })
              }
            />
          }
          description="开播时播放提示音"
          label="提醒声音"
        />
        <SettingsRow
          control={
            <Toggle
              aria-label="软件弹窗"
              checked={notification.popupEnabled}
              onCheckedChange={(checked) =>
                onUpdateNotification({ popupEnabled: checked })
              }
            />
          }
          description="右下角弹出提醒卡片，点击进入直播间"
          label="软件弹窗"
        />
        <SettingsRow
          control={
            <Toggle
              aria-label="Windows 系统通知"
              checked={notification.windowsToastEnabled}
              onCheckedChange={(checked) =>
                onUpdateNotification({ windowsToastEnabled: checked })
              }
            />
          }
          description="在通知中心留一条记录，之后可以回看、点击"
          label="系统通知"
        />
        <SettingsRow
          control={
            <Toggle
              aria-label="点击提醒时自动连接弹幕"
              checked={notification.autoConnectOnClick}
              onCheckedChange={(checked) =>
                onUpdateNotification({ autoConnectOnClick: checked })
              }
            />
          }
          description="点击提醒卡片打开直播间时，同时连接该房间的弹幕"
          label="点击连弹幕"
        />
        <SettingsRow
          control={
            <Toggle
              aria-label="显示已开播时长"
              checked={notification.showLiveDuration}
              onCheckedChange={(checked) =>
                onUpdateNotification({ showLiveDuration: checked })
              }
            />
          }
          description="在直播中的关注卡片上显示「已开播多久」"
          label="显示已开播时长"
        />
      </SettingsSection>

      <SettingsSection description="立即验证提醒链路是否正常" title="测试">
        <SettingsRow
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void checkNow()} disabled={isChecking}>
                {isChecking ? "检测中…" : "立即检测"}
              </Button>
              <Button onClick={() => void testNotification()} variant="primary">
                发送测试提醒
              </Button>
            </div>
          }
          description="立即检测：立刻轮询一次全部关注的主播；发送测试提醒：走完整的提醒链路（弹窗 + 声音 + 系统通知）"
          label="动手试试"
        />
      </SettingsSection>

      {message ? (
        <StatusBanner description={message} title="已完成" tone="success" />
      ) : null}

      {error ? (
        <StatusBanner description={error} title="操作失败" tone="danger" />
      ) : null}
    </SettingsPage>
  );
}
