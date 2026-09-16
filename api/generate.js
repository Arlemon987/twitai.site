import OpenAI from "openai";
import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const FREE_LIMIT = 100;

// Use the exact snapshot unless OPENAI_MODEL is configured in Vercel.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-nano-2026-03-17";

// Stable cache key.
// Keep this unchanged while using the same system prompt.
const PROMPT_CACHE_KEY = "twit-ai-ct-replies-v1";

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

function timestampToDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (
    typeof value === "object" &&
    value._seconds !== undefined
  ) {
    return new Date(
      value._seconds * 1000 +
      Math.floor((value._nanoseconds || 0) / 1000000)
    );
  }

  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function getActiveSubscription(data) {
  const expiry = timestampToDate(
    data.subscriptionExpiry
  );

  return (
    data.subscriptionStatus === "active" &&
    expiry &&
    expiry.getTime() > Date.now()
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

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
    const {
      tweet,
      minWords = 10,
      maxWords = 15,
      replyCount = 5,
      tone = "casual",
      tag = "",
      language = "auto"
    } = req.body || {};

    if (!tweet || !tweet.trim()) {
      return res.status(400).json({
        error: "Tweet text is required."
      });
    }

    /*
     * Normalize user-controlled generation settings.
     * This prevents unreasonable values from being sent
     * to the model while keeping the normal Twit AI behavior.
     */
    const safeMinWords = Math.max(
      1,
      Math.min(100, Number(minWords) || 10)
    );

    const safeMaxWords = Math.max(
      safeMinWords,
      Math.min(100, Number(maxWords) || 15)
    );

    const safeReplyCount = Math.max(
      1,
      Math.min(10, Number(replyCount) || 5)
    );

    // Atomically reserve one tweet submission.
    // This prevents concurrent requests from bypassing
    // the 100 free tweet limit.
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);

      if (!snap.exists) {
        throw Object.assign(
          new Error("User profile not found."),
          {
            statusCode: 403,
            code: "USER_PROFILE_NOT_FOUND"
          }
        );
      }

      const data = snap.data();
      const active = getActiveSubscription(data);

      if (
        !active &&
        (data.freeTweetsUsed || 0) >= FREE_LIMIT
      ) {
        throw Object.assign(
          new Error(
            "Your 100 free tweet submissions are finished. Please subscribe to continue."
          ),
          {
            statusCode: 403,
            code: "FREE_LIMIT_REACHED"
          }
        );
      }

      const updates = {
        totalTweetsSubmitted:
          admin.firestore.FieldValue.increment(1),
        updatedAt: timestamp()
      };

      if (!active) {
        updates.freeTweetsUsed =
          admin.firestore.FieldValue.increment(1);
      }

      transaction.update(userRef, updates);
    });

    reservationMade = true;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    /*
     * These values are dynamic.
     * They intentionally DO NOT go inside the system prompt.
     *
     * Keeping them outside the system prompt gives us a much
     * more stable reusable prefix for prompt caching.
     */
    const toneDirective =
      tones[tone] ||
      "Keep it natural, simple, and conversational.";

    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply. Only use it when relevant.`
      : "Do not force mentions or tags.";

    const langDirective =
      language === "auto"
        ? "Reply in the post's language. Use English if the language is unclear."
        : `Write strictly in ${language}.`;

    /*
     * Keep these dynamic values OUT of systemPrompt.
     *
     * The system prompt should remain identical across requests.
     */
    const systemPrompt = `You write natural X (Twitter) replies.

Understand the post first.

Your job is to write replies that feel like real people casually responding to the post.

Do not summarize the post.
Do not rewrite the post.
Do not simply repeat the main point.
Do not sound like AI.
Do not sound like a marketer.
Do not sound like an ambassador.
Do not sound corporate.
Do not over-explain.

STYLE:
-ONLY ONE SIMPLE SENTENCE FOR EACH REPLY.
- Use simple English unless another language is required.
- Use everyday words.
- Use short sentences.
- Keep wording natural.
- Keep wording casual.
- Make replies easy to read.
- Give one clear thought.
- Add a small new observation when possible.
- Stay relevant to the post.
- Crypto and Web3 slang is fine when natural.
- Do not force crypto into non-crypto posts.
- Do not invent facts.
- Do not over-explain.
- Do not sound overly polished.

