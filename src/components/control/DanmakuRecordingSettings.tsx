import type { DanmakuRecordingStatus } from "../../types/recording";
import { Button, Toggle } from "../ui";
import {
  SettingsRow,
  SettingsSection,
  StatusBanner,
  StatusDot,
  type StatusTone,
} from "./settings-ui";

export type DanmakuRecordingSettingsProps = {
  commandError: string;
  onEnabledChange: (enabled: boolean) => void | Promise<void>;
  onOpenDirectory: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  status: DanmakuRecordingStatus;
};

/** 「本地记录」区块，挂在「弹幕显示」页。 */
export function DanmakuRecordingSettings({
  commandError,
  onEnabledChange,
  onOpenDirectory,
  onRetry,
  status,
}: DanmakuRecordingSettingsProps) {
  return (
    <SettingsSection
      actions={
        <Button onClick={onOpenDirectory} size="sm">
          打开记录目录
        </Button>
      }
      description="按本机日期和真实房间号保存四类直播消息"
      title="本地记录"
    >
      <SettingsRow
        control={
          <Toggle
            aria-label="记录弹幕"
            checked={status.enabled}
            onCheckedChange={onEnabledChange}
          />
        }
        description="开启状态会持久化，连接直播间后自动开始记录"
        label="记录弹幕"
      />
      <SettingsRow
        control={
          <StatusDot
            label={recordingStatusText(status)}
            tone={recordingStatusTone(status)}
          />
        }
        description={
          status.activeFiles.length === 0 ? (
            "尚未生成记录文件"
          ) : status.activeFiles.length === 1 ? (
            status.activeFiles[0].fileName
          ) : (
            <>
              {status.activeFiles.map((file) => (
                <span className="block" key={file.roomId}>
                  {file.fileName}
                </span>
              ))}
            </>
          )
        }
        label="状态"
      />
      {status.state === "error" ? (
        <div className="border-t border-drift-line p-3">
          <StatusBanner
            actions={<Button onClick={onRetry}>重试记录</Button>}
            description={`${status.errorMessage || "记录服务暂不可用"}；暂停期间的消息不会补写`}
            title="记录已暂停"
            tone="danger"
          />
        </div>
      ) : null}
      {commandError ? (
        <div className="border-t border-drift-line p-3">
          <StatusBanner
            description={commandError}
            title="本地记录操作失败"
            tone="danger"
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}

function recordingStatusText(status: DanmakuRecordingStatus) {
  switch (status.state) {
    case "waiting":
      return "等待连接";
    case "recording":
      return status.activeFiles.length > 1
        ? `记录中 · ${status.activeFiles.length} 个房间`
        : "记录中";
    case "error":
      return "记录已暂停";
    case "disabled":
    default:
      return "关闭";
  }
}

function recordingStatusTone(status: DanmakuRecordingStatus): StatusTone {
  switch (status.state) {
    case "waiting":
      return "signal";
    case "recording":
      return "success";
    case "error":
      return "danger";
    case "disabled":
    default:
      return "neutral";
  }
}
