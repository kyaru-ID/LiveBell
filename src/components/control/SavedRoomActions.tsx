import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { SavedRoom } from "../../types/config";
import { Button, IconButton } from "../ui";

/** 菜单仅保留修改与取消关注，连接和打开直播间直接显示在卡片上。 */
export function SavedRoomActions({ room, onEdit, onDelete }: {
  room: SavedRoom;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    buttonRef.current?.focus();
    action();
  }

  return (
    <div
      className="relative shrink-0"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
        if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <IconButton
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`更多操作 ${room.displayName}`}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        size="sm"
      >
        <MoreHorizontal aria-hidden="true" size={17} />
      </IconButton>
      {open ? (
        <div aria-label={`${room.displayName} 的操作`} className="saved-room-menu" id={menuId} role="menu">
          <Button onClick={() => choose(onEdit)} role="menuitem" size="sm" variant="ghost">
            <Pencil aria-hidden="true" size={14} /> 修改
          </Button>
          <Button onClick={() => choose(onDelete)} role="menuitem" size="sm" variant="danger">
            <Trash2 aria-hidden="true" size={14} /> 取消关注
          </Button>
        </div>
      ) : null}
    </div>
  );
}
