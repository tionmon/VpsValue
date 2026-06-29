import {
  CYCLES,
  analyzeBillingText,
  calculateServerValue,
  detectCurrency,
  formatChineseDate,
  normalizeAiAnalysis,
  parseFlexibleDate,
} from "./core.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const form = $("#calculator-form");
const priceInput = $("#renewal-price");
const currencyInput = $("#currency");
const cycleInput = $("#billing-cycle");
const registrationInput = $("#registration-date");
const nextPaymentInput = $("#next-payment");
const valuationInput = $("#valuation-date");
const rateStatus = $("#rate-status");
const formError = $("#form-error");
const resultValue = $("#result-value");
const originalValue = $("#original-value");
const resultStatus = $("#result-status");
const billingText = $("#billing-text");
const analysisResult = $("#analysis-result");
const analysisError = $("#analysis-error");
const toast = $("#toast");
const analyzeButton = $("#analyze-text");

const shareModal = $("#share-modal");
const currencySymbol = $("#currency-symbol");
const rateDateDisplay = $("#rate-date-display");
const progressPercent = $("#progress-percent");
const progressBar = $("#progress-bar");
const progressTrack = $(".progress-track");
const periodStart = $("#period-start");
const periodEnd = $("#period-end");
const remainingDaysEl = $("#remaining-days");
const totalDaysEl = $("#total-days");
const dailyCost = $("#daily-cost");

const API_ROOT = location.protocol === "file:" ? "http://127.0.0.1:4173" : "";
const symbols = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", HKD: "HK$", JPY: "¥", CAD: "C$" };
const rateNames = { CNY: "人民币", USD: "美元", EUR: "欧元", GBP: "英镑", HKD: "港币", JPY: "日元", CAD: "加拿大元" };
const sampleText = `注册日期
2026/05/05
续约价格
￥299.00CNY
账单周期
每年
下次付款日期
2027/05/05
付款方式
支付宝`;

let rates = { CNY: 1 };
let rateDate = "";
let ratesReady = false;
let lastResult = null;
let lastAnalysis = null;
let toastTimer;
let aiConfig = { enabled: false, hasApiKey: false, baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" };
let modalReturnFocus = null;

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function apiUrl(path) {
  return `${API_ROOT}${path}`;
}

function setDateEntryValue(id, isoDate) {
  const group = document.querySelector(`[data-date-entry="${id}"]`);
  const hidden = document.getElementById(id);
  if (!group || !hidden) return;
  const parsed = parseFlexibleDate(isoDate);
  const [year = "", month = "", day = ""] = parsed ? parsed.split("-") : [];
  group.querySelector('[data-date-part="year"]').value = year;
  group.querySelector('[data-date-part="month"]').value = month;
  group.querySelector('[data-date-part="day"]').value = day;
  hidden.value = parsed;
  const picker = group.querySelector(".date-picker-proxy");
  if (picker) picker.value = parsed;
}

function syncDateEntry(group) {
  const id = group.dataset.dateEntry;
  const hidden = document.getElementById(id);
  const year = group.querySelector('[data-date-part="year"]').value;
  const month = group.querySelector('[data-date-part="month"]').value;
  const day = group.querySelector('[data-date-part="day"]').value;
  const parsed = year.length === 4 && month && day ? parseFlexibleDate(`${year}.${month}.${day}`) : "";
  hidden.value = parsed;
  const picker = group.querySelector(".date-picker-proxy");
  if (picker) picker.value = parsed;
  return parsed;
}

function setupDateEntries() {
  $$('[data-date-entry]').forEach((group) => {
    const parts = [...group.querySelectorAll('[data-date-part]')];
    parts.forEach((input, index) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(0, Number(input.maxLength));
        syncDateEntry(group);
        if (input.value.length === Number(input.maxLength) && parts[index + 1]) parts[index + 1].focus();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !input.value && parts[index - 1]) parts[index - 1].focus();
      });
    });
    group.addEventListener("paste", (event) => {
      const parsed = parseFlexibleDate(event.clipboardData?.getData("text") || "");
      if (!parsed) return;
      event.preventDefault();
      setDateEntryValue(group.dataset.dateEntry, parsed);
      parts[2].focus();
      updateResult();
      showToast(`已识别日期 ${parsed}`);
    });
    const picker = group.querySelector(".date-picker-proxy");
    picker?.addEventListener("change", () => {
      setDateEntryValue(group.dataset.dateEntry, picker.value);
      updateResult();
    });
  });
  $$('[data-open-date]').forEach((button) => button.addEventListener("click", () => {
    const picker = document.querySelector(`[data-picker-for="${button.dataset.openDate}"]`);
    if (typeof picker?.showPicker === "function") picker.showPicker();
    else picker?.click();
  }));
}

