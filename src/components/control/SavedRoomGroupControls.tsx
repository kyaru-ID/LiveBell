import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { FolderPen, FolderPlus, Trash2 } from "lucide-react";
import {
  ALL_SAVED_ROOM_GROUP_ID,
  UNGROUPED_SAVED_ROOM_GROUP_ID,
  type SavedRoomGroup,
} from "../../types/config";
import { Button, IconButton, Input, Tooltip, TooltipProvider } from "../ui";
import { Toolbar } from "./settings-ui";

type SavedRoomGroupControlsProps = {
  draggedRoomId: string | null;
  groups: SavedRoomGroup[];
  onCreateGroup: (name: string) => Promise<boolean>;
  onDeleteGroup: (groupId: string) => Promise<boolean>;
  onDropRoomToGroup: (
    savedRoomId: string,
    groupId: string,
  ) => void | Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<boolean>;
  onSearchQueryChange: (query: string) => void;
  onSelectedGroupChange: (groupId: string) => void;
  searchQuery: string;
  selectedGroupId: string;
  /** 主界面不用这个搜索框（用户要求关注列表不过滤），设置页仍然要。 */
  showSearch?: boolean;
  /**
   * 主界面把「新建分组」放在右侧操作区，分组页签右边那块位置留给「全部断开」。
   * 放在页签尾部会挤在可横向滚动的 tablist 里，滚动后被推出视野。
   */
  createActionPosition?: "actions" | "tabs-end";
  /**
   * 放在分组条同一行最右端的额外操作（主界面用它挂「全部断开」）。
   * 挂在组件内部而不是在外面拼一行，是为了让下面的输入面板能横跨到整行右端，
   * 和按钮、下面的卡片左右对齐。
   */
  trailingActions?: ReactNode;
};

