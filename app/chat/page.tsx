"use client";

import {
  Send,
  Bot,
  User,
  Menu,
  Plus,
  BookOpen,
  FileText,
  Briefcase,
  Copy,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatSession = {
  _id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

const starterMessage: Message = {
  role: "assistant",
  content:
    "Hi, I am StudyMate AI. I can help with study planning, exam revision, assignments, and career preparation.",
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([starterMessage]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadChats = async () => {
    try {
      const res = await fetch("/api/chats");
      const data: ChatSession[] = await res.json();

      setChatSessions(data);

      if (data.length > 0) {
        setActiveChatId(data[0]._id);
        setMessages(data[0].messages);
      }
    } catch {
      console.error("Failed to load chats");
    }
  };

  const createChatTitle = (text: string) => {
    return text.trim().slice(0, 35) || "New Chat";
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const startNewChat = () => {
    setActiveChatId(null);
    setMessages([starterMessage]);
    setInput("");
    setOpenMenuId(null);
  };

  const openChat = (chat: ChatSession) => {
    setActiveChatId(chat._id);
    setMessages(chat.messages);
    setInput("");
    setOpenMenuId(null);
  };

  const renameChat = async (chatId: string) => {
    const chat = chatSessions.find((c) => c._id === chatId);
    if (!chat) return;

    const newTitle = prompt("Rename chat", chat.title);
    if (!newTitle || !newTitle.trim()) return;

    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: newTitle.trim(),
        }),
      });

      const updatedChat: ChatSession = await res.json();

      setChatSessions((prev) =>
        prev.map((c) => (c._id === chatId ? updatedChat : c))
      );

      setOpenMenuId(null);
    } catch {
      alert("Failed to rename chat.");
    }
  };

  const deleteChat = async (chatId: string) => {
    const confirmed = confirm("Delete this chat?");
    if (!confirmed) return;

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "DELETE",
      });

      const remainingChats = chatSessions.filter((chat) => chat._id !== chatId);

      setChatSessions(remainingChats);
      setOpenMenuId(null);

      if (activeChatId === chatId) {
        const nextChat = remainingChats[0];

        if (nextChat) {
          setActiveChatId(nextChat._id);
          setMessages(nextChat.messages);
        } else {
          setActiveChatId(null);
          setMessages([starterMessage]);
        }
      }
    } catch {
      alert("Failed to delete chat.");
    }
  };

  const saveChatToMongoDB = async (
    chatId: string | null,
    title: string,
    finalMessages: Message[]
  ) => {
    if (chatId) {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: finalMessages,
        }),
      });

      const updatedChat: ChatSession = await res.json();

      setChatSessions((prev) =>
        prev
          .map((chat) => (chat._id === chatId ? updatedChat : chat))
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
      );

      return updatedChat;
    }

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        messages: finalMessages,
      }),
    });

    const newChat: ChatSession = await res.json();

    setActiveChatId(newChat._id);

    setChatSessions((prev) => [newChat, ...prev]);

    return newChat;
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();
    const title = createChatTitle(currentInput);

    const chatHistory: Message[] = [
      ...messages.filter((m) => m.content !== "● ● ●"),
      { role: "user", content: currentInput },
    ];

    const loadingMessages: Message[] = [
      ...chatHistory,
      { role: "assistant", content: "● ● ●" },
    ];

    setMessages(loadingMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: chatHistory,
        }),
      });

      const data = await res.json();

      const assistantReply =
        data.reply ||
        data.error ||
        "StudyMate AI is temporarily unavailable. Please try again later.";

      const finalMessages: Message[] = [
        ...chatHistory,
        {
          role: "assistant",
          content: assistantReply,
        },
      ];

      setMessages(finalMessages);
      await saveChatToMongoDB(activeChatId, title, finalMessages);
    } catch {
      const errorMessages: Message[] = [
        ...chatHistory,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ];

      setMessages(errorMessages);
      await saveChatToMongoDB(activeChatId, title, errorMessages);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="h-screen bg-slate-950 text-white flex overflow-hidden">
      <aside
        className={`hidden md:flex bg-slate-900 border-r border-slate-800 p-3 flex-col transition-all duration-300 ${
          sidebarOpen ? "w-64" : "w-16"
        }`}
      >
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="mb-4 bg-slate-800 hover:bg-slate-700 p-2 rounded-lg flex items-center justify-center"
        >
          <Menu size={20} />
        </button>

        {sidebarOpen && (
          <h1 className="text-xl font-bold mb-6">StudyMate AI</h1>
        )}

        <button
          onClick={startNewChat}
          className={`bg-blue-600 hover:bg-blue-700 rounded-lg py-3 mb-4 flex items-center justify-center gap-2 ${
            sidebarOpen ? "px-4" : "px-2"
          }`}
        >
          <Plus size={18} />
          {sidebarOpen && "New Chat"}
        </button>

        {sidebarOpen && chatSessions.length > 0 && (
          <div className="mb-4 overflow-visible">
            <p className="text-xs text-slate-500 mb-2 px-1">Recents</p>

            <div className="space-y-1">
              {chatSessions.map((chat) => (
                <div
                  key={chat._id}
                  className={`group relative flex items-center rounded-lg ${
                    activeChatId === chat._id
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                  }`}
                >
                  <button
                    onClick={() => openChat(chat)}
                    className="flex-1 text-left p-3 text-sm truncate"
                  >
                    {chat.title}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(
                        openMenuId === chat._id ? null : chat._id
                      );
                    }}
                    className="p-2 opacity-0 group-hover:opacity-100 hover:text-white"
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {openMenuId === chat._id && (
                    <div className="absolute right-0 top-9 z-[9999] w-40 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl p-1">
                      <button
                        onClick={() => renameChat(chat._id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-slate-700"
                      >
                        <Pencil size={14} />
                        Rename
                      </button>

                      <button
                        onClick={() => deleteChat(chat._id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-slate-700 text-red-400"
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
          <div className="space-y-2 text-sm text-slate-300 mt-auto">
            <button className="w-full bg-slate-800 hover:bg-slate-700 p-3 rounded-lg flex items-center gap-3">
              <BookOpen size={18} />
              Exam Revision
            </button>

            <button className="w-full bg-slate-800 hover:bg-slate-700 p-3 rounded-lg flex items-center gap-3">
              <FileText size={18} />
              Assignment Help
            </button>

            <button className="w-full bg-slate-800 hover:bg-slate-700 p-3 rounded-lg flex items-center gap-3">
              <Briefcase size={18} />
              CV / LinkedIn Help
            </button>
          </div>
        )}
      </aside>

      <section className="flex-1 flex flex-col max-w-full overflow-hidden">
        <header className="border-b border-slate-800 px-5 py-4 shrink-0">
          <h2 className="font-semibold">AI Student Assistant</h2>
          <p className="text-sm text-slate-400">
            Ask questions about study, exams, projects, or career preparation.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="bg-blue-600 p-2 rounded-full h-9 w-9 flex items-center justify-center shrink-0">
                    <Bot size={18} />
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 leading-relaxed text-[15px] ${
                    message.role === "user"
                      ? "max-w-xl bg-blue-600"
                      : "max-w-[680px] bg-slate-800 text-slate-100"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <div className="prose prose-invert max-w-none overflow-x-auto prose-table:w-full prose-th:border prose-td:border prose-th:p-3 prose-td:p-3 prose-th:border-slate-600 prose-td:border-slate-600 prose-th:bg-slate-700 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-headings:my-3">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ className, children, ...props }) {
                            const codeText = String(children).replace(
                              /\n$/,
                              ""
                            );

                            const isBlockCode =
                              className?.includes("language-") ||
                              codeText.includes("\n");

                            if (isBlockCode) {
                              return (
                                <div className="my-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                                  <div className="flex items-center justify-between bg-slate-900 px-4 py-2 text-xs text-slate-400">
                                    <span>
                                      {className?.replace("language-", "") ||
                                        "code"}
                                    </span>

                                    <button
                                      onClick={() => copyCode(codeText)}
                                      className="flex items-center gap-1 hover:text-white"
                                    >
                                      {copiedCode === codeText ? (
                                        <>
                                          <Check size={14} />
                                          Copied
                                        </>
                                      ) : (
                                        <>
                                          <Copy size={14} />
                                          Copy
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  <pre className="overflow-x-auto max-h-[350px] p-4 text-xs">
                                    <code
                                      className={`${
                                        className || ""
                                      } font-mono text-xs`}
                                      {...props}
                                    >
                                      {children}
                                    </code>
                                  </pre>
                                </div>
                              );
                            }

                            return (
                              <code
                                className="bg-slate-700 px-1 py-0.5 rounded text-sm"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    message.content
                  )}
                </div>

                {message.role === "user" && (
                  <div className="bg-slate-700 p-2 rounded-full h-9 w-9 flex items-center justify-center shrink-0">
                    <User size={18} />
                  </div>
                )}
              </div>
            ))}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="px-4 py-4 shrink-0 bg-slate-950">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <input
                value={input}
                disabled={isLoading}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
                placeholder={
                  isLoading
                    ? "StudyMate is thinking..."
                    : "Ask StudyMate AI anything..."
                }
                className="w-full bg-[#1f1f1f] border border-slate-700 rounded-full py-3 pl-6 pr-16 text-white outline-none focus:border-blue-500 disabled:opacity-60"
              />

              <button
                onClick={sendMessage}
                disabled={isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white text-black flex items-center justify-center disabled:opacity-50 hover:bg-slate-200"
              >
                <Send size={18} />
              </button>
            </div>

            <p className="text-center text-xs text-slate-500 mt-2">
              StudyMate AI can make mistakes. Check important information.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}