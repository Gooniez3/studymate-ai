import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

export async function GET() {
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

    const chats =
      await prisma.chat.findMany({
        where: {
          userId:
            session.user.id,
        },

        include: {
          messages: {
            include: {
              attachment:
                true,
            },

            orderBy: [
              {
                position:
                  "asc",
              },
              {
                createdAt:
                  "asc",
              },
            ],
          },

          documents: {
            orderBy: {
              createdAt:
                "asc",
            },
          },
        },

        orderBy: {
          updatedAt:
            "desc",
        },
      });

    return NextResponse.json(
      chats
    );
  } catch (error) {
    console.error(
      "Failed to load chats:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to load chats",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(
  req: Request
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

    const body =
      await req.json();

    const messages:
      IncomingMessage[] =
      Array.isArray(
        body.messages
      )
        ? body.messages
        : [];

    const chat =
      await prisma.chat.create({
        data: {
          userId:
            session.user.id,

          title:
            body.title ||
            "New Chat",

          mode:
            body.mode ||
            "default",

          messages: {
            create:
              messages.map(
                (
                  message,
                  index
                ) => ({
                  role:
                    message.role,

                  content:
                    message.content,

                  position:
                    index,

                  quiz:
                    message.quiz ??
                    undefined,

                  ...(
                    message.attachment
                      ? {
                          attachment:
                            {
                              create:
                                {
                                  name:
                                    message
                                      .attachment
                                      .name,

                                  type:
                                    message
                                      .attachment
                                      .type,

                                  size:
                                    message
                                      .attachment
                                      .size,
                                },
                            },
                        }
                      : {}
                  ),
                })
              ),
          },
        },

        include: {
          messages: {
            include: {
              attachment:
                true,
            },

            orderBy: [
              {
                position:
                  "asc",
              },
              {
                createdAt:
                  "asc",
              },
            ],
          },

          documents: {
            orderBy: {
              createdAt:
                "asc",
            },
          },
        },
      });

    return NextResponse.json(
      chat
    );
  } catch (error) {
    console.error(
      "Failed to create chat:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to create chat",
      },
      {
        status: 500,
      }
    );
  }
}