import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Chat from "@/models/Chat";

export async function GET() {
  await connectDB();

  const chats = await Chat.find().sort({ updatedAt: -1 });

  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  await connectDB();

  const body = await req.json();

  const chat = await Chat.create({
    title: body.title,
    messages: body.messages,
  });

  return NextResponse.json(chat);
}