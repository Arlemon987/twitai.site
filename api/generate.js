import OpenAI from "openai";
import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const FREE_LIMIT = 100;

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

// Models that accept the `reasoning` parameter on /v1/responses.
// gpt-4o / gpt-4o-mini do NOT support it and will 400 if it's sent.
// Add/remove entries here as you switch OPENAI_MODEL.
const REASONING_MODELS = new Set([
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5-nano",
  "gpt-5-mini",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini"
]);

// Models that support EXTENDED (24h) prompt cache retention. gpt-4o /
// gpt-4o-mini and most other models only support the default "in_memory"
// policy (5-10 min). Sending prompt_cache_retention: "24h" to a model that
// doesn't support it does not reliably error - it can silently prevent
// caching from engaging at all (cache_write_tokens stays 0 on every call).
// So this field is only attached when the model is actually on this list;
// otherwise it's omitted entirely and the model just uses its default
// in-memory caching automatically, no parameter needed.
const EXTENDED_CACHE_RETENTION_MODELS = new Set([
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-chat-latest",
  "gpt-5",
  "gpt-5-codex",
  "gpt-4.1"
]);

// A fixed label for OpenAI's prompt-cache routing.
// Bump the suffix whenever STATIC_SYSTEM_PROMPT changes.
const PROMPT_CACHE_KEY = "twitai-generate-v5";

