import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../../utils/classNames";

export function SettingsPage({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classNames(
        "drift-theme-transition settings-scroll-list box-border grid h-full min-h-0 content-start gap-3 overflow-y-auto px-5 py-4 text-drift-ink max-[619px]:px-4",
        className,
      )}
      {...props}
    />
  );
}

type SettingsSectionProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function SettingsSection({
  actions,
  children,
  className,
  description,
  title,
  ...props
}: SettingsSectionProps) {
  const ariaLabel = typeof title === "string" ? title : undefined;
  return (
    <section
      aria-label={ariaLabel}
      className={classNames("grid min-w-0 gap-2.5", className)}
      {...props}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-1">
        <div className="grid gap-0.5">
          <h2 className="drift-theme-transition m-0 text-[13px] font-semibold text-drift-ink">
            {title}
          </h2>
          {description ? (
            <p className="drift-theme-transition m-0 text-[11px] leading-5 text-[var(--drift-ui-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </header>
      <div className="drift-theme-transition overflow-hidden rounded-lg border border-drift-line bg-[var(--drift-ui-raised)]">
        {children}
      </div>
    </section>
  );
}

type SettingsRowProps = HTMLAttributes<HTMLDivElement> & {
  control: ReactNode;
  description?: ReactNode;
  descriptionLayout?: "separate" | "inline";
  htmlFor?: string;
  label: ReactNode;
};

export function SettingsRow({
  className,
  control,
  description,
  descriptionLayout = "separate",
  htmlFor,
  label,
  ...props
}: SettingsRowProps) {
  const labelNode = (
    <span className="drift-theme-transition text-[13px] font-semibold text-drift-ink">{label}</span>
  );
  const labelElement = htmlFor ? (
    <label htmlFor={htmlFor}>{labelNode}</label>
  ) : (
    labelNode
  );
  const descriptionNode = (
    <span className="drift-theme-transition min-w-0 text-[11px] leading-4 text-[var(--drift-ui-muted)]">
      {description}
    </span>
  );

  return (
    <div
      className={classNames(
        "drift-theme-transition box-border grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-4 gap-y-1.5 border-t border-drift-line px-4 py-2 first:border-t-0 max-[519px]:grid-cols-1",
        className,
      )}
      data-description-layout={descriptionLayout}
      {...props}
    >
      <div className={classNames(
        "settings-row-metadata grid min-w-0 gap-0.5",
        descriptionLayout === "inline" && "grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-2 max-[619px]:grid-cols-1",
      )}>
        {labelElement}
        {description ? descriptionNode : null}
      </div>
      <div className="min-w-0">
        {control}
      </div>
    </div>
  );
}

export function Toolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classNames(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2",
        className,
      )}
      role="toolbar"
      {...props}
    />
  );
}

export function DataValue({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={classNames(
        "drift-data-text drift-theme-transition min-w-0 truncate text-[12px] text-[var(--drift-ui-ink-soft)]",
        className,
      )}
      {...props}
    />
  );
}
