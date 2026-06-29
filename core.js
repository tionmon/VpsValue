const DAY_MS = 86_400_000;

export const CYCLES = {
  monthly: { label: "每月", months: 1 },
  quarterly: { label: "每季度", months: 3 },
  semiannual: { label: "每半年", months: 6 },
  annual: { label: "每年", months: 12 },
  biennial: { label: "每两年", months: 24 },
};

export function parseISODate(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return date;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function daysInUTCMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function shiftMonths(date, amount) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const sourceLastDay = daysInUTCMonth(year, month);
  const targetAnchor = new Date(Date.UTC(year, month + amount, 1));
  const targetYear = targetAnchor.getUTCFullYear();
  const targetMonth = targetAnchor.getUTCMonth();
  const targetLastDay = daysInUTCMonth(targetYear, targetMonth);
  const targetDay = day === sourceLastDay ? targetLastDay : Math.min(day, targetLastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

export function calendarDaysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

export function calculateServerValue({
  renewalPrice,
  cycle,
  nextPayment,
  valuationDate,
  rateToCny = 1,
}) {
  const price = Number(renewalPrice);
  const next = parseISODate(nextPayment);
  const valuation = parseISODate(valuationDate);
  const cycleConfig = CYCLES[cycle];

  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "请输入大于 0 的续约价格" };
  }
  if (!cycleConfig) return { ok: false, error: "请选择账单周期" };
  if (!next || !valuation) return { ok: false, error: "请填写有效的日期" };

  const periodStart = shiftMonths(next, -cycleConfig.months);
  const totalDays = Math.max(calendarDaysBetween(periodStart, next), 1);
  const rawRemainingDays = calendarDaysBetween(valuation, next);
  const remainingDays = Math.max(0, Math.min(rawRemainingDays, totalDays));
  const elapsedDays = totalDays - remainingDays;
  const remainingRatio = remainingDays / totalDays;
  const safeRate = Number.isFinite(Number(rateToCny)) && Number(rateToCny) > 0
    ? Number(rateToCny)
    : 1;

  return {
    ok: true,
    status: rawRemainingDays <= 0 ? "expired" : rawRemainingDays > totalDays ? "upcoming" : "active",
    periodStart: toISODate(periodStart),
    totalDays,
    remainingDays,
    elapsedDays,
    remainingRatio,
    progressRatio: elapsedDays / totalDays,
    originalValue: price * remainingRatio,
    cnyValue: price * remainingRatio * safeRate,
    cycleCostCny: price * safeRate,
    dailyCostCny: (price * safeRate) / totalDays,
  };
}

function valueAfterLabel(lines, labels) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const label of labels) {
      const match = line.match(label);
      if (!match) continue;
      const remainder = line.slice((match.index ?? 0) + match[0].length)
        .replace(/^[\s:：=-]+/, "")
        .trim();
      if (remainder) return remainder;
      if (lines[index + 1]) return lines[index + 1].trim();
    }
  }
  return "";
}

export function parseFlexibleDate(value) {
  if (!value) return "";
  const source = String(value).trim();
  const numeric = source.match(/(?:^|\D)(\d{2}|20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?(?:\D|$)/);
  if (numeric) {
    const year = numeric[1].length === 2 ? `20${numeric[1]}` : numeric[1];
    const iso = `${year}-${numeric[2].padStart(2, "0")}-${numeric[3].padStart(2, "0")}`;
    return parseISODate(iso) ? iso : "";
  }
  const compact = source.match(/(?:^|\D)((?:20)?\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) {
    const year = compact[1].length === 2 ? `20${compact[1]}` : compact[1];
    const iso = `${year}-${compact[2]}-${compact[3]}`;
    return parseISODate(iso) ? iso : "";
  }
  const english = source.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}/i);
  if (english) {
    const parsed = new Date(english[0].replace(/(\d)(st|nd|rd|th)/i, "$1"));
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  }
  return "";
}

export function detectCurrency(value) {
  const source = String(value || "");
  const code = source.match(/\b(CNY|RMB|USD|EUR|GBP|HKD|JPY)\b/i)?.[1]?.toUpperCase();
  if (code === "RMB") return "CNY";
  if (code) return code;
  if (/人民币|人民币元|元人民币|中(?:国)?元|[￥¥]/i.test(source)) return "CNY";
  if (/美元|美金|美刀|\bUS\s*dollars?\b|\$/i.test(source)) return "USD";
  if (/欧元|€|\beuros?\b/i.test(source)) return "EUR";
  if (/英镑|£|\bpounds?\b/i.test(source)) return "GBP";
  if (/港币|港元/i.test(source)) return "HKD";
  if (/日元|日币/i.test(source)) return "JPY";
  return "";
}

export function detectCycle(value) {
  const normalized = value.toLowerCase();
  if (/每两年|两年|2\s*年|biennial|every\s*2\s*years?/.test(normalized)) return "biennial";
  if (/每半年|半年|6\s*个月|semi[\s-]?annual|half[\s-]?year/.test(normalized)) return "semiannual";
  if (/每季度|季度|3\s*个月|quarterly|quarter/.test(normalized)) return "quarterly";
  if (/每月|月付|一个月|monthly|per\s*month/.test(normalized)) return "monthly";
  if (/每年|年付|一年|annual|yearly|per\s*year/.test(normalized)) return "annual";
  return "";
}

