import { Icon } from "./Icon";
import { cn } from "./utils";

type Tone = "danger" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-info/10 text-info border-info/20",
};

export function Alert({ tone = "danger", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", TONE_CLASSES[tone])}>
      <Icon name={tone === "danger" ? "error" : "info"} size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
