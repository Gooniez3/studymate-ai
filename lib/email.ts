import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const BRAND_NAME = "StudyMate AI";
const BRAND_COLOR = "#2563eb";
const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL || "support@studymateai.app";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailLayout({
  title,
  previewText,
  content,
}: {
  title: string;
  previewText: string;
  content: string;
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background-color:#f4f7fb;
    font-family:Arial,Helvetica,sans-serif;
    color:#0f172a;
  "
>
  <div
    style="
      display:none;
      max-height:0;
      overflow:hidden;
      opacity:0;
      color:transparent;
    "
  >
    ${escapeHtml(previewText)}
  </div>

  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="background-color:#f4f7fb;"
  >
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width:560px;
            background:#ffffff;
            border:1px solid #e2e8f0;
            border-radius:18px;
            overflow:hidden;
          "
        >
          <tr>
            <td
              style="
                padding:28px 32px 22px;
                border-bottom:1px solid #e2e8f0;
              "
            >
              <table
                role="presentation"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td
                    align="center"
                    valign="middle"
                    style="
                      width:42px;
                      height:42px;
                      background:${BRAND_COLOR};
                      border-radius:12px;
                      color:#ffffff;
                      font-size:21px;
                      font-weight:700;
                    "
                  >
                    S
                  </td>

                  <td style="padding-left:12px;">
                    <div
                      style="
                        font-size:20px;
                        line-height:26px;
                        font-weight:700;
                        color:#0f172a;
                      "
                    >
                      ${BRAND_NAME}
                    </div>

                    <div
                      style="
                        margin-top:2px;
                        font-size:12px;
                        color:#64748b;
                      "
                    >
                      Your AI-powered learning assistant
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>

          <tr>
            <td
              style="
                padding:22px 32px;
                background:#f8fafc;
                border-top:1px solid #e2e8f0;
              "
            >
              <p
                style="
                  margin:0 0 8px;
                  font-size:12px;
                  line-height:18px;
                  color:#64748b;
                "
              >
                This is an automated security email from ${BRAND_NAME}.
              </p>

              <p
                style="
                  margin:0;
                  font-size:12px;
                  line-height:18px;
                  color:#94a3b8;
                "
              >
                Need help? Contact
                <a
                  href="mailto:${SUPPORT_EMAIL}"
                  style="
                    color:${BRAND_COLOR};
                    text-decoration:none;
                  "
                >
                  ${SUPPORT_EMAIL}
                </a>
              </p>

              <p
                style="
                  margin:12px 0 0;
                  font-size:11px;
                  color:#94a3b8;
                "
              >
                © ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function codeBlock(code: string) {
  const safeCode = escapeHtml(code);

  return `
    <div
      style="
        margin:26px 0;
        padding:20px;
        background:#eff6ff;
        border:1px solid #bfdbfe;
        border-radius:12px;
        text-align:center;
      "
    >
      <div
        style="
          margin-bottom:8px;
          font-size:12px;
          font-weight:600;
          color:#64748b;
          text-transform:uppercase;
          letter-spacing:1px;
        "
      >
        Verification code
      </div>

      <div
        style="
          font-size:34px;
          line-height:42px;
          font-weight:700;
          letter-spacing:8px;
          color:#1d4ed8;
        "
      >
        ${safeCode}
      </div>
    </div>
  `;
}

export async function sendVerificationEmail(
  email: string,
  code: string
) {
  const html = emailLayout({
    title: "Verify your StudyMate AI account",
    previewText:
      "Use your verification code to finish creating your StudyMate AI account.",

    content: `
      <h1
        style="
          margin:0 0 14px;
          font-size:26px;
          line-height:34px;
          color:#0f172a;
        "
      >
        Verify your email
      </h1>

      <p
        style="
          margin:0;
          font-size:15px;
          line-height:24px;
          color:#475569;
        "
      >
        Welcome to StudyMate AI. Enter the verification code below
        to confirm your email address and finish creating your account.
      </p>

      ${codeBlock(code)}

      <p
        style="
          margin:0;
          font-size:14px;
          line-height:22px;
          color:#475569;
        "
      >
        This code expires in
        <strong style="color:#0f172a;">10 minutes</strong>.
      </p>

      <p
        style="
          margin:18px 0 0;
          font-size:13px;
          line-height:20px;
          color:#64748b;
        "
      >
        If you didn't create a StudyMate AI account,
        you can safely ignore this email.
      </p>
    `,
  });

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Verify your email | StudyMate AI",
    html,
  });

  if (result.error) {
    console.error(
      "SEND_VERIFICATION_EMAIL_ERROR:",
      result.error
    );

    throw new Error(
      "Failed to send verification email."
    );
  }

  return result.data;
}

