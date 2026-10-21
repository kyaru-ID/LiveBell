import { invoke } from "@tauri-apps/api/core";
import type { AppearanceConfig, MessageDisplayConfig } from "../../types/config";
import type { VerticalFlowStatus } from "../../types/verticalFlow";
import { Button, SegmentedControl, Toggle } from "../ui";
import { ControlSlider } from "./ControlSlider";
import {
  DanmakuRecordingSettings,
  type DanmakuRecordingSettingsProps,
} from "./DanmakuRecordingSettings";
import {
  DataValue,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusBanner,
  StatusDot,
} from "./settings-ui";

type DisplaySettingsProps = {
  appearance: AppearanceConfig;
  displayConfigError?: string | null;
  messageDisplay: MessageDisplayConfig;
  onResetAppearance: () => void;
  onUpdateAppearance: (appearance: Partial<AppearanceConfig>) => void;
  onUpdateMessageDisplay: (messageDisplay: Partial<MessageDisplayConfig>) => void;
  recording?: DanmakuRecordingSettingsProps | null;
  verticalFlowStatus: VerticalFlowStatus;
};

const MESSAGE_FLOW_OPTIONS: Array<{
  label: string;
  value: AppearanceConfig["messageFlow"];
}> = [
  { label: "横向滚动", value: "horizontal" },
  { label: "纵向聊天流", value: "vertical" },
];

const VERTICAL_OVERFLOW_OPTIONS: Array<{
  label: string;
  value: AppearanceConfig["verticalOverflowPolicy"];
}> = [
  { label: "实时优先", value: "realtime" },
  { label: "完整优先", value: "complete" },
];

