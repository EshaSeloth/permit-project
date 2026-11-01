import { SBadge } from "@/components/ui-kit";

import { ACCESS_LEVEL_LABEL } from "@/lib/rag/access";
import type { AccessLevel } from "@/lib/rag/types";

const VARIANT: Record<AccessLevel, "neutral" | "info" | "warning" | "danger"> = {
  L0: "neutral",
  L1: "info",
  L2: "warning",
  L3: "danger",
};

export function AccessBadge({ level }: { level: AccessLevel }) {
  return (
    <SBadge variant={VARIANT[level]} mode="light" size="regular">
      {level} · {ACCESS_LEVEL_LABEL[level]}
    </SBadge>
  );
}
