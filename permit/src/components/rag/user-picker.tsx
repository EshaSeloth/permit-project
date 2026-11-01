import { SIcon } from "@/components/ui-kit";

import { effectiveLevel } from "@/lib/rag/access";
import { ACCOUNTS } from "@/lib/rag/dataset";
import { displayName, displayRoleLine } from "@/lib/rag/display";
import type { RagUser } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { AccessBadge } from "./access-badge";

export function scopeLabel(user: RagUser): string {
  if (user.revoked || user.accountScope === "NONE") return "No account access";
  if (user.accountScope === "ALL") return "All accounts";
  return ACCOUNTS.find((a) => a.id === user.accountScope)?.name ?? user.accountScope;
}

interface UserPickerProps {
  users: RagUser[];
  value: string;
  onChange: (username: string) => void;
}

export function UserPicker({ users, value, onChange }: UserPickerProps) {
  return (
    <div role="radiogroup" aria-label="Ask as user" className="space-y-2">
      {users.map((u) => {
        const selected = u.username === value;
        return (
          <button
            key={u.username}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(u.username)}
            className={cn(
              "w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary bg-accent" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <SIcon name={u.revoked ? "user-x" : "user-round"} size={16} />
                {displayName(u.username)}
              </span>
              <AccessBadge level={effectiveLevel(u)} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {displayRoleLine(u.username) ?? `${u.role} · ${scopeLabel(u)}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}
