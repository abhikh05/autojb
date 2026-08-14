const nodemailer = require('nodemailer');
const dns = require('dns').promises;

async function validateEmailDomain(email) {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;
    const records = await dns.resolveMx(domain);
    return records && records.length > 0;
  } catch {
    return false;
  }
}

function createTransport(cfg = {}) {
  const provider = cfg.provider || 'gmail';
  const user = (cfg.gmailUser || process.env.GMAIL_USER || '').trim();
  // Strip ALL whitespace — Google shows app passwords as "xxxx xxxx xxxx xxxx" with spaces
  const pass = (cfg.gmailPass || process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

  if (!user || !pass) {
    throw new Error('Email not configured — set your email and password in Settings');
  }

  if (provider === 'outlook') {
    return nodemailer.createTransport({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false }
    });
  }

  if (provider === 'yahoo') {
    return nodemailer.createTransport({
      host: 'smtp.mail.yahoo.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }

  if (provider === 'custom') {
    if (!cfg.smtpHost) throw new Error('Custom SMTP host not set in Settings');
    return nodemailer.createTransport({
      host: cfg.smtpHost,
      port: parseInt(cfg.smtpPort || '587'),
      secure: cfg.smtpPort === '465',
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }

  // Gmail — use nodemailer's built-in gmail service config
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

async function sendEmail({ to, subject, body, attachments = [], overrides = {} }) {
  const domainOk = await validateEmailDomain(to);
  if (!domainOk) throw new Error(`Domain for ${to} has no mail server — skipping to avoid bounce`);
  const transporter = createTransport(overrides);
  const from = (overrides.gmailUser || process.env.GMAIL_USER || '').trim();
  await transporter.sendMail({
    from,
    to,
    subject,
    text: body,
    html: body.replace(/\n/g, '<br>'),
    attachments
  });
  console.log(`[Email] Sent to ${to}: "${subject}"`);
}

async function testConnection(cfg = {}) {
  try {
    const user = (cfg.gmailUser || process.env.GMAIL_USER || '').trim();
    const rawPass = cfg.gmailPass || process.env.GMAIL_APP_PASSWORD || '';
    const pass = rawPass.replace(/\s/g, '');
    console.log(`[Mailer] Testing: user="${user}" passLength=${pass.length} provider=${cfg.provider || 'gmail'}`);
    const t = createTransport(cfg);
    await t.verify();
    return { ok: true };
  } catch (e) {
    console.log(`[Mailer] Test failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail, testConnection, validateEmailDomain };
