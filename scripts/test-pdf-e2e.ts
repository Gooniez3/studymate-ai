import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config({
  path: ".env.local",
});

/*
 * End-to-end regression test for the REAL
 * studymate_rag_test.pdf through the actual
 * API route (auth -> upload -> RAG ->
 * grounded answer -> citations -> follow-up ->
 * document-grounded quiz).
 *
 * Requires a running dev server:
 *   npm run dev
 *
 * Skips gracefully when the server is not
 * reachable. Creates a dedicated test user and
 * removes it afterwards (cascades chat,
 * document, chunks, embeddings, messages).
 */

const BASE =
  process.env.E2E_BASE_URL ??
  "http://localhost:3000";

const EMAIL =
  "pdf-e2e-test@studymate.local";

const PASSWORD =
  "Pdf-E2E-Test-2026!";

const FIXTURE_PATH =
  "tests/fixtures/studymate_rag_test.pdf";

async function ensureTestUser() {
  const { prisma } = await import(
    "../lib/prisma"
  );

  const bcrypt = (
    await import("bcryptjs")
  ).default;

  const existing =
    await prisma.user.findUnique({
      where: { email: EMAIL },
    });

  if (existing) {
    return;
  }

  await prisma.user.create({
    data: {
      name: "PDF E2E Test",

      email: EMAIL,

      emailVerified: true,

      password:
        await bcrypt.hash(
          PASSWORD,
          12
        ),
    },
  });
}

async function removeTestUser() {
  const { prisma } = await import(
    "../lib/prisma"
  );

  await prisma.user
    .delete({
      where: { email: EMAIL },
    })
    .catch(() => undefined);
}

async function login(): Promise<string> {
  const csrfRes = await fetch(
    `${BASE}/api/auth/csrf`
  );

  const { csrfToken } =
    (await csrfRes.json()) as {
      csrfToken: string;
    };

  const cookies =
    csrfRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]);

  const loginRes = await fetch(
    `${BASE}/api/auth/callback/credentials`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",

        Cookie: cookies.join("; "),
      },

      body: new URLSearchParams({
        csrfToken,

        email: EMAIL,

        password: PASSWORD,

        callbackUrl: `${BASE}/chat`,
      }),

      redirect: "manual",
    }
  );

  const sessionCookies = [
    ...cookies,

    ...(loginRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])),
  ];

  if (
    !sessionCookies.some((c) =>
      c.startsWith("authjs.session-token")
    )
  ) {
    throw new Error(
      `Login failed (${loginRes.status})`
    );
  }

  return sessionCookies.join("; ");
}

async function createChat(
  cookie: string
): Promise<string> {
  const res = await fetch(
    `${BASE}/api/chats`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Cookie: cookie,
      },

      body: JSON.stringify({
        title:
          "[pdf-e2e] studymate_rag_test",
      }),
    }
  );

  const data = (await res.json()) as {
    id?: string;
  };

  if (!res.ok || !data.id) {
    throw new Error(
      `Chat creation failed: ${res.status}`
    );
  }

  return data.id;
}

async function sendMessage(options: {
  cookie: string;

  chatId: string;

  content: string;

  pdfPath?: string;
}): Promise<{
  visible: string;

  hasQuiz: boolean;
}> {
  const form = new FormData();

  form.append(
    "messages",
    JSON.stringify([
      {
        role: "user",

        content: options.content,
      },
    ])
  );

  form.append("chatId", options.chatId);

  form.append("mode", "default");

  form.append(
    "webSearchEnabled",
    "false"
  );

  if (options.pdfPath) {
    const bytes =
      readFileSync(options.pdfPath);

    form.append(
      "file",

      new Blob(
        [new Uint8Array(bytes)],
        {
          type: "application/pdf",
        }
      ),

      "studymate_rag_test.pdf"
    );
  }

  const res = await fetch(
    `${BASE}/api/chat`,
    {
      method: "POST",

      headers: {
        Cookie: options.cookie,
      },

      body: form,
    }
  );

  console.log(
    `\n[${options.content}] HTTP ${res.status}`
  );

  if (!res.ok || !res.body) {
    throw new Error(
      `Chat request failed: ${res.status}`
    );
  }

  const raw = await res.text();

  const quizStart =
    raw.indexOf("__STUDYMATE_QUIZ__");

  const visible =
    quizStart === -1
      ? raw.trim()
      : raw.slice(0, quizStart).trim();

  return {
    visible,

    hasQuiz:
      quizStart !== -1 &&
      raw.includes("__END_STUDYMATE_QUIZ__"),
  };
}

async function main() {
  try {
    await fetch(
      `${BASE}/api/auth/csrf`,
      {
        signal:
          AbortSignal.timeout(5000),
      }
    );
  } catch {
    console.log(
      `SKIP | dev server not reachable at ${BASE} - start 'npm run dev' to run this test`
    );

    return;
  }

  let failures = 0;

  try {
    await ensureTestUser();

    const cookie = await login();

    console.log("login OK");

    const chatId =
      await createChat(cookie);

    console.log("chat:", chatId);

    // 1. Upload the REAL PDF and ask for an explanation.
    const first =
      await sendMessage({
        cookie,

        chatId,

        content:
          "Explain this document",

        pdfPath: FIXTURE_PATH,
      });

    console.log(
      "visible:",
      first.visible.slice(0, 180)
    );

    const hasCitations =
      first.visible.includes(
        "**Document Sources**"
      );

    console.log(
      "document sources present:",
      hasCitations
    );

    if (!hasCitations) {
      failures += 1;
    }

    // 2. Document follow-up.
    const second =
      await sendMessage({
        cookie,

        chatId,

        content:
          "Explain that more simply.",
      });

    console.log(
      "follow-up:",
      second.visible.slice(0, 140)
    );

    // 3. Document-grounded quiz.
    const third =
      await sendMessage({
        cookie,

        chatId,

        content: "Quiz me on this.",
      });

    console.log(
      "quiz marker:",
      third.hasQuiz
    );

    if (!third.hasQuiz) {
      failures += 1;
    }

    console.log(
      `\n=== PDF E2E ${
        failures === 0
          ? "ALL CHECKS PASSED"
          : `${failures} FAILURE(S)`
      } ===`
    );
  } finally {
    await removeTestUser();

    console.log(
      "E2E test user cleaned up."
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
