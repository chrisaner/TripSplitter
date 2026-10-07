process.env.TZ = "Asia/Taipei";
const admin = require("firebase-admin");
const { onValueWritten } = require("firebase-functions/v2/database");
const vision = require("@google-cloud/vision");


admin.initializeApp();

const db = admin.database();
const bucket = admin.storage().bucket();
const visionClient = new vision.ImageAnnotatorClient();

/**
 * Normalize OCR text
 */
function normalizeText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Parse number string like:
 * 1,234
 * 1,234.50
 * 1234
 * 1234.5
 */
function parseAmountString(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/,/g, "").trim();
  const num = Number(cleaned);
  if (Number.isNaN(num)) return null;
  return num;
}

/**
 * Detect likely currency from OCR text.
 * Priority:
 * 1) explicit currency code / language hints
 * 2) symbols
 * 3) fallback by roomId hint
 */
 
function hasJapaneseKana(text) {
  return /[\u3040-\u30ff]/.test(text); // 平假名 + 片假名
}

function hasChineseYuanContext(text) {
  return /人民币|人民幣|RMB|CNY/.test(text);
}

function hasJapaneseReceiptContext(text) {
  return /レジ|領収書|合計|現計|内消費税|外税|税込|税抜|お釣り|釣銭|現金|カード|商品|対象|預り|お預り|小計/.test(text);
}

function detectCurrency(text, roomId = "") {
  const t = String(text || "");
  const room = String(roomId || "").toLowerCase();

  // 1. 明確台幣
  if (/NT\$|TWD|NTD/i.test(t)) return "TWD";

  // 2. 明確韓元
  if (/KRW|₩|원/i.test(t)) return "KRW";

  // 3. 明確美金
  if (/USD|US\$/i.test(t)) return "USD";

  // 4. 明確歐元
  if (/EUR|€/i.test(t)) return "EUR";

  // 5. 明確人民幣
  // 注意：必須是明確人民幣語境，不接受單獨「元」
  if (hasChineseYuanContext(t)) return "CNY";

  // 6. 日本收據強特徵：優先判 JPY
  if (
    hasJapaneseKana(t) ||
    /JPY|円|￥/.test(t) ||
    hasJapaneseReceiptContext(t)
  ) {
    return "JPY";
  }

  // 7. 單獨出現 ¥ / ￥ 時，先依 room 判斷
  if (/¥|￥/.test(t)) {
    if (/china|cn|beijing|shanghai|guangzhou|shenzhen/i.test(room)) return "CNY";
    if (/tokyo|japan|jp|osaka|kyoto|fukuoka|nagoya|sapporo/i.test(room)) return "JPY";

    // 沒有 room 線索時，預設 JPY
    return "JPY";
  }

  // 8. 單獨出現 $ 時，依 room 補判
  if (/\$/.test(t)) {
    if (/taiwan|tw/i.test(room)) return "TWD";
    return "USD";
  }

  return "TWD";
}

/**
 * Extract candidate amounts from OCR text lines.
 * We score lines with "total-like" keywords higher.
 */