export async function sendPasswordResetCodeEmail(
  email: string,
  code: string
) {
  const html = emailLayout({
    title: "Reset your StudyMate AI password",
    previewText:
      "Use this security code to reset your StudyMate AI password.",

    content: `
      <h1
        style="
          margin:0 0 14px;
          font-size:26px;
          line-height:34px;
          color:#0f172a;
        "
      >
        Reset your password
      </h1>

      <p
        style="
          margin:0;
          font-size:15px;
          line-height:24px;
          color:#475569;
        "
      >
        We received a request to reset the password for your
        StudyMate AI account.
      </p>

      <p
        style="
          margin:14px 0 0;
          font-size:15px;
          line-height:24px;
          color:#475569;
        "
      >
        Enter the security code below to continue.
      </p>

      ${codeBlock(code)}

      <p
        style="
          margin:0;
          font-size:14px;
          line-height:22px;
          color:#475569;
        "
      >
        This code expires in
        <strong style="color:#0f172a;">10 minutes</strong>.
      </p>

      <div
        style="
          margin-top:24px;
          padding:14px 16px;
          background:#fff7ed;
          border:1px solid #fed7aa;
          border-radius:10px;
        "
      >
        <p
          style="
            margin:0;
            font-size:13px;
            line-height:20px;
            color:#9a3412;
          "
        >
          <strong>Didn't request this?</strong><br />
          You can safely ignore this email.
          Your password will remain unchanged.
        </p>
      </div>
    `,
  });

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Password reset code | StudyMate AI",
    html,
  });

  if (result.error) {
    console.error(
      "SEND_PASSWORD_RESET_EMAIL_ERROR:",
      result.error
    );

    throw new Error(
      "Failed to send password reset email."
    );
  }

  return result.data;
}


export async function sendAccountDeletedEmail(email: string) {
  const html = emailLayout({
    title: "Your StudyMate AI account has been deleted",
    previewText:
      "Your StudyMate AI account and associated data have been deleted.",

    content: `
      <h1
        style="
          margin:0 0 14px;
          font-size:26px;
          line-height:34px;
          color:#0f172a;
        "
      >
        Account deleted
      </h1>

      <p
        style="
          margin:0;
          font-size:15px;
          line-height:24px;
          color:#475569;
        "
      >
        Your StudyMate AI account associated with
        <strong style="color:#0f172a;">
          ${escapeHtml(email)}
        </strong>
        has been permanently deleted.
      </p>

      <p
        style="
          margin:16px 0 0;
          font-size:15px;
          line-height:24px;
          color:#475569;
        "
      >
        Your account information and saved StudyMate AI data
        have been removed.
      </p>

      <div
        style="
          margin-top:24px;
          padding:16px;
          background:#fff7ed;
          border:1px solid #fed7aa;
          border-radius:10px;
        "
      >
        <p
          style="
            margin:0;
            font-size:13px;
            line-height:20px;
            color:#9a3412;
          "
        >
          <strong>Didn't request this?</strong><br />
          Contact StudyMate AI support as soon as possible.
        </p>
      </div>

      <p
        style="
          margin:22px 0 0;
          font-size:13px;
          line-height:20px;
          color:#64748b;
        "
      >
        Thank you for using StudyMate AI.
      </p>
    `,
  });

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Account deleted | StudyMate AI",
    html,
  });

  if (result.error) {
    console.error(
      "SEND_ACCOUNT_DELETED_EMAIL_ERROR:",
      result.error
    );

    throw new Error(
      "Failed to send account deletion email."
    );
  }

  return result.data;
}