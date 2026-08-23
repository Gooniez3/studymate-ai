"use client";

import { Menu } from "lucide-react";

import type { ChatMode } from "@/types/chat";

type ChatHeaderProps = {
  title: string;

  activeMode: ChatMode | null;

  onMenuClick: () => void;
};

const MODE_LABELS: Record<
  ChatMode,
  string
> = {
  exam: "Exam Revision",

  assignment: "Assignment Help",

  career: "CV / LinkedIn",
};

export default function ChatHeader({
  title,
  activeMode,
  onMenuClick,
}: ChatHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white px-3 md:px-4 dark:border-white/10 dark:bg-slate-950">
      <button
        onClick={onMenuClick}

        title="Open menu"

        aria-label="Open menu"

        className="-ml-1 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 md:hidden"
      >
        <Menu size={18} />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
        {title}
      </h1>

      {activeMode && (
        <span className="shrink-0 rounded-full bg-blue-600/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          {MODE_LABELS[activeMode]}
        </span>
      )}
    </header>
  );
}