// ---------------------------------------------------------------------------
// STATIC SYSTEM PROMPT
// General-purpose X reply writer.
//
// Keep this block between roughly 1200 and 1500 tokens. If you edit it,
// verify the real `input_tokens` from your usage logs afterward rather than
// estimating from word count.
// ---------------------------------------------------------------------------
const STATIC_SYSTEM_PROMPT = `You write natural X (Twitter) replies to any tweet, on any topic.

Read the tweet fully before writing.
Identify the subject, main claim, key detail, question, and tone.
Understand what the tweet is actually trying to communicate.
Reply to that specific content, not a generic version of the topic.
Do not summarize, rewrite, or restate the tweet.
Do not sound like AI, a marketer, an ambassador, or a promotion account.
Do not assume the tweet is about crypto, trading, or Web3.
Match the actual topic: tech, sports, work, relationships, news, humor,
hobbies, business, crypto, finance, culture, or anything else.

ONE SENTENCE RULE:
- Every reply is exactly one complete sentence, with exactly one full stop
  at the end and nowhere else.
- Never write two sentences in one reply.
- If a second thought feels needed, cut it and keep only the strongest one.
- Keep the sentence short enough to feel natural as a quick reply on X.

STYLE:
- Use simple, everyday, natural, casual, conversational English.
- Give one clear thought per reply: an observation, connection, implication,
  condition, or follow-up.
- Stay tightly connected to the specific tweet.
- Use niche slang only when it naturally fits the tweet; never force crypto
  language into a non-crypto post.
- Do not invent facts, numbers, or claims.
- Do not sound overly polished, corporate, scripted, or promotional.
- Avoid dramatic wording and filler adjectives.
- Write like something a real person would quickly type as a reply.

CONVERSATIONAL, NOT PERSONAL:
- Replies are conversational contributions, not personal opinions or
  experiences.
- Never write from the writer's own perspective or claim personal experience,
  belief, feeling, or preference.
- Never use "I think", "I believe", "I feel", "I like", "I'd say",
  "personally", "for me", "my", or "mine".
- Do not address or advise the poster directly ("you should...").
- Build every reply only from the tweet's own subject, claim, detail, or
  question.
- A reply can note a detail, ask a relevant question, or point out a
  tradeoff or implication, without approving, disapproving, or advising.
- Do not write generic agreement or disagreement just because the tweet
  sounds positive or negative.
- Do not pretend to have personal knowledge of, or experience with, whatever
  the tweet mentions.

BANNED OPENINGS:
- Never start a reply with "I", "You", "This", "That", "The", or "We", in
  any capitalization, contraction (e.g. "I'm", "You've"), or
  punctuation/emoji/quote-prefixed form.
- This applies to any phrase that functionally means the same thing, even if
  worded differently.
- Before finalizing, check the literal first word of each reply. Rewrite
  completely with a different natural opening if it violates this rule -
  do not just insert filler in front of the banned word.
- Do not overuse the same opening word, structure, or project/person name
  across the set of replies either.
- A reply may naturally open with a relevant noun, number, detail, time
  reference, or condition instead.

CONTENT:
- Do not repeat or paraphrase the tweet's main point.
- Add a fresh thought tied to a specific detail: an implication, contrast,
  condition, or relevant connection.
- If the tweet asks a question, engage with its context.
- If it tells a story or makes an announcement, respond to a specific detail
  rather than generic congratulations.
- If it states an opinion, engage with the underlying subject without
  turning your reply into your own opinion.
- If it is humorous, light conversational humor is fine when it fits.
- If it is emotional, acknowledge the situation through its context without
  claiming to personally share the emotion.

AVOID GENERIC REPLIES:
- Avoid "Great post", "Exactly", "Well said", "This is huge", "Love this",
  "So true", "Game changer", "Bullish", "LFG", or any generic praise,
  agreement, or congratulations that could fit almost any tweet.
- Avoid a reply that could be copied under a completely different tweet.

VARIETY:
- Make each of the replies feel different: vary opening, sentence pattern,
  and the type of contribution (observation, question, tradeoff, contrast).
- Do not make every reply a question, or every reply skeptical, or every
  reply praise the post.
- Do not default to crypto framing unless the tweet is actually about
  crypto.

SENTENCE STRUCTURE:
- Keep sentences simple and short: one idea, no compound clauses.
- Avoid semicolons, colons, parentheses, and the em dash character.
- Avoid "and"/"but"/"because"/"although"/"which"/"that"/"since"/"while"/"so"
  when they'd create a compound or complex sentence.

EXAMPLES (each exactly one sentence, no personal framing, no banned opening):
- Good: "Gas savings only show up once batching kicks in, not on a single call."
- Good: "Recovery between sets makes that training split more interesting."
- Good: "Moving cities alone is easier to plan than it is to actually do."
- Good: "Headline growth looks different once regional concentration shows up."
- Good: "Lower fees matter most when transaction volume stays consistent."
- Good: "Better retention data would make the launch numbers easier to judge."
- Bad: "This is so amazing, huge congrats, love seeing this happen."
- Bad: "I think this is a massive opportunity and I love the direction."
- Bad: "You should definitely try this approach because it looks much better."
- Bad: "That is huge and this could completely change everything."

FINAL CHECK:
- Confirm each reply is exactly one sentence with one full stop.
- Confirm the first word is not a banned opening in any form.
- Confirm no reply expresses a personal opinion, experience, or preference,
  or gives direct advice to the poster.
- Confirm the reply responds to this specific tweet's content and doesn't
  just paraphrase it or fit any generic tweet on the topic.
- Confirm the five replies vary in opening and angle.
- Rewrite any reply that fails a rule before returning final output.`;

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
      return res.status(400).json({
        error: "Tweet text is required."
      });
    }

    // Atomically reserve one tweet submission.
    // This prevents concurrent requests from bypassing the 100-tweet limit.
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

      if (!active && (data.freeTweetsUsed || 0) >= FREE_LIMIT) {
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

    const styleSeed =
      Math.random().toString(36).slice(2, 10);

    const personas = [
      "a casual reader",
      "a thoughtful reader",
      "a curious community member",
      "a busy user replying quickly",
      "a practical observer",
      "someone familiar with the topic"
    ];

    const persona =
      personas[Math.floor(Math.random() * personas.length)];

    // ---------------------------------------------------------------------
    // Everything that varies per request is appended AFTER the static block.
    // The static prefix therefore remains byte-identical and cacheable.
    // ---------------------------------------------------------------------
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

    const systemPrompt =
      STATIC_SYSTEM_PROMPT + dynamicInstructions;

    const userMessage = `${tweet.trim()}
Write the replies now.
Understand what this tweet is actually about before replying.
Reply to its real content and topic, whatever that topic is.
Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed.
Never mention the voice hint.`;

    const model = process.env.OPENAI_MODEL;

    const requestPayload = {
      model,
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

      // Groups requests under one cache key so consecutive requests
      // are more likely to use the same cached static prefix.
      prompt_cache_key: PROMPT_CACHE_KEY
    };

    // Only attach prompt_cache_retention for models that support the
    // extended 24h policy. Everything else (including gpt-4o-mini) uses the
    // default in_memory caching automatically - no field needed, and
    // sending "24h" to an unsupported model can silently break caching
    // instead of cleanly erroring.
    if (EXTENDED_CACHE_RETENTION_MODELS.has(model)) {
      requestPayload.prompt_cache_retention = "24h";
    }

    // Only attach reasoning for models that support it.
    // gpt-4o and gpt-4o-mini reject this parameter.
    if (REASONING_MODELS.has(model)) {
      requestPayload.reasoning = {
        effort: "low"
      };
    }

    const response =
      await openai.responses.create(requestPayload);

    const text =
      response.output_text || "";

    if (!text.trim()) {
      throw new Error(
        "OpenAI returned an empty response."
      );
    }

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

    await userRef.update({
      totalRepliesGenerated:
        admin.firestore.FieldValue.increment(
          finalReplies.length
        ),
      updatedAt: timestamp()
    });

    if (response.usage) {
      console.log(
        "Usage:",
        JSON.stringify(response.usage)
      );
    }

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

    // If the free submission was reserved and OpenAI failed,
    // return that submission to the user.
    if (reservationMade) {
      try {
        const snap =
          await userRef.get();

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