function extractCandidates(text, currency) {
  const lines = String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const keywordRules = [
    { re: /grand total/i, score: 140 },
    { re: /total/i, score: 120 },
    { re: /amount/i, score: 100 },
    { re: /合計/, score: 140 },
    { re: /現計/, score: 140 },
    { re: /ご利用額|利用額/, score: 130 },
    { re: /總計|总计/, score: 130 },
    { re: /應付|应付/, score: 120 },
    { re: /付款金額|付款金额/, score: 120 },
    { re: /小計|subtotal/i, score: 70 },
    { re: /tax|稅|税|消費税/i, score: 10 }
  ];

  const amountRegex =
    /(?:NT\$|TWD|NTD|JPY|KRW|USD|EUR|CNY|RMB|US\$|¥|￥|₩|€|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/g;

  const candidates = [];

  function isPhoneLike(line) {
    return (
      /電話|TEL|Tel|Phone/i.test(line) ||
      /\d{2,4}-\d{2,4}-\d{3,4}/.test(line)
    );
  }

  function isCardLike(line) {
    return /カード番号|卡號|卡号|card|會員編號|会员编号/i.test(line);
  }

  function isDateLike(line) {
    return (
      /\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}/.test(line) ||
      /\d{1,2}:\d{2}/.test(line)
    );
  }

  function isReceiptMetaLike(line) {
    return /No\.|NO\.|レジ|店番|取引|交易|編號|编号|receipt/i.test(line);
  }

  function isBalanceLine(line) {
    return /残高|餘額|余额|balance/i.test(line);
  }

  function isLikelyNonAmountLine(line) {
    return (
      isPhoneLike(line) ||
      isCardLike(line) ||
      isDateLike(line) ||
      isReceiptMetaLike(line) ||
      isBalanceLine(line)
    );
  }

  for (const line of lines) {
    if (isLikelyNonAmountLine(line)) continue;

    const matches = [...line.matchAll(amountRegex)];
    if (matches.length === 0) continue;

    for (const m of matches) {
      const amount = parseAmountString(m[1]);
      if (amount == null || amount <= 0) continue;

      let score = 10;

      for (const rule of keywordRules) {
        if (rule.re.test(line)) {
          score += rule.score;
        }
      }

      // 稅通常不是最終金額
      if (/tax|稅|税|消費税/i.test(line)) score -= 30;

      // 小計比總計低
      if (/小計|subtotal/i.test(line)) score -= 20;

      // 太小金額直接降權
      if (amount < 50) score -= 30;

      // 金額越大越可能是總額
      score += Math.min(amount / 50, 40);

      // 有幣別符號加分
      if (/(¥|￥|NT\$|TWD|USD|EUR)/.test(line)) {
        score += 20;
      }

      candidates.push({
        amount,
        currency,
        label: line,
        score
      });
    }
  }

  // fallback
  if (candidates.length === 0) {
    for (const line of lines) {
      if (isLikelyNonAmountLine(line)) continue;

      const allMatches = [...line.matchAll(amountRegex)];
      for (const m of allMatches) {
        const amount = parseAmountString(m[1]);
        if (amount == null || amount <= 0) continue;

        candidates.push({
          amount,
          currency,
          label: line,
          score: amount
        });
      }
    }
  }

  // dedupe
  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.amount}|${c.currency}|${c.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(c);
    }
  }

  uniq.sort((a, b) => b.score - a.score);

  return uniq.slice(0, 5);
}

/**
 * Main parser
 */
function parseReceiptText(text, roomId = "") {
  const normalized = normalizeText(text);
  const currency = detectCurrency(normalized, roomId);
  const candidates = extractCandidates(normalized, currency);

  const best = candidates[0] || null;

  return {
    amount: best ? best.amount : null,
    currency: best ? best.currency : currency,
    confidence: best ? Math.min(0.95, 0.5 + best.score / 200) : 0.2,
    rawText: normalized,
    candidates: candidates.map((c) => ({
      amount: c.amount,
      currency: c.currency,
      label: c.label.length > 60 ? c.label.slice(0, 60) + "..." : c.label
    }))
  };
}

exports.processOcrJob = onValueWritten(
  {
    ref: "/ocrJobs/{jobId}",
    region: "asia-southeast1"
  },
  async (event) => {
    const after = event.data.after.val();
    if (!after) return;

    // only handle newly created or updated pending jobs
    if (after.status !== "pending") return;

    const jobId = event.params.jobId;
    const { imagePath, roomId } = after || {};

    if (!imagePath) {
      await db.ref(`/ocrJobs/${jobId}`).update({
        status: "error",
        error: "Missing imagePath",
        processedAt: Date.now()
      });
      return;
    }

    try {
      await db.ref(`/ocrJobs/${jobId}`).update({
        status: "processing",
        processedAt: Date.now()
      });

      // download image from Firebase Storage bucket
      const file = bucket.file(imagePath);
      const [buffer] = await file.download();

      // Vision OCR
      const [result] = await visionClient.documentTextDetection({
        image: { content: buffer }
      });

      const text =
        result?.fullTextAnnotation?.text ||
        (Array.isArray(result?.textAnnotations) && result.textAnnotations[0]?.description) ||
        "";

      if (!text) {
        await db.ref(`/ocrJobs/${jobId}`).update({
          status: "error",
          error: "No text detected",
          processedAt: Date.now()
        });
        return;
      }

      const parsed = parseReceiptText(text, roomId);

      await db.ref(`/ocrJobs/${jobId}`).update({
        status: "done",
        result: parsed,
        error: null,
        processedAt: Date.now()
      });
    } catch (err) {
      console.error("processOcrJob failed:", err);

      await db.ref(`/ocrJobs/${jobId}`).update({
        status: "error",
        error: err?.message || "OCR processing failed",
        processedAt: Date.now()
      });
    }
  }
);