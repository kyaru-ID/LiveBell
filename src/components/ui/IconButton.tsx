import type { ButtonHTMLAttributes, Ref } from "react";
import { classNames } from "../../utils/classNames";
import { Button } from "./Button";

type IconButtonSize = "sm" | "md";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  active?: boolean;
  size?: IconButtonSize;
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: "size-8 px-0",
  md: "size-9 px-0",
};

export function IconButton({
  className,
  size = "md",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <Button
      className={classNames(
        "drift-icon-button shrink-0",
        SIZE_CLASSES[size],
        className,
      )}
      size="sm"
      variant={variant}
      {...props}
    />
  );
}
