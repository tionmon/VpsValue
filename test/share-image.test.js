import test from "node:test";
import assert from "node:assert/strict";
import { createShareSvg } from "../scripts/share-image.mjs";

test("creates a safe share SVG with calculation data", () => {
  const svg = createShareSvg({
    cnyValue: 254.76,
    remainingDays: 311,
    totalDays: 365,
    renewalPrice: 299,
    currency: "CNY<script>",
    cycleLabel: "每年",
    nextPayment: "2027-05-05",
    valuationDate: "2026-06-28",
  });
  assert.match(svg, /254\.76/);
  assert.match(svg, /311 天/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /CNY&lt;scri/);
  assert.match(svg, /animateMotion/);
  assert.match(svg, /stroke-dashoffset/);
  assert.match(svg, /r="13" fill="#F9C846"/);
});
