import { clsx } from "clsx";

type Props = {
  label: string;
  value: string | number;
  subLabel?: string;
  subTone?: "up" | "down" | "warn" | "muted";
  className?: string;
};

const SUB_COLOR: Record<NonNullable<Props["subTone"]>, string> = {
  up: "text-ramp-green-600",
  down: "text-ramp-red-600",
  warn: "text-ramp-amber-600",
  muted: "text-text-tertiary",
};

export function MetricCard({ label, value, subLabel, subTone = "muted", className }: Props) {
  return (
    <div
      className={clsx(
        "rounded-md bg-bg-secondary px-4 py-3",
        className
      )}
    >
      <div className="text-label text-text-secondary">{label}</div>
      <div className="mt-0.5 text-[16px] font-medium text-text-primary">{value}</div>
      {subLabel && (
        <div className={clsx("text-[10px]", SUB_COLOR[subTone])}>{subLabel}</div>
      )}
    </div>
  );
}
