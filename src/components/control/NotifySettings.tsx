import { useRef, useState } from "react";
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
  onUpdateNotification: (patch: Partial<NotificationConfig>) => void | Promise<void>;
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
  const [savingField, setSavingField] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function persistNotification(
    patch: Partial<NotificationConfig>,
    field: string,
    successMessage: string,
  ) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingField(field);
    setError(null);
    setMessage("正在保存设置…");
    try {
      await onUpdateNotification(patch);
      setMessage(successMessage);
    } catch (saveError) {
      setMessage(null);
      setError(`保存失败，请重试：${saveError instanceof Error ? saveError.message : String(saveError)}`);
    } finally {
      savingRef.current = false;
      setSavingField(null);
    }
  }

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
    void persistNotification(
      { monitorIntervalSeconds: next },
      "interval",
      `开播检测间隔已保存：${next} 秒`,
    );
  }

  function saveDuration() {
    const next = parseClamped(
      draftDuration,
      1,
      60,
      notification.notificationDurationSeconds,
    );
    setDraftDuration(String(next));
    void persistNotification(
      { notificationDurationSeconds: next },
      "duration",
      `提醒停留时长已保存：${next} 秒`,
    );
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
            <div className="grid min-w-[220px] grid-cols-[minmax(0,1fr)_80px] gap-2 max-[519px]:min-w-0">
              <Input
                disabled={savingField !== null}
                id="notify-interval-input"
                inputMode="numeric"
                max={60}
                min={2}
                onChange={(event) => setDraftInterval(event.currentTarget.value)}
                type="number"
                value={draftInterval}
              />
              <Button aria-label="保存检测间隔" disabled={savingField !== null} onClick={saveInterval}>
                {savingField === "interval" ? "保存中…" : "保存"}
              </Button>
            </div>
          }
          description="检测间隔，单位秒（2 - 60）"
          htmlFor="notify-interval-input"
          label="检测间隔"
        />
        <SettingsRow
          control={
            <div className="grid min-w-[220px] grid-cols-[minmax(0,1fr)_80px] gap-2 max-[519px]:min-w-0">
              <Input
                disabled={savingField !== null}
                id="notify-duration-input"
                inputMode="numeric"
                max={60}
                min={1}
                onChange={(event) => setDraftDuration(event.currentTarget.value)}
                type="number"
                value={draftDuration}
              />
              <Button aria-label="保存停留时长" disabled={savingField !== null} onClick={saveDuration}>
                {savingField === "duration" ? "保存中…" : "保存"}
              </Button>
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
              disabled={savingField !== null}
              checked={notification.soundEnabled}
              onCheckedChange={(checked) =>
                void persistNotification({ soundEnabled: checked }, "sound", "提醒声音设置已保存")
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
              disabled={savingField !== null}
              checked={notification.popupEnabled}
              onCheckedChange={(checked) =>
                void persistNotification({ popupEnabled: checked }, "popup", "软件弹窗设置已保存")
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
              disabled={savingField !== null}
              checked={notification.windowsToastEnabled}
              onCheckedChange={(checked) =>
                void persistNotification({ windowsToastEnabled: checked }, "toast", "系统通知设置已保存")
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
              disabled={savingField !== null}
              checked={notification.autoConnectOnClick}
              onCheckedChange={(checked) =>
                void persistNotification({ autoConnectOnClick: checked }, "autoConnect", "点击连弹幕设置已保存")
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
              disabled={savingField !== null}
              checked={notification.showLiveDuration}
              onCheckedChange={(checked) =>
                void persistNotification({ showLiveDuration: checked }, "durationBadge", "开播时长显示设置已保存")
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
        <StatusBanner description={message} title={savingField ? "保存中" : "已完成"} tone={savingField ? "neutral" : "success"} />
      ) : null}

      {error ? (
        <StatusBanner description={error} title="操作失败" tone="danger" />
      ) : null}
    </SettingsPage>
  );
}
