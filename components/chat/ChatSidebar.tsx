"use client";

import Link from "next/link";
import {
  Menu,
  Plus,
  BookOpen,
  FileText,
  Briefcase,
  MoreHorizontal,
  Pencil,
  Trash2,
  LogOut,
  Settings,
} from "lucide-react";
import type { ChatMode, ChatSession } from "@/types/chat";
import { signOut } from "next-auth/react";

type ChatSidebarProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  chatSessions: ChatSession[];
  activeChatId: string | null;
  activeMode: ChatMode | null;
  openMenuId: string | null;
  setOpenMenuId: (value: string | null) => void;
  onNewChat: () => void;
  onOpenChat: (chat: ChatSession) => void;
  onRenameChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onSpecialChat: (mode: ChatMode) => void;
  userName?: string | null;
  userImage?: string | null;
};

export default function ChatSidebar({
  sidebarOpen,
  setSidebarOpen,
  chatSessions,
  activeChatId,
  activeMode,
  openMenuId,
  setOpenMenuId,
  onNewChat,
  onOpenChat,
  onRenameChat,
  onDeleteChat,
  onSpecialChat,
  userName,
  userImage,
}: ChatSidebarProps) {
  const inactiveButton =
    "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

  return (
    <aside
      className={`hidden flex-col border-r border-slate-200 bg-slate-50 p-3 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 md:flex ${
        sidebarOpen ? "w-64" : "w-16"
      }`}
    >
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="mb-4 flex items-center justify-center rounded-lg bg-slate-200 p-2 text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
      >
        <Menu size={20} />
      </button>

      {sidebarOpen && (
        <h1 className="mb-6 text-xl font-bold text-slate-950 dark:text-white">
          StudyMate AI
        </h1>
      )}

      <button
        onClick={onNewChat}
        className={`mb-4 flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-white hover:bg-blue-700 ${
          sidebarOpen ? "px-4" : "px-2"
        }`}
      >
        <Plus size={18} />
        {sidebarOpen && "New Chat"}
      </button>

      {sidebarOpen && chatSessions.length > 0 && (
        <div className="mb-4 overflow-visible">
          <p className="mb-2 px-1 text-xs text-slate-500">Recents</p>

          <div className="space-y-1">
            {chatSessions.map((chat) => (
              <div
                key={chat._id}
                className={`group relative flex items-center rounded-lg ${
                  activeChatId === chat._id
                    ? "bg-blue-600 text-white"
                    : inactiveButton
                }`}
              >
                <button
                  onClick={() => onOpenChat(chat)}
                  className="flex-1 truncate p-3 text-left text-sm"
                >
                  {chat.title}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === chat._id ? null : chat._id);
                  }}
                  className="p-2 opacity-0 hover:text-slate-950 group-hover:opacity-100 dark:hover:text-white"
                >
                  <MoreHorizontal size={16} />
                </button>

                {openMenuId === chat._id && (
                  <div className="absolute right-0 top-9 z-[9999] w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => onRenameChat(chat._id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Pencil size={14} />
                      Rename
                    </button>

                    <button
                      onClick={() => onDeleteChat(chat._id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-slate-700"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sidebarOpen && (
        <div className="mt-auto space-y-2 text-sm">
          <button
            onClick={() => onSpecialChat("exam")}
            className={`flex w-full items-center gap-3 rounded-lg p-3 transition ${
              activeMode === "exam" ? "bg-blue-600 text-white" : inactiveButton
            }`}
          >
            <BookOpen size={18} />
            Exam Revision
          </button>

          <button
            onClick={() => onSpecialChat("assignment")}
            className={`flex w-full items-center gap-3 rounded-lg p-3 transition ${
              activeMode === "assignment"
                ? "bg-blue-600 text-white"
                : inactiveButton
            }`}
          >
            <FileText size={18} />
            Assignment Help
          </button>

          <button
            onClick={() => onSpecialChat("career")}
            className={`flex w-full items-center gap-3 rounded-lg p-3 transition ${
              activeMode === "career"
                ? "bg-blue-600 text-white"
                : inactiveButton
            }`}
          >
            <Briefcase size={18} />
            CV / LinkedIn Help
          </button>

          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            <Link
              href="/profile"
              className="mb-2 flex w-full items-center gap-3 rounded-lg bg-slate-100 p-3 text-slate-700 transition hover:bg-slate-200 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <Settings size={18} />
              Account Settings
            </Link>

            <div className="flex items-center gap-3 px-1 py-2">
              {userImage ? (
                <img
                  src={userImage}
                  alt={userName || "User"}
                  className="h-8 w-8 shrink-0 rounded-full"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {userName?.[0]?.toUpperCase() || "U"}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  {userName || "User"}
                </p>
              </div>

              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}