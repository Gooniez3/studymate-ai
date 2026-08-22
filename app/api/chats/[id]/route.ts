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

    const messages:
      IncomingMessage[] |
      undefined =
      Array.isArray(
        body.messages
      )
        ? body.messages
        : undefined;

    const chat =
      await prisma.$transaction(
        async (tx) => {
          /*
           * Current implementation
           * rewrites all messages.
           *
           * We preserve the exact
           * conversational order using
           * the explicit position field.
           */
          if (messages) {
            await tx.message.deleteMany(
              {
                where: {
                  chatId:
                    id,
                },
              }
            );
          }

          return tx.chat.update(
            {
              where: {
                id,
              },

              data: {
                ...(
                  typeof body.title ===
                  "string"
                    ? {
                        title:
                          body.title,
                      }
                    : {}
                ),

                ...(
                  typeof body.mode ===
                  "string"
                    ? {
                        mode:
                          body.mode,
                      }
                    : {}
                ),

                ...(
                  messages
                    ? {
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

                                /*
                                 * Stable message order.
                                 */
                                position:
                                  index,

                                /*
                                 * Quiz definition +
                                 * selected answers +
                                 * submitted state +
                                 * score are stored
                                 * inside this JSON.
                                 */
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
                      }
                    : {}
                ),
              },

              include: {
                messages: {
                  include: {
                    attachment:
                      true,
                  },

                  /*
                   * Never depend only
                   * on createdAt because
                   * these rows may be
                   * recreated within the
                   * same millisecond.
                   */
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
            }
          );
        }
      );

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