import OpenAI from "openai";
import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";
import { STATIC_SYSTEM_PROMPT } from "./prompt.js";

const FREE_LIMIT = 100;
const TIME_ZONE = "Asia/Dhaka";
const PROMPT_CACHE_KEY = "twitai-generate-v4";

const tones = {
  technical: "Mention one clear technical detail.",
  analytical: "Give one thoughtful observation.",
  defi: "Focus on one practical DeFi point.",
  skeptical: "Mention one thing worth watching.",
  humor: "Use light humor when it fits.",
  supportive: "Support one specific point.",
  bullish_rational: "Show calm confidence about one specific point.",
  casual: "Keep it light and conversational.",
  balanced: "Keep it natural, simple, and conversational."
};

const REASONING_MODELS = new Set([
  "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5-nano", "gpt-5-mini",
  "o1", "o1-mini", "o3", "o3-mini"
]);

function getDhakaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getActiveSubscription(data) {
  let expiry = null;
  const value = data.subscriptionExpiry;
  if (value?.toDate) expiry = value.toDate();
  else if (value?._seconds !== undefined) expiry = new Date(value._seconds * 1000);
  else if (value) expiry = new Date(value);
  return data.subscriptionStatus === "active" && expiry && expiry.getTime() > Date.now();
}

function usageFromResponse(response) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens));
  const cachedInputTokens = Number(
    usage.input_tokens_details?.cached_tokens ??
    usage.inputTokensDetails?.cachedTokens ??
    0
  );
  const actualInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return {
    inputTokens,
    cachedInputTokens,
    actualInputTokens,
    outputTokens,
    totalTokens
  };
}

