import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<string, string> = {
  uploading: "bg-muted text-muted-foreground",
  uploaded: "bg-secondary text-secondary-foreground",
  processing: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  ocr_processed: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  ocr_complete: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  completed: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  needs_review: "bg-chart-5/20 text-chart-5 border-chart-5/40",
  pending_approval: "bg-chart-5/20 text-chart-5 border-chart-5/40",
  confirmed: "bg-chart-2/20 text-chart-2 border-chart-2/50",
  credited: "bg-chart-2/20 text-chart-2 border-chart-2/50",
  loaded: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  approved_for_loading: "bg-chart-4/15 text-chart-4 border-chart-4/40",
  rejected: "bg-destructive/15 text-destructive border-destructive/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
  duplicate: "bg-destructive/15 text-destructive border-destructive/40",
  disputed: "bg-destructive/15 text-destructive border-destructive/40",
};

export function StatusBadge({ state, className }: { state: string; className?: string }) {
  const label = state.replace(/_/g, " ");
  return (
    <Badge
      variant="outline"
      className={cn("capitalize font-medium", STATE_STYLES[state] ?? "", className)}
    >
      {label}
    </Badge>
  );
}
