function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function createShareSvg(input) {
  const value = Math.max(0, safeNumber(input.cnyValue));
  const remaining = Math.max(0, Math.round(safeNumber(input.remainingDays)));
  const total = Math.max(1, Math.round(safeNumber(input.totalDays, 1)));
  const progress = Math.max(0, Math.min(100, Math.round((1 - remaining / total) * 1000) / 10));
  const progressWidth = Math.round(700 * progress / 100);
  const activeNode = Math.max(0, Math.min(4, Math.round(progress / 25)));
  const timelinePoints = [[78, 528], [320, 472], [560, 526], [825, 452], [1120, 520]];
  const timelineNodes = timelinePoints.map(([x, y], index) => {
    const isActive = index === activeNode;
    const isPast = index < activeNode;
    const radius = isActive ? 13 : isPast ? 8 : 6;
    const fill = isActive || isPast ? "#F9C846" : "#FFFFFF";
    const opacity = isActive ? 1 : isPast ? .65 : .28;
    const ring = isActive ? `<circle class="flow-motion" cx="${x}" cy="${y}" r="21" fill="none" stroke="#F9C846" stroke-width="2" opacity=".34"><animate attributeName="r" values="18;24;18" dur="2.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".42;.12;.42" dur="2.8s" repeatCount="indefinite"/></circle>` : "";
    return `${ring}<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" opacity="${opacity}"/>`;
  }).join("");
  const renewal = Math.max(0, safeNumber(input.renewalPrice));
  const currency = escapeXml(String(input.currency || "CNY").slice(0, 8));
  const cycle = escapeXml(String(input.cycleLabel || "账单周期").slice(0, 20));
  const nextPayment = escapeXml(String(input.nextPayment || "—").slice(0, 20));
  const valuationDate = escapeXml(String(input.valuationDate || "—").slice(0, 20));
  const formattedValue = moneyFormatter.format(value);
  const formattedRenewal = moneyFormatter.format(renewal);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">VPS 剩余价值 ¥${formattedValue}</title>
  <desc id="desc">剩余 ${remaining} 天，共 ${total} 天，下次付款 ${nextPayment}</desc>
  <rect width="1200" height="630" rx="36" fill="#F7F8FC"/>
  <circle cx="1110" cy="80" r="260" fill="#F9C846" opacity=".18"/>
  <rect x="54" y="52" width="1092" height="526" rx="32" fill="#3157E7"/>
  <circle cx="1080" cy="315" r="270" fill="#FFFFFF" opacity=".06"/>
  <style>@media (prefers-reduced-motion: reduce) { .flow-motion { display: none } }</style>
  <g aria-hidden="true">
    <path d="M78 528 C210 430 385 535 560 526 S900 388 1120 520" fill="none" stroke="#FFFFFF" stroke-width="3" opacity=".09"/>
    <path class="flow-motion" d="M78 528 C210 430 385 535 560 526 S900 388 1120 520" fill="none" stroke="#9FB3FF" stroke-width="2" stroke-dasharray="8 18" opacity=".32">
      <animate attributeName="stroke-dashoffset" from="0" to="-104" dur="6s" repeatCount="indefinite"/>
    </path>
    ${timelineNodes}
    <circle class="flow-motion" r="5" fill="#F9C846" opacity=".9">
      <animateMotion dur="8s" repeatCount="indefinite" path="M78 528 C210 430 385 535 560 526 S900 388 1120 520"/>
    </circle>
  </g>
  <g font-family="Plus Jakarta Sans, Microsoft YaHei, sans-serif" fill="#FFFFFF">
    <text x="104" y="125" font-size="30" font-weight="700">VPS VALUE</text>
    <text x="104" y="177" font-size="22" opacity=".72">当前剩余价值</text>
    <text x="104" y="292" font-size="82" font-weight="800">¥${formattedValue}</text>
    <text x="104" y="334" font-size="22" opacity=".65">${cycle}续费 ${formattedRenewal} ${currency}</text>
    <text x="104" y="415" font-size="20" opacity=".68">本周期已使用</text>
    <text x="804" y="415" font-size="22" font-weight="700" text-anchor="end">${progress}%</text>
    <rect x="104" y="438" width="700" height="12" rx="6" fill="#132D98" opacity=".8"/>
    <rect x="104" y="438" width="${progressWidth}" height="12" rx="6" fill="#F9C846"/>
    <text x="104" y="494" font-size="18" opacity=".6">估值日 ${valuationDate}</text>
    <text x="804" y="494" font-size="18" opacity=".6" text-anchor="end">下次付款 ${nextPayment}</text>
    <line x1="858" y1="128" x2="858" y2="500" stroke="#FFFFFF" opacity=".18"/>
    <text x="916" y="200" font-size="20" opacity=".65">剩余天数</text>
    <text x="916" y="255" font-size="46" font-weight="800">${remaining} 天</text>
    <text x="916" y="355" font-size="20" opacity=".65">周期天数</text>
    <text x="916" y="410" font-size="46" font-weight="800">${total} 天</text>
  </g>
  <text x="600" y="610" text-anchor="middle" font-family="Plus Jakarta Sans, Microsoft YaHei, sans-serif" font-size="16" fill="#5F6B82">按真实自然日计算 · VPS Value</text>
</svg>`;
}