function numberOr(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let decoded;
  try {
    decoded = await requireUser(req);
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      error: error.message || "Authentication failed.",
      code: error.code || "AUTH_ERROR"
    });
  }

  const db = getDb();
  const admin = getFirebaseAdmin();
  const userRef = db.collection("users").doc(decoded.uid);
  let reservationMade = false;

  try {
    const body = req.body || {};
    const tweet = String(body.tweet || "").trim();
    const minWords = numberOr(body.minWords, 10, 5, 60);
    const maxWords = numberOr(body.maxWords, 18, minWords, 60);
    const replyCount = numberOr(body.replyCount, 5, 1, 10);
    const tone = body.tone || "balanced";
    const tag = String(body.tag || "").trim();
    const language = body.language || "auto";

    if (!tweet) return res.status(400).json({ error: "Tweet text is required." });

    await db.runTransaction(async transaction => {
      const snap = await transaction.get(userRef);
      if (!snap.exists) {
        throw Object.assign(new Error("User profile not found."), {
          statusCode: 403, code: "USER_PROFILE_NOT_FOUND"
        });
      }

      const data = snap.data();
      const active = getActiveSubscription(data);
      if (!active && Number(data.freeTweetsUsed || 0) >= FREE_LIMIT) {
        throw Object.assign(
          new Error("Your 100 free tweet submissions are finished. Please subscribe to continue."),
          { statusCode: 403, code: "FREE_LIMIT_REACHED" }
        );
      }

      const updates = {
        totalTweetsSubmitted: admin.firestore.FieldValue.increment(1),
        updatedAt: timestamp()
      };
      if (!active) updates.freeTweetsUsed = admin.firestore.FieldValue.increment(1);
      transaction.update(userRef, updates);
    });
    reservationMade = true;

    const toneDirective = tones[tone] || tones.balanced;
    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply. Only use it when relevant.`
      : "Do not force mentions or tags.";
    const langDirective = language === "auto"
      ? "Reply in the post's language. Use English if the language is unclear."
      : `Write strictly in ${language}.`;

    const personas = [
      "a casual reader", "a thoughtful reader", "a curious community member",
      "a busy user replying quickly", "a practical observer", "someone familiar with the topic"
    ];
    const persona = personas[Math.floor(Math.random() * personas.length)];
    const styleSeed = Math.random().toString(36).slice(2, 10);

    const dynamicInstructions = `
FORMAT:
- Exactly ${replyCount} replies.
- Each reply must be exactly ONE sentence, ${minWords}-${maxWords} words total.
- Put every reply inside its own Markdown fenced code block.
- Use one code block per reply.
- Put nothing outside the code blocks.
- Do not add labels.
- Do not add numbering.
- Do not add explanations.
- Do not add commentary.

LANGUAGE:
${langDirective}

TONE:
${toneDirective}

MENTION RULE:
${tagDirective}`;

    const systemPrompt = STATIC_SYSTEM_PROMPT + dynamicInstructions;
    const userMessage = `${tweet}
Write the replies now.
Understand what this tweet is actually about before replying.
Reply to its real content and topic, whatever that topic is.
Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed.
Never mention the voice hint.`;

    const model = process.env.OPENAI_MODEL;
    if (!model) throw new Error("OPENAI_MODEL is not configured.");

    const requestPayload = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_output_tokens: 400,
      prompt_cache_key: PROMPT_CACHE_KEY,
      prompt_cache_retention: "24h"
    };
    if (REASONING_MODELS.has(model)) requestPayload.reasoning = { effort: "low" };

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create(requestPayload);
    const text = response.output_text || "";
    if (!text.trim()) throw new Error("OpenAI returned an empty response.");

    const replies = [...text.matchAll(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
    const finalReplies = replies.length ? replies : [text.trim()];

    const usage = usageFromResponse(response);
    const date = getDhakaDate();
    const dayRef = db.collection("usageDaily").doc(`${decoded.uid}_${date}`);
    const logRef = db.collection("generationLogs").doc();

    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    );

    const batch = db.batch();
    batch.update(userRef, {
      totalRepliesGenerated: admin.firestore.FieldValue.increment(finalReplies.length),
      updatedAt: timestamp()
    });

    batch.set(dayRef, {
      uid: decoded.uid,
      email: decoded.email || "",
      date,
      tweets: admin.firestore.FieldValue.increment(1),
      replies: admin.firestore.FieldValue.increment(finalReplies.length),
      requestCount: admin.firestore.FieldValue.increment(1),
      inputTokens: admin.firestore.FieldValue.increment(usage.inputTokens),
      cachedInputTokens: admin.firestore.FieldValue.increment(usage.cachedInputTokens),
      actualInputTokens: admin.firestore.FieldValue.increment(usage.actualInputTokens),
      outputTokens: admin.firestore.FieldValue.increment(usage.outputTokens),
      totalTokens: admin.firestore.FieldValue.increment(usage.totalTokens),
      updatedAt: timestamp(),
      expiresAt
    }, { merge: true });

    batch.set(logRef, {
      uid: decoded.uid,
      email: decoded.email || "",
      date,
      createdAt: timestamp(),
      tweetText: tweet,
      tweets: 1,
      replies: finalReplies.length,
      model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      actualInputTokens: usage.actualInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      expiresAt
    });

    await batch.commit();

    console.log("Twit AI usage:", JSON.stringify({
      uid: decoded.uid, date, ...usage,
      tweets: 1, replies: finalReplies.length
    }));

    return res.status(200).json({
      text: text.trim(),
      replies: finalReplies,
      usage: {
        tweets: 1,
        replies: finalReplies.length,
        date,
        ...usage
      }
    });
  } catch (error) {
    console.error("Generate API error:", error);

    if (reservationMade) {
      try {
        const snap = await userRef.get();
        if (snap.exists) {
          const active = getActiveSubscription(snap.data());
          const rollback = {
            totalTweetsSubmitted: admin.firestore.FieldValue.increment(-1),
            updatedAt: timestamp()
          };
          if (!active) rollback.freeTweetsUsed = admin.firestore.FieldValue.increment(-1);
          await userRef.update(rollback);
        }
      } catch (rollbackError) {
        console.error("Usage rollback failed:", rollbackError);
      }
    }

    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to generate replies.",
      code: error.code || "GENERATION_ERROR"
    });
  }
}
