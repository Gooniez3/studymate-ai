import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({
  path: ".env.local",
});

const apiKey =
  process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY is missing."
  );
}

const client = new OpenAI({
  apiKey,
  baseURL:
    "https://openrouter.ai/api/v1",
});

const response =
  await client.chat.completions.create({
    model: "openrouter/free",

    messages: [
      {
        role: "user",
        content:
          "Reply with exactly: OpenRouter works",
      },
    ],

    temperature: 0,
  });

console.log(
  "OpenRouter response:",
  response.choices[0]?.message?.content
);