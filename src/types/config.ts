export type AppConfig = {
  roomId: string;
  savedRoomGroups: SavedRoomGroup[];
  savedRooms: SavedRoom[];
  selectedSavedRoomIds: string[];
  send: SendConfig;
  auth: AuthConfig;
  update: UpdateConfig;
  recording: RecordingConfig;
  appearance: AppearanceConfig;
  messageDisplay: MessageDisplayConfig;
  filter: FilterConfig;
  shortcuts: ShortcutConfig;
  notification: NotificationConfig;
  mockPanelEnabled: boolean;
};

export const UNGROUPED_SAVED_ROOM_GROUP_ID = "uncategorized";
export const ALL_SAVED_ROOM_GROUP_ID = "__all__";
export const MAX_SAVED_ROOMS = 50;

export type SavedRoomGroup = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthConfig = {
  enabled: boolean;
  lastLoginUid?: number;
  lastLoginName?: string;
  lastValidatedAt?: number;
};

export type UpdateConfig = {
  checkOnStartup: boolean;
};

export type RecordingConfig = {
  enabled: boolean;
};

export type SendConfig = {
  lastRoomId?: string;
};

export type SavedRoom = {
  id: string;
  roomId: string;
  displayName: string;
  anchorName?: string;
  /** 本地头像文件（后端下载缓存到 Data/Avatars），前端只读。 */
  avatarPath?: string;
  groupIds: string[];
  order: number;
  isEnabled: boolean;
  liveState: LiveState;
  liveTitle?: string;
  /** 本轮开播开始时间（RFC3339）；只有直播中才有值，转未开播后清空。 */
  liveStartedAt?: string;
  lastCheckedAt?: string;
  lastError?: string;
  updatedAt: string;
};

export type AppearanceConfig = {
  fontSize: number;
  fontFamily: string;
  theme: UiTheme;
  opacity: number;
  scrollDuration: number;
  density: "low" | "medium" | "high";
  showUsername: boolean;
  color: "white";
  messageFlow: MessageFlow;
  verticalOverflowPolicy: VerticalOverflowPolicy;
  /** 弹幕表情图片的缩放（0.5–2.0，默认 1.0；对齐 C# 老版 DanmakuEmoteScale）。 */
  emoteScale: number;
};

export type UiTheme = "dark" | "light";
export type MessageFlow = "horizontal" | "vertical";
export type VerticalOverflowPolicy = "realtime" | "complete";

export type MessageDisplayConfig = {
  showDanmaku: boolean;
  // 抽奖弹幕：观众为参与天选 / 红包抽奖自动发出的弹幕（B 站会给这类弹幕打标记）。
  showLottery: boolean;
  showEmotes: boolean;
  showGift: boolean;
  showGuard: boolean;
  showSuperChat: boolean;
  // 弹幕层右上角的「同接 N」徽章（对齐 C# 老版 DanmakuShowOnlineCount）。
  showOnlineCount: boolean;
};

export type FilterConfig = {
  blockedWords: string[];
  rules: FilterRule[];
};

export type FilterTarget =
  | "text"
  | "user"
  | "senderUid"
  | "currentRoomFanMedal";

export type FilterOperator =
  | "contains"
  | "equals"
  | "startsWith"
  | "endsWith"
  | "regex";

export type FilterAction = "hide" | "highlight";

export type FilterRule = {
  id: string;
  enabled: boolean;
  name: string;
  target: FilterTarget;
  operator: FilterOperator;
  value: string;
  action: FilterAction;
};

export type ShortcutConfig = {
  toggleEditMode: string;
  toggleOverlayWindow: string;
  openSendDanmaku: string;
};

export type NotificationConfig = {
  monitorIntervalSeconds: number;
  notificationDurationSeconds: number;
  soundEnabled: boolean;
  // 系统通知（Windows 通知中心）与软件弹窗各自独立开关，对齐 C# 老版的
  // WindowsNotificationEnabled / PopupNotificationEnabled。
  windowsToastEnabled: boolean;
  popupEnabled: boolean;
  autoConnectOnClick: boolean;
  /** 关注卡片上是否显示「已开播多久」的小胶囊。 */
  showLiveDuration: boolean;
};

export type LiveState = "unknown" | "offline" | "live" | "error";