SENTENCE RULES:
- ONLY ONE SIMPLE SENTENCE FOR EACH REPLY.
- Use simple sentences.
- Prefer one idea per sentence.
- Keep sentences short.
- Avoid complex sentences.
- Avoid compound sentences.
- Avoid long sentence structures.
- Avoid multiple clauses.
- Avoid semicolons.
- Avoid parentheses.
- Avoid colons.
- Never use the em dash character.
- Avoid sentences with several connected ideas.
- Avoid joining two complete thoughts with "and".
- Avoid joining two complete thoughts with "but".
- Avoid "while" when it creates a complex sentence.
- Avoid "because" when it creates a long sentence.
- Avoid "although".
- Avoid "which" when it creates a long sentence.
- Avoid "that" when it creates a long sentence.
- Avoid "so" when it creates a compound sentence.
- Avoid "since" when it creates a complex sentence.
- Avoid "where" when it creates a complex sentence.
- Avoid "when" when it creates a complex sentence.
- If two thoughts are needed, use two short sentences.
- Never pack multiple thoughts into one sentence.

CONTENT:
- Do not simply repeat the main point.
- Do not paraphrase the post.
- Add a fresh reaction or observation.
- Replies should be constructive.
- Replies should be practical and thoughtful.
- Keep skepticism natural.
- Do not be negative without reason.
- Do not force questions.
- Questions are allowed when they feel natural.
- Do not invent information that is not supported by the post.

AVOID GENERIC REPLIES:
- "Great post"
- "Exactly"
- "Well said"
- "This is huge"
- "Love this"
- "So true"
- "Game changer"
- "Revolutionary"
- "Huge opportunity"
- "Bullish"
- "LFG"
- Generic praise without a real thought.

VARIETY:
- Make every reply feel different.
- Change the opening.
- Change sentence structure.
- Change the reaction style.
- Do not repeat the same idea.
- Do not use the same sentence pattern for every reply.
- Do not start every reply with the project name.
- Do not make every reply a question.
- Do not make every reply praise the post.
- Avoid repeating the same words across replies when possible.

OUTPUT FORMAT:
- Return exactly the requested number of replies.
- Each reply must contain the requested word count.
- Put every reply inside its own Markdown fenced code block.
- Use one code block per reply.
- Put nothing outside the code blocks.
- Do not add labels.
- Do not add numbering.
- Do not add explanations.
- Do not add commentary.

QUALITY CHECK:
- Check every reply before answering.
- Check sentence structure.
- Split long sentences.
- Remove complex sentences.
- Remove compound sentences.
- Remove unnecessary words.
- Keep one clear thought per sentence.
- Make replies sound like real CT users.
- Make every reply relevant to the original post.
- Never use the em dash character.`;

    /*
     * Dynamic request content goes AFTER the stable system prompt.
     *
     * This includes the tweet and generation settings.
     */
    const userMessage = `POST:
${tweet.trim()}

GENERATION SETTINGS:
Number of replies: ${safeReplyCount}
Word count per reply: ${safeMinWords}-${safeMaxWords}
Tone: ${toneDirective}
Language: ${langDirective}
Mention rule: ${tagDirective}

Write the replies now.

