import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

function hashCode(code: string) {
  return crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
}

function isStrongPassword(password: string) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export async function POST(req: Request) {
  try {
    const { email, code, password } =
      await req.json();

    if (!email || !code || !password) {
      return NextResponse.json(
        {
          error:
            "Email, code, and password are required.",
        },
        { status: 400 }
      );
    }

    if (!isStrongPassword(password)) {
      return NextResponse.json(
        {
          error:
            "Password must have 8 characters, 1 uppercase letter, 1 number, and 1 special character.",
        },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email)
      .toLowerCase()
      .trim();

    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        resetPasswordToken: hashCode(
          String(code)
        ),
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired reset code.",
        },
        { status: 400 }
      );
    }

    const hashedPassword =
      await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        password: hashedPassword,
        passwordUpdatedAt: new Date(),
        emailVerified: true,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Reset password error:",
      error
    );

    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}