export function defaultShortcutLabel() {
  return navigator.platform.toLowerCase().includes("mac")
    ? "Command+Option+K"
    : "Control+Alt+K";
}

export function defaultOverlayShortcutLabel() {
  return navigator.platform.toLowerCase().includes("mac")
    ? "Command+Option+J"
    : "Control+Alt+J";
}

export function defaultSendDanmakuShortcutLabel() {
  return navigator.platform.toLowerCase().includes("mac")
    ? "Command+Option+Enter"
    : "Control+Alt+Enter";
}

export function createDefaultSavedRoomGroups(
  now = new Date().toISOString(),
): SavedRoomGroup[] {
  return [
    { id: "vtuber", name: "VTuber", createdAt: now, updatedAt: now },
    { id: "game", name: "游戏", createdAt: now, updatedAt: now },
    { id: "chat", name: "聊天", createdAt: now, updatedAt: now },
    { id: "event", name: "赛事", createdAt: now, updatedAt: now },
  ];
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  roomId: "",
  savedRoomGroups: createDefaultSavedRoomGroups(),
  savedRooms: [],
  selectedSavedRoomIds: [],
  send: {},
  auth: {
    enabled: false,
  },
  update: {
    // 默认不自动检查：仓库目前是私有的，程序里的更新请求不带 GitHub 凭据，拿不到 release 里的
    // latest.json，自动检查只会失败刷日志。想检查的话在「关于」页手动打开这个开关。
    checkOnStartup: false,
  },
  recording: {
    enabled: false,
  },
  appearance: {
    fontSize: 20,
    fontFamily: "system",
    theme: "light",
    opacity: 0.94,
    scrollDuration: 12,
    density: "high",
    showUsername: false,
    color: "white",
    emoteScale: 1,
    messageFlow: "horizontal",
    verticalOverflowPolicy: "realtime",
  },
  messageDisplay: {
    showDanmaku: true,
    showLottery: true,
    showEmotes: true,
    showGift: true,
    showGuard: true,
    showSuperChat: true,
    showOnlineCount: true,
  },
  filter: {
    blockedWords: [],
    rules: [],
  },
  shortcuts: {
    toggleEditMode: defaultShortcutLabel(),
    toggleOverlayWindow: defaultOverlayShortcutLabel(),
    openSendDanmaku: defaultSendDanmakuShortcutLabel(),
  },
  notification: {
    monitorIntervalSeconds: 6,
    notificationDurationSeconds: 6,
    soundEnabled: true,
    windowsToastEnabled: true,
    popupEnabled: true,
    autoConnectOnClick: true,
    showLiveDuration: true,
  },
  mockPanelEnabled: false,
};

