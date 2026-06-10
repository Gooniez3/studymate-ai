import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Chat from "@/models/Chat";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();

  const body = await req.json();
  const { id } = await params;

  const chat = await Chat.findByIdAndUpdate(id, body, {
    new: true,
  });

  return NextResponse.json(chat);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();

  const { id } = await params;

  await Chat.findByIdAndDelete(id);

  return NextResponse.json({ success: true });
}