import {
  Activity,
  BellRing,
  CircleUserRound,
  History,
  Info,
  Keyboard,
  ListFilter,
  MessagesSquare,
  Power,
  type LucideIcon,
} from "lucide-react";

export type SettingsTab =
  | "room"
  | "account"
  | "notify"
  | "notifications"
  | "display"
  | "filter"
  | "startup"
  | "shortcuts"
  | "diagnostics"
  | "about";

export type SettingsNavItem = {
  icon: LucideIcon;
  id: SettingsTab;
  label: string;
};

export type SettingsNavGroup = {
  items: SettingsNavItem[];
  label: string;
};

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "连接",
    items: [
      { id: "account", label: "账号", icon: CircleUserRound },
    ],
  },
  {
    label: "提醒",
    items: [
      { id: "notify", label: "开播提醒", icon: BellRing },
      { id: "notifications", label: "通知记录", icon: History },
    ],
  },
  {
    label: "显示",
    items: [
      { id: "display", label: "弹幕显示", icon: MessagesSquare },
      { id: "filter", label: "过滤规则", icon: ListFilter },
    ],
  },
  {
    label: "系统",
    items: [
      { id: "startup", label: "启动", icon: Power },
      { id: "shortcuts", label: "快捷键", icon: Keyboard },
      { id: "diagnostics", label: "诊断", icon: Activity },
      { id: "about", label: "关于", icon: Info },
    ],
  },
];

/** 侧栏不列出、但仍然存在的页（直播间页的主要内容已由主界面承担）。 */
const HIDDEN_TAB_LABELS: Partial<Record<SettingsTab, string>> = {
  room: "直播间",
};

export function getSettingsTabLabel(tab: SettingsTab) {
  for (const group of SETTINGS_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.id === tab);
    if (item) return item.label;
  }
  return HIDDEN_TAB_LABELS[tab] ?? "设置";
}
