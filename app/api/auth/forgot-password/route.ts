import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetCodeEmail } from "@/lib/email";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashCode(code: string) {
  return crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email)
      .toLowerCase()
      .trim();

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    // Do not reveal whether an account exists
    // Also don't send reset codes for Google-only accounts
    if (!user || !user.password) {
      return NextResponse.json({
        success: true,
      });
    }

    const code = generateCode();

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        resetPasswordToken: hashCode(code),
        resetPasswordExpires: new Date(
          Date.now() + 10 * 60 * 1000
        ),
      },
    });

    await sendPasswordResetCodeEmail(
      normalizedEmail,
      code
    );

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}