"use client";

import { clsx } from "clsx";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type Tab = { id: string; label: string };

type Props = {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  syncToUrl?: boolean; // when true, also reflect tab index via ?tab=
};

export function TabBar({ tabs, activeId, onChange, syncToUrl = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (id: string, idx: number) => {
    onChange(id);
    if (syncToUrl) {
      const params = new URLSearchParams(searchParams.toString());
      if (idx === 0) params.delete("tab");
      else params.set("tab", String(idx));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  if (!tabs.length) return null;

  return (
    <div
      className="flex bg-bg-primary px-[14px] flex-shrink-0"
      style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
    >
      {tabs.map((tab, i) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => handleClick(tab.id, i)}
            className={clsx(
              "text-[12px] whitespace-nowrap cursor-pointer px-[13px] py-[7px]",
              active ? "font-medium" : "text-text-secondary hover:text-text-primary"
            )}
            style={{
              borderBottom: active ? "2px solid #C9A55A" : "2px solid transparent",
              color: active ? "#C9A55A" : undefined,
              marginBottom: "-0.5px",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
