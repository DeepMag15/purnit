import { cn } from "./utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-hover text-text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  accent: "bg-accent/10 text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize", TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}
