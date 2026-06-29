import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeBillingText,
  calculateServerValue,
  calendarDaysBetween,
  detectCurrency,
  normalizeAiAnalysis,
  parseFlexibleDate,
  parseISODate,
  shiftMonths,
} from "../core.js";

test("uses real calendar days for an annual cycle", () => {
  const result = calculateServerValue({
    renewalPrice: 365,
    cycle: "annual",
    nextPayment: "2027-05-05",
    valuationDate: "2026-05-05",
    rateToCny: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalDays, 365);
  assert.equal(result.remainingDays, 365);
  assert.equal(result.cnyValue, 365);
});

test("accounts for leap-year billing periods", () => {
  const result = calculateServerValue({
    renewalPrice: 366,
    cycle: "annual",
    nextPayment: "2024-03-01",
    valuationDate: "2023-03-01",
    rateToCny: 1,
  });
  assert.equal(result.totalDays, 366);
  assert.equal(result.dailyCostCny, 1);
});

test("supports remaining terms longer than 365 days", () => {
  const result = calculateServerValue({
    renewalPrice: 95,
    cycle: "triennial",
    nextPayment: "2029-04-22",
    valuationDate: "2026-04-22",
    rateToCny: 7,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "active");
  assert.equal(result.totalDays, 1096);
  assert.equal(result.remainingDays, 1096);
  assert.equal(result.originalValue, 95);
  assert.equal(result.cnyValue, 665);
});

test("preserves end-of-month billing semantics", () => {
  const previous = shiftMonths(parseISODate("2026-02-28"), -1);
  assert.equal(previous.toISOString().slice(0, 10), "2026-01-31");
  assert.equal(calendarDaysBetween(previous, parseISODate("2026-02-28")), 28);
});

test("parses the provided Chinese billing example", () => {
  const result = analyzeBillingText(`注册日期\n2026/05/05\n续约价格\n￥299.00CNY\n账单周期\n每年\n下次付款日期\n2027/05/05\n付款方式\n支付宝`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {
    registrationDate: "2026-05-05",
    renewalPrice: 299,
    currency: "CNY",
    cycle: "annual",
    nextPayment: "2027-05-05",
    paymentMethod: "支付宝",
  });
});

test("returns zero value after expiration", () => {
  const result = calculateServerValue({
    renewalPrice: 100,
    cycle: "monthly",
    nextPayment: "2026-06-01",
    valuationDate: "2026-06-02",
    rateToCny: 1,
  });
  assert.equal(result.status, "expired");
  assert.equal(result.remainingDays, 0);
  assert.equal(result.cnyValue, 0);
});

test("normalizes pasted short and dotted dates", () => {
  assert.equal(parseFlexibleDate("2026.6.1"), "2026-06-01");
  assert.equal(parseFlexibleDate("26.12.12"), "2026-12-12");
  assert.equal(parseFlexibleDate("20260601"), "2026-06-01");
});

test("recognizes Chinese currency names", () => {
  assert.equal(detectCurrency("续费 19.99 美元"), "USD");
  assert.equal(detectCurrency("每年 20 欧元"), "EUR");
  assert.equal(detectCurrency("价格 15 英镑"), "GBP");
  assert.equal(detectCurrency("299 人民币"), "CNY");
  assert.equal(detectCurrency("续费 25 加元"), "CAD");
  assert.equal(detectCurrency("三年付95刀"), "USD");
});

test("parses an inline three-year billing description", () => {
  const result = analyzeBillingText("2029-04-22到期 三年付95刀");
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {
    registrationDate: "",
    renewalPrice: 95,
    currency: "USD",
    cycle: "triennial",
    nextPayment: "2029-04-22",
    paymentMethod: "",
  });
});

test("parses Chinese currency names from billing text", () => {
  const result = analyzeBillingText("续约价格 29.99 美元\n账单周期 每月\n下次付款日期 26.12.12");
  assert.equal(result.ok, true);
  assert.equal(result.fields.renewalPrice, 29.99);
  assert.equal(result.fields.currency, "USD");
  assert.equal(result.fields.cycle, "monthly");
  assert.equal(result.fields.nextPayment, "2026-12-12");
});

test("normalizes strict AI output", () => {
  const result = normalizeAiAnalysis({
    registrationDate: "2026.6.1",
    renewalPrice: 49,
    currency: "欧元",
    cycle: "每年",
    nextPayment: "27.6.1",
    confidence: 93,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fields.currency, "EUR");
  assert.equal(result.fields.cycle, "annual");
  assert.equal(result.fields.nextPayment, "2027-06-01");
  assert.equal(result.confidence, 93);
});

test("normalizes CAD and triennial AI output", () => {
  const result = normalizeAiAnalysis({
    renewalPrice: 120,
    currency: "CAD",
    cycle: "triennial",
    nextPayment: "2029-04-22",
  });
  assert.equal(result.ok, true);
  assert.equal(result.fields.currency, "CAD");
  assert.equal(result.fields.cycle, "triennial");
});
