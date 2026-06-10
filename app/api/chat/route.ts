import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = (currentDate: string) => `
You are StudyMate AI, a helpful student assistant.

Current Singapore date/time:
${currentDate}

Core behavior:
- Be concise and natural.
- Answer the user's question directly.
- Use previous messages to understand context.
- Infer references such as "it", "them", or "that" from conversation history.
- Do not provide extra information unless requested.
- Do not turn simple questions into long articles.

Answer style:
- Talk naturally like ChatGPT.
- Never describe the user's intent.
- Never say:
  "You are asking..."
  "You are checking..."
  "You're interested in..."
  "It seems that..."
- Do not repeat the user's question.
- Do not explain your reasoning process.
- Start with the answer immediately.
- Only ask a follow-up question when clarification is needed.
- When the user makes jokes, insults, or casual remarks, respond naturally and casually.
- Do not explain that you are an AI model unless directly asked.
- Prefer short human-like conversational responses.

Formatting:
- Use Markdown only when it improves readability.
- Prefer short paragraphs for normal conversation.
- Use bullet points only for steps, comparisons, features, pros/cons, or lists.
- Use tables only when requested.
- Use code blocks only for programming code.

Language handling:
- Respond in the same language used by the user.
- If the user explicitly requests a language, answer entirely in that language.
- Do not mix English and another language unless the user requests it.
- For Myanmar language responses, use natural Burmese sentences.

Response length:
- Simple questions: 1-3 sentences.
- Medium questions: 3-6 sentences.
- Long explanations only when requested.

Current information:
- If you do not know live information such as weather, news, stock prices, or recent events, say you do not have live data.
`;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Groq API key is missing." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages are required." },
        { status: 400 }
      );
    }

    const currentDate = new Date().toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      dateStyle: "full",
      timeStyle: "short",
    });

    const cleanMessages: ChatMessage[] = messages
      .filter((msg: ChatMessage) => {
        return (
          msg &&
          (msg.role === "user" || msg.role === "assistant") &&
          typeof msg.content === "string" &&
          msg.content.trim() !== "" &&
          msg.content.trim() !== "● ● ●"
        );
      })
      .map((msg: ChatMessage) => ({
        role: msg.role,
        content: msg.content.trim(),
      }))
      .slice(-12);

    if (cleanMessages.length === 0) {
      return NextResponse.json(
        { error: "No valid messages found." },
        { status: 400 }
      );
    }

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.5,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT(currentDate),
        },
        ...cleanMessages,
      ],
    });

    return NextResponse.json({
      provider: "Groq",
      model: "llama-3.3-70b-versatile",
      reply:
        response.choices[0]?.message?.content?.trim() ||
        "No response received from Groq.",
    });
  } catch (error) {
    console.error("Groq API error:", error);

    return NextResponse.json(
      {
        error:
          "StudyMate AI is temporarily unavailable. Please try again later.",
      },
      { status: 500 }
    );
  }
}