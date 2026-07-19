// ╔══════════════════════════════════════════════════════════╗
// ║   ربات فروشگاهی تلگرام پریمیوم و استارز                ║
// ║   Cloudflare Worker - نسخه نهایی                        ║
// ╚══════════════════════════════════════════════════════════╝

// ============================================================
// ⚙️  تنظیمات - فقط همین بخش رو تغییر بده
// ============================================================

const BOT_TOKEN = "اینجا_توکن_ربات_رو_بذار";
// مثال: "7123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
// از @BotFather بگیر

const ADMIN_IDS = [123456789];
// مثال: [123456789] یا چند ادمین: [123456789, 987654321]
// آیدی عددی خودت رو از @userinfobot بگیر

// ============================================================
// ⚠️  بعد از deploy - یه‌بار این لینک رو در مرورگر باز کن:
// https://api.telegram.org/bot{توکن}/setWebhook?url={آدرس_worker}
// آدرس worker بعد از deploy نشون داده میشه
// ============================================================

// ============================================================
// STATE ها
// ============================================================
const S = {
  IDLE: 'idle',
  PREMIUM_USER: 'premium_user',
  STARS_USER: 'stars_user',
  STARS_CUSTOM: 'stars_custom',
  RECEIPT: 'receipt',
  SET_PRICE: 'set_price',
  BROADCAST: 'broadcast',
  REPLY_USER: 'reply_user',
  SET_PAYMENT: 'set_payment',
  SET_CHANNEL: 'set_channel',
  SET_SUPPORT: 'set_support',
  SET_RULES: 'set_rules',
  ORDER_NOTE: 'order_note',
  SETUP_GROUP: 'setup_group',
};

// ============================================================
// TELEGRAM API
// ============================================================
async function tg(method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.ok) console.error(`[TG:${method}]`, d.description);
    return d;
  } catch (e) {
    console.error(`[TG:${method}] fetch error:`, e.message);
    return { ok: false };
  }
}

const send  = (cid, text, extra = {}) => tg('sendMessage',    { chat_id: cid, text, parse_mode: 'Markdown', ...extra });
const edit  = (cid, mid, text, extra = {}) => tg('editMessageText', { chat_id: cid, message_id: mid, text, parse_mode: 'Markdown', ...extra });
const answer = (id, text = '', alert = false) => tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
const sendPhoto = (cid, photo, cap, extra = {}) => tg('sendPhoto', { chat_id: cid, photo, caption: cap, parse_mode: 'Markdown', ...extra });
const copyMsg = (to, from, mid, extra = {}) => tg('copyMessage', { chat_id: to, from_chat_id: from, message_id: mid, ...extra });
const sendTopic = (gid, tid, text, extra = {}) => (gid && tid) ? tg('sendMessage', { chat_id: gid, message_thread_id: tid, text, parse_mode: 'Markdown', ...extra }) : null;
const makeTopic = (cid, name, color) => tg('createForumTopic', { chat_id: cid, name, icon_color: color });
const notifyAdmins = (text, extra = {}) => Promise.all(ADMIN_IDS.map(id => send(id, text, extra).catch(() => null)));

// ============================================================
// KV DATABASE
// ============================================================

// --- کاربر ---
async function getUser(uid, KV) {
  const d = await KV.get(`u:${uid}`, 'json');
  return d || { id: uid, state: S.IDLE, sd: {}, fn: '', un: '', orders: 0 };
}
async function saveUser(u, KV) {
  await KV.put(`u:${u.id}`, JSON.stringify(u), { expirationTtl: 86400 * 365 });
}
async function getState(uid, KV) {
  const u = await getUser(uid, KV);
  return { state: u.state || S.IDLE, sd: u.sd || {} };
}
async function setState(uid, state, sd, KV) {
  const u = await getUser(uid, KV);
  u.state = state; u.sd = sd || {};
  await saveUser(u, KV);
}

// --- سفارش ---
async function newOrder(data, KV) {
  const id = `ORD${Date.now()}${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const o = { id, ...data, status: 'pending', at: Date.now(), note: '' };
  await KV.put(`o:${id}`, JSON.stringify(o), { expirationTtl: 86400 * 90 });
  // لیست سفارش‌های کاربر
  const ul = await KV.get(`ul:${data.uid}`, 'json') || [];
  ul.unshift(id);
  await KV.put(`ul:${data.uid}`, JSON.stringify(ul.slice(0, 50)));
  // لیست کل
  const al = await KV.get('oa', 'json') || [];
  al.unshift(id);
  await KV.put('oa', JSON.stringify(al.slice(0, 500)));
  return o;
}
async function getOrder(id, KV) { return await KV.get(`o:${id}`, 'json'); }
async function updOrder(id, upd, KV) {
  const o = await getOrder(id, KV);
  if (!o) return null;
  const n = { ...o, ...upd, upAt: Date.now() };
  await KV.put(`o:${id}`, JSON.stringify(n), { expirationTtl: 86400 * 90 });
  return n;
}
async function getUserOrders(uid, KV, lim = 8) {
  const ids = await KV.get(`ul:${uid}`, 'json') || [];
  return (await Promise.all(ids.slice(0, lim).map(i => getOrder(i, KV)))).filter(Boolean);
}
async function getOrdersByStatus(st, KV, lim = 20) {
  const ids = await KV.get('oa', 'json') || [];
  const all = await Promise.all(ids.slice(0, 150).map(i => getOrder(i, KV)));
  return all.filter(o => o && o.status === st).slice(0, lim);
}
async function getRecentOrders(KV, lim = 15) {
  const ids = await KV.get('oa', 'json') || [];
  return (await Promise.all(ids.slice(0, lim).map(i => getOrder(i, KV)))).filter(Boolean);
}
async function getStats(KV) {
  const ids = await KV.get('oa', 'json') || [];
  const all = await Promise.all(ids.slice(0, 300).map(i => getOrder(i, KV)));
  const v = all.filter(Boolean);
  const s = { total: v.length, pending: 0, paid: 0, processing: 0, done: 0, cancelled: 0, rev: 0, prem: 0, stars: 0 };
  for (const o of v) {
    s[o.status] = (s[o.status] || 0) + 1;
    if (o.status === 'done') { s.rev += o.price || 0; o.type === 'premium' ? s.prem++ : s.stars++; }
  }
  return s;
}
async function getAllUids(KV) {
  const l = await KV.list({ prefix: 'u:' });
  return l.keys.map(k => k.name.slice(2));
}

// --- تنظیمات ---
async function getSettings(KV) {
  const s = await KV.get('cfg', 'json');
  return s || { pay: '', ch: '', sup: '', gid: '', topics: {}, on: true, rules: '' };
}
async function saveSettings(s, KV) { await KV.put('cfg', JSON.stringify(s)); }

// --- قیمت‌ها ---
async function getPrices(KV) {
  const p = await KV.get('prices', 'json');
  return p || {
    p: { '1m': { price: 0, label: '۱ ماهه' }, '3m': { price: 0, label: '۳ ماهه' }, '6m': { price: 0, label: '۶ ماهه' }, '12m': { price: 0, label: '۱ ساله' } },
    s: { '50': 0, '100': 0, '250': 0, '500': 0, '1000': 0 }
  };
}
async function savePrices(p, KV) { await KV.put('prices', JSON.stringify(p)); }

// ============================================================
// HELPERS
// ============================================================
const isAdmin = uid => ADMIN_IDS.includes(Number(uid));
const fmt = p => p ? Number(p).toLocaleString('fa-IR') : '---';
const stLbl = s => ({ pending: '⏳ در انتظار پرداخت', paid: '💰 پرداخت شده', processing: '⚙️ در پردازش', done: '✅ تحویل شده', cancelled: '❌ لغو شده' }[s] || s);
const stEm  = s => ({ pending: '⏳', paid: '💰', processing: '⚙️', done: '✅', cancelled: '❌' }[s] || '❓');
const uLbl  = u => `${u.fn || ''}${u.un ? ` (@${u.un})` : ''} [${u.id}]`;

function orderTxt(o, u) {
  const t = o.type === 'premium' ? `پریمیوم 💎 ${o.pkgLabel || ''}` : `استارز ⭐ ${o.amt} عدد`;
  return `🆔 \`${o.id}\`\n👤 ${uLbl(u)}\n📦 ${t}\n🎯 مقصد: \`${o.target}\`\n💰 ${fmt(o.price)} تومان\n📊 ${stLbl(o.status)}\n📅 ${new Date(o.at).toLocaleString('fa-IR')}${o.note ? `\n📝 ${o.note}` : ''}`;
}

