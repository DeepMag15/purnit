import { Icon } from "./Icon";
import { cn } from "./utils";

type Tone = "danger" | "info" | "success" | "warning";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-info/10 text-info border-info/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
};

const TONE_ICON: Record<Tone, string> = {
  danger: "error",
  info: "info",
  success: "check_circle",
  warning: "warning",
};

export function Alert({ tone = "danger", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", TONE_CLASSES[tone])}>
      <Icon name={TONE_ICON[tone]} size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
