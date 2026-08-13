import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(
  email: string,
  code: string
) {
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Verify your StudyMate AI account",
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Verify your StudyMate AI account</h2>

        <p>Your verification code is:</p>

        <div style="
          font-size:32px;
          font-weight:bold;
          letter-spacing:8px;
          margin:20px 0;
        ">
          ${code}
        </div>

        <p>This code expires in 10 minutes.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Reset your StudyMate AI password",
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Reset your StudyMate AI password</h2>

        <p>You requested to reset your password.</p>

        <p>
          <a href="${resetUrl}" style="
            display:inline-block;
            background:#2563eb;
            color:white;
            padding:12px 18px;
            border-radius:8px;
            text-decoration:none;
            font-weight:bold;
          ">
            Reset Password
          </a>
        </p>

        <p>This link expires in 15 minutes.</p>

        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}
export async function sendPasswordResetCodeEmail(email: string, code: string) {
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Reset your StudyMate AI password",
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Reset your StudyMate AI password</h2>
        <p>Your password reset code is:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0;">
          ${code}
        </div>
        <p>This code expires in 10 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });

  console.log("Resend result:", result);

  return result;
}