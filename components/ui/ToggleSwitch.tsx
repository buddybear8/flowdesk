"use client";

import { clsx } from "clsx";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
};

export function ToggleSwitch({ checked, onChange, label, disabled }: Props) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative inline-flex h-[19px] w-[34px] shrink-0 rounded-full transition-colors",
          checked ? "bg-ramp-blue-600" : "bg-ramp-gray-600/40",
          disabled && "opacity-50"
        )}
      >
        <span
          className={clsx(
            "absolute top-[3px] h-[13px] w-[13px] rounded-full bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          )}
        />
      </button>
      {label && <span className="text-body">{label}</span>}
    </label>
  );
}
