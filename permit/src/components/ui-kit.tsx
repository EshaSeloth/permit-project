import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ChevronDown, ChevronUp, CircleCheck, CircleX, Loader2, ShieldCheck, MessageSquare, UserRound, UserX, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  x: X,
  "user-x": UserX,
  "user-round": UserRound,
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  "shield-check": ShieldCheck,
  "message-square": MessageSquare,
};

/** Small icon wrapper so call sites keep using string names. */
export function SIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICONS[name] ?? CircleX;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger" | "primary";
type BadgeMode = "light" | "dark" | "outline";

const LIGHT: Record<BadgeVariant, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-accent text-accent-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-destructive-soft text-destructive",
  primary: "bg-accent text-accent-foreground",
};
const DARK: Record<BadgeVariant, string> = {
  neutral: "bg-foreground text-background",
  info: "bg-primary text-primary-foreground",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-destructive text-destructive-foreground",
  primary: "bg-primary text-primary-foreground",
};
const OUTLINE: Record<BadgeVariant, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-primary/40 text-accent-foreground",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-destructive/40 text-destructive",
  primary: "border-primary/40 text-accent-foreground",
};

export function SBadge({
  variant = "neutral",
  mode = "light",
  size: _size,
  title,
  children,
}: {
  variant?: BadgeVariant;
  mode?: BadgeMode;
  size?: string;
  title?: string;
  children: ReactNode;
}) {
  const tone = mode === "dark" ? DARK[variant] : mode === "outline" ? `border bg-transparent ${OUTLINE[variant]}` : LIGHT[variant];
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", tone)}>
      {children}
    </span>
  );
}

interface SButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: "primary" | "neutral-outline";
  loading?: boolean;
}

export function SButton({ variant = "primary", loading = false, disabled, type = "button", children, ...rest }: SButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-input bg-background text-foreground hover:bg-accent",
      )}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export const STextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function STextarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...rest}
    />
  );
});
