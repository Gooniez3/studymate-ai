"use client";

import {
  BookOpen,
  Brain,
  CalendarDays,
  FileText,
} from "lucide-react";

type AuthLayoutProps = {
  children: React.ReactNode;
};

const features = [
  {
    icon: Brain,
    label: "AI-powered exam revision",
  },
  {
    icon: BookOpen,
    label: "Interactive quizzes",
  },
  {
    icon: FileText,
    label: "Document intelligence",
  },
  {
    icon: CalendarDays,
    label: "Personalized study planning",
  },
];

export default function AuthLayout({
  children,
}: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen bg-[#020617]">
      {/* ── Left brand panel (desktop) ── */}
      <div className="hidden lg:flex lg:w-[46%] lg:flex-col lg:justify-between bg-slate-900/40 border-r border-slate-800/60 px-12 py-12 xl:px-16">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white">
            S
          </div>
          <span className="text-base font-semibold text-slate-200">
            StudyMate AI
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight text-white xl:text-[2.75rem]">
            Study smarter.
            <br />
            Learn with AI.
          </h2>

          <p className="mt-5 text-[15px] leading-relaxed text-slate-400">
            Your intelligent workspace for
            revision, document understanding,
            quizzes, study planning, and
            assignments.
          </p>

          <ul className="mt-8 space-y-3.5">
            {features.map((f) => (
              <li
                key={f.label}
                className="flex items-center gap-3 text-sm text-slate-300"
              >
                <f.icon
                  size={17}
                  className="shrink-0 text-blue-400"
                />
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-600">
          Built for focused learning.
        </p>
      </div>

      {/* ── Right content panel ── */}
      <div className="flex w-full flex-col items-center justify-center px-5 py-10 lg:w-[54%] lg:px-8">
        {/* Mobile brand */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
            S
          </div>
          <span className="text-sm font-semibold text-slate-200">
            StudyMate AI
          </span>
        </div>

        <div className="w-full max-w-[420px]">
          {children}
        </div>
      </div>
    </main>
  );
}
