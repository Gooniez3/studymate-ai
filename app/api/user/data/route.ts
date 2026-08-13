import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const chats = await prisma.chat.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        messages: {
          include: {
            attachment: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        documents: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      totalChats: chats.length,
      chats,
    });
  } catch (error) {
    console.error("EXPORT_CHATS_ERROR:", error);

    return NextResponse.json(
      { error: "Failed to export chat history" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    await prisma.chat.deleteMany({
      where: {
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      message: "All chats deleted successfully",
    });
  } catch (error) {
    console.error("DELETE_ALL_CHATS_ERROR:", error);

    return NextResponse.json(
      { error: "Failed to delete chats" },
      { status: 500 }
    );
  }
}