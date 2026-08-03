// Shared lead-capture function — forwards form submissions to a Telegram bot
// AND logs them into a Notion database (pipeline + Mila's commission).
// Reusable across all sites: drop this file into /api of any project.
// Env vars (set per Vercel project):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — bot notification
//   NOTION_TOKEN                          — Notion internal integration secret (ntn_…)
// The Notion database id is not secret, so it's hardcoded below.
const NOTION_DB_ID = '9f4e8ca03a014a839d2591cb8099290e';
const NOTION_SOURCES = ['cc-code.marketing', 'odud.marketing', 'odud.pro', 'odud.online'];

export default async function handler(req, res) {
  // CORS — allow all our sites to POST to this single endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n).trim();
  const name = clip(b.name, 200);
  const email = clip(b.email, 200);
  const phone = clip(b.phone, 60);
  const telegram = clip(b.telegram, 100);
  const company = clip(b.company, 200);
  const count = clip(b.count, 100);
  const comment = clip(b.comment, 1500);
  const source = clip(b.source, 120) || clip(req.headers['host'], 120) || 'сайт';
  const page = clip(b.page, 300) || clip(req.headers['referer'], 300) || '';

  // ── anti-spam (respond 200 so bots get no signal, but don't notify) ──
  if (b.website) return res.status(200).json({ ok: true });
  const elapsed = Number(b.elapsedMs || 0);
  if (elapsed > 0 && elapsed < 2500) return res.status(200).json({ ok: true });
  if (/(https?:\/\/|\[url|<a\s|\bwww\.)/i.test(name + ' ' + company + ' ' + comment)) {
    return res.status(200).json({ ok: true });
  }

  if (!name || (!email && !phone && !telegram)) {
    return res.status(400).json({ ok: false, error: 'missing_contact' });
  }

  // normalized site name for Notion "Источник"
  const srcNorm = source.replace(/^www\./i, '').toLowerCase();
  const notionSource = NOTION_SOURCES.find((s) => srcNorm.includes(s)) || 'другое';

  // ── 1) Telegram notification ──
  let tgOk = false;
  if (token && chatId) {
    const lines = [];
    lines.push('🟣 Новая заявка');
    lines.push('🌐 Сайт: ' + source);
    if (page) lines.push('📄 Страница: ' + page);
    lines.push('');
    lines.push('👤 Имя: ' + name);
    if (telegram) lines.push('💬 Telegram: ' + telegram);
    if (phone) lines.push('📞 Телефон: ' + phone);
    if (email) lines.push('✉️ Email: ' + email);
    if (company) lines.push('🏢 Компания: ' + company);
    if (count) lines.push('👥 Сотрудников: ' + count);
    if (comment) lines.push('📝 Комментарий: ' + comment);
    try {
      const tg = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
      });
      tgOk = tg.ok;
    } catch (e) { /* best-effort */ }
  }

  // ── 2) Notion row (best-effort) ──
  let notionOk = false;
  const notionToken = process.env.NOTION_TOKEN;
  if (notionToken) {
    const rt = (v) => ({ rich_text: v ? [{ text: { content: v.slice(0, 1900) } }] : [] });
    const props = {
      'Заявка': { title: [{ text: { content: (company || name || 'Заявка').slice(0, 200) } }] },
      'Статус': { select: { name: 'Новая' } },
      'Компания': rt(company),
      'Контакт': rt([email, telegram, phone].filter(Boolean).join(' · ')),
      'Сотрудников': rt(count),
      'Комментарий': rt(comment),
      'Источник': { select: { name: notionSource } },
    };
    if (/^https?:\/\//i.test(page)) props['Страница'] = { url: page };
    try {
      const nr = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + notionToken,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: NOTION_DB_ID }, properties: props }),
      });
      notionOk = nr.ok;
    } catch (e) { /* best-effort */ }
  }

  // ── 3) Acknowledgment email to the lead via Resend (best-effort) ──
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && email && /.+@.+\..+/.test(email)) {
    const isMarketing = ['cc-code.marketing', 'odud.marketing'].some((s) => srcNorm.includes(s));
    const courseName = isMarketing ? 'Claude Code и Codex для маркетологов' : 'Claude Code для продактов';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6">' +
      '<p>Здравствуйте!</p>' +
      '<p>Спасибо за интерес к нашему курсу «' + courseName + '». Получили ваш запрос с сайта на оплату через юрлицо.</p>' +
      '<p>Добавляю в копию моего партнёра — Милу, она выставит счёт на юрлицо. Пришлите, пожалуйста, ответным письмом ИНН организации.</p>' +
      '<p>После оплаты вышлем на email закрывающие документы (чек и акт при необходимости) и доступ к курсу.</p>' +
      '<p style="color:#888;margin-top:20px">С уважением,<br>Евгения Одуд</p>' +
      '</div>';
    const cc = (process.env.LEAD_CC || '').split(',').map((s) => s.trim()).filter(Boolean);
    const mail = {
      from: 'Евгения Одуд <hello@odud.pro>',
      to: [email],
      reply_to: 'hello@odud.pro',
      subject: 'Заявка получена — оформим счёт на юрлицо',
      html,
    };
    if (cc.length) mail.cc = cc;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(mail),
      });
    } catch (e) { /* best-effort */ }
  }

  if (!tgOk && !notionOk) {
    return res.status(502).json({ ok: false, error: 'delivery_failed' });
  }
  return res.status(200).json({ ok: true });
}
