"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AppTheme,
  Attachment,
  ChatMode,
  ChatSession,
  DefaultChatMode,
  Message,
} from "@/types/chat";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { useSession } from "next-auth/react";

const starterMessage: Message = {
  role: "assistant",
  content:
    "Hi, I am StudyMate AI. I can help with study planning, exam revision, assignments, and career preparation.",
};

type UserProfile = {
  name: string;
  image?: string | null;
  defaultMode: DefaultChatMode;
  webSearchDefault: boolean;
  theme: AppTheme;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([starterMessage]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ChatMode | null>(null);

  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const { data: session } = useSession();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUserProfile();
    loadChats();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const applyTheme = (theme: AppTheme) => {
    document.documentElement.classList.remove("dark", "light", "system");
    document.documentElement.classList.add(theme || "system");
  };

  const loadUserProfile = async () => {
    try {
      const res = await fetch("/api/user/profile");
      if (!res.ok) return;

      const data = await res.json();
      const user: UserProfile = data.user;

      setProfileName(user.name || null);
      setProfileImage(user.image || null);
      setWebSearchEnabled(user.webSearchDefault ?? false);

      applyTheme(user.theme || "system");

      if (user.defaultMode && user.defaultMode !== "default") {
        startSpecialChat(user.defaultMode);
      }
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  };

  const loadChats = async () => {
    try {
      const res = await fetch("/api/chats");
      const data: ChatSession[] = await res.json();

      setChatSessions(data);

      if (data.length > 0) {
         setActiveChatId(data[0]._id);

         setActiveMode(
           data[0].mode && data[0].mode !== "default"
              ? data[0].mode
              : null
       );

        setMessages(data[0].messages);
      }
    } catch {
      console.error("Failed to load chats");
    }
  };

  const createChatTitle = (text: string, file?: File | null) => {
    if (text.trim()) return text.trim().slice(0, 35);
    if (file) return file.name.slice(0, 35);
    return "New Chat";
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const startNewChat = () => {
    setActiveChatId(null);
    setActiveMode(null);
    setMessages([starterMessage]);
    setInput("");
    setSelectedFile(null);
    setOpenMenuId(null);
  };

  const startSpecialChat = (mode: ChatMode) => {
    setActiveChatId(null);
    setActiveMode(mode);
    setInput("");
    setSelectedFile(null);
    setOpenMenuId(null);

    if (mode === "exam") {
      setMessages([
        starterMessage,
        {
          role: "assistant",
          content:
            "📚 **Exam Revision Mode**\n\nI can help you create summaries, flashcards, practice questions, revision plans, and explain difficult topics.\n\nTell me your subject or topic first.",
        },
      ]);
    }

    if (mode === "assignment") {
      setMessages([
        starterMessage,
        {
          role: "assistant",
          content:
            "📝 **Assignment Help Mode**\n\nI can help you understand requirements, plan report structure, improve writing, explain concepts, and check your work step by step.\n\nPaste your assignment question, task sheet, or rubric.",
        },
      ]);
    }

    if (mode === "career") {
      setMessages([
        starterMessage,
        {
          role: "assistant",
          content:
            "💼 **CV / LinkedIn Help Mode**\n\nI can help improve your CV, LinkedIn profile, portfolio description, cover letter, and interview answers.\n\nPaste your CV, LinkedIn section, or job target.",
        },
      ]);
    }
  };

  const openChat = (chat: ChatSession) => {
  setActiveChatId(chat._id);

  setActiveMode(
    chat.mode && chat.mode !== "default"
      ? chat.mode
      : null
  );

  setMessages(chat.messages);
  setInput("");
  setSelectedFile(null);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
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
          setActiveMode(
            nextChat.mode && nextChat.mode !== "default"
            ? nextChat.mode
            : null
          );
          setMessages(nextChat.messages);
        } else {
          setActiveChatId(null);
          setActiveMode(null);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: finalMessages,
          mode: activeMode || "default",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        mode: activeMode || "default",
        messages: finalMessages,
      }),
    });

    const newChat: ChatSession = await res.json();

    setActiveChatId(newChat._id);
    setChatSessions((prev) => [newChat, ...prev]);

    return newChat;
  };

  const sendMessage = async () => {
    if ((!input.trim() && !selectedFile) || isLoading) return;

    const currentInput = input.trim() || "Please analyze this PDF.";
    const fileToSend = selectedFile;
    const title = createChatTitle(currentInput, fileToSend);

    const attachment: Attachment | null = fileToSend
      ? {
          name: fileToSend.name,
          type: fileToSend.type,
          size: fileToSend.size,
        }
      : null;

    const userMessage: Message = {
      role: "user",
      content: currentInput,
      attachment,
    };

    const chatHistory: Message[] = [
      ...messages.filter((m) => m.content !== "● ● ●"),
      userMessage,
    ];

    setMessages([...chatHistory, { role: "assistant", content: "" }]);
    setInput("");
    setSelectedFile(null);
    setIsLoading(true);
    let chatIdForRequest = activeChatId;

    try {  
       if (!chatIdForRequest) {
         const newChat = await saveChatToMongoDB(
            activeChatId,
            title,
            chatHistory
          );

          chatIdForRequest = newChat._id;
        }

      const formData = new FormData();

      formData.append("messages", JSON.stringify(chatHistory));
      formData.append("mode", activeMode || "default");
      formData.append("webSearchEnabled", String(webSearchEnabled));
      formData.append("chatId", chatIdForRequest);

      if (fileToSend) {
        formData.append("file", fileToSend);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      if (!res.ok || !res.body) {
        throw new Error("No stream returned.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let assistantReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantReply += chunk;

        setMessages([
          ...chatHistory,
          { role: "assistant", content: assistantReply },
        ]);
      }

      const finalMessages: Message[] = [
        ...chatHistory,
        { role: "assistant", content: assistantReply },
      ];

      setMessages(finalMessages);
      await saveChatToMongoDB(
        chatIdForRequest, 
        title, 
        finalMessages
      );
    } catch (error) {
      console.error(error);

      const errorMessages: Message[] = [
        ...chatHistory,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ];

      setMessages(errorMessages);
      await saveChatToMongoDB(
        chatIdForRequest, 
        title, 
        errorMessages
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex h-screen overflow-hidden bg-white text-slate-950 dark:bg-slate-950 dark:text-white">
      <ChatSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        chatSessions={chatSessions}
        activeChatId={activeChatId}
        activeMode={activeMode}
        openMenuId={openMenuId}
        setOpenMenuId={setOpenMenuId}
        onNewChat={startNewChat}
        onOpenChat={openChat}
        onRenameChat={renameChat}
        onDeleteChat={deleteChat}
        onSpecialChat={startSpecialChat}
        userName={profileName || session?.user?.name}
        userImage={profileImage || session?.user?.image}
      />

      <section className="flex max-w-full flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
          <h2 className="font-semibold text-slate-950 dark:text-white">
            AI Student Assistant
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ask questions about study, exams, projects, or career preparation.
          </p>
        </header>

        <ChatMessages
          messages={messages}
          bottomRef={bottomRef}
          copiedCode={copiedCode}
          isLoading={isLoading}
          webSearchEnabled={webSearchEnabled}
          onCopyCode={copyCode}
        />

        <ChatInput
          input={input}
          isLoading={isLoading}
          webSearchEnabled={webSearchEnabled}
          selectedFile={selectedFile}
          setInput={setInput}
          setWebSearchEnabled={setWebSearchEnabled}
          setSelectedFile={setSelectedFile}
          onSend={sendMessage}
        />
      </section>
    </main>
  );
}