export function SavedRoomGroupControls({
  draggedRoomId,
  groups,
  onCreateGroup,
  onDeleteGroup,
  onDropRoomToGroup,
  onRenameGroup,
  onSearchQueryChange,
  onSelectedGroupChange,
  searchQuery,
  selectedGroupId,
  showSearch = true,
  createActionPosition = "actions",
  trailingActions,
}: SavedRoomGroupControlsProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<SavedRoomGroup | null>(null);
  // 新建 / 重命名都在分组条下面弹出同一栏输入（drift 的 inline 面板样���）。
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const groupCreateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isCreatingGroup) {
      return;
    }
    groupCreateInputRef.current?.focus();
  }, [isCreatingGroup]);

  const selectedGroup =
    selectedGroupId === ALL_SAVED_ROOM_GROUP_ID
      ? null
      : groups.find((group) => group.id === selectedGroupId) ?? null;

  function closeCreate() {
    setIsCreatingGroup(false);
    setNewGroupName("");
  }

  async function createGroup() {
    const created = await onCreateGroup(newGroupName);
    if (created) {
      setNewGroupName("");
      setIsCreatingGroup(false);
    }
  }

  function startCreate() {
    setIsCreatingGroup((current) => !current);
    setNewGroupName("");
    setRenamingGroupId(null);
    setPendingDeleteGroup(null);
  }

  function startRename(group: SavedRoomGroup) {
    setRenamingGroupId(group.id);
    setRenameDraft(group.name);
    setPendingDeleteGroup(null);
    setIsCreatingGroup(false);
  }

  async function saveRename() {
    if (!renamingGroupId) {
      return;
    }
    const renamed = await onRenameGroup(renamingGroupId, renameDraft);
    if (renamed) {
      setRenamingGroupId(null);
      setRenameDraft("");
    }
  }

  function requestDelete(group: SavedRoomGroup) {
    setRenamingGroupId(null);
    setIsCreatingGroup(false);
    setPendingDeleteGroup(group);
  }

  /** 拖动中的常用直播间可以被放到「未分组」或任一自定义分组页签上。 */
  function groupTabDropProps(groupId: string) {
    return {
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (draggedRoomId) {
          event.preventDefault();
        }
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        if (!draggedRoomId) {
          return;
        }
        event.preventDefault();
        void onDropRoomToGroup(draggedRoomId, groupId);
      },
    };
  }

  async function confirmDelete() {
    if (!pendingDeleteGroup) {
      return;
    }
    const deleted = await onDeleteGroup(pendingDeleteGroup.id);
    if (deleted) {
      setPendingDeleteGroup(null);
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid min-w-0 gap-2">
        {showSearch ? (
          <Toolbar aria-label="常用直播间工具栏">
            <Input
              aria-label="搜索常用直播间"
              inputSize="sm"
              onChange={(event) =>
                onSearchQueryChange(event.currentTarget.value)
              }
              placeholder="搜索房间号、名称、主播"
              type="search"
              value={searchQuery}
            />
          </Toolbar>
        ) : null}

        {/*
        分组页签行和下方的输入面板共用一条竖向网格：面板要横跨到图标区右边，
        才能和首行左右两端对齐；「重命名分组 / 删除分组」那排图标固定在
        右列第一行（self-start），和页签行顶端对齐，不再被垂直居中。
        */}
        <div className="flex min-w-0 items-center gap-2">
          {/* 页签左列：只在「有页签可显示」时出现。 */}
          <div
            aria-label="常用直播间分组"
            className="settings-scroll-list flex min-h-7 min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            role="tablist"
          >
          <Button
            active={selectedGroupId === ALL_SAVED_ROOM_GROUP_ID}
            aria-selected={selectedGroupId === ALL_SAVED_ROOM_GROUP_ID}
            onClick={() => onSelectedGroupChange(ALL_SAVED_ROOM_GROUP_ID)}
            role="tab"
            size="sm"
          >
            全部
          </Button>
          <Button
            active={selectedGroupId === UNGROUPED_SAVED_ROOM_GROUP_ID}
            aria-selected={selectedGroupId === UNGROUPED_SAVED_ROOM_GROUP_ID}
            onClick={() =>
              onSelectedGroupChange(UNGROUPED_SAVED_ROOM_GROUP_ID)
            }
            role="tab"
            size="sm"
            title="把常用直播间拖到这里可以取消分组"
            {...groupTabDropProps(UNGROUPED_SAVED_ROOM_GROUP_ID)}
          >
            未分组
          </Button>
          {groups.map((group) => (
            <Button
              active={selectedGroupId === group.id}
              aria-selected={selectedGroupId === group.id}
              key={group.id}
              onClick={() => onSelectedGroupChange(group.id)}
              role="tab"
              size="sm"
              title="把常用直播间拖到这里可以归入该分组"
              {...groupTabDropProps(group.id)}
            >
              {group.name}
            </Button>
          ))}
          {/*
          主界面把「新建分组」放在页签尾部，紧挨最后一个分组（用户指定）。
          和分组页签同一套外观（.drift-button + min-h-7 px-2 text-[10px]，白底浅边框），
          点它不就地展开，而是像「重命名分组」那样在下方弹出一栏输入（见下面的 isCreatingGroup 面板）。
          */}
          <IconButton
            active={isCreatingGroup}
            aria-label="新建分组"
            aria-selected={isCreatingGroup}
            className="size-7"
            onClick={startCreate}
            role="tab"
            size="sm"
            title="新建分组"
          >
            <FolderPlus aria-hidden="true" size={14} />
          </IconButton>
          </div>
          {createActionPosition === "actions" || selectedGroup ? (
          <div className="flex min-h-7 shrink-0 items-center gap-1">
            {createActionPosition === "actions" ? (
              <Tooltip content="新建分组">
                <IconButton
                  active={isCreatingGroup}
                  aria-label="新建分组"
                  onClick={startCreate}
                  size="sm"
                >
                  <FolderPlus aria-hidden="true" size={14} />
                </IconButton>
              </Tooltip>
            ) : null}
            {selectedGroup ? (
              <>
                <Tooltip content="重命名分组">
                  <IconButton
                    active={renamingGroupId === selectedGroup.id}
                    aria-label="重命名分组"
                    onClick={() => startRename(selectedGroup)}
                    size="sm"
                  >
                    <FolderPen aria-hidden="true" size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="删除分组">
                  <IconButton
                    aria-label="删除分组"
                    disabled={groups.length <= 1}
                    onClick={() => requestDelete(selectedGroup)}
                    size="sm"
                    variant="danger"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </div>
          ) : null}
          {trailingActions ? (
            <div className="flex min-h-7 shrink-0 items-center">
              {trailingActions}
            </div>
          ) : null}
        </div>

        {isCreatingGroup ||
        (selectedGroup && renamingGroupId === selectedGroup.id) ? (
          <div className="drift-theme-transition grid min-w-0 rounded-lg border border-drift-line bg-[var(--drift-ui-surface)] p-2">
            {isCreatingGroup ? (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
                <Input
                  aria-label="新分组名称"
                  inputSize="sm"
                  onChange={(event) =>
                    setNewGroupName(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void createGroup();
                    }
                    if (event.key === "Escape") {
                      closeCreate();
                    }
                  }}
                  placeholder="新分组"
                  ref={groupCreateInputRef}
                  value={newGroupName}
                />
                <Button
                  disabled={!newGroupName.trim()}
                  onClick={() => void createGroup()}
                  size="sm"
                  variant="primary"
                >
                  添加
                </Button>
                <Button onClick={closeCreate} size="sm">
                  取消
                </Button>
              </div>
            ) : null}

            {selectedGroup && renamingGroupId === selectedGroup.id ? (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
                <Input
                  aria-label="重命名分组"
                  inputSize="sm"
                  onChange={(event) =>
                    setRenameDraft(event.currentTarget.value)
                  }
                  value={renameDraft}
                />
                <Button
                  disabled={!renameDraft.trim()}
                  onClick={saveRename}
                  size="sm"
                  variant="primary"
                >
                  保存
                </Button>
                <Button
                  onClick={() => {
                    setRenamingGroupId(null);
                    setRenameDraft("");
                  }}
                  size="sm"
                >
                  取消
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingDeleteGroup ? (
          <div
            className="fixed inset-0 z-20 grid place-items-center bg-black/45 p-6"
            role="presentation"
          >
            <div
              aria-labelledby="group-delete-title"
              aria-modal="true"
              className="drift-theme-transition grid w-full max-w-[360px] gap-3 rounded-lg border border-drift-line bg-drift-raised p-4 shadow-2xl"
              role="dialog"
            >
              <strong
                className="drift-theme-transition text-xs text-drift-ink"
                id="group-delete-title"
              >
                删除分组
              </strong>
              <p className="drift-theme-transition m-0 text-[10px] leading-5 text-[var(--drift-ui-muted)]">
                确认删除“{pendingDeleteGroup.name}”？该分组下的常用直播间将变为未分组，只在“全部”中显示。
              </p>
              <div className="flex justify-end gap-1.5">
                <Button onClick={confirmDelete} size="sm" variant="danger">
                  确认删除
                </Button>
                <Button
                  onClick={() => setPendingDeleteGroup(null)}
                  size="sm"
                >
                  取消
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
