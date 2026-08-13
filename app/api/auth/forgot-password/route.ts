import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { sendPasswordResetCodeEmail } from "@/lib/email";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    await connectDB();

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

   

    // Do not reveal if account exists
    if (!user || !user.password) {
      return NextResponse.json({ success: true });
    }

    const code = generateCode();

    user.resetPasswordToken = hashCode(code);
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

   

    await sendPasswordResetCodeEmail(normalizedEmail, code);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}