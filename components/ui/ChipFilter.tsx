"use client";

import { clsx } from "clsx";

export type ChipTone = "blue" | "green" | "red" | "amber" | "neutral";

type Option<T extends string> = {
  id: T;
  label: string;
  tone?: ChipTone;
};

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
};

const TONE_ACTIVE: Record<ChipTone, string> = {
  blue: "bg-ramp-blue-50 text-ramp-blue-800 border-ramp-blue-600",
  green: "bg-ramp-green-50 text-ramp-green-800 border-ramp-green-600",
  red: "bg-ramp-red-50 text-ramp-red-800 border-ramp-red-600",
  amber: "bg-ramp-amber-50 text-ramp-amber-800 border-ramp-amber-600",
  neutral: "bg-ramp-blue-50 text-ramp-blue-800 border-ramp-blue-600",
};

export function ChipFilter<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => {
        const active = opt.id === value;
        const tone = opt.tone ?? "neutral";
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={clsx(
              "rounded-full border px-2.5 py-[3px] text-label transition-colors",
              active
                ? TONE_ACTIVE[tone]
                : "border-border-tertiary text-text-secondary hover:bg-bg-secondary"
            )}
            style={!active ? { borderColor: "var(--color-border-tertiary)" } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
