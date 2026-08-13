import { NextResponse } from "next/server";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendAccountDeletedEmail } from "@/lib/email";

export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const email = user.email;

    // Because your Prisma relations use onDelete: Cascade,
    // deleting the user also removes related chats,
    // messages, attachments, and documents.
    await prisma.user.delete({
      where: {
        id: user.id,
      },
    });

    // Account deletion should still succeed even if
    // the notification email temporarily fails.
    try {
      await sendAccountDeletedEmail(email);
    } catch (emailError) {
      console.error(
        "ACCOUNT_DELETION_EMAIL_ERROR:",
        emailError
      );
    }

    await signOut({
      redirect: false,
    });

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error(
      "DELETE_ACCOUNT_ERROR:",
      error
    );

    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}