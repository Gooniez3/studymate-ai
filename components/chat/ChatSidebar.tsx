"use client";

import Link from "next/link";
import {
  BookOpen,
  Briefcase,
  ChevronLeft,
  FileText,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
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

  /*
   * Mobile drawer state. Desktop collapse is
   * still controlled by sidebarOpen; this only
   * drives the <md overlay drawer.
   */
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  isInitialLoading?: boolean;
};

type ChatGroup = {
  label: string;

  chats: ChatSession[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Groups loaded chats by updatedAt into
 * stable buckets. Pure client-side - no
 * stored data or API changes.
 */
function groupChatsByDate(
  chats: ChatSession[]
): ChatGroup[] {
  const now = new Date();

  const startOfToday =
    new Date(
      now.getFullYear(),

      now.getMonth(),

      now.getDate()
    ).getTime();

  const startOfYesterday =
    startOfToday - DAY_MS;

  const startOf7Days =
    startOfToday - 7 * DAY_MS;

  const groups: ChatGroup[] = [
    { label: "Today", chats: [] },

    { label: "Yesterday", chats: [] },

    {
      label: "Previous 7 Days",

      chats: [],
    },

    { label: "Older", chats: [] },
  ];

  for (const chat of chats) {
    const updated = new Date(
      chat.updatedAt
    ).getTime();

    if (updated >= startOfToday) {
      groups[0].chats.push(chat);
    } else if (
      updated >= startOfYesterday
    ) {
      groups[1].chats.push(chat);
    } else if (
      updated >= startOf7Days
    ) {
      groups[2].chats.push(chat);
    } else {
      groups[3].chats.push(chat);
    }
  }

  return groups.filter(
    (group) => group.chats.length > 0
  );
}

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

  isMobileOpen = false,
  onCloseMobile,
  isInitialLoading = false,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] =
    useState("");

  const collapsed = !sidebarOpen;

  const filteredChats = useMemo(() => {
    const query = searchQuery
      .trim()
      .toLowerCase();

    if (!query) {
      return chatSessions;
    }

    return chatSessions.filter(
      (chat) =>
        chat.title
          .toLowerCase()
          .includes(query)
    );
  }, [chatSessions, searchQuery]);

  const groupedChats = useMemo(
    () => groupChatsByDate(filteredChats),

    [filteredChats]
  );

  const modeItems: {
    mode: ChatMode;

    label: string;

    icon: typeof BookOpen;
  }[] = [
    {
      mode: "exam",

      label: "Exam Revision",

      icon: BookOpen,
    },

    {
      mode: "assignment",

      label: "Assignment Help",

      icon: FileText,
    },

    {
      mode: "career",

      label: "CV / LinkedIn",

      icon: Briefcase,
    },
  ];

  const closeMobile = () => {
    onCloseMobile?.();
  };

  return (
    <>
      {isMobileOpen && (
        <div
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[250px] shrink-0 flex-col border-r border-slate-200/60 bg-slate-100 transition-transform duration-300 ease-out md:static md:z-auto md:h-dvh md:translate-x-0 dark:border-white/5 dark:bg-slate-900 ${
          isMobileOpen
            ? "translate-x-0"
            : "-translate-x-full"
        } ${
          collapsed
            ? "md:w-[60px]"
            : "md:w-[250px]"
        }`}
      >
        {/* Brand + controls */}
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <div className="grid h-5 w-5 shrink-0 place-items-center rounded bg-gradient-to-br from-blue-500 to-indigo-600 text-[10px] font-bold text-white">
            S
          </div>

          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-200">
              StudyMate AI
            </span>
          )}

          <button
            onClick={() =>
              isMobileOpen
                ? closeMobile()
                : setSidebarOpen(!sidebarOpen)
            }
            title={
              isMobileOpen
                ? "Close menu"
                : collapsed
                ? "Expand sidebar"
                : "Collapse sidebar"
            }
            className={`rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
              collapsed ? "mx-auto" : ""
            } hidden md:block`}
          >
            <ChevronLeft
              size={16}

              className={`transition-transform ${
                collapsed ? "rotate-180" : ""
              }`}
            />
          </button>

          <button
            onClick={closeMobile}
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 md:hidden"
            title="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* New chat */}
        <div className="shrink-0 px-2 pb-1">
          <button
            onClick={() => {
              onNewChat();

              closeMobile();
            }}
            title="New Chat"
            className={`flex h-9 w-full items-center rounded-lg text-[13px] font-medium text-slate-700 transition hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 ${
              collapsed
                ? "justify-center px-0"
                : "gap-2.5 px-2.5"
            }`}
          >
            <Plus
              size={16}

              className="shrink-0 text-blue-600 dark:text-blue-400"
            />

            {!collapsed && "New Chat"}
          </button>
        </div>

        {/* Tools */}
        <div className="shrink-0 px-2 pb-1">
          {!collapsed && (
            <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-slate-400">
              Tools
            </p>
          )}

          <div className="space-y-px">
            {modeItems.map((item) => {
              const Icon = item.icon;

              const active =
                activeMode === item.mode;

              return (
                <button
                  key={item.mode}

                  onClick={() => {
                    onSpecialChat(item.mode);

                    closeMobile();
                  }}

                  title={item.label}

                  className={`flex h-[34px] w-full items-center rounded-lg text-[13px] transition ${
                    collapsed
                      ? "justify-center px-0"
                      : "gap-2.5 px-2.5"
                  } ${
                    active
                      ? "bg-slate-200/80 font-medium text-slate-900 dark:bg-slate-700/60 dark:text-slate-100"
                      : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon
                    size={15}

                    className={`shrink-0 ${
                      active
                        ? ""
                        : "opacity-70"
                    }`}
                  />

                  {!collapsed && (
                    <span className="truncate">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Recents */}
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col px-2">
            <p className="shrink-0 px-2.5 pb-1 pt-2 text-[11px] font-medium text-slate-400">
              Recents
            </p>

            {chatSessions.length > 0 && (
              <div className="relative shrink-0 pb-1">
                <Search
                  size={13}

                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  value={searchQuery}

                  onChange={(event) =>
                    setSearchQuery(
                      event.target.value
                    )
                  }

                  placeholder="Search chats"

                  className="h-7 w-full rounded-md border border-transparent bg-slate-200/40 pl-7.5 pr-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500/30 focus:bg-white dark:bg-slate-800/50 dark:text-slate-200 dark:focus:bg-slate-800"
                />
              </div>
            )}

            <nav className="scrollbar-slim min-h-0 flex-1 overflow-y-auto pb-2 pr-0.5">
              {isInitialLoading ? (
                <div className="space-y-2 px-2.5 pt-3">
                  <div className="h-8 w-full animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  <div className="h-8 w-4/5 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  <div className="h-8 w-3/5 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                </div>
              ) : chatSessions.length ===
              0 ? (
                <p className="px-2 py-4 text-[13px] text-slate-400">
                  No conversations yet.
                </p>
              ) : groupedChats.length ===
                0 ? (
                <p className="px-2 py-4 text-[13px] text-slate-400">
                  No matching chats.
                </p>
              ) : (
                groupedChats.map(
                  (group) => (
                    <div
                      key={group.label}

                      className="pb-1"
                    >
                      <p className="px-2.5 pb-0.5 pt-3 text-[11px] font-medium text-slate-400/80">
                        {group.label}
                      </p>

                      <div>
                        {group.chats.map(
                          (chat) => {
                            const selected =
                              activeChatId ===
                              chat.id;

                            return (
                              <div
                                key={
                                  chat.id
                                }

                                className="group relative"
                              >
                                <button
                                  onClick={() => {
                                    onOpenChat(chat);

                                    closeMobile();
                                  }}

                                  title={chat.title}

                                  className={`flex h-9 w-full items-center rounded-lg pl-2.5 pr-8 text-left transition ${
                                    selected
                                      ? "bg-slate-200/80 font-medium text-slate-900 dark:bg-slate-700/60 dark:text-slate-100"
                                      : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-[13px]">
                                    {
                                      chat.title
                                    }
                                  </span>
                                </button>

                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();

                                    setOpenMenuId(
                                      openMenuId ===
                                        chat.id
                                        ? null
                                        : chat.id
                                    );
                                  }}

                                  title="Chat options"

                                  className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-300/70 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${
                                    selected
                                      ? "opacity-100"
                                      : "opacity-0 focus:opacity-100 group-hover:opacity-100"
                                  }`}
                                >
                                  <MoreHorizontal
                                    size={14}
                                  />
                                </button>

                                {openMenuId ===
                                  chat.id && (
                                  <>
                                    <div
                                      onClick={() =>
                                        setOpenMenuId(
                                          null
                                        )
                                      }

                                      className="fixed inset-0 z-[998]"
                                    />

                                    <div className="absolute right-1 top-9 z-[999] w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-950/5 dark:border-slate-700 dark:bg-slate-800">
                                      <button
                                        onClick={() =>
                                          onRenameChat(
                                            chat.id
                                          )
                                        }

                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                                      >
                                        <Pencil
                                          size={13}
                                        />

                                        Rename
                                      </button>

                                      <button
                                        onClick={() =>
                                          onDeleteChat(
                                            chat.id
                                          )
                                        }

                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                                      >
                                        <Trash2
                                          size={13}
                                        />

                                        Delete
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )
                )
              )}
            </nav>
          </div>
        )}

        {collapsed && (
          <div className="min-h-0 flex-1" />
        )}

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200/60 px-2 py-2 dark:border-white/5">
          <Link
            href="/profile"

            title="Account Settings"

            className={`flex h-[34px] w-full items-center rounded-lg text-[13px] text-slate-500 transition hover:bg-slate-200/50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
              collapsed
                ? "justify-center px-0"
                : "gap-2.5 px-2.5"
            }`}
          >
            <Settings size={15} />

            {!collapsed && (
              <span className="truncate">
                Account Settings
              </span>
            )}
          </Link>

          <div
            className={`flex h-9 items-center gap-2.5 ${
              collapsed
                ? "justify-center px-0"
                : "px-1"
            }`}
          >
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img

                src={userImage}

                alt={userName || "User"}

                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600/90 text-xs font-bold text-white">
                {userName?.[0]?.toUpperCase() ||
                  "U"}
              </div>
            )}

            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  {userName || "User"}
                </span>

                <button
                  onClick={() =>
                    signOut({
                      callbackUrl: "/",
                    })
                  }

                  title="Sign out"

                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <LogOut size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
