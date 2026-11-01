import { SIcon } from "@/components/ui-kit";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface CenteredModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered dialog with a dimmed backdrop. Closes on the X button, Escape, or a backdrop click. */
export function CenteredModal({ open, onClose, title, children, footer }: CenteredModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // Clicks on the dimmed backdrop land on the dialog element itself.
        if (e.target === e.currentTarget) onClose();
      }}
      // Inline positioning: the design system's base styles override utility margins on <dialog>.
      style={{ position: "fixed", inset: 0, margin: "auto", height: "fit-content", maxHeight: "85vh", width: "calc(100% - 2rem)", maxWidth: 720 }}
      className="overflow-hidden rounded-xl border border-border bg-card p-0 text-sm shadow-xl backdrop:bg-foreground/40"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <h3 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SIcon name="x" size={18} />
            </button>
          </header>
          <div className="space-y-5 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
