import OpenAI from "openai";
import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const FREE_LIMIT = 100;

const TONE_INSTRUCTIONS = {
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

const DEFAULT_TONE_KEY = "balanced";

// Rendered once into the STATIC system prompt below as a fixed reference
// table. Per-request, only the tone's NAME travels in the dynamic block
// ("TONE: casual") instead of its full instruction text — the model looks
// the name up in this table. This keeps the tone directive's actual prose
// out of the varying part of the prompt, so switching tones between callers
// no longer changes the system message's bytes at all.
const TONE_REFERENCE_TABLE = Object.entries(TONE_INSTRUCTIONS)
  .map(([key, instruction]) => `- ${key}: ${instruction}`)
  .join("\n");

// Models that accept the `reasoning` parameter on /v1/responses.
// gpt-4o / gpt-4o-mini do NOT support it and will 400 if it's sent.
// Add/remove FAMILY PREFIXES here as you switch OPENAI_MODEL. OPENAI_MODEL
// is often set to a dated snapshot string (e.g. "gpt-5.4-nano-2026-03-17"),
// which would never match a Set of bare family names, so this checks
// whether the configured model STARTS WITH one of these prefixes instead.
//
// EFFORT LEVEL: reasoning tokens are drawn from the SAME max_output_tokens
// budget as the visible reply, on the Responses API. For a task this
// simple (one short sentence, no multi-step logic), there is nothing for
// deep reasoning to buy you, and every reasoning token spent is a token
// not available for the actual reply. "low" was still enough for gpt-5-mini
// to occasionally burn through the whole 400-token budget on reasoning
// alone and return an empty output_text -- OpenAI's own forum has many
// reports of exactly this on gpt-5-mini/nano. "minimal" keeps reasoning
// close to off for the mini/nano tier, which is the right setting for a
// short, low-latency, non-analytical task like this one. o1/o3 do not
// accept "minimal" (their lowest supported level is "low"), so they keep
// their own entry.
const REASONING_MODEL_EFFORT = [
  { prefix: "gpt-5.4-nano", effort: "minimal" },
  { prefix: "gpt-5.4-mini", effort: "minimal" },
  { prefix: "gpt-5-nano", effort: "minimal" },
  { prefix: "gpt-5-mini", effort: "minimal" },
  { prefix: "o1", effort: "low" },
  { prefix: "o3", effort: "low" }
];

function getReasoningEffort(model) {
  if (!model) return null;
  const match = REASONING_MODEL_EFFORT.find(({ prefix }) =>
    model.startsWith(prefix)
  );
  return match ? match.effort : null;
}

// See the max_output_tokens comment at the call site for why reasoning
// models need a separate, larger budget than non-reasoning ones.
const BASE_OUTPUT_TOKENS = 400;
const REASONING_OUTPUT_BUFFER = 1000;
const RETRY_OUTPUT_TOKEN_INCREASE = 1500;

// A fixed label prefix for OpenAI's prompt-cache routing. All requests to
// this endpoint share the same static system prompt, so a constant prefix
// groups them together and makes it far more likely consecutive requests
// land on the same cache-holding server. Bump the suffix whenever
// STATIC_SYSTEM_PROMPT changes, so old and new prefixes don't get mixed
// under the same key.
//
// SHARDING: a single prompt_cache_key is one lane on OpenAI's side, and per
// OpenAI's own docs that lane starts dropping cache hits once combined
// traffic on it exceeds roughly 15 requests/minute -- at that point ANY
// concurrent request (regardless of its tone/format settings, regardless of
// which user sent it) can push the lane over capacity and knock later
// requests on that same key back to a cold machine. Since every request's
// system prompt is byte-identical no matter who sent it, splitting traffic
// across several keys is safe: each shard warms up independently and serves
// hits once it's seen a couple of requests, and the effective combined
// capacity becomes roughly SHARD_COUNT x 15/min instead of one shared 15/min
// ceiling for the whole app. Raise SHARD_COUNT if you're seeing this at
// higher volume; each additional shard trades a bit of hit-rate efficiency
// (more machines each holding their own warm copy) for more total headroom.
const PROMPT_CACHE_KEY_BASE = "twitai-generate-v3";
const PROMPT_CACHE_SHARD_COUNT = Number(process.env.PROMPT_CACHE_SHARD_COUNT) || 4;

function pickPromptCacheKey() {
  const shard = Math.floor(Math.random() * PROMPT_CACHE_SHARD_COUNT);
  return `${PROMPT_CACHE_KEY_BASE}-shard${shard}`;
}

// ---------------------------------------------------------------------------
// STATIC SYSTEM PROMPT
// General-purpose: reads and responds to whatever the tweet is actually
// about, not a crypto/CT default. Enforces exactly one sentence per reply.
//
// SIZE NOTE: earlier versions of this prompt ballooned to ~2050-2170 measured
// tokens (way more than needed) once several example sections were stacked
// together. This version is trimmed back down to sit around 1200-1300 total
// measured tokens together with the dynamic FORMAT/LANGUAGE/TONE block below
// (before the actual tweet text is added) — enough margin above the
// 1024-token caching floor without paying for unnecessary bulk on every
// call. If you edit this block, check the real `input_tokens` from your
// Vercel/OpenAI usage logs afterward rather than assuming from word count.
// ---------------------------------------------------------------------------
const STATIC_SYSTEM_PROMPT = `You write natural X (Twitter) replies to any tweet, on any topic.

Read the tweet fully before writing.
Identify what it is actually about: the subject, the claim, and the feeling
behind it.
Reply to that specific content, not a generic line that could sit under
almost any tweet.
Do not summarize or rewrite the post.
Do not sound like AI, a marketer, or an ambassador.
Do not assume every tweet is about crypto or trading.
Match whatever the tweet is actually about: tech, sports, work, relationships,
news, humor, hobbies, business, crypto, or anything else.

ONE SENTENCE RULE (STRICT, NO EXCEPTIONS):
- Every reply must be exactly one complete sentence.
- Never write two sentences in one reply, even short ones.
- Never separate two thoughts with a period inside the same reply.
- At most one full stop, and only at the very end, never in the middle.
- See CASING AND PUNCTUATION VARIETY below for when the ending full stop
  should be left off entirely.
- If a second thought feels needed, cut it and keep only the strongest one.

STYLE:
- Use simple, everyday English.
- Keep the wording natural and casual.
- Keep the reply easy to read.
- Give one clear thought.
- Add a small new observation when possible.
- Stay relevant to the specific post, not the general topic area.
- Use niche slang only when the tweet itself uses that world, or the tone
  calls for it.
- Do not force crypto or trading language into a non-crypto post.
- Do not invent facts.
- Do not over-explain.
- Do not sound overly polished.

CASING AND PUNCTUATION VARIETY:
- Real people typing quick replies do not always capitalize the first
  letter and do not always close with a period, so vary this across the
  set of replies instead of applying the same style to every one.
- Some replies should start with a lowercase letter instead of a capital.
- Some replies should end with no punctuation at all, no closing period.
- Do not apply lowercase starts or missing end punctuation to every reply
  in the set. Mix it in across the replies. Several replies can still look
  fully standard, capitalized and closing with a period.
- Only the first letter and the final full stop are affected by this. Every
  other capitalization rule (proper nouns, acronyms, "I") and all internal
  punctuation stay normal and correct.
- Never drop a full stop mid-word or mid-sentence, only at the very end.

STRICT SENTENCE RULES:
- Use simple sentences only, one idea per sentence.
- Keep sentences short.
- Avoid compound sentences, semicolons, colons, and parentheses.
- Avoid multiple clauses in a single sentence.
- Never use the em dash character "—".
- Avoid joining two complete thoughts with "and" or "but".
- Avoid "because", "although", "which", "that", "since", or "while" when they
  create a long or complex sentence.
- Avoid "so" when it creates a compound sentence.
- If a second thought feels necessary, drop it. Keep only one sentence.
- Never pack multiple thoughts into one sentence.

CONTENT:
- Do not simply repeat or paraphrase the main point.
- Add a fresh reaction or observation tied to what the post actually says.
- Keep replies constructive and practical.
- Keep skepticism natural when it fits, without being negative for no reason.
- Questions are allowed when they feel natural, but do not force them.

AVOID GENERIC REPLIES:
- "Great post", "Exactly", "Well said", "This is huge", "Love this",
  "So true", "Game changer", "Revolutionary", "Bullish", "LFG", or any
  generic praise without a real thought.
- Any reply that ignores what the specific tweet actually said.

VARIETY:
- Make every reply feel different: change the opening, the sentence
  structure, and the reaction style.
- Do not repeat the same idea or the same sentence pattern across replies.
- Do not start every reply with the project or person's name.
- Do not make every reply a question or every reply praise the post.
- Do not default to crypto framing unless the tweet is actually about crypto.

EXAMPLE REPLIES (different topics, each exactly one sentence):
- Good: "The gas savings only show up once batching kicks in, not on a single call."
- Good: "The numbers only make sense if retention holds past the first month."
- Good: "That splits table only works if you're recovering fully between sets."
- Good: "Moving cities alone is easier to plan than it is to actually do."
- Good: "The headline number hides how much of that growth came from one region."
- Good: "The chart looks like it took a wrong turn at the gym."
- Good (lowercase start, no closing period): "the gas savings only show up once batching kicks in"
- Good (lowercase start, no closing period): "that splits table only works if you're recovering fully between sets"
- Bad: "This is so amazing, huge congrats, love seeing this happen."
- Bad: "Great post, totally agree, this is exactly right honestly."
- Bad: "This yield is insane, definitely aping in, LFG to the moon."
- Bad: "Massively bullish, this is going parabolic soon, get in now."

Notice the pattern: bad replies lean on generic praise or hype and could sit
under almost any tweet. Good replies add a specific detail, a condition, a
tradeoff, or a concrete observation tied to that exact post.

COMMON MISTAKES TO AVOID:
- Do not open every reply with an exclamation.
- Do not use vague enthusiasm as a substitute for a real reaction.
- Do not write a reply that could apply to almost any post on the topic.
- Do not write more than one sentence, ever, for any reply.

FINAL CHECK:
Before answering, confirm each reply is exactly one sentence, follows the
CASING AND PUNCTUATION VARIETY rules, and responds to what this specific
tweet actually said.
Remove any second sentence, unnecessary words, or complex structure.
Make the replies sound like a real person, not a bot.
Never use the em dash character "—".

TONE REFERENCE TABLE:
Each request's dynamic block below will name one tone by key. Look up its
instruction here and apply it. If the named key is not in this table, fall
back to "balanced".
${TONE_REFERENCE_TABLE}`;

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
    return res.status(405).json({ error: "Method not allowed." });
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
      return res.status(400).json({ error: "Tweet text is required." });
    }

    // Atomically reserve one tweet submission.
    // This prevents two concurrent requests from bypassing the 100-tweet limit.
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);

      if (!snap.exists) {
        throw Object.assign(new Error("User profile not found."), {
          statusCode: 403,
          code: "USER_PROFILE_NOT_FOUND"
        });
      }

      const data = snap.data();
      const active = getActiveSubscription(data);

      if (!active && (data.freeTweetsUsed || 0) >= FREE_LIMIT) {
        throw Object.assign(
          new Error("Your 100 free tweet submissions are finished. Please subscribe to continue."),
          {
            statusCode: 403,
            code: "FREE_LIMIT_REACHED"
          }
        );
      }

      const updates = {
        totalTweetsSubmitted: admin.firestore.FieldValue.increment(1),
        updatedAt: timestamp()
      };

      if (!active) {
        updates.freeTweetsUsed = admin.firestore.FieldValue.increment(1);
      }

      transaction.update(userRef, updates);
    });

    reservationMade = true;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Resolve to a known tone key (falls back to the default) so we only
    // ever send a short NAME across the wire, never the tone's full
    // instruction text — that text already lives in the static system
    // prompt's TONE REFERENCE TABLE, so the model looks it up there instead.
    const toneKey = Object.prototype.hasOwnProperty.call(TONE_INSTRUCTIONS, tone)
      ? tone
      : DEFAULT_TONE_KEY;

    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply. Only use it when relevant.`
      : "Do not force mentions or tags.";

    const langDirective =
      language === "auto"
        ? "Reply in the post's language. Use English if the language is unclear."
        : `Write strictly in ${language}.`;

    const styleSeed = Math.random().toString(36).slice(2, 10);

    const personas = [
      "a casual reader",
      "a thoughtful reader",
      "a curious community member",
      "a busy user replying quickly",
      "a practical observer",
      "someone familiar with the topic"
    ];

    const persona = personas[Math.floor(Math.random() * personas.length)];

    // ---------------------------------------------------------------------
    // CACHING: the system prompt is ALWAYS exactly STATIC_SYSTEM_PROMPT,
    // byte-for-byte, on every request — no per-request values are appended
    // to it. Every setting that can differ between callers (tone, reply
    // count, word counts, language, tag) instead travels in the trailing
    // user message below.
    //
    // This matters most on gpt-5.4-nano: OpenAI has confirmed nano needs a
    // longer identical prefix than other models in this family before a
    // cache hit registers at all, and a shared prefix that changes bytes
    // whenever one caller picks a different tone or reply count never gets
    // the chance to build up hits across callers in the first place. Moving
    // all variability after the fixed prefix, and keeping that fixed prefix
    // as large as possible (see the TONE REFERENCE TABLE folded into
    // STATIC_SYSTEM_PROMPT above), is the most this app can do — nano's
    // actual cache threshold isn't publicly documented, so treat this as
    // "maximizes the odds," not "guarantees a hit." Watch real
    // response.usage.input_tokens_details.cached_tokens values in your logs
    // to see whether it's landing; if it still doesn't, gpt-5.4-mini is the
    // model OpenAI itself points to for workloads that depend on caching.
    // ---------------------------------------------------------------------
    const systemPrompt = STATIC_SYSTEM_PROMPT;

    const dynamicInstructions = `FORMAT:
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
${toneKey}

