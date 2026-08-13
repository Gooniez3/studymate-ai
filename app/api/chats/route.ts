import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Chat from "@/models/Chat";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const chats = await Chat.find({ userId: session.user.id }).sort({ updatedAt: -1 });
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const body = await req.json();

  const chat = await Chat.create({
    userId: session.user.id,
    title: body.title || "New Chat",
    mode: body.mode || "default",
    messages: body.messages || [],
  });

  return NextResponse.json(chat);
}