function confirmTxt(o, cfg) {
  const t = o.type === 'premium' ? `پریمیوم ${o.pkgLabel || ''} 💎` : `${o.amt} استارز ⭐`;
  return `✅ *سفارش ثبت شد*\n\n🆔 \`${o.id}\`\n📦 ${t}\n🎯 مقصد: \`${o.target}\`\n💰 *${fmt(o.price)} تومان*\n\n━━━━━━━━━━━━━━━\n💳 *اطلاعات پرداخت:*\n${cfg.pay || '⚠️ هنوز تنظیم نشده - با پشتیبانی تماس بگیرید'}\n━━━━━━━━━━━━━━━\n\n📤 پس از پرداخت، رسید را ارسال کنید.`;
}

// ============================================================
// KEYBOARDS
// ============================================================
const mainKb = () => ({ inline_keyboard: [
  [{ text: '💎 خرید تلگرام پریمیوم', callback_data: 'pm' }],
  [{ text: '⭐ خرید تلگرام استارز', callback_data: 'st' }],
  [{ text: '📦 سفارش‌های من', callback_data: 'myord' }, { text: '💬 پشتیبانی', callback_data: 'sup' }],
  [{ text: '📋 قوانین', callback_data: 'rules' }, { text: '📣 کانال ما', callback_data: 'ch' }],
]});

const premKb = (prices) => ({ inline_keyboard: [
  [{ text: `🥉 ۱ ماهه — ${fmt(prices.p['1m']?.price)} تومان`, callback_data: 'bp_1m' }],
  [{ text: `🥈 ۳ ماهه — ${fmt(prices.p['3m']?.price)} تومان`, callback_data: 'bp_3m' }],
  [{ text: `🥇 ۶ ماهه — ${fmt(prices.p['6m']?.price)} تومان`, callback_data: 'bp_6m' }],
  [{ text: `👑 ۱ ساله — ${fmt(prices.p['12m']?.price)} تومان`, callback_data: 'bp_12m' }],
  [{ text: '🔙 بازگشت', callback_data: 'home' }],
]});

const starsKb = (prices) => ({ inline_keyboard: [
  [{ text: `⭐ ۵۰ — ${fmt(prices.s['50'])} تومان`, callback_data: 'bs_50' },   { text: `🌟 ۱۰۰ — ${fmt(prices.s['100'])} تومان`, callback_data: 'bs_100' }],
  [{ text: `✨ ۲۵۰ — ${fmt(prices.s['250'])} تومان`, callback_data: 'bs_250' }, { text: `💫 ۵۰۰ — ${fmt(prices.s['500'])} تومان`, callback_data: 'bs_500' }],
  [{ text: `🌠 ۱۰۰۰ — ${fmt(prices.s['1000'])} تومان`, callback_data: 'bs_1000' }],
  [{ text: '🔢 مقدار دلخواه', callback_data: 'bs_custom' }],
  [{ text: '🔙 بازگشت', callback_data: 'home' }],
]});

const myOrdKb = (orders) => ({ inline_keyboard: [
  ...orders.map(o => [{ text: `${stEm(o.status)} ${o.id} — ${o.type === 'premium' ? 'پریمیوم 💎' : 'استارز ⭐'}`, callback_data: `od_${o.id}` }]),
  [{ text: '🔙 بازگشت', callback_data: 'home' }],
]});

const ordDetKb = (o, adm) => {
  const r = [];
  if (o.status === 'pending') r.push([{ text: '📤 ارسال رسید', callback_data: `rc_${o.id}` }, { text: '❌ لغو', callback_data: `cx_${o.id}` }]);
  if (adm) {
    r.push([{ text: '✅ تایید پرداخت', callback_data: `acp_${o.id}` }, { text: '⚙️ تغییر وضعیت', callback_data: `acs_${o.id}` }]);
    r.push([{ text: '📝 یادداشت', callback_data: `anote_${o.id}` }, { text: '❌ لغو سفارش', callback_data: `acx_${o.id}` }]);
    r.push([{ text: '💬 پیام به کاربر', callback_data: `amsg_${o.id}` }]);
  }
  r.push([{ text: '🔙 بازگشت', callback_data: 'myord' }]);
  return { inline_keyboard: r };
};

const stChgKb = (oid) => ({ inline_keyboard: [
  [{ text: '⏳ انتظار', callback_data: `ss_${oid}_pending` },    { text: '💰 پرداخت شده', callback_data: `ss_${oid}_paid` }],
  [{ text: '⚙️ در پردازش', callback_data: `ss_${oid}_processing` }, { text: '✅ تحویل شد', callback_data: `ss_${oid}_done` }],
  [{ text: '❌ لغو شده', callback_data: `ss_${oid}_cancelled` }],
  [{ text: '🔙 بازگشت', callback_data: `od_${oid}` }],
]});