function openModal(modal) {
  modalReturnFocus = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  $(".page-shell").inert = true;
  const focusTarget = modal.querySelector("input, button");
  requestAnimationFrame(() => focusTarget?.focus());
}

function closeModal(modal) {
  modal.hidden = true;
  if (!document.querySelector(".modal-backdrop:not([hidden])")) {
    document.body.style.overflow = "";
    $(".page-shell").inert = false;
    modalReturnFocus?.focus();
  }
}

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value, currency = "CNY") {
  return moneyFormatter.format(Number(value) || 0) + ` ${currency}`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setRateStatus(label, state = "ready") {
  rateStatus.querySelector("span:last-child").textContent = label;
  rateStatus.classList.toggle("is-loading", state === "loading");
}

async function loadRates() {
  setRateStatus("正在更新汇率", "loading");
  try {
    const response = await fetch(apiUrl("/api/rates"), { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok || !data.rates?.USD) throw new Error(data.error || `HTTP ${response.status}`);
    rates = { CNY: 1, ...data.rates };
    rateDate = data.date || todayISO();
    ratesReady = true;
    setRateStatus(`${data.stale ? "缓存汇率" : "汇率已更新"} · ${rateDate.slice(5)}`);
  } catch (error) {
    rates = { CNY: 1 };
    ratesReady = false;
    setRateStatus("汇率服务不可用");
  }
  updateCurrencyUI();
  updateResult();
}

function activeRate() {
  const currency = currencyInput.value;
  if (currency === "CNY") return 1;
  return Number(rates[currency]) || null;
}

function updateCurrencyUI() {
  const currency = currencyInput.value;
  currencySymbol.textContent = symbols[currency];
  rateDateDisplay.textContent = /^\d{4}-/.test(rateDate) ? rateDate.slice(5).replace("-", "/") : "API";
}

function updateResult() {
  updateCurrencyUI();
  const rate = activeRate();
  if (currencyInput.value !== "CNY" && (!ratesReady || !rate)) {
    lastResult = null;
    formError.textContent = "外币汇率尚未从服务器加载，请稍后重试";
    formError.hidden = false;
    return;
  }
  const result = calculateServerValue({
    renewalPrice: priceInput.value,
    cycle: cycleInput.value,
    nextPayment: nextPaymentInput.value,
    valuationDate: valuationInput.value,
    rateToCny: rate,
  });

  if (!result.ok) {
    formError.textContent = result.error;
    formError.hidden = false;
    return;
  }
  formError.hidden = true;
  lastResult = result;

  const cny = moneyFormatter.format(result.cnyValue);
  resultValue.textContent = cny;
  originalValue.textContent = currencyInput.value === "CNY"
    ? `完整周期价格 ¥${formatMoney(result.cycleCostCny, "CNY")}`
    : `原币剩余价值 ${symbols[currencyInput.value]}${formatMoney(result.originalValue, currencyInput.value)}`;

  const statusMap = {
    active: ["服务中", false],
    expired: ["已到期", true],
    upcoming: ["周期未开始", false],
  };
  resultStatus.lastChild.textContent = statusMap[result.status][0];
  resultStatus.classList.toggle("is-expired", statusMap[result.status][1]);

  const progress = Math.round(result.progressRatio * 1000) / 10;
  progressPercent.textContent = `${progress}%`;
  progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
  progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  periodStart.textContent = result.periodStart;
  periodEnd.textContent = nextPaymentInput.value;
  remainingDaysEl.textContent = `${result.remainingDays} 天`;
  totalDaysEl.textContent = `${result.totalDays} 天`;
  dailyCost.textContent = `¥${result.dailyCostCny.toFixed(2)}`;
}

function resetForm() {
  priceInput.value = "299";
  currencyInput.value = "CNY";
  cycleInput.value = "annual";
  setDateEntryValue("registration-date", "2026-05-05");
  setDateEntryValue("next-payment", "2027-05-05");
  setDateEntryValue("valuation-date", todayISO());
  updateResult();
  showToast("已恢复示例数据");
}

function renderAnalysis(analysis) {
  lastAnalysis = analysis;
  analysisError.hidden = true;
  analysisResult.hidden = false;
  $("#analysis-confidence").textContent = `识别置信度 ${analysis.confidence}%`;
  $("#analysis-source").textContent = analysis.source === "ai"
    ? `AI 接口 · ${analysis.model || aiConfig.model}`
    : analysis.source === "fallback"
      ? "AI 不可用，已用本地规则"
      : "本地规则解析";
  $("#analysis-summary").textContent = analysis.summary;
  const fields = analysis.fields;
  const chips = [];
  if (fields.registrationDate) chips.push(`注册 ${fields.registrationDate}`);
  if (fields.renewalPrice) chips.push(`${fields.renewalPrice.toFixed(2)} ${fields.currency}`);
  if (fields.cycle) chips.push(CYCLES[fields.cycle].label);
  if (fields.nextPayment) chips.push(`付款 ${fields.nextPayment}`);
  if (fields.paymentMethod) chips.push(fields.paymentMethod);
  $("#analysis-fields").replaceChildren(...chips.map((label) => {
    const chip = document.createElement("span");
    chip.textContent = label;
    return chip;
  }));
}

function updateAiMode() {
  $("#ai-mode-dot").classList.toggle("is-active", aiConfig.enabled);
  $("#ai-mode-label").textContent = aiConfig.enabled ? "AI 精确解析已启用" : "本地智能解析";
  $("#ai-mode-detail").textContent = aiConfig.enabled
    ? `${aiConfig.model} · 通过后台安全调用`
    : "无需配置，文字不会上传";
}

async function loadAiConfig() {
  try {
    const response = await fetch(apiUrl("/api/ai-config"), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Backend unavailable");
    aiConfig = await response.json();
  } catch {
    aiConfig.enabled = false;
  }
  updateAiMode();
}



async function requestAiAnalysis(text) {
  const response = await fetch(apiUrl("/api/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AI 分析失败");
  const normalized = normalizeAiAnalysis(data);
  if (!normalized.ok) throw new Error(normalized.error);
  return { ...normalized, source: "ai", model: data.model || aiConfig.model };
}

async function runAnalysis() {
  if (!billingText.value.trim()) {
    analysisResult.hidden = true;
    analysisError.textContent = "请先粘贴账单或订单文字";
    analysisError.hidden = false;
    return;
  }
  const localAnalysis = analyzeBillingText(billingText.value);
  if (!localAnalysis.ok && !aiConfig.enabled) {
    lastAnalysis = null;
    analysisResult.hidden = true;
    analysisError.textContent = localAnalysis.error;
    analysisError.hidden = false;
    return;
  }
  analyzeButton.disabled = true;
  const analyzeLabel = analyzeButton.querySelector("span");
  const originalLabel = analyzeLabel.textContent;
  analyzeLabel.textContent = "分析中…";
  analysisError.hidden = true;
  try {
    if (aiConfig.enabled) renderAnalysis(await requestAiAnalysis(billingText.value));
    else renderAnalysis({ ...localAnalysis, source: "local" });
  } catch (error) {
    if (localAnalysis.ok) {
      renderAnalysis({ ...localAnalysis, source: "fallback" });
      showToast(`AI 分析失败，已使用本地规则：${error.message}`);
    } else {
      lastAnalysis = null;
      analysisResult.hidden = true;
      analysisError.textContent = `AI 分析失败：${error.message}`;
      analysisError.hidden = false;
    }
  } finally {
    analyzeButton.disabled = false;
    analyzeLabel.textContent = originalLabel;
  }
}

function applyAnalysis() {
  if (!lastAnalysis?.ok) return;
  const fields = lastAnalysis.fields;
  if (fields.registrationDate) setDateEntryValue("registration-date", fields.registrationDate);
  if (fields.renewalPrice) priceInput.value = String(fields.renewalPrice);
  if (fields.currency) currencyInput.value = fields.currency;
  if (fields.cycle) cycleInput.value = fields.cycle;
  if (fields.nextPayment) setDateEntryValue("next-payment", fields.nextPayment);
  updateResult();
  $("#calculator").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  showToast("账单信息已填入计算器");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

async function copyResult() {
  if (!lastResult) return;
  const label = CYCLES[cycleInput.value]?.label || "账单周期";
  const summary = `VPS 剩余价值：¥${formatMoney(lastResult.cnyValue, "CNY")}\n剩余 ${lastResult.remainingDays} 天 / 本周期 ${lastResult.totalDays} 天\n${label}续费：${symbols[currencyInput.value]}${formatMoney(Number(priceInput.value), currencyInput.value)}\n下次付款：${formatChineseDate(nextPaymentInput.value)}\n估值日期：${formatChineseDate(valuationInput.value)}`;
  await copyToClipboard(summary);
  $("#copy-result span").textContent = "已复制";
  setTimeout(() => { $("#copy-result span").textContent = "复制结果"; }, 1800);
  showToast("估值结果已复制");
}

async function createShareLink() {
  if (!lastResult) return;
  const button = $("#share-result");
  button.disabled = true;
  button.querySelector("span").textContent = "生成中…";
  try {
    const response = await fetch(apiUrl("/api/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cnyValue: lastResult.cnyValue,
        remainingDays: lastResult.remainingDays,
        totalDays: lastResult.totalDays,
        renewalPrice: Number(priceInput.value),
        currency: currencyInput.value,
        cycleLabel: CYCLES[cycleInput.value]?.label,
        nextPayment: nextPaymentInput.value,
        valuationDate: valuationInput.value,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "生成直链失败");
    $("#share-direct-url").value = data.url;
    $("#share-markdown").value = data.markdown;
    $("#share-image-preview").src = data.url;
    $("#share-status").hidden = true;
    openModal(shareModal);
  } catch (error) {
    showToast(location.protocol === "file:"
      ? "直链需要后台服务，请先运行 npm run dev"
      : error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "图片直链";
  }
}

function handlePricePaste(event) {
  const text = event.clipboardData?.getData("text") || "";
  const currency = detectCurrency(text);
  const amount = text.match(/(?:^|[^\d])([\d,]+(?:\.\d+)?)(?:[^\d]|$)/)?.[1];
  if (!currency || !amount) return;
  event.preventDefault();
  priceInput.value = amount.replace(/,/g, "");
  currencyInput.value = currency;
  updateResult();
  showToast(`已识别 ${rateNames[currency]} ${priceInput.value}`);
}

setupDateEntries();
setDateEntryValue("valuation-date", todayISO());
form.addEventListener("input", updateResult);
form.addEventListener("change", updateResult);
$("#reset-form").addEventListener("click", resetForm);
rateStatus.addEventListener("click", () => loadRates(true));
$("#copy-result").addEventListener("click", copyResult);
$("#share-result").addEventListener("click", createShareLink);
priceInput.addEventListener("paste", handlePricePaste);
$("#load-sample").addEventListener("click", () => {
  billingText.value = sampleText;
  runAnalysis();
  billingText.focus();
});
$("#analyze-text").addEventListener("click", runAnalysis);
$("#apply-analysis").addEventListener("click", applyAnalysis);

$$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(document.getElementById(button.dataset.closeModal))));
$$('.modal-backdrop').forEach((modal) => modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal(modal);
}));
$$('[data-copy-field]').forEach((button) => button.addEventListener("click", async () => {
  const field = document.getElementById(button.dataset.copyField);
  await copyToClipboard(field.value);
  const label = button.textContent;
  button.textContent = "已复制";
  setTimeout(() => { button.textContent = label; }, 1400);
}));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const modal = document.querySelector(".modal-backdrop:not([hidden])");
  if (modal) closeModal(modal);
});
billingText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runAnalysis();
  }
});

updateCurrencyUI();
updateResult();
loadRates();
loadAiConfig();
