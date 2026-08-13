import { FileText, Globe, Paperclip, Send, X } from "lucide-react";
import { useRef } from "react";

type ChatInputProps = {
  input: string;
  isLoading: boolean;
  webSearchEnabled: boolean;
  selectedFile: File | null;
  setInput: (value: string) => void;
  setWebSearchEnabled: (value: boolean) => void;
  setSelectedFile: (file: File | null) => void;
  onSend: () => void;
};

export default function ChatInput({
  input,
  isLoading,
  webSearchEnabled,
  selectedFile,
  setInput,
  setWebSearchEnabled,
  setSelectedFile,
  onSend,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Only PDF files are supported for now.");
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("PDF must be under 10MB.");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
    e.target.value = "";
  };

  return (
    <div className="shrink-0 bg-white px-4 py-4 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        {selectedFile && (
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                <FileText size={18} />
              </div>

              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900 dark:text-white">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-slate-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · PDF
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 hover:text-slate-950 disabled:opacity-50 dark:border-slate-700 dark:bg-[#1f1f1f] dark:text-slate-400 dark:hover:text-white"
            title="Add PDF"
          >
            <Paperclip size={18} />
          </button>

          <button
            type="button"
            onClick={() => setWebSearchEnabled(!webSearchEnabled)}
            className={`flex h-11 items-center gap-2 rounded-full border px-4 text-sm ${
              webSearchEnabled
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-slate-300 bg-slate-100 text-slate-600 hover:text-slate-950 dark:border-slate-700 dark:bg-[#1f1f1f] dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Globe size={16} />
            Web
          </button>

          <div className="relative flex-1">
            <input
              value={input}
              disabled={isLoading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSend();
              }}
              placeholder={
                isLoading
                  ? "StudyMate is thinking..."
                  : selectedFile
                  ? "Ask about this PDF..."
                  : "Ask StudyMate AI anything..."
              }
              className="w-full rounded-full border border-slate-300 bg-slate-100 py-3 pl-6 pr-16 text-slate-950 outline-none focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-[#1f1f1f] dark:text-white"
            />

            <button
              onClick={onSend}
              disabled={isLoading || (!input.trim() && !selectedFile)}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-slate-200"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

        <p className="mt-2 text-center text-xs text-slate-500">
          StudyMate AI can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}