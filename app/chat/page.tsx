"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AppTheme,
  Attachment,
  ChatMode,
  ChatSession,
  DefaultChatMode,
  Message,
  QuizData,
} from "@/types/chat";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatHeader from "@/components/chat/ChatHeader";
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


type QuizMetadata = {
  type: "quiz";
  data: QuizData;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([starterMessage]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ChatMode | null>(null);

  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const { data: session } = useSession();
  const ACTIVE_CHAT_KEY =
  "studymate-active-chat-id";
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(messages.length);
  const prevLastContentRef = useRef(
    messages.length > 0
      ? messages[messages.length - 1].content
      : ""
  );
  const prevChatIdRef = useRef(activeChatId);

  const applyTheme = (theme: AppTheme) => {
    document.documentElement.classList.remove("dark", "light", "system");
    document.documentElement.classList.add(theme || "system");
    try {
      localStorage.setItem("studymate-theme", theme || "system");
    } catch {}
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

    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  };

  const loadChats = async () => {
  try {
    const res =
      await fetch(
        "/api/chats"
      );

    if (!res.ok) {
      throw new Error(
        "Failed to load chats."
      );
    }

    const data:
      ChatSession[] =
      await res.json();

    setChatSessions(data);

    if (data.length === 0) {
      setActiveChatId(null);
      setActiveMode(null);
      setMessages([
        starterMessage,
      ]);

      localStorage.removeItem(
        ACTIVE_CHAT_KEY
      );

      return;
    }

    const savedChatId =
      localStorage.getItem(
        ACTIVE_CHAT_KEY
      );

    const savedChat =
      savedChatId
        ? data.find(
            (chat) =>
              chat.id ===
              savedChatId
          )
        : undefined;

    const chatToOpen =
      savedChat ??
      data[0];

    setActiveChatId(
      chatToOpen.id
    );

    setActiveMode(
      chatToOpen.mode &&
        chatToOpen.mode !==
          "default"
        ? chatToOpen.mode
        : null
    );

    setMessages(
      chatToOpen.messages
    );

    localStorage.setItem(
      ACTIVE_CHAT_KEY,
      chatToOpen.id
    );
  } catch (error) {
    console.error(
      "Failed to load chats:",
      error
    );
  } finally {
    setIsInitialLoading(false);
  }
};

  useEffect(() => {
    // Initial data load on mount - setState here
    // is intentional hydration of profile/chats.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUserProfile();

    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    const prevContent = prevLastContentRef.current;
    const prevChatId = prevChatIdRef.current;
    const count = messages.length;
    const lastContent =
      count > 0 ? messages[count - 1].content : "";

    prevCountRef.current = count;
    prevLastContentRef.current = lastContent;
    prevChatIdRef.current = activeChatId;

    const countGrew = count > prevCount;
    const contentChanged = lastContent !== prevContent;
    const chatChanged = activeChatId !== prevChatId;

    if (countGrew || chatChanged || (contentChanged && isLoading)) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, activeChatId]);

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
    setStatusMessage(null);

    localStorage.removeItem(
  ACTIVE_CHAT_KEY
);
  };

  const startSpecialChat = (mode: ChatMode) => {
    setActiveChatId(null);
    setActiveMode(mode);
    setInput("");
    setSelectedFile(null);
    setOpenMenuId(null);
    setStatusMessage(null);

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

  const openChat = (
  chat: ChatSession
) => {
  setActiveChatId(
    chat.id
  );

  localStorage.setItem(
    ACTIVE_CHAT_KEY,
    chat.id
  );

  setActiveMode(
    chat.mode &&
      chat.mode !== "default"
      ? chat.mode
      : null
  );

  setMessages(
    chat.messages
  );

  setInput("");
  setSelectedFile(null);
  setOpenMenuId(null);
};

  const renameChat = async (chatId: string) => {
    const chat = chatSessions.find((c) => c.id === chatId);
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
        prev.map((c) => (c.id === chatId ? updatedChat : c))
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

      const remainingChats = chatSessions.filter((chat) => chat.id !== chatId);

      setChatSessions(remainingChats);
      setOpenMenuId(null);

      if (activeChatId === chatId) {
        const nextChat = remainingChats[0];

        if (nextChat) {
          setActiveChatId(nextChat.id);
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
  
const updateQuizMessage =
  async (
    messageIndex: number,
    quiz: QuizData
  ) => {
    const updatedMessages =
      messages.map(
        (
          message,
          index
        ) =>
          index ===
          messageIndex
            ? {
                ...message,
                quiz,
              }
            : message
      );

    setMessages(
      updatedMessages
    );

    if (
      !activeChatId
    ) {
      return;
    }

    const activeChat =
      chatSessions.find(
        (chat) =>
          chat.id ===
          activeChatId
      );

    const title =
      activeChat?.title ??
      "StudyMate Chat";

    try {
      await saveChat(
        activeChatId,
        title,
        updatedMessages
      );
    } catch (error) {
      console.error(
        "Failed to save quiz progress:",
        error
      );
    }
  };

  const saveChat = async (
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
          .map((chat) => (chat.id === chatId ? updatedChat : chat))
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

    setActiveChatId(newChat.id);
    localStorage.setItem(
  ACTIVE_CHAT_KEY,
  newChat.id
);
    setChatSessions((prev) => [newChat, ...prev]);

    return newChat;
  };

 const sendMessage = async () => {
  if (
    (!input.trim() && !selectedFile) ||
    isLoading
  ) {
    return;
  }

  const currentInput =
    input.trim() ||
    "Please analyze this PDF.";

  const fileToSend =
    selectedFile;

  const title =
    createChatTitle(
      currentInput,
      fileToSend
    );

  const attachment:
    Attachment | null =
    fileToSend
      ? {
          name:
            fileToSend.name,

          type:
            fileToSend.type,

          size:
            fileToSend.size,
        }
      : null;

  const userMessage:
    Message = {
    role: "user",

    content:
      currentInput,

    attachment,
  };

  const chatHistory:
    Message[] = [
    ...messages.filter(
      (message) =>
        message.content !==
        "â— â— â—"
    ),

    userMessage,
  ];

  /*
   * Add a temporary empty
   * assistant message while
   * StudyMate is generating.
   */
  setMessages([
    ...chatHistory,

    {
      role: "assistant",
      content: "",
    },
  ]);

  setInput("");

  setSelectedFile(null);

  setIsLoading(true);

  if (fileToSend) {
    setStatusMessage("Reading document...");
  } else if (webSearchEnabled) {
    setStatusMessage("Searching the web...");
  } else {
    setStatusMessage("Thinking...");
  }

  let chatIdForRequest =
    activeChatId;

  try {
    /*
     * Create the chat first if this
     * is a brand-new conversation.
     *
     * This is important because the
     * LangGraph checkpoint thread
     * uses the chat ID.
     */
    if (!chatIdForRequest) {
      const newChat =
        await saveChat(
          activeChatId,
          title,
          chatHistory
        );

      chatIdForRequest =
        newChat.id;
    }

    const formData =
      new FormData();

    formData.append(
      "messages",
      JSON.stringify(
        chatHistory
      )
    );

    formData.append(
      "mode",
      activeMode ||
        "default"
    );

    formData.append(
      "webSearchEnabled",
      String(
        webSearchEnabled
      )
    );

    formData.append(
      "chatId",
      chatIdForRequest
    );

    if (fileToSend) {
      formData.append(
        "file",
        fileToSend
      );
    }

    /*
     * Send the request to the
     * LangGraph-powered API route.
     */
    const res =
      await fetch(
        "/api/chat",
        {
          method: "POST",
          body: formData,
        }
      );

    if (
      !res.ok ||
      !res.body
    ) {
      throw new Error(
        "No stream returned."
      );
    }

    const reader =
      res.body.getReader();

    const decoder =
      new TextDecoder();

    /*
     * rawAssistantReply:
     * Everything received from
     * the API, including hidden
     * StudyMate metadata.
     *
     * visibleAssistantReply:
     * Only the text the user
     * should actually see.
     */
    let rawAssistantReply =
      "";

    let visibleAssistantReply =
      "";

    let quizData:
      QuizData | null =
      null;

    /*
     * Backend metadata markers.
     */
    const QUIZ_START =
      "__STUDYMATE_QUIZ__";

    const QUIZ_END =
      "__END_STUDYMATE_QUIZ__";

    /*
     * Read the streamed response.
     */
    while (true) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (done) {
        break;
      }

      const chunk =
        decoder.decode(
          value,
          {
            stream: true,
          }
        );

      rawAssistantReply +=
        chunk;

      /*
       * Check whether quiz metadata
       * has started appearing.
       */
      const quizStartIndex =
        rawAssistantReply.indexOf(
          QUIZ_START
        );

      if (
        quizStartIndex >= 0
      ) {
        /*
         * Everything before the
         * metadata marker is normal
         * visible assistant text.
         */
        visibleAssistantReply =
          rawAssistantReply
            .slice(
              0,
              quizStartIndex
            )
            .trimEnd();

        /*
         * The metadata may arrive
         * across multiple stream
         * chunks, so only parse it
         * when the closing marker
         * has also arrived.
         */
        const quizEndIndex =
          rawAssistantReply.indexOf(
            QUIZ_END,
            quizStartIndex +
              QUIZ_START.length
          );

        if (
          quizEndIndex >= 0
        ) {
          const quizJson =
            rawAssistantReply.slice(
              quizStartIndex +
                QUIZ_START.length,

              quizEndIndex
            );

          try {
            const parsed =
              JSON.parse(
                quizJson
              ) as QuizMetadata;

            if (
              parsed.type ===
                "quiz" &&
              parsed.data
            ) {
              quizData =
                parsed.data;
            }
          } catch (error) {
            console.error(
              "Failed to parse quiz metadata:",
              error
            );
          }
        }
      } else {
        /*
         * Normal non-quiz response.
         */
        visibleAssistantReply =
          rawAssistantReply;
      }

      /*
       * Update the visible assistant
       * message during streaming.
       *
       * Hidden quiz JSON never
       * appears in the UI.
       */
      if (visibleAssistantReply) {
        setStatusMessage(null);
      }

      setMessages([
        ...chatHistory,

        {
          role:
            "assistant",

          content:
            visibleAssistantReply,
        },
      ]);
    }

    /*
     * Flush any remaining bytes in
     * the TextDecoder.
     */
    const remaining =
      decoder.decode();

    if (remaining) {
      rawAssistantReply +=
        remaining;
    }

    /*
     * Parse metadata one last time
     * after the stream has finished.
     *
     * This makes the parser safer
     * if the metadata arrives in
     * unusual stream boundaries.
     */
    const finalQuizStartIndex =
      rawAssistantReply.indexOf(
        QUIZ_START
      );

    if (
      finalQuizStartIndex >= 0
    ) {
      visibleAssistantReply =
        rawAssistantReply
          .slice(
            0,
            finalQuizStartIndex
          )
          .trimEnd();

      const finalQuizEndIndex =
        rawAssistantReply.indexOf(
          QUIZ_END,
          finalQuizStartIndex +
            QUIZ_START.length
        );

      if (
        finalQuizEndIndex >= 0
      ) {
        const quizJson =
          rawAssistantReply.slice(
            finalQuizStartIndex +
              QUIZ_START.length,

            finalQuizEndIndex
          );

        try {
          const parsed =
            JSON.parse(
              quizJson
            ) as QuizMetadata;

          if (
            parsed.type ===
              "quiz" &&
            parsed.data
          ) {
            quizData =
              parsed.data;
          }
        } catch (error) {
          console.error(
            "Failed to parse final quiz metadata:",
            error
          );
        }
      }
    } else {
      visibleAssistantReply =
        rawAssistantReply;
    }

    /*
     * For this step we only confirm
     * that structured quiz data has
     * successfully reached the
     * frontend.
     *
     * In the next step this data
     * will be attached to the
     * Message and rendered as an
     * interactive quiz card.
     */
    if (quizData) {
      console.log(
        "Interactive quiz received:",
        quizData
      );

      console.log(
        "Quiz title:",
        quizData.title
      );

      console.log(
        "Quiz questions:",
        quizData.questions.length
      );
    }

    /*
     * Save only the visible text.
     *
     * Do NOT save the hidden
     * __STUDYMATE_QUIZ__ metadata
     * string as chat content.
     */
    const finalMessages:
  Message[] = [
  ...chatHistory,

  {
    role:
      "assistant",

    content:
      visibleAssistantReply,

    quiz:
      quizData,
  },
];

    setMessages(
      finalMessages
    );

    await saveChat(
      chatIdForRequest,
      title,
      finalMessages
    );
  } catch (error) {
    console.error(
      "Send message failed:",
      error
    );

    const errorMessage:
      Message = {
      role:
        "assistant",

      content:
        "StudyMate AI could not complete that request. Please try again.",
    };

    const finalMessages:
      Message[] = [
      ...chatHistory,
      errorMessage,
    ];

    setMessages(
      finalMessages
    );
  } finally {
    setIsLoading(false);
    setStatusMessage(null);
  }
};

  const activeChat = chatSessions.find(
    (chat) => chat.id === activeChatId
  );

  const headerTitle = isInitialLoading
    ? "StudyMate AI"
    : activeChat
    ? activeChat.title
    : activeMode
    ? "New conversation"
    : "New conversation";

  return (
    <main className="flex h-dvh overflow-hidden bg-white text-slate-950 dark:bg-slate-950 dark:text-white">
      <ChatSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
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
        isInitialLoading={isInitialLoading}
      />

      <section className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          title={headerTitle}
          activeMode={activeMode}
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <ChatMessages
          messages={messages}
          bottomRef={bottomRef}
          copiedCode={copiedCode}
          isLoading={isLoading}
          statusMessage={statusMessage}
          webSearchEnabled={webSearchEnabled}
          onCopyCode={copyCode}
          onQuizChange={
          updateQuizMessage
}
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