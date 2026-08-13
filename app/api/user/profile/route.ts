import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function isStrongPassword(password: string) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export async function GET() {
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
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        password: true,
        passwordUpdatedAt: true,
        defaultMode: true,
        webSearchDefault: true,
        theme: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const totalChats = await prisma.chat.count({
      where: {
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name || "",
        email: user.email,
        image: user.image || "",
        emailVerified: user.emailVerified,
        accountType: user.password
          ? "Email & Password"
          : "Google",
        loginMethod: user.password
          ? "Email/password"
          : "Google OAuth",
        passwordUpdatedAt:
          user.passwordUpdatedAt || null,
        defaultMode:
          user.defaultMode || "default",
        webSearchDefault:
          user.webSearchDefault ?? false,
        theme: user.theme || "system",
        createdAt: user.createdAt,
      },

      stats: {
        totalChats,
      },
    });
  } catch (error) {
    console.error("GET_PROFILE_ERROR:", error);

    return NextResponse.json(
      { error: "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        defaultMode: true,
        webSearchDefault: true,
        theme: true,
        passwordUpdatedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const updateData: {
      name?: string;
      password?: string;
      passwordUpdatedAt?: Date;
      defaultMode?: string;
      webSearchDefault?: boolean;
      theme?: string;
    } = {};

    if (typeof body.name === "string") {
      const name = body.name.trim();

      if (name.length < 2) {
        return NextResponse.json(
          {
            error:
              "Name must be at least 2 characters",
          },
          { status: 400 }
        );
      }

      updateData.name = name;
    }

    if (
      body.currentPassword ||
      body.newPassword
    ) {
      if (!user.password) {
        return NextResponse.json(
          {
            error:
              "Google accounts cannot change password here",
          },
          { status: 400 }
        );
      }

      if (
        !body.currentPassword ||
        !body.newPassword
      ) {
        return NextResponse.json(
          {
            error:
              "Current password and new password are required",
          },
          { status: 400 }
        );
      }

      const isMatch = await bcrypt.compare(
        body.currentPassword,
        user.password
      );

      if (!isMatch) {
        return NextResponse.json(
          {
            error:
              "Current password is incorrect",
          },
          { status: 400 }
        );
      }

      if (
        !isStrongPassword(body.newPassword)
      ) {
        return NextResponse.json(
          {
            error:
              "Password must be 8+ characters with uppercase, number, and special character",
          },
          { status: 400 }
        );
      }

      updateData.password = await bcrypt.hash(
        body.newPassword,
        12
      );

      updateData.passwordUpdatedAt =
        new Date();
    }

    if (
      typeof body.defaultMode === "string"
    ) {
      const allowedModes = [
        "default",
        "exam",
        "assignment",
        "career",
      ];

      if (
        !allowedModes.includes(
          body.defaultMode
        )
      ) {
        return NextResponse.json(
          {
            error: "Invalid default mode",
          },
          { status: 400 }
        );
      }

      updateData.defaultMode =
        body.defaultMode;
    }

    if (
      typeof body.webSearchDefault ===
      "boolean"
    ) {
      updateData.webSearchDefault =
        body.webSearchDefault;
    }

    if (typeof body.theme === "string") {
      const allowedThemes = [
        "system",
        "light",
        "dark",
      ];

      if (
        !allowedThemes.includes(body.theme)
      ) {
        return NextResponse.json(
          {
            error: "Invalid theme",
          },
          { status: 400 }
        );
      }

      updateData.theme = body.theme;
    }

    await prisma.user.update({
      where: {
        id: session.user.id,
      },
      data: updateData,
    });

    return NextResponse.json({
      message:
        "Profile updated successfully",
    });
  } catch (error) {
    console.error(
      "PATCH_PROFILE_ERROR:",
      error
    );

    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}