MENTION RULE:
${tagDirective}`;

    const userMessage = `${dynamicInstructions}

TWEET:
${tweet.trim()}
Write the replies now.
Understand what this tweet is actually about before replying.
Reply to its real content and topic, whatever that topic is.
Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed.
Never mention the voice hint.`;

    const model = process.env.OPENAI_MODEL;
    const reasoningEffort = getReasoningEffort(model);
    // Extra headroom given to reasoning-capable models only, on top of
    // BASE_OUTPUT_TOKENS, so reasoning tokens have room to spend without
    // starving the visible reply. Non-reasoning models (gpt-4o-mini) get
    // none of this since they never produce reasoning tokens in the first
    // place -- their whole budget is BASE_OUTPUT_TOKENS.
    const reasoningOutputBuffer = reasoningEffort ? REASONING_OUTPUT_BUFFER : 0;

    const requestPayload = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      // BASE_OUTPUT_TOKENS covers the actual visible reply text for a
      // non-reasoning model (gpt-4o-mini and similar), where every token in
      // the budget goes toward the reply. Reasoning-capable models (gpt-5
      // family, o1/o3) draw their internal reasoning tokens from this SAME
      // budget before writing any visible text, so they get extra headroom
      // added below. Without it, the model can spend the whole budget on
      // reasoning and return an empty output_text -- this is a documented,
      // model-specific failure mode, not something that happens on
      // gpt-4o-mini, which is why this app "fully works" there and fails
      // intermittently on gpt-5-mini.
      max_output_tokens: BASE_OUTPUT_TOKENS + reasoningOutputBuffer,
      // Routing hint: spreads /api/generate requests across a small pool of
      // cache keys (see PROMPT_CACHE_SHARD_COUNT above) instead of one
      // fixed key, so a burst of concurrent requests from different users
      // doesn't all compete for the same 15-req/min cache lane and knock
      // each other back to a cold machine.
      prompt_cache_key: pickPromptCacheKey(),
      // Keeps the cached prefix alive for up to 24h of inactivity instead of
      // the default 5-10 minute in-memory window, so gaps between users
      // don't reset the cache. If your OpenAI org/model doesn't support this
      // field yet, remove this line — it's safe to omit if unsupported.
      prompt_cache_retention: "24h"
    };

    // Only attach `reasoning` for models that actually support it.
    // gpt-4o / gpt-4o-mini reject the request with a 400 if it's present.
    if (reasoningEffort) {
      requestPayload.reasoning = { effort: reasoningEffort };
    }

    let response = await openai.responses.create(requestPayload);
    let text = response.output_text || "";

    // A reasoning model can still burn its entire budget on internal
    // reasoning tokens and return no visible message at all (status
    // "incomplete", incomplete_details.reason "max_output_tokens", output
    // containing only a "reasoning" item). One retry with a much larger
    // budget resolves the large majority of these without failing the
    // user's request outright; if it still comes back empty, fall through
    // to the existing empty-response error below.
    const wasTruncatedByBudget =
      response.status === "incomplete" &&
      response.incomplete_details &&
      response.incomplete_details.reason === "max_output_tokens";

    if (!text.trim() && reasoningEffort && wasTruncatedByBudget) {
      console.warn(
        "Empty output_text on first attempt (reasoning exhausted budget), retrying with a larger max_output_tokens.",
        { model, firstAttemptBudget: requestPayload.max_output_tokens }
      );

      const retryPayload = {
        ...requestPayload,
        max_output_tokens: requestPayload.max_output_tokens + RETRY_OUTPUT_TOKEN_INCREASE
      };

      response = await openai.responses.create(retryPayload);
      text = response.output_text || "";
    }

    if (!text.trim()) {
      throw new Error("OpenAI returned an empty response.");
    }

    const replies = [
      ...text.matchAll(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g)
    ]
      .map((match) => match[1].trim())
      .filter(Boolean);

    const finalReplies = replies.length > 0 ? replies : [text.trim()];

    await userRef.update({
      totalRepliesGenerated: admin.firestore.FieldValue.increment(finalReplies.length),
      updatedAt: timestamp()
    });

    if (response.usage) {
      console.log("Usage:", JSON.stringify(response.usage));
    }

    return res.status(200).json({
      text: text.trim(),
      replies: finalReplies,
      usage: {
        freeTweetsUsed: null
      }
    });
  } catch (error) {
    console.error("Generate API error:", error);

    // If we reserved a free submission and OpenAI failed,
    // give that free submission back.
    if (reservationMade) {
      try {
        const snap = await userRef.get();
        if (snap.exists) {
          const data = snap.data();
          const active = getActiveSubscription(data);

          const rollback = {
            totalTweetsSubmitted: admin.firestore.FieldValue.increment(-1),
            updatedAt: timestamp()
          };

          if (!active) {
            rollback.freeTweetsUsed = admin.firestore.FieldValue.increment(-1);
          }

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
