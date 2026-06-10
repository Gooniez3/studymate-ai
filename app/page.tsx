import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <section className="max-w-3xl text-center">
        <p className="text-blue-400 font-semibold mb-4">StudyMate AI</p>

        <h1 className="text-4xl md:text-6xl font-bold leading-tight">
          Your AI study assistant for exams, assignments, and career prep.
        </h1>

        <p className="text-slate-300 mt-6 text-lg">
          Chat with an AI assistant, generate study plans, prepare for exams,
          and improve your CV and LinkedIn profile.
        </p>

        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/chat"
            className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium"
          >
            Start Chatting
          </Link>

          <a
            href="#features"
            className="border border-slate-600 px-6 py-3 rounded-lg font-medium"
          >
            View Features
          </a>
        </div>
      </section>
    </main>
  );
}