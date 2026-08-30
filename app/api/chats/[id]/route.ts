import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

type IncomingMessage = {
  role: string;
  content: string;

  attachment?: {
    name: string;
    type: string;
    size: number;
  } | null;

  quiz?: {
    title: string;

    questions: {
      question: string;
      options: string[];
      answer: string;
      explanation: string;
    }[];

    answers?: Record<
      number,
      string
    >;

    submitted?: boolean;

    score?: number | null;
  } | null;
};

export async function PATCH(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const session =
      await auth();

    if (
      !session?.user?.id
    ) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const {
      id,
    } = await params;

    const body =
      await req.json();

    const existingChat =
      await prisma.chat.findFirst(
        {
          where: {
            id,

            userId:
              session.user.id,
          },
        }
      );

    if (!existingChat) {
      return NextResponse.json(
        {
          error:
            "Not found",
        },
        {
          status: 404,
        }
      );
    }

    const messages: IncomingMessage[] | undefined =
      Array.isArray(body.messages) ? body.messages : undefined;

    const chat = await prisma.$transaction(async (tx) => {
      if (messages) {
        const existingMessages = await tx.message.findMany({
          where: { chatId: id },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            position: true,
            role: true,
            content: true,
            quiz: true,
            attachment: true,
          },
        });

        const existingCount = existingMessages.length;
        const incomingCount = messages.length;

        // Helpers

        const quizEqual = (a: unknown, b: unknown) =>
          JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

        const attachmentsEqual = (
          e: { name: string; type: string; size: number } | null,
          i: { name: string; type: string; size: number } | null | undefined,
        ) =>
          e === null && (i === null || i === undefined)
            ? true
            : e !== null && i !== null && i !== undefined
              ? e.name === i.name && e.type === i.type && e.size === i.size
              : false;

        const structurallyEqual = (
          e: (typeof existingMessages)[number],
          i: IncomingMessage,
        ) =>
          e.role === i.role &&
          e.content === i.content &&
          attachmentsEqual(e.attachment, i.attachment ?? null);

        const msgData = (
          msg: IncomingMessage,
          position: number,
        ) => ({
          chatId: id,
          role: msg.role,
          content: msg.content,
          position,
          quiz: msg.quiz ?? Prisma.JsonNull,
          ...(msg.attachment
            ? { attachment: { create: { name: msg.attachment.name, type: msg.attachment.type, size: msg.attachment.size } } }
            : {}),
        });

        // Compare prefix: structural match, quiz match, and quiz diff indices.

        const limit = Math.min(existingCount, incomingCount);
        let structuralOk = true;
        let quizOk = true;
        const quizDiffs: number[] = [];

        for (let i = 0; i < limit; i++) {
          if (!structurallyEqual(existingMessages[i], messages[i])) {
            structuralOk = false;
            break;
          }
          if (!quizEqual(existingMessages[i].quiz, messages[i].quiz)) {
            quizOk = false;
            quizDiffs.push(i);
          }
        }

        // Path classification

        const equal = existingCount === incomingCount;
        const longer = incomingCount > existingCount;

        if (equal && structuralOk && quizOk) {
          // no-op
        } else if (equal && structuralOk) {
          // quiz-only update
          for (const i of quizDiffs) {
            await tx.message.update({
              where: { id: existingMessages[i].id },
              data: { quiz: messages[i].quiz ?? Prisma.JsonNull },
            });
          }
        } else if (longer && structuralOk && quizOk) {
          // pure append
          for (let i = existingCount; i < incomingCount; i++) {
            await tx.message.create({ data: msgData(messages[i], i) });
          }
        } else if (longer && structuralOk) {
          // append + prefix quiz updates
          for (const i of quizDiffs) {
            await tx.message.update({
              where: { id: existingMessages[i].id },
              data: { quiz: messages[i].quiz ?? Prisma.JsonNull },
            });
          }
          for (let i = existingCount; i < incomingCount; i++) {
            await tx.message.create({ data: msgData(messages[i], i) });
          }
        } else {
          // full rewrite
          await tx.message.deleteMany({ where: { chatId: id } });
          for (let i = 0; i < incomingCount; i++) {
            await tx.message.create({ data: msgData(messages[i], i) });
          }
        }
      }

      return tx.chat.update({
        where: { id },
        data: {
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.mode === "string" ? { mode: body.mode } : {}),
        },
        include: {
          messages: {
            include: { attachment: true },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          },
          documents: { orderBy: { createdAt: "asc" } },
        },
      });
    });

    return NextResponse.json(
      chat
    );
  } catch (error) {
    console.error(
      "Failed to update chat:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to update chat",
      },
      {
        status: 500,
      }
    );
  }
}

export async function DELETE(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const session =
      await auth();

    if (
      !session?.user?.id
    ) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const {
      id,
    } = await params;

    const chat =
      await prisma.chat.findFirst(
        {
          where: {
            id,

            userId:
              session.user.id,
          },
        }
      );

    if (!chat) {
      return NextResponse.json(
        {
          error:
            "Not found",
        },
        {
          status: 404,
        }
      );
    }

    await prisma.chat.delete({
      where: {
        id,
      },
    });

    return NextResponse.json(
      {
        success: true,
      }
    );
  } catch (error) {
    console.error(
      "Failed to delete chat:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to delete chat",
      },
      {
        status: 500,
      }
    );
  }
}