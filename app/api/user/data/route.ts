import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import Chat from "@/models/Chat";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const chats = await Chat.find({ userId: session.user.id })
      .sort({ updatedAt: -1 })
      .lean();

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    await Chat.deleteMany({ userId: session.user.id });

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