export function mergeAppConfig(config: Partial<AppConfig>): AppConfig {
  const savedRoomGroups = normalizeSavedRoomGroups(config.savedRoomGroups);
  const savedRooms = normalizeSavedRooms(config.savedRooms, savedRoomGroups);
  const selectedSavedRoomIds = normalizeSelectedSavedRoomIds(
    config.selectedSavedRoomIds,
    savedRooms,
  );
  const lastRoomId = normalizePositiveRoomId(config.send?.lastRoomId);
  const roomId =
    typeof config.roomId === "string"
      ? config.roomId
      : DEFAULT_APP_CONFIG.roomId;
  const mockPanelEnabled =
    typeof config.mockPanelEnabled === "boolean"
      ? config.mockPanelEnabled
      : DEFAULT_APP_CONFIG.mockPanelEnabled;

  const toggleEditMode =
    config.shortcuts?.toggleEditMode === "Command+Option+D" ||
    config.shortcuts?.toggleEditMode === "Control+Alt+D"
      ? defaultShortcutLabel()
      : config.shortcuts?.toggleEditMode;

  return {
    roomId,
    appearance: {
      ...DEFAULT_APP_CONFIG.appearance,
      ...config.appearance,
      // 只认显式的 "dark"，其余（含 undefined / "system"）都落到默认的浅色。
      theme: config.appearance?.theme === "dark" ? "dark" : "light",
      messageFlow:
        config.appearance?.messageFlow === "vertical"
          ? "vertical"
          : DEFAULT_APP_CONFIG.appearance.messageFlow,
      verticalOverflowPolicy:
        config.appearance?.verticalOverflowPolicy === "complete"
          ? "complete"
          : DEFAULT_APP_CONFIG.appearance.verticalOverflowPolicy,
      // 表情缩放：非数字 / 越界一律落回 0.5–2.0（默认 1），与后端 normalize_app_config 对齐。
      emoteScale:
        typeof config.appearance?.emoteScale === "number" &&
        Number.isFinite(config.appearance.emoteScale)
          ? Math.min(2, Math.max(0.5, config.appearance.emoteScale))
          : DEFAULT_APP_CONFIG.appearance.emoteScale,
    },
    messageDisplay: {
      ...DEFAULT_APP_CONFIG.messageDisplay,
      ...config.messageDisplay,
    },
    auth: {
      ...DEFAULT_APP_CONFIG.auth,
      ...config.auth,
    },
    update: {
      ...DEFAULT_APP_CONFIG.update,
      ...config.update,
    },
    recording: {
      ...DEFAULT_APP_CONFIG.recording,
      ...config.recording,
    },
    filter: {
      ...DEFAULT_APP_CONFIG.filter,
      ...config.filter,
      blockedWords: Array.isArray(config.filter?.blockedWords)
        ? config.filter.blockedWords
        : [],
      rules: Array.isArray(config.filter?.rules) ? config.filter.rules : [],
    },
    savedRoomGroups,
    savedRooms,
    selectedSavedRoomIds,
    send: lastRoomId ? { lastRoomId } : {},
    shortcuts: {
      ...DEFAULT_APP_CONFIG.shortcuts,
      ...config.shortcuts,
      toggleEditMode: toggleEditMode ?? DEFAULT_APP_CONFIG.shortcuts.toggleEditMode,
      toggleOverlayWindow:
        config.shortcuts?.toggleOverlayWindow ??
        DEFAULT_APP_CONFIG.shortcuts.toggleOverlayWindow,
      openSendDanmaku:
        config.shortcuts?.openSendDanmaku ??
        DEFAULT_APP_CONFIG.shortcuts.openSendDanmaku,
    },
    notification: normalizeNotificationConfig(config.notification),
    mockPanelEnabled,
  };
}

function normalizeNotificationConfig(
  config?: Partial<NotificationConfig>,
): NotificationConfig {
  const defaults = DEFAULT_APP_CONFIG.notification;
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;

  return {
    monitorIntervalSeconds: clamp(
      config?.monitorIntervalSeconds,
      defaults.monitorIntervalSeconds,
      2,
      60,
    ),
    notificationDurationSeconds: clamp(
      config?.notificationDurationSeconds,
      defaults.notificationDurationSeconds,
      1,
      60,
    ),
    soundEnabled:
      typeof config?.soundEnabled === "boolean"
        ? config.soundEnabled
        : defaults.soundEnabled,
    windowsToastEnabled:
      typeof config?.windowsToastEnabled === "boolean"
        ? config.windowsToastEnabled
        : defaults.windowsToastEnabled,
    popupEnabled:
      typeof config?.popupEnabled === "boolean"
        ? config.popupEnabled
        : defaults.popupEnabled,
    autoConnectOnClick:
      typeof config?.autoConnectOnClick === "boolean"
        ? config.autoConnectOnClick
        : defaults.autoConnectOnClick,
    showLiveDuration:
      typeof config?.showLiveDuration === "boolean"
        ? config.showLiveDuration
        : defaults.showLiveDuration,
  };
}

const MAX_SELECTED_ROOMS = 5;

function normalizeSelectedSavedRoomIds(ids: unknown, savedRooms: SavedRoom[]) {
  const valid = new Set(
    savedRooms
      .map((room) => room.id)
      .filter((id) => id.trim().length > 0),
  );
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id): id is string =>
        typeof id === "string" && id.trim().length > 0 && valid.has(id),
      ))].slice(0, MAX_SELECTED_ROOMS)
    : [];
}

function normalizePositiveRoomId(value: unknown) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value)
    ? value
    : undefined;
}

function normalizeSavedRoomGroups(
  savedRoomGroups: Partial<SavedRoomGroup>[] | undefined,
): SavedRoomGroup[] {
  if (!Array.isArray(savedRoomGroups) || savedRoomGroups.length === 0) {
    return createDefaultSavedRoomGroups();
  }

  const now = new Date().toISOString();
  const normalizedGroups = savedRoomGroups
    .map((group) => ({
      id: typeof group.id === "string" ? group.id.trim() : "",
      name: typeof group.name === "string" ? group.name.trim() : "",
      createdAt:
        typeof group.createdAt === "string" && group.createdAt
          ? group.createdAt
          : now,
      updatedAt:
        typeof group.updatedAt === "string" && group.updatedAt
          ? group.updatedAt
          : now,
    }))
    .filter(
      (group) =>
        group.id && group.name && group.id !== UNGROUPED_SAVED_ROOM_GROUP_ID,
    );

  return normalizedGroups.length > 0
    ? normalizedGroups
    : createDefaultSavedRoomGroups(now);
}

type LegacySavedRoom = Partial<SavedRoom> & {
  group?: string;
  groupId?: string;
};

function normalizeSavedRooms(
  savedRooms: Partial<SavedRoom>[] | undefined,
  savedRoomGroups: SavedRoomGroup[],
): SavedRoom[] {
  if (!Array.isArray(savedRooms)) {
    return [];
  }

  const validGroupIds = new Set(savedRoomGroups.map((group) => group.id));

  return savedRooms.map((room, index) => {
    const legacyRoom = room as LegacySavedRoom;
    const legacyGroup = legacyRoom.group;
    const groupIds = resolveSavedRoomGroupIds(legacyRoom, legacyGroup, validGroupIds);

    return {
      id: typeof room.id === "string" ? room.id : "",
      roomId: typeof room.roomId === "string" ? room.roomId : "",
      displayName:
        typeof room.displayName === "string" ? room.displayName : "",
      anchorName:
        typeof room.anchorName === "string" ? room.anchorName : undefined,
      avatarPath:
        typeof room.avatarPath === "string" ? room.avatarPath : undefined,
      groupIds,
      order:
        typeof room.order === "number" && Number.isFinite(room.order)
          ? room.order
          : index,
      isEnabled: typeof room.isEnabled === "boolean" ? room.isEnabled : true,
      liveState: normalizeLiveState(room.liveState),
      liveTitle: typeof room.liveTitle === "string" ? room.liveTitle : undefined,
      liveStartedAt:
        typeof room.liveStartedAt === "string" ? room.liveStartedAt : undefined,
      lastCheckedAt:
        typeof room.lastCheckedAt === "string" ? room.lastCheckedAt : undefined,
      lastError: typeof room.lastError === "string" ? room.lastError : undefined,
      updatedAt: typeof room.updatedAt === "string" ? room.updatedAt : "",
    };
  });
}

function normalizeLiveState(value: unknown): LiveState {
  return value === "offline" || value === "live" || value === "error"
    ? value
    : "unknown";
}

function resolveSavedRoomGroupIds(
  room: LegacySavedRoom,
  legacyGroup: string | undefined,
  validGroupIds: Set<string>,
): string[] {
  if (Array.isArray(room.groupIds)) {
    return dedupeSavedRoomGroupIds(room.groupIds, validGroupIds);
  }

  // 旧版是单分组字段：仍然有效就迁进数组，否则归入未分组（空数组）。
  const legacySingleGroupId = room.groupId;
  if (legacySingleGroupId && validGroupIds.has(legacySingleGroupId)) {
    return [legacySingleGroupId];
  }

  const migratedGroupId = mapLegacySavedRoomGroup(legacyGroup);
  if (migratedGroupId && validGroupIds.has(migratedGroupId)) {
    return [migratedGroupId];
  }

  return [];
}

export function dedupeSavedRoomGroupIds(
  groupIds: unknown,
  validGroupIds: Set<string>,
): string[] {
  if (!Array.isArray(groupIds)) {
    return [];
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const groupId of groupIds) {
    if (typeof groupId !== "string" || !validGroupIds.has(groupId)) {
      continue;
    }
    if (seen.has(groupId)) {
      continue;
    }
    seen.add(groupId);
    deduped.push(groupId);
  }

  return deduped;
}

function mapLegacySavedRoomGroup(group: string | undefined) {
  switch (group) {
    case "favorite":
      return UNGROUPED_SAVED_ROOM_GROUP_ID;
    case "event":
      return "event";
    case "study":
      return "chat";
    case "entertainment":
      return "game";
    default:
      return undefined;
  }
}
