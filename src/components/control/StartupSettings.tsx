import { Toggle } from "../ui";
import {
  DataValue,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusBanner,
} from "./settings-ui";

type StartupSettingsProps = {
  autoStartEnabled: boolean;
  autoStartError: string | null;
  isAutoStartBusy: boolean;
  onToggleAutoStart: (enabled: boolean) => void;
};

export function StartupSettings({
  autoStartEnabled,
  autoStartError,
  isAutoStartBusy,
  onToggleAutoStart,
}: StartupSettingsProps) {
  return (
    <SettingsPage>
      <SettingsSection
        description="登录 Windows 后在后台自动开始监听，不弹出主界面"
        title="开机自启动"
      >
        <SettingsRow
          control={
            <Toggle
              aria-label="开机自启动"
              checked={autoStartEnabled}
              disabled={isAutoStartBusy}
              onCheckedChange={onToggleAutoStart}
            />
          }
          description="关闭后需要手动启动 LiveBell"
          label="开机自启动"
        />
        <SettingsRow
          control={
            <DataValue>
              {autoStartEnabled ? "已写入启动项" : "未设置启动项"}
            </DataValue>
          }
          description="位置：HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
          label="启动项"
        />
      </SettingsSection>

      {autoStartError ? (
        <StatusBanner
          description={autoStartError}
          title="开机自启设置失败"
          tone="danger"
        />
      ) : null}
    </SettingsPage>
  );
}