const adminKb = () => ({ inline_keyboard: [
  [{ text: '📊 آمار کلی', callback_data: 'adst' },       { text: '📦 مدیریت سفارش‌ها', callback_data: 'adord' }],
  [{ text: '💰 قیمت‌گذاری', callback_data: 'adpr' },     { text: '⚙️ تنظیمات', callback_data: 'adcfg' }],
  [{ text: '👥 کاربران', callback_data: 'adusr' },        { text: '📣 ارسال همگانی', callback_data: 'adbc' }],
  [{ text: '🏠 منوی اصلی', callback_data: 'home' }],
]});

const adOrdKb = () => ({ inline_keyboard: [
  [{ text: '⏳ در انتظار', callback_data: 'aos_pending' },    { text: '💰 پرداخت‌شده', callback_data: 'aos_paid' }],
  [{ text: '⚙️ در پردازش', callback_data: 'aos_processing' }, { text: '✅ تحویل‌شده', callback_data: 'aos_done' }],
  [{ text: '❌ لغوشده', callback_data: 'aos_cancelled' },     { text: '🔄 آخرین‌ها', callback_data: 'aore' }],
  [{ text: '🔙 بازگشت', callback_data: 'adpanel' }],
]});

const adPrKb = () => ({ inline_keyboard: [
  [{ text: '💎 قیمت پریمیوم', callback_data: 'adppr' }, { text: '⭐ قیمت استارز', callback_data: 'adpst' }],
  [{ text: '🔙 بازگشت', callback_data: 'adpanel' }],
]});

const adPPrKb = () => ({ inline_keyboard: [
  [{ text: '🥉 قیمت ۱ ماهه', callback_data: 'sp_p_1m' }],
  [{ text: '🥈 قیمت ۳ ماهه', callback_data: 'sp_p_3m' }],
  [{ text: '🥇 قیمت ۶ ماهه', callback_data: 'sp_p_6m' }],
  [{ text: '👑 قیمت ۱ ساله', callback_data: 'sp_p_12m' }],
  [{ text: '🔙 بازگشت', callback_data: 'adpr' }],
]});

const adSPrKb = () => ({ inline_keyboard: [
  [{ text: '⭐ ۵۰', callback_data: 'sp_s_50' },   { text: '🌟 ۱۰۰', callback_data: 'sp_s_100' }],
  [{ text: '✨ ۲۵۰', callback_data: 'sp_s_250' }, { text: '💫 ۵۰۰', callback_data: 'sp_s_500' }],
  [{ text: '🌠 ۱۰۰۰', callback_data: 'sp_s_1000' }],
  [{ text: '🔙 بازگشت', callback_data: 'adpr' }],
]});

const adCfgKb = () => ({ inline_keyboard: [
  [{ text: '💳 اطلاعات پرداخت', callback_data: 'cfg_pay' }, { text: '📣 کانال', callback_data: 'cfg_ch' }],
  [{ text: '💬 پشتیبانی', callback_data: 'cfg_sup' },       { text: '📝 قوانین', callback_data: 'cfg_rules' }],
  [{ text: '🗂 راه‌اندازی گروه لاگ', callback_data: 'cfg_grp' }],
  [{ text: '🔛 وضعیت ربات', callback_data: 'cfg_tog' }],
  [{ text: '🔙 بازگشت', callback_data: 'adpanel' }],
]});

const rcptKb = (oid) => ({ inline_keyboard: [
  [{ text: '✅ تایید پرداخت', callback_data: `acp_${oid}` }, { text: '❌ رد پرداخت', callback_data: `arj_${oid}` }],
  [{ text: '📋 جزئیات سفارش', callback_data: `od_${oid}` }],
]});

const grpKb = (cfg) => {
  const t = cfg.topics || {};
  const items = [
    ['new_orders', '📦 سفارش‌های جدید'], ['paid_orders', '💰 پرداخت‌شده‌ها'],
    ['done_orders', '✅ تحویل‌شده‌ها'],   ['cancelled', '❌ لغوشده‌ها'],
    ['reports', '📊 گزارش‌ها'],           ['support', '💬 پشتیبانی'],
  ];
  return { inline_keyboard: [
    ...items.map(([k, n]) => [{ text: `${t[k] ? '✅' : '➕'} ${n}`, callback_data: `gt_${k}` }]),
    [{ text: '🔙 بازگشت', callback_data: 'adcfg' }],
  ]};
};

// ============================================================
// LOG به گروه
// ============================================================
async function logNew(o, u, KV) {
  const cfg = await getSettings(KV);
  if (!cfg.gid || !cfg.topics?.new_orders) return;
  const t = o.type === 'premium' ? `پریمیوم 💎 ${o.pkgLabel || ''}` : `استارز ⭐ ${o.amt} عدد`;
  await sendTopic(cfg.gid, cfg.topics.new_orders, `🆕 *سفارش جدید*\n\n🆔 \`${o.id}\`\n👤 ${uLbl(u)}\n📦 ${t}\n🎯 \`${o.target}\`\n💰 ${fmt(o.price)} تومان`);
}

async function logStatus(o, u, st, KV) {
  const cfg = await getSettings(KV);
  if (!cfg.gid) return;
  const mp = { paid: 'paid_orders', done: 'done_orders', cancelled: 'cancelled', processing: 'paid_orders' };
  const tk = mp[st];
  if (!tk || !cfg.topics?.[tk]) return;
  const lb = { paid: '💰 پرداخت تایید شد', processing: '⚙️ در پردازش', done: '✅ تحویل شد', cancelled: '❌ لغو شد' };
  await sendTopic(cfg.gid, cfg.topics[tk], `${lb[st] || st}\n\n🆔 \`${o.id}\`\n👤 ${uLbl(u)}\n💰 ${fmt(o.price)} تومان`);
}

async function logReceipt(o, u, fromCid, mid, KV) {
  const cfg = await getSettings(KV);
  if (!cfg.gid || !cfg.topics?.paid_orders) return;
  await tg('forwardMessage', { chat_id: cfg.gid, from_chat_id: fromCid, message_id: mid, message_thread_id: cfg.topics.paid_orders });
  await sendTopic(cfg.gid, cfg.topics.paid_orders, `📤 *رسید دریافت شد*\n\n🆔 \`${o.id}\`\n👤 ${uLbl(u)}\n💰 ${fmt(o.price)} تومان`);
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
async function onMessage(msg, KV) {
  const cid = msg.chat.id;
  const uid = msg.from.id;
  const txt = msg.text || '';
  const adm = isAdmin(uid);
  const cfg = await getSettings(KV);

  if (!cfg.on && !adm) { await send(cid, '⚠️ ربات موقتاً در دسترس نیست.'); return; }

  // ذخیره اطلاعات کاربر
  const u = await getUser(uid, KV);
  u.fn = msg.from.first_name || ''; u.un = msg.from.username || ''; u.id = uid;
  await saveUser(u, KV);

  // دستورات
  if (txt === '/start') {
    await setState(uid, S.IDLE, {}, KV);
    await send(cid, `🌟 *به فروشگاه رسمی تلگرام پریمیوم و استارز خوش آمدید!*\n\n✨ ارائه‌دهنده:\n• تلگرام پریمیوم اصلی 💎\n• تلگرام استارز رسمی ⭐\n\n⚡️ ارسال فوری | قیمت مناسب | پشتیبانی ۲۴ ساعته`, { reply_markup: mainKb() });
    if (adm) await send(cid, '👑 پنل ادمین: /admin');
    return;
  }

  if (txt === '/admin' && adm) {
    const st = await getStats(KV);
    await send(cid, `👑 *پنل مدیریت*\n\n📦 ${st.total} سفارش | ✅ ${st.done} تحویل | ⏳ ${st.pending} انتظار`, { reply_markup: adminKb() });
    return;
  }

  const { state, sd } = await getState(uid, KV);

  // ---- STATE: یوزرنیم پریمیوم ----
  if (state === S.PREMIUM_USER) {
    if (!txt || txt.length < 2) { await send(cid, '⚠️ یوزرنیم یا آیدی عددی معتبر وارد کنید:'); return; }
    const target = txt.replace('@', '').trim();
    const prices = await getPrices(KV);
    const pkg = sd.pkg;
    const price = prices.p[pkg]?.price;
    if (!price) { await send(cid, '⚠️ قیمت این بسته تنظیم نشده. با پشتیبانی تماس بگیرید.', { reply_markup: mainKb() }); return; }
    await setState(uid, S.IDLE, {}, KV);
    const o = await newOrder({ uid, type: 'premium', pkg, pkgLabel: prices.p[pkg]?.label || pkg, target, price }, KV);
    await send(cid, confirmTxt(o, cfg), { reply_markup: { inline_keyboard: [
      [{ text: '📤 ارسال رسید پرداخت', callback_data: `rc_${o.id}` }],
      [{ text: '❌ لغو سفارش', callback_data: `cx_${o.id}` }],
    ]}});
    await logNew(o, u, KV);
    await notifyAdmins(`🆕 *سفارش جدید*\n\n${orderTxt(o, u)}`, { reply_markup: { inline_keyboard: [[{ text: '📋 مشاهده', callback_data: `od_${o.id}` }]] } });
    return;
  }

  // ---- STATE: یوزرنیم استارز ----
  if (state === S.STARS_USER) {
    if (!txt || txt.length < 2) { await send(cid, '⚠️ یوزرنیم یا آیدی عددی معتبر وارد کنید:'); return; }
    const target = txt.replace('@', '').trim();
    const prices = await getPrices(KV);
    const amt = sd.amt;
    const price = prices.s[String(amt)];
    if (!price) { await send(cid, '⚠️ قیمت این مقدار تنظیم نشده. با پشتیبانی تماس بگیرید.', { reply_markup: mainKb() }); return; }
    await setState(uid, S.IDLE, {}, KV);
    const o = await newOrder({ uid, type: 'stars', amt, target, price }, KV);
    await send(cid, confirmTxt(o, cfg), { reply_markup: { inline_keyboard: [
      [{ text: '📤 ارسال رسید پرداخت', callback_data: `rc_${o.id}` }],
      [{ text: '❌ لغو سفارش', callback_data: `cx_${o.id}` }],
    ]}});
    await logNew(o, u, KV);
    await notifyAdmins(`🆕 *سفارش جدید*\n\n${orderTxt(o, u)}`, { reply_markup: { inline_keyboard: [[{ text: '📋 مشاهده', callback_data: `od_${o.id}` }]] } });
    return;
  }

  // ---- STATE: مقدار دلخواه استارز ----
  if (state === S.STARS_CUSTOM) {
    const amt = parseInt(txt);
    if (isNaN(amt) || amt < 1 || amt > 100000) { await send(cid, '⚠️ عدد بین ۱ تا ۱۰۰٬۰۰۰ وارد کنید:'); return; }
    await setState(uid, S.STARS_USER, { amt }, KV);
    await send(cid, `✅ ${amt} استارز انتخاب شد.\n\nیوزرنیم یا آیدی مقصد را وارد کنید:`);
    return;
  }

  // ---- STATE: رسید پرداخت ----
  if (state === S.RECEIPT) {
    const oid = sd.oid;
    if (!oid) { await setState(uid, S.IDLE, {}, KV); await send(cid, '⚠️ خطا. دوباره تلاش کنید.', { reply_markup: mainKb() }); return; }
    const o = await getOrder(oid, KV);
    if (!o || o.status === 'cancelled') { await setState(uid, S.IDLE, {}, KV); await send(cid, '❌ سفارش لغو یا نامعتبر است.', { reply_markup: mainKb() }); return; }
    const photo = msg.photo?.[msg.photo.length - 1];
    const fid = photo?.file_id || msg.document?.file_id;
    if (!fid && !msg.text) { await send(cid, '⚠️ تصویر یا فایل رسید را ارسال کنید:'); return; }
    await updOrder(oid, { receiptFid: fid || null, status: 'paid' }, KV);
    await setState(uid, S.IDLE, {}, KV);
    await send(cid, `✅ *رسید دریافت شد!*\n\n🆔 \`${oid}\`\n⏳ در حال بررسی...`, { reply_markup: { inline_keyboard: [[{ text: '🏠 منو اصلی', callback_data: 'home' }, { text: '📦 سفارش‌هام', callback_data: 'myord' }]] } });
    const adTxt = `💰 *رسید پرداخت*\n\n🆔 \`${oid}\`\n👤 ${uLbl(u)}\n💵 ${fmt(o.price)} تومان`;
    for (const aid of ADMIN_IDS) {
      if (fid && photo) await sendPhoto(aid, fid, adTxt, { reply_markup: rcptKb(oid) }).catch(() => null);
      else await send(aid, adTxt, { reply_markup: rcptKb(oid) }).catch(() => null);
    }
    await logReceipt(o, u, cid, msg.message_id, KV);
    return;
  }

  // ---- ADMIN STATES ----
  if (!adm) { await send(cid, '🏠', { reply_markup: mainKb() }); return; }

  if (state === S.SET_PRICE) {
    const price = parseInt(txt.replace(/[,،٬\s]/g, ''));
    if (isNaN(price) || price < 0) { await send(cid, '⚠️ عدد معتبر وارد کنید (مثلاً 150000):'); return; }
    const prices = await getPrices(KV);
    const { tp, key } = sd;
    if (tp === 'p') { if (!prices.p[key]) prices.p[key] = {}; prices.p[key].price = price; }
    else { prices.s[key] = price; }
    await savePrices(prices, KV);
    await setState(uid, S.IDLE, {}, KV);
    await send(cid, `✅ قیمت تنظیم شد: ${fmt(price)} تومان`, { reply_markup: adPrKb() });
    return;
  }

  if (state === S.BROADCAST) {
    await setState(uid, S.IDLE, {}, KV);
    const uids = await getAllUids(KV);
    await send(cid, `⏳ در حال ارسال به ${uids.length} کاربر...`);
    let ok = 0, fail = 0;
    for (const id of uids) {
      try { await copyMsg(id, cid, msg.message_id); ok++; await new Promise(r => setTimeout(r, 60)); } catch { fail++; }
    }
    await send(cid, `✅ ارسال انجام شد\n✔️ موفق: ${ok}\n❌ ناموفق: ${fail}`, { reply_markup: adminKb() });
    return;
  }

  if (state === S.REPLY_USER) {
    const tid = sd.tid;
    await setState(uid, S.IDLE, {}, KV);
    try { await copyMsg(tid, cid, msg.message_id); await send(cid, '✅ پیام ارسال شد.', { reply_markup: adminKb() }); }
    catch { await send(cid, '❌ خطا. کاربر ربات را مسدود کرده باشد.', { reply_markup: adminKb() }); }
    return;
  }

  if (state === S.SET_PAYMENT) { cfg.pay = txt; await saveSettings(cfg, KV); await setState(uid, S.IDLE, {}, KV); await send(cid, '✅ اطلاعات پرداخت ذخیره شد.', { reply_markup: adminKb() }); return; }
  if (state === S.SET_CHANNEL) { cfg.ch = txt.trim(); await saveSettings(cfg, KV); await setState(uid, S.IDLE, {}, KV); await send(cid, `✅ کانال: ${txt}`, { reply_markup: adminKb() }); return; }
  if (state === S.SET_SUPPORT) { cfg.sup = txt.replace('@', '').trim(); await saveSettings(cfg, KV); await setState(uid, S.IDLE, {}, KV); await send(cid, `✅ پشتیبانی: @${cfg.sup}`, { reply_markup: adminKb() }); return; }
  if (state === S.SET_RULES) { cfg.rules = txt; await saveSettings(cfg, KV); await setState(uid, S.IDLE, {}, KV); await send(cid, '✅ قوانین ذخیره شد.', { reply_markup: adminKb() }); return; }
  if (state === S.ORDER_NOTE) { await updOrder(sd.oid, { note: txt }, KV); await setState(uid, S.IDLE, {}, KV); await send(cid, `✅ یادداشت ذخیره شد.`); return; }
  if (state === S.SETUP_GROUP) {
    cfg.gid = txt.trim(); await saveSettings(cfg, KV); await setState(uid, S.IDLE, {}, KV);
    await send(cid, `✅ گروه تنظیم شد: \`${txt}\`\n\nحالا تاپیک‌ها را بسازید:`, { reply_markup: grpKb(cfg) });
    return;
  }

  await send(cid, '🏠', { reply_markup: mainKb() });
}

// ============================================================
// CALLBACK HANDLER
// ============================================================
async function onCallback(cb, KV) {
  const cid = cb.message.chat.id;
  const mid = cb.message.message_id;
  const uid = cb.from.id;
  const d   = cb.data;
  const adm = isAdmin(uid);

  const ans = (t = '', al = false) => answer(cb.id, t, al);
  const ed  = (t, kb) => edit(cid, mid, t, kb ? { reply_markup: kb } : {});

  // ---- HOME ----
  if (d === 'home') { await ans(); await ed('🏠 *منوی اصلی*', mainKb()); return; }

  if (d === 'rules') {
    await ans();
    const cfg = await getSettings(KV);
    await ed(cfg.rules || `📋 *قوانین فروشگاه*\n\n۱. پس از ثبت سفارش اطلاعات پرداخت ارسال می‌شود\n۲. پس از پرداخت رسید ارسال کنید\n۳. پس از تایید سفارش تحویل داده می‌شود\n۴. در صورت عدم ارسال وجه برگشت داده می‌شود`,
      { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'home' }]] });
    return;
  }

  if (d === 'ch') {
    await ans();
    const cfg = await getSettings(KV);
    await ed(cfg.ch ? `📣 کانال ما:\nt.me/${cfg.ch.replace('@', '')}` : '⚠️ کانال تنظیم نشده',
      { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'home' }]] });
    return;
  }

  if (d === 'sup') {
    await ans();
    const cfg = await getSettings(KV);
    const kb = { inline_keyboard: [
      cfg.sup ? [{ text: '💬 تماس با پشتیبانی', url: `https://t.me/${cfg.sup}` }] : [],
      [{ text: '🔙 بازگشت', callback_data: 'home' }],
    ].filter(r => r.length) };
    await ed(cfg.sup ? `💬 *پشتیبانی ۲۴/۷*\n\n@${cfg.sup}` : '💬 با ادمین تماس بگیرید.', kb);
    return;
  }

  // ---- PREMIUM ----
  if (d === 'pm') { await ans(); const p = await getPrices(KV); await ed('💎 *بسته‌های پریمیوم*\n\nانتخاب کنید:', premKb(p)); return; }

  if (d.startsWith('bp_')) {
    const pkg = d.slice(3);
    const prices = await getPrices(KV);
    const info = prices.p[pkg];
    if (!info?.price) { await ans('⚠️ این بسته موقتاً در دسترس نیست', true); return; }
    await ans();
    await setState(uid, S.PREMIUM_USER, { pkg }, KV);
    await ed(`💎 *پریمیوم ${info.label}*\n\n💰 *${fmt(info.price)} تومان*\n\nیوزرنیم یا آیدی عددی مقصد را وارد کنید:\n_(مثال: @username یا 123456789)_`,
      { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'pm' }]] });
    return;
  }

  // ---- STARS ----
  if (d === 'st') { await ans(); const p = await getPrices(KV); await ed('⭐ *بسته‌های استارز*\n\nانتخاب کنید:', starsKb(p)); return; }

  if (d === 'bs_custom') { await ans(); await setState(uid, S.STARS_CUSTOM, {}, KV); await ed('🔢 *مقدار دلخواه*\n\nتعداد استارز (۱ تا ۱۰۰٬۰۰۰) را وارد کنید:', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'st' }]] }); return; }

  if (d.startsWith('bs_')) {
    const amt = parseInt(d.slice(3));
    const prices = await getPrices(KV);
    const price = prices.s[String(amt)];
    if (!price) { await ans('⚠️ این بسته موقتاً در دسترس نیست', true); return; }
    await ans();
    await setState(uid, S.STARS_USER, { amt }, KV);
    await ed(`⭐ *${amt} استارز*\n\n💰 *${fmt(price)} تومان*\n\nیوزرنیم یا آیدی عددی مقصد را وارد کنید:`,
      { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'st' }]] });
    return;
  }

  // ---- ORDER FLOW ----
  if (d.startsWith('rc_')) {
    const oid = d.slice(3);
    await ans(); await setState(uid, S.RECEIPT, { oid }, KV);
    await ed(`📤 *ارسال رسید*\n\nسفارش: \`${oid}\`\n\nتصویر رسید پرداخت را ارسال کنید:`,
      { inline_keyboard: [[{ text: '❌ انصراف', callback_data: `od_${oid}` }]] });
    return;
  }

  if (d.startsWith('cx_')) {
    const oid = d.slice(3);
    const o = await getOrder(oid, KV);
    if (!o || (o.uid !== uid && !adm)) { await ans('❌ دسترسی ندارید', true); return; }
    await ans(); await updOrder(oid, { status: 'cancelled' }, KV); await setState(uid, S.IDLE, {}, KV);
    await ed(`❌ *سفارش لغو شد*\n\nشناسه: \`${oid}\``, mainKb());
    const u = await getUser(uid, KV);
    await notifyAdmins(`❌ *سفارش لغو شد*\n\n🆔 \`${oid}\`\n👤 ${uLbl(u)}`);
    return;
  }

  // ---- MY ORDERS ----
  if (d === 'myord') {
    await ans();
    const orders = await getUserOrders(uid, KV, 8);
    if (!orders.length) {
      await ed('📦 *سفارش‌های شما*\n\nهنوز سفارشی ندارید!', { inline_keyboard: [
        [{ text: '💎 خرید پریمیوم', callback_data: 'pm' }, { text: '⭐ خرید استارز', callback_data: 'st' }],
        [{ text: '🔙 بازگشت', callback_data: 'home' }],
      ]});
      return;
    }
    await ed('📦 *سفارش‌های شما:*', myOrdKb(orders));
    return;
  }

  if (d.startsWith('od_')) {
    const oid = d.slice(3);
    await ans();
    const o = await getOrder(oid, KV);
    if (!o) { await ed('❌ سفارش یافت نشد.', mainKb()); return; }
    if (o.uid !== uid && !adm) { await ans('❌ دسترسی ندارید', true); return; }
    const t = o.type === 'premium' ? `پریمیوم 💎 ${o.pkgLabel || ''}` : `استارز ⭐ ${o.amt} عدد`;
    await ed(`📋 *جزئیات سفارش*\n\n🆔 \`${o.id}\`\n📦 ${t}\n🎯 مقصد: \`${o.target}\`\n💰 ${fmt(o.price)} تومان\n📊 ${stLbl(o.status)}\n📅 ${new Date(o.at).toLocaleString('fa-IR')}${o.note ? `\n📝 ${o.note}` : ''}`, ordDetKb(o, adm));
    return;
  }

  // ---- ADMIN ONLY ----
  if (!adm) { await ans('⛔ دسترسی ندارید', true); return; }

  if (d === 'adpanel') {
    await ans();
    const st = await getStats(KV);
    await ed(`👑 *پنل مدیریت*\n\n📦 ${st.total} | ✅ ${st.done} | ⏳ ${st.pending}`, adminKb());
    return;
  }

  if (d === 'adst') {
    await ans();
    const st = await getStats(KV);
    await ed(`📊 *آمار کلی*\n\n📦 کل: ${st.total}\n⏳ انتظار: ${st.pending}\n💰 پرداخت‌شده: ${st.paid}\n⚙️ پردازش: ${st.processing}\n✅ تحویل: ${st.done}\n❌ لغو: ${st.cancelled}\n\n💎 پریمیوم: ${st.prem}\n⭐ استارز: ${st.stars}\n💵 درآمد: ${fmt(st.rev)} تومان`,
      { inline_keyboard: [[{ text: '📣 ارسال گزارش به گروه', callback_data: 'send_report' }], [{ text: '🔙 بازگشت', callback_data: 'adpanel' }]] });
    return;
  }

  if (d === 'send_report') {
    await ans('در حال ارسال...');
    const st = await getStats(KV);
    const cfg = await getSettings(KV);
    if (cfg.gid && cfg.topics?.reports) {
      await sendTopic(cfg.gid, cfg.topics.reports, `📊 *گزارش آماری*\n\n📦 کل: ${st.total}\n⏳ انتظار: ${st.pending}\n✅ تحویل: ${st.done}\n❌ لغو: ${st.cancelled}\n\n💎 پریمیوم: ${st.prem}\n⭐ استارز: ${st.stars}\n💵 درآمد: ${fmt(st.rev)} تومان`);
      await ans('✅ گزارش ارسال شد', true);
    } else { await ans('⚠️ گروه لاگ تنظیم نشده', true); }
    return;
  }

  if (d === 'adord') { await ans(); await ed('🗂 *مدیریت سفارش‌ها*', adOrdKb()); return; }
  if (d === 'aore') { await ans(); const ords = await getRecentOrders(KV, 15); await ed(`📦 *آخرین ${ords.length} سفارش:*`, ords.length ? myOrdKb(ords) : { inline_keyboard: [[{ text: '🔙', callback_data: 'adpanel' }]] }); return; }

  if (d.startsWith('aos_')) {
    const st = d.slice(4);
    await ans();
    const ords = await getOrdersByStatus(st, KV, 15);
    await ed(ords.length ? `📦 *${stLbl(st)} (${ords.length}):*` : `📦 سفارشی با وضعیت «${stLbl(st)}» نیست.`,
      ords.length ? myOrdKb(ords) : { inline_keyboard: [[{ text: '🔙', callback_data: 'adord' }]] });
    return;
  }

  if (d === 'adpr') { await ans(); const p = await getPrices(KV); const pr = p.p; const sr = p.s; await ed(`💰 *قیمت‌گذاری*\n\n💎 *پریمیوم:*\n🥉 ۱ماهه: ${fmt(pr['1m']?.price)}\n🥈 ۳ماهه: ${fmt(pr['3m']?.price)}\n🥇 ۶ماهه: ${fmt(pr['6m']?.price)}\n👑 ۱ساله: ${fmt(pr['12m']?.price)}\n\n⭐ *استارز:*\n50: ${fmt(sr['50'])} | 100: ${fmt(sr['100'])}\n250: ${fmt(sr['250'])} | 500: ${fmt(sr['500'])}\n1000: ${fmt(sr['1000'])} تومان`, adPrKb()); return; }
  if (d === 'adppr') { await ans(); await ed('💎 *قیمت پریمیوم*\n\nکدام بسته؟', adPPrKb()); return; }
  if (d === 'adpst') { await ans(); await ed('⭐ *قیمت استارز*\n\nکدام بسته؟', adSPrKb()); return; }

  if (d.startsWith('sp_')) {
    const parts = d.slice(3).split('_');
    const tp = parts[0];
    const key = parts.slice(1).join('_');
    await ans();
    await setState(uid, S.SET_PRICE, { tp, key }, KV);
    await ed(`💰 *تنظیم قیمت*\n\n${tp === 'p' ? 'پریمیوم' : 'استارز'}: ${key}\n\nقیمت جدید (تومان) را وارد کنید:`,
      { inline_keyboard: [[{ text: '❌ انصراف', callback_data: tp === 'p' ? 'adppr' : 'adpst' }]] });
    return;
  }

  if (d === 'adcfg') {
    await ans();
    const cfg = await getSettings(KV);
    await ed(`⚙️ *تنظیمات*\n\n💳 پرداخت: ${cfg.pay ? '✅' : '❌'}\n📣 کانال: ${cfg.ch || '---'}\n💬 پشتیبانی: ${cfg.sup ? '@'+cfg.sup : '---'}\n🗂 گروه لاگ: ${cfg.gid || '---'}\n🔛 وضعیت: ${cfg.on !== false ? '✅ فعال' : '❌ غیرفعال'}`, adCfgKb());
    return;
  }

  if (d === 'cfg_pay') { await ans(); const cfg = await getSettings(KV); await setState(uid, S.SET_PAYMENT, {}, KV); await ed(`💳 *اطلاعات پرداخت*\n\nفعلی:\n${cfg.pay || '---'}\n\nمتن جدید را ارسال کنید:`, { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adcfg' }]] }); return; }
  if (d === 'cfg_ch') { await ans(); await setState(uid, S.SET_CHANNEL, {}, KV); await ed('📣 *کانال*\n\nآیدی کانال را وارد کنید (مثلاً @mychannel):', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adcfg' }]] }); return; }
  if (d === 'cfg_sup') { await ans(); await setState(uid, S.SET_SUPPORT, {}, KV); await ed('💬 *پشتیبانی*\n\nیوزرنیم را وارد کنید (بدون @):', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adcfg' }]] }); return; }
  if (d === 'cfg_rules') { await ans(); await setState(uid, S.SET_RULES, {}, KV); await ed('📝 *قوانین*\n\nمتن قوانین را ارسال کنید:', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adcfg' }]] }); return; }

  if (d === 'cfg_tog') {
    await ans();
    const cfg = await getSettings(KV);
    cfg.on = !cfg.on; await saveSettings(cfg, KV);
    await ed(`🔛 وضعیت ربات: ${cfg.on ? '✅ فعال' : '❌ غیرفعال'}`, adCfgKb());
    return;
  }

  if (d === 'cfg_grp') {
    await ans();
    const cfg = await getSettings(KV);
    await setState(uid, S.SETUP_GROUP, {}, KV);
    await ed(`🗂 *گروه لاگ*\n\nگروه فعلی: ${cfg.gid ? `\`${cfg.gid}\`` : 'تنظیم نشده'}\n\nآیدی عددی گروه را ارسال کنید:`, { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adcfg' }]] });
    return;
  }

  if (d.startsWith('gt_')) {
    const tk = d.slice(3);
    await ans();
    const cfg = await getSettings(KV);
    if (!cfg.gid) { await ans('⚠️ ابتدا آیدی گروه تنظیم کنید', true); return; }
    const names = { new_orders: '📦 سفارش‌های جدید', paid_orders: '💰 پرداخت‌شده‌ها', done_orders: '✅ تحویل‌شده‌ها', cancelled: '❌ لغوشده‌ها', reports: '📊 گزارش‌ها', support: '💬 پشتیبانی' };
    const colors = { new_orders: 0x6FB9F0, paid_orders: 0xFFD67E, done_orders: 0xCBF0F8, cancelled: 0xFF93B2, reports: 0xFB6F5F, support: 0xB0D9FF };
    const res = await makeTopic(cfg.gid, names[tk] || tk, colors[tk] || 0x6FB9F0);
    if (res.ok) {
      if (!cfg.topics) cfg.topics = {};
      cfg.topics[tk] = res.result.message_thread_id;
      await saveSettings(cfg, KV);
      await ed(`✅ تاپیک «${names[tk]}» ساخته شد!\n\nبقیه را هم بسازید:`, grpKb(cfg));
    } else {
      await ed(`❌ خطا: ${res.description || 'ناشناخته'}\n\nمطمئن شوید ربات ادمین گروه است و Topics فعال باشد.`, grpKb(cfg));
    }
    return;
  }

  // ---- ADMIN ORDER ACTIONS ----
  if (d.startsWith('acp_')) {
    const oid = d.slice(4);
    await ans();
    const o = await getOrder(oid, KV);
    if (!o) { await ans('❌ سفارش یافت نشد', true); return; }
    await updOrder(oid, { status: 'processing' }, KV);
    await send(o.uid, `✅ *پرداخت تایید شد!*\n\n🆔 \`${oid}\`\n⚙️ در حال پردازش...`, { reply_markup: mainKb() }).catch(() => null);
    const u = await getUser(o.uid, KV);
    await logStatus(o, u, 'processing', KV);
    await ed('✅ پرداخت تایید شد.', { inline_keyboard: [[{ text: '✅ تحویل دادم', callback_data: `ss_${oid}_done` }], [{ text: '📋 جزئیات', callback_data: `od_${oid}` }]] });
    return;
  }

  if (d.startsWith('arj_')) {
    const oid = d.slice(4);
    await ans();
    await updOrder(oid, { status: 'pending' }, KV);
    const o = await getOrder(oid, KV);
    await send(o.uid, `⚠️ *رسید تایید نشد*\n\n🆔 \`${oid}\`\n\nرسید صحیح ارسال کنید.`, { reply_markup: { inline_keyboard: [[{ text: '📤 ارسال رسید جدید', callback_data: `rc_${oid}` }]] } }).catch(() => null);
    await ed('⚠️ رسید رد شد.', { inline_keyboard: [[{ text: '📋 جزئیات', callback_data: `od_${oid}` }]] });
    return;
  }

  if (d.startsWith('acs_')) { const oid = d.slice(4); await ans(); await ed(`⚙️ *تغییر وضعیت*\n\`${oid}\``, stChgKb(oid)); return; }

  if (d.startsWith('ss_')) {
    const rest = d.slice(3);
    const li = rest.lastIndexOf('_');
    const oid = rest.slice(0, li);
    const st = rest.slice(li + 1);
    await ans();
    const o = await getOrder(oid, KV);
    if (!o) { await ans('❌ سفارش یافت نشد', true); return; }
    await updOrder(oid, { status: st }, KV);
    const msgs = { paid: '💰 پرداخت تایید شد!', processing: '⚙️ سفارش در پردازش است.', done: '✅ سفارش تحویل داده شد! ممنون 🙏', cancelled: '❌ سفارش لغو شد.', pending: '⏳ سفارش به انتظار پرداخت برگشت.' };
    await send(o.uid, `${msgs[st] || ''}\n\n🆔 \`${oid}\``, { reply_markup: mainKb() }).catch(() => null);
    const u = await getUser(o.uid, KV);
    await logStatus(o, u, st, KV);
    await ed(`✅ وضعیت: ${stLbl(st)}`, { inline_keyboard: [[{ text: '📋 جزئیات', callback_data: `od_${oid}` }]] });
    return;
  }

  if (d.startsWith('anote_')) { const oid = d.slice(6); await ans(); await setState(uid, S.ORDER_NOTE, { oid }, KV); await ed(`📝 *یادداشت*\n\n\`${oid}\`\n\nمتن یادداشت:`, { inline_keyboard: [[{ text: '❌ انصراف', callback_data: `od_${oid}` }]] }); return; }

  if (d.startsWith('acx_')) {
    const oid = d.slice(4);
    await ans();
    const o = await getOrder(oid, KV);
    if (!o) { await ans('❌ سفارش یافت نشد', true); return; }
    await updOrder(oid, { status: 'cancelled' }, KV);
    await send(o.uid, `❌ سفارش \`${oid}\` توسط ادمین لغو شد.`, {}).catch(() => null);
    await ed(`❌ سفارش \`${oid}\` لغو شد.`, { inline_keyboard: [[{ text: '🔙', callback_data: 'adpanel' }]] });
    return;
  }

  if (d.startsWith('amsg_')) {
    const oid = d.slice(5);
    const o = await getOrder(oid, KV);
    if (!o) { await ans('❌ سفارش یافت نشد', true); return; }
    await ans(); await setState(uid, S.REPLY_USER, { tid: o.uid }, KV);
    await ed('💬 *پیام به کاربر*\n\nپیام یا مدیا را ارسال کنید:', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: `od_${oid}` }]] });
    return;
  }

  if (d === 'adbc') { await ans(); await setState(uid, S.BROADCAST, {}, KV); await ed('📣 *ارسال همگانی*\n\nپیام را ارسال کنید:', { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'adpanel' }]] }); return; }

  if (d === 'adusr') {
    await ans();
    const uids = await getAllUids(KV);
    await ed(`👥 *کاربران*\n\n👤 تعداد کل: ${uids.length}`, { inline_keyboard: [[{ text: '📣 ارسال همگانی', callback_data: 'adbc' }], [{ text: '🔙 بازگشت', callback_data: 'adpanel' }]] });
    return;
  }

  await ans('⚠️ دستور نامشخص', true);
}

