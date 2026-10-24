import { Resend } from "resend";
import type { BackendConfig } from "../config.js";

type AuthEmail = {
  to: string;
  name: string;
  url: string;
};

export function createAuthEmails(config: BackendConfig) {
  const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;
  const from = config.AUTH_EMAIL_FROM;

  async function deliver(
    subject: string,
    { to, name, url }: AuthEmail,
    heading: string,
    body: string,
    action: string,
  ) {
    if (!resend || !from) {
      console.info(`[auth] ${subject} for ${to}: ${url}`);
      return;
    }
    const response = await resend.emails.send({
      from,
      to,
      replyTo: config.AUTH_EMAIL_REPLY_TO,
      subject,
      text: `${heading}\n\n${body}\n\n${action}: ${url}\n\nThis link expires in one hour. If you did not request this email, ignore it.`,
      html: emailHtml(name, heading, body, action, url),
    });
    if (response.error) {
      throw new Error(`Resend rejected ${subject}: ${response.error.message}`);
    }
  }

  return {
    sendVerificationEmail: async ({ user, url }: { user: AuthUser; url: string }) =>
      deliver(
        "Verify your RepoRound email",
        { to: user.email, name: user.name, url },
        "Verify your email",
        "Confirm your email address to start practicing interviews with RepoRound.",
        "Verify email",
      ),
    sendResetPassword: async ({ user, url }: { user: AuthUser; url: string }) =>
      deliver(
        "Reset your RepoRound password",
        { to: user.email, name: user.name, url },
        "Reset your password",
        "Use the link below to choose a new password. Your other sessions will be revoked.",
        "Reset password",
      ),
  };
}

type AuthUser = {
  email: string;
  name: string;
};

function emailHtml(
  name: string,
  heading: string,
  body: string,
  action: string,
  url: string,
): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f2;color:#171714;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #deded8;border-radius:12px">
      <p style="margin:0 0 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase">RepoRound</p>
      <h1 style="margin:0 0 16px;font-size:26px">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 12px;line-height:1.6">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 24px;line-height:1.6">${escapeHtml(body)}</p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#171714;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(action)}</a>
      </p>
      <p style="margin:0;color:#66665f;font-size:13px;line-height:1.6">This link expires in one hour. If you did not request this email, ignore it.</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
