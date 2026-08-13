import { NextResponse } from "next/server";
import { auth, signOut } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Chat from "@/models/Chat";

export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    await Chat.deleteMany({ userId: session.user.id });
    await User.findByIdAndDelete(session.user.id);

    await signOut({ redirect: false });

    return NextResponse.json({
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("DELETE_ACCOUNT_ERROR:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}