// ============================================================
// MAIN WORKER EXPORT
// ============================================================
export default {
  async fetch(request, env, ctx) {

    // ---- بررسی تنظیمات ----
    if (!BOT_TOKEN || BOT_TOKEN.includes('اینجا')) {
      console.error('❌ BOT_TOKEN تنظیم نشده!');
      return new Response('BOT_TOKEN is not set', { status: 500 });
    }
    if (!env.KV) {
      console.error('❌ KV Namespace متصل نشده!');
      return new Response('KV not bound', { status: 500 });
    }

    // ---- GET: بررسی وضعیت ----
    if (request.method === 'GET') {
      const wh = await tg('getWebhookInfo', {});
      const me = await tg('getMe', {});
      const status = {
        bot: me.ok ? `✅ @${me.result.username}` : '❌ توکن نامعتبر',
        webhook: wh.ok ? (wh.result.url ? `✅ ${wh.result.url}` : '❌ ست نشده') : '❌',
        pending: wh.result?.pending_update_count || 0,
        admins: ADMIN_IDS,
        version: '1.0.0',
      };
      console.log('🤖 Bot Status:', JSON.stringify(status));
      return new Response(
        `🤖 ربات فروشگاهی پریمیوم و استارز\n\n` +
        `ربات: ${status.bot}\n` +
        `Webhook: ${status.webhook}\n` +
        `آپدیت‌های در صف: ${status.pending}\n` +
        `ادمین‌ها: ${status.admins.join(', ')}\n\n` +
        `برای ست کردن webhook:\n` +
        `${request.url}setup`,
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    // ---- GET /setup: ست کردن webhook خودکار ----
    const url = new URL(request.url);
    if (request.method === 'GET' || url.pathname === '/setup') {
      // این حالت در بالا handle شد
    }

    // ---- POST: آپدیت تلگرام ----
    if (request.method === 'POST') {
      // ---- Webhook setup از URL ----
      if (url.pathname.endsWith('/setup')) {
        const workerUrl = `${url.protocol}//${url.host}`;
        const res = await tg('setWebhook', { url: workerUrl, allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
        console.log('🔗 Webhook setup:', JSON.stringify(res));
        return new Response(res.ok ? `✅ Webhook ست شد:\n${workerUrl}` : `❌ خطا: ${res.description}`, { status: 200 });
      }

      let update;
      try { update = await request.json(); } catch { return new Response('OK', { status: 200 }); }

      ctx.waitUntil((async () => {
        try {
          if (update.message) {
            console.log(`📨 پیام از ${update.message.from?.id}: ${update.message.text || '[media]'}`);
            await onMessage(update.message, env.KV);
          } else if (update.callback_query) {
            console.log(`🔘 کلیک از ${update.callback_query.from?.id}: ${update.callback_query.data}`);
            await onCallback(update.callback_query, env.KV);
          } else if (update.my_chat_member) {
            const m = update.my_chat_member;
            if (['administrator', 'member'].includes(m.new_chat_member?.status)) {
              console.log(`➕ ربات به گروه اضافه شد: ${m.chat.title} [${m.chat.id}]`);
              await notifyAdmins(`✅ ربات به گروه اضافه شد:\n📌 ${m.chat.title}\n🆔 \`${m.chat.id}\`\n\nاین آیدی را در تنظیمات گروه لاگ وارد کنید.`);
            }
          }
        } catch (e) {
          console.error('❌ خطا در پردازش آپدیت:', e.message, e.stack);
        }
      })());

      return new Response('OK', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  }
};
