import { clsx } from "clsx";

export type BadgeTone =
  | "blue"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "gray"
  | "teal";

const TONE_CLASSES: Record<BadgeTone, string> = {
  blue: "bg-ramp-blue-50 text-ramp-blue-800",
  green: "bg-ramp-green-50 text-ramp-green-800",
  red: "bg-ramp-red-50 text-ramp-red-800",
  amber: "bg-ramp-amber-50 text-ramp-amber-800",
  purple: "bg-ramp-purple-50 text-ramp-purple-800",
  gray: "bg-ramp-gray-50 text-ramp-gray-800",
  teal: "bg-ramp-teal-50 text-ramp-teal-800",
};

type Props = {
  tone?: BadgeTone;
  rounded?: "sm" | "md" | "pill";
  size?: "xs" | "sm";
  children: React.ReactNode;
};

export function Badge({ tone = "gray", rounded = "sm", size = "sm", children }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center font-medium uppercase tracking-wide",
        TONE_CLASSES[tone],
        rounded === "sm" && "rounded-[3px]",
        rounded === "md" && "rounded-[4px]",
        rounded === "pill" && "rounded-full",
        size === "xs" ? "px-1 py-[1px] text-[9px]" : "px-1.5 py-[2px] text-[10px]"
      )}
    >
      {children}
    </span>
  );
}
