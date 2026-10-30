// Transactional email over SMTP (Mailpit locally). Plain English templates (ADR-0015).
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { CONFIG, type Config } from '../config';

export type MailKind = 'verify' | 'magic' | 'reset' | 'email-change' | 'export-ready' | 'account-deleted';

const COPY: Record<MailKind, { subject: string; intro: string; action: string; outro: string }> = {
  verify: {
    subject: 'Confirm your email',
    intro: 'Confirm your email address to save designs to the cloud.',
    action: 'Confirm email',
    outro: "If you didn't create an account, you can ignore this email.",
  },
  magic: {
    subject: 'Your sign-in link',
    intro: 'Use this link to sign in. It works once and expires in 15 minutes.',
    action: 'Sign in',
    outro: "If you didn't ask to sign in, you can ignore this email.",
  },
  reset: {
    subject: 'Reset your password',
    intro: 'Use this link to choose a new password. It works once and expires in 30 minutes.',
    action: 'Reset password',
    outro: "If you didn't ask for this, your password is unchanged and you can ignore this email.",
  },
  'email-change': {
    subject: 'Confirm your new email',
    intro: 'Confirm this address to make it the email for your account.',
    action: 'Confirm new email',
    outro: "If you didn't ask for this, you can ignore this email.",
  },
  'export-ready': {
    subject: 'Your data export is ready',
    intro: 'Your projects and uploaded files are ready to download. The link works for 7 days.',
    action: 'Download export',
    outro: '',
  },
  'account-deleted': {
    subject: 'Your account is scheduled for deletion',
    intro:
      'Your account was deleted and you were signed out everywhere. Your data will be removed permanently in 30 days.',
    action: '',
    outro: "If this wasn't you, reply to this email straight away.",
  },
};

@Injectable()
export class Mailer {
  private readonly transport: Transporter;
  private readonly log = new Logger('Mailer');

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.transport = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(kind: MailKind, to: string, link?: string): Promise<void> {
    const c = COPY[kind];
    const text = [c.intro, link && c.action ? `${c.action}: ${link}` : '', c.outro].filter(Boolean).join('\n\n');
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const html = [
      `<p>${esc(c.intro)}</p>`,
      link && c.action ? `<p><a href="${esc(link)}">${esc(c.action)}</a></p>` : '',
      c.outro ? `<p style="color:#666">${esc(c.outro)}</p>` : '',
    ].join('');
    try {
      await this.transport.sendMail({ from: this.config.MAIL_FROM, to, subject: c.subject, text, html });
    } catch (e) {
      this.log.error(`send ${kind} failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