const DENSITY_LABELS: Record<AppearanceConfig["density"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const DENSITY_OPTIONS: Array<{
  label: string;
  value: AppearanceConfig["density"];
}> = [
  { label: DENSITY_LABELS.low, value: "low" },
  { label: DENSITY_LABELS.medium, value: "medium" },
  { label: DENSITY_LABELS.high, value: "high" },
];

export function DisplaySettings({
  appearance,
  displayConfigError,
  messageDisplay,
  onResetAppearance,
  onUpdateAppearance,
  onUpdateMessageDisplay,
  recording = null,
  verticalFlowStatus,
}: DisplaySettingsProps) {
  const isVerticalFlow = appearance.messageFlow === "vertical";
  const isVerticalQueueNormal =
    !verticalFlowStatus.active ||
    (verticalFlowStatus.backlog === 0 &&
      verticalFlowStatus.droppedTotal === 0);
  const verticalQueueLabel = isVerticalQueueNormal
    ? "纵向队列正常"
    : `积压 ${verticalFlowStatus.backlog} 条 · ${verticalFlowStatus.speedMultiplier}× 加速`;
  const messageTypeOptions: Array<{
    checked: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  }> = [
    {
      checked: messageDisplay.showDanmaku,
      label: "普通弹幕",
      onChange: (checked) => onUpdateMessageDisplay({ showDanmaku: checked }),
    },
    {
      // 抽奖弹幕：观众为参与天选 / 红包抽奖自动发出的弹幕（B 站会打标记），
      // 抽奖期间这类弹幕会刷屏，所以单独给一个开关。
      checked: messageDisplay.showLottery,
      label: "抽奖弹幕",
      onChange: (checked) => onUpdateMessageDisplay({ showLottery: checked }),
    },
    {
      // 对齐 C# 老版「显示内容」区的顺序：普通弹幕 → 表情图片 → 礼物…
      checked: messageDisplay.showEmotes,
      label: "表情图片",
      onChange: (checked) => onUpdateMessageDisplay({ showEmotes: checked }),
    },
    {
      checked: messageDisplay.showGift,
      label: "礼物消息",
      onChange: (checked) => onUpdateMessageDisplay({ showGift: checked }),
    },
    {
      checked: messageDisplay.showGuard,
      label: "上舰消息",
      onChange: (checked) => onUpdateMessageDisplay({ showGuard: checked }),
    },
    {
      checked: messageDisplay.showSuperChat,
      label: "醒目留言",
      onChange: (checked) =>
        onUpdateMessageDisplay({ showSuperChat: checked }),
    },
    {
      // 老版「显示内容」区的最后一项，落到弹幕层右上角的「同接 N」徽章。
      checked: messageDisplay.showOnlineCount,
      label: "同接数",
      onChange: (checked) => onUpdateMessageDisplay({ showOnlineCount: checked }),
    },
  ];

  return (
    <SettingsPage>
      {displayConfigError ? (
        <StatusBanner title={displayConfigError} tone="danger" />
      ) : null}

      <SettingsSection title="外观">
        <SettingsRow
          control={
            <SegmentedControl
              ariaLabel="消息流模式"
              className="w-full grid-cols-2"
              onChange={(messageFlow) => onUpdateAppearance({ messageFlow })}
              options={MESSAGE_FLOW_OPTIONS}
              value={appearance.messageFlow}
            />
          }
          label="消息流模式"
        />
        <ControlSlider
          label="字号"
          max={32}
          min={14}
          onChange={(value) => onUpdateAppearance({ fontSize: value })}
          suffix="px"
          value={appearance.fontSize}
        />
        {/* 对齐 C# 老版：表情大小是在「字号 × 固定比例」上再乘一个系数，只影响表情本身。 */}
        <ControlSlider
          description="只缩放表情图片，不改变字号"
          label="表情大小"
          max={200}
          min={50}
          onChange={(value) => onUpdateAppearance({ emoteScale: value / 100 })}
          suffix="%"
          value={Math.round(appearance.emoteScale * 100)}
        />
        <ControlSlider
          label="透明度"
          max={100}
          min={30}
          onChange={(value) => onUpdateAppearance({ opacity: value / 100 })}
          suffix="%"
          value={Math.round(appearance.opacity * 100)}
        />
        <ControlSlider
          description={isVerticalFlow ? "仅横向模式生效" : undefined}
          disabled={isVerticalFlow}
          label="滚动速度"
          max={24}
          min={6}
          onChange={(value) => onUpdateAppearance({ scrollDuration: value })}
          suffix="秒"
          value={appearance.scrollDuration}
        />
        <SettingsRow
          control={
            <SegmentedControl
              ariaLabel="显示密度"
              className="w-full grid-cols-3"
              onChange={(density) => onUpdateAppearance({ density })}
              options={DENSITY_OPTIONS}
              value={appearance.density}
            />
          }
          label="显示密度"
        />
        <SettingsRow
          description={
            isVerticalFlow ? "纵向聊天流始终显示用户名" : undefined
          }
          control={
            <Toggle
              aria-label="显示用户名"
              checked={isVerticalFlow || appearance.showUsername}
              disabled={isVerticalFlow}
              onCheckedChange={(checked) =>
                onUpdateAppearance({ showUsername: checked })
              }
            />
          }
          label="显示用户名"
        />
        {isVerticalFlow ? (
          <>
            <SettingsRow
              control={
                <SegmentedControl
                  ariaLabel="过载策略"
                  className="w-full grid-cols-2"
                  onChange={(verticalOverflowPolicy) =>
                    onUpdateAppearance({ verticalOverflowPolicy })
                  }
                  options={VERTICAL_OVERFLOW_OPTIONS}
                  value={appearance.verticalOverflowPolicy}
                />
              }
              label="过载策略"
            />
            <SettingsRow
              control={
                <div className="grid justify-items-end gap-1">
                  <StatusDot
                    label={verticalQueueLabel}
                    tone={isVerticalQueueNormal ? "success" : "signal"}
                  />
                  {verticalFlowStatus.droppedTotal > 0 ? (
                    <StatusDot
                      label={`本次运行已丢弃 ${verticalFlowStatus.droppedTotal} 条`}
                      tone="warning"
                    />
                  ) : null}
                </div>
              }
              label="队列状态"
            />
          </>
        ) : null}
        <SettingsRow
          control={<DataValue>统一白色</DataValue>}
          label="弹幕颜色"
        />
      </SettingsSection>

      <SettingsSection title="内容">
        {messageTypeOptions.map((option) => (
          <SettingsRow
            control={
              <Toggle
                aria-label={option.label}
                checked={option.checked}
                onCheckedChange={option.onChange}
              />
            }
            key={option.label}
            label={option.label}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="弹幕窗口">
        <div className="grid grid-cols-2 gap-2 p-3 max-[519px]:grid-cols-1">
          <Button onClick={() => invoke("show_window", { label: "main" })}>
            显示弹幕窗口
          </Button>
          <Button onClick={() => invoke("hide_window", { label: "main" })}>
            隐藏弹幕窗口
          </Button>
        </div>
      </SettingsSection>

      {recording ? <DanmakuRecordingSettings {...recording} /> : null}

      <SettingsSection title="重置">
        <div className="p-3">
          <Button onClick={onResetAppearance}>恢复默认显示设置</Button>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