export function analyzeBillingText(text) {
  const cleanText = String(text || "").replace(/\r/g, "").trim();
  if (!cleanText) return { ok: false, error: "请先粘贴账单或订单文字" };

  const lines = cleanText.split("\n").map((line) => line.trim()).filter(Boolean);
  const registrationRaw = valueAfterLabel(lines, [/注册日期/i, /开通日期/i, /registration\s*date/i, /registered\s*(?:on)?/i]);
  const nextPaymentRaw = valueAfterLabel(lines, [/下次付款日期/i, /下次续费/i, /到期日期/i, /next\s*payment\s*date/i, /renewal\s*date/i, /expires?\s*(?:on)?/i]);
  const priceRaw = valueAfterLabel(lines, [/续约价格/i, /续费价格/i, /续费金额/i, /renewal\s*price/i, /renewal\s*cost/i]);
  const cycleRaw = valueAfterLabel(lines, [/账单周期/i, /付款周期/i, /billing\s*(?:cycle|period)/i]);
  const paymentMethod = valueAfterLabel(lines, [/付款方式/i, /支付方式/i, /payment\s*method/i]);

  const currencyWords = "CNY|RMB|USD|EUR|GBP|HKD|JPY|人民币(?:元)?|美元|美金|美刀|欧元|英镑|港币|港元|日元|日币";
  const broadPrice = cleanText.match(new RegExp(`(?:[￥¥$€£]|${currencyWords})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "i"))
    || cleanText.match(new RegExp(`([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:${currencyWords})`, "i"));
  const priceSource = priceRaw || broadPrice?.[0] || "";
  const amountMatch = priceSource.match(/([\d,]+(?:\.\d+)?)/);
  const renewalPrice = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
  const currency = detectCurrency(priceSource || cleanText) || "CNY";
  const registrationDate = parseFlexibleDate(registrationRaw);
  const nextPayment = parseFlexibleDate(nextPaymentRaw);
  const cycle = detectCycle(cycleRaw || cleanText);

  const extracted = {
    registrationDate,
    renewalPrice,
    currency,
    cycle,
    nextPayment,
    paymentMethod: paymentMethod.replace(/[。.;；].*$/, "").trim(),
  };
  const recognized = [registrationDate, renewalPrice, cycle, nextPayment, paymentMethod].filter(Boolean).length;
  const confidence = Math.min(98, Math.round(45 + recognized * 10.5));

  if (!renewalPrice && !registrationDate && !nextPayment) {
    return { ok: false, error: "没有识别到日期或价格，请保留字段名称后再试" };
  }

  const parts = [];
  if (registrationDate) parts.push(`注册于 ${formatChineseDate(registrationDate)}`);
  if (renewalPrice) parts.push(`${CYCLES[cycle]?.label || "续约"}价格为 ${renewalPrice.toFixed(2)} ${currency}`);
  if (nextPayment) parts.push(`下次付款日是 ${formatChineseDate(nextPayment)}`);
  if (paymentMethod) parts.push(`付款方式为 ${extracted.paymentMethod}`);

  return {
    ok: true,
    fields: extracted,
    confidence,
    summary: parts.length ? `${parts.join("，")}。` : "已识别账单信息。",
  };
}

export function normalizeAiAnalysis(payload) {
  const raw = payload?.fields || payload || {};
  const price = Number(String(raw.renewalPrice ?? raw.price ?? "").replace(/,/g, ""));
  const registrationDate = parseFlexibleDate(String(raw.registrationDate || ""));
  const nextPayment = parseFlexibleDate(String(raw.nextPayment || raw.nextPaymentDate || ""));
  const currency = detectCurrency(String(raw.currency || "")) || "CNY";
  const cycle = CYCLES[raw.cycle] ? raw.cycle : detectCycle(String(raw.cycle || raw.billingCycle || ""));
  const paymentMethod = String(raw.paymentMethod || "").trim().slice(0, 80);
  const renewalPrice = Number.isFinite(price) && price > 0 ? price : null;

  if (!registrationDate && !nextPayment && !renewalPrice) {
    return { ok: false, error: "AI 没有识别到有效的日期或价格" };
  }

  const fields = { registrationDate, renewalPrice, currency, cycle, nextPayment, paymentMethod };
  const confidenceValue = Number(payload?.confidence ?? raw.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(100, Math.round(confidenceValue)))
    : 85;
  const summary = String(payload?.summary || raw.summary || "").trim() || [
    registrationDate ? `注册于 ${formatChineseDate(registrationDate)}` : "",
    renewalPrice ? `${CYCLES[cycle]?.label || "续约"}价格为 ${renewalPrice.toFixed(2)} ${currency}` : "",
    nextPayment ? `下次付款日是 ${formatChineseDate(nextPayment)}` : "",
    paymentMethod ? `付款方式为 ${paymentMethod}` : "",
  ].filter(Boolean).join("，") + "。";

  return { ok: true, fields, confidence, summary };
}

export function formatChineseDate(isoDate) {
  const date = parseISODate(isoDate);
  if (!date) return "—";
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}
