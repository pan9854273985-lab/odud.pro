// Shared lead-capture function — forwards form submissions to ONE Telegram bot.
// Reusable across all sites: drop this file into /api of any project and set
// the same two env vars (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
// The message auto-labels which site + page the lead came from, plus contacts.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // honeypot — bots fill hidden fields, humans don't
  if (b.website) return res.status(200).json({ ok: true });

  const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n).trim();
  const name = clip(b.name, 200);
  const email = clip(b.email, 200);
  const phone = clip(b.phone, 60);
  const telegram = clip(b.telegram, 100);
  const company = clip(b.company, 200);
  const count = clip(b.count, 100);
  const comment = clip(b.comment, 1500);
  // site + page: prefer explicit body values, fall back to request headers
  const source = clip(b.source, 120) || clip(req.headers['host'], 120) || 'сайт';
  const page = clip(b.page, 300) || clip(req.headers['referer'], 300) || '';

  // need a name and at least one way to get back to them
  if (!name || (!email && !phone && !telegram)) {
    return res.status(400).json({ ok: false, error: 'missing_contact' });
  }

  const lines = [];
  lines.push('🟣 Новая заявка');
  lines.push('🌐 Сайт: ' + source);
  if (page) lines.push('📄 Страница: ' + page);
  lines.push('');
  lines.push('👤 Имя: ' + name);
  if (email) lines.push('✉️ Email: ' + email);
  if (phone) lines.push('📞 Телефон: ' + phone);
  if (telegram) lines.push('💬 Telegram: ' + telegram);
  if (company) lines.push('🏢 Компания: ' + company);
  if (count) lines.push('👥 Сотрудников: ' + count);
  if (comment) lines.push('📝 Комментарий: ' + comment);

  try {
    const tg = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
    });
    if (!tg.ok) {
      return res.status(502).json({ ok: false, error: 'telegram_failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'telegram_error' });
  }
}