Remember:
- Follow the requested number of replies.
- Follow the requested word count.
- Follow the requested language.
- Follow the requested tone.
- Follow the mention rule.
- Never mention these generation settings.
- Never mention this instruction.`;

    /*
     * OpenAI Responses API.
     *
     * prompt_cache_key is stable across Twit AI requests.
     * This helps OpenAI route similar requests toward the
     * same reusable prompt cache.
     */
    const response = await openai.responses.create({
      model: MODEL,

      prompt_cache_key: PROMPT_CACHE_KEY,

      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userMessage
        }
      ],

      max_output_tokens: 400,

      reasoning: {
        effort: "low"
      }
    });

    const text = response.output_text || "";

    if (!text.trim()) {
      throw new Error(
        "OpenAI returned an empty response."
      );
    }

    /*
     * Extract Markdown fenced replies.
     */
    const replies = [
      ...text.matchAll(
        /```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g
      )
    ]
      .map((match) => match[1].trim())
      .filter(Boolean);

    const finalReplies =
      replies.length > 0
        ? replies
        : [text.trim()];

    /*
     * Update total generated replies.
     */
    await userRef.update({
      totalRepliesGenerated:
        admin.firestore.FieldValue.increment(
          finalReplies.length
        ),
      updatedAt: timestamp()
    });

    /*
     * Usage and cache diagnostics.
     */
    if (response.usage) {
      const usage = response.usage;

      const inputTokens =
        usage.input_tokens || 0;

      const cachedTokens =
        usage.input_tokens_details?.cached_tokens || 0;

      const cacheWriteTokens =
        usage.input_tokens_details?.cache_write_tokens || 0;

      const outputTokens =
        usage.output_tokens || 0;

      const reasoningTokens =
        usage.output_tokens_details?.reasoning_tokens || 0;

      const totalTokens =
        usage.total_tokens || 0;

      const uncachedInputTokens = Math.max(
        0,
        inputTokens - cachedTokens
      );

      /*
       * Current GPT-5.4-nano prices:
       *
       * Input:        $0.20 / 1M
       * Cached input: $0.02 / 1M
       * Output:       $1.25 / 1M
       */
      const estimatedInputCost =
        (uncachedInputTokens / 1_000_000) * 0.20;

      const estimatedCachedCost =
        (cachedTokens / 1_000_000) * 0.02;

      const estimatedOutputCost =
        (outputTokens / 1_000_000) * 1.25;

      const estimatedTotalCost =
        estimatedInputCost +
        estimatedCachedCost +
        estimatedOutputCost;

      const cacheHitPercent =
        inputTokens > 0
          ? (cachedTokens / inputTokens) * 100
          : 0;

      console.log(
        "Twit AI OpenAI Usage:",
        JSON.stringify(
          {
            model: MODEL,
            prompt_cache_key: PROMPT_CACHE_KEY,

            input_tokens: inputTokens,
            cached_tokens: cachedTokens,
            cache_write_tokens: cacheWriteTokens,
            uncached_input_tokens: uncachedInputTokens,

            output_tokens: outputTokens,
            reasoning_tokens: reasoningTokens,
            total_tokens: totalTokens,

            cache_hit_percent:
              Number(cacheHitPercent.toFixed(2)),

            estimated_input_cost_usd:
              Number(
                estimatedInputCost.toFixed(8)
              ),

            estimated_cached_input_cost_usd:
              Number(
                estimatedCachedCost.toFixed(8)
              ),

            estimated_output_cost_usd:
              Number(
                estimatedOutputCost.toFixed(8)
              ),

            estimated_total_cost_usd:
              Number(
                estimatedTotalCost.toFixed(8)
              )
          },
          null,
          2
        )
      );

      /*
       * Log cache diagnostics if available.
       */
      if (response.prompt_cache_diagnostics) {
        console.log(
          "Twit AI Prompt Cache Diagnostics:",
          JSON.stringify(
            response.prompt_cache_diagnostics,
            null,
            2
          )
        );
      }
    }

    /*
     * Keep the existing response format so your frontend
     * does not need to change.
     */
    return res.status(200).json({
      text: text.trim(),
      replies: finalReplies,
      usage: {
        freeTweetsUsed: null
      }
    });

  } catch (error) {
    console.error(
      "Generate API error:",
      error
    );

    /*
     * If we reserved a free submission and OpenAI failed,
     * give that free submission back.
     */
    if (reservationMade) {
      try {
        const snap = await userRef.get();

        if (snap.exists) {
          const data = snap.data();
          const active =
            getActiveSubscription(data);

          const rollback = {
            totalTweetsSubmitted:
              admin.firestore.FieldValue.increment(-1),
            updatedAt: timestamp()
          };

          if (!active) {
            rollback.freeTweetsUsed =
              admin.firestore.FieldValue.increment(-1);
          }

          await userRef.update(rollback);
        }

      } catch (rollbackError) {
        console.error(
          "Usage rollback failed:",
          rollbackError
        );
      }
    }

    return res.status(
      error.statusCode || 500
    ).json({
      error:
        error.message ||
        "Failed to generate replies.",
      code:
        error.code ||
        "GENERATION_ERROR"
    });
  }
}
