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
  "gpt-5.6-luna",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5-nano",
  "gpt-5-mini",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini"
]);

// A fixed label for OpenAI's prompt-cache routing. All requests to this
// endpoint share the same static system prompt, so using one constant key
// groups them together and makes it far more likely consecutive requests
// land on the same cache-holding server. Bump the suffix whenever
// STATIC_SYSTEM_PROMPT changes, so old and new prefixes don't get mixed
// under the same key.
const PROMPT_CACHE_KEY = "twitai-generate-v3";

const TIME_ZONE = "Asia/Dhaka";

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
- One full stop at the end, and nowhere else.
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
- Do not use below items as Subject of a sentence= I, You, We, The+Sub, This, that, Those, Which.
- Do not use this word in the sentence starting- The, Curious, Good, Wonder, Hope, Looks, Sounds, Seems, If, it, It's, Hoping,

CONTENT:
- Do not simply repeat or paraphrase the main point.
- Add a fresh reaction or observation tied to what the post actually says.
- Keep replies constructive and practical.
- Keep skepticism natural when it fits, without being negative for no reason.
- Questions are allowed when they feel natural, but do not force them.


QUESTION REPLY RULE:
- Include a natural question in some replies when the tweet genuinely invites discussion, but never force a question into every reply.
- Keep questions specific to the tweet and ask something the author could realistically answer.

AVOID GENERIC REPLIES:
- "Great post", "Exactly", "Well said", "This is huge", "Love this",
  "So true", "Game changer", "Revolutionary", "Bullish", "LFG", or any
  generic praise without a real thought.
- Any reply that ignores what the specific tweet actually said.

NEGATIVE INSTRUCTIONS:


NEGATIVE SENTENCE-OPENING RULES:
- Never start a sentence with "I", "You", "We", "The", "This", "That", "Those", or "Which".
- Never start a sentence with "Curious", "Good", "Wonder", "Hope", "Looks", "Sounds", "Seems", "If", "It", "It's", or "Hoping".
- Never start a sentence with "Interesting", "Honestly", "Actually", "Definitely", "Absolutely", "Exactly", "Agreed", "True", "Right", "Nice", "Great", "Amazing", "Impressive", "Solid", "Important", "Clear", "Notably", "Basically", "Personally", "Apparently", or "Obviously".
- Never start a sentence with "Here", "There", "Now", "Today", "So", "But", "And", "Also", "Still", "Yet", or "Meanwhile".
- Never start a sentence with "One", "Another", "Something", "Someone", "Anyone", "Everyone", or "Everything".
- Never start a sentence with "What", "Why", "How", "When", or "Where" unless the entire reply is a natural question.
- Never start with generic agreement such as "Exactly", "Absolutely", "100%", "Couldn't agree more", or "Well said".
- Never start with generic praise such as "Great", "Amazing", "Impressive", "Love", "Nice", "Strong", or "Fantastic".
- Never start with filler phrases such as "Honestly", "To be fair", "In my opinion", "At the end of the day", "For sure", "In general", or "From my perspective".
- Never start with a reaction word followed by a comma, such as "Interesting,", "Exactly,", "Honestly,", or "Agreed,".
- Never start by restating the subject, project name, person's name, or main topic unless doing so is necessary for clarity.
- Never start with a generic observation that could apply to many unrelated tweets.
- Never use "This is..." or "That is..." as a sentence opening.
- Never use "It's..." or "It is..." as a sentence opening.
- Never use "There is..." or "There are..." as a sentence opening.
- Never use "The fact that..." as a sentence opening.
- Never use "The way..." as a sentence opening.
- Never use "What stands out..." as a sentence opening.
- Never use "What I like..." as a sentence opening.
- Never use "What matters..." as a sentence opening.
- Never use "One thing..." as a sentence opening.
- Never use "A lot of..." as a sentence opening.
- Never use "A good..." as a sentence opening.
- Never use "It would..." or "It could..." as a sentence opening.
- Never use "Would love..." or "Would be interesting..." as a sentence opening.
- Never use "Feels like..." or "Seems like..." as a sentence opening.
- Never use "Makes sense..." as a sentence opening.
- Never use "Worth noting..." as a sentence opening.
- Never use "Worth watching..." as a sentence opening.
- Never use "Hard to..." as a sentence opening.
- Never use "Easy to..." as a sentence opening.
- Never use "Great to see..." as a sentence opening.
- Never use "Love seeing..." as a sentence opening.
- Never use "Nice to see..." as a sentence opening.
- Never use "Glad to see..." as a sentence opening.
- Never use "Excited to see..." as a sentence opening.
- Never use "Can't wait..." as a sentence opening.

ANTI-AI LANGUAGE RULES:
- Do not use "This highlights..."
- Do not use "This shows..."
- Do not use "This demonstrates..."
- Do not use "This reinforces..."
- Do not use "This reflects..."
- Do not use "This is a reminder..."
- Do not use "This is exactly why..."
- Do not use "That really highlights..."
- Do not use "It really shows..."
- Do not use "One thing that stands out..."
- Do not use "What stands out to me..."
- Do not use "What makes this interesting..."
- Do not use "The interesting part..."
- Do not use "The bigger picture..."
- Do not use "The key takeaway..."
- Do not use "The real value..."
- Do not use "The main thing..."
- Do not use "At its core..."
- Do not use "In a world where..."
- Do not use "More importantly..."
- Do not use "Ultimately..."
- Do not use "Moving forward..."
- Do not use "Going forward..."
- Do not use "Time will tell..."
- Do not use "Only time will tell..."
- Do not use "It will be interesting to see..."
- Do not use "Exciting times ahead..."
- Do not use "Big things ahead..."
- Do not use "The future looks..."
- Do not use "Could be a game changer..."
- Do not use "This could be huge..."
- Do not use "This might be the beginning..."
- Avoid corporate, promotional, motivational, and LinkedIn-style language.
- Avoid phrases that sound like commentary generated from a template.


OPENING VARIETY:
- Prefer starting with a concrete noun, specific detail, action, metric, condition, contrast, or observation from the tweet.
- Start with the most specific part of the tweet rather than a generic reaction.
- Avoid repeating the same sentence-opening structure across replies.
- Do not force unusual sentence openings just to satisfy the rule.
- A natural specific opening is more important than artificial variation.




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
Before answering, confirm each reply is exactly one sentence with one full
stop, and that it responds to what this specific tweet actually said.
Remove any second sentence, unnecessary words, or complex structure.
Make the replies sound like a real person, not a bot.
Never use the em dash character "—".`;

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

function getDhakaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function getUsageMetrics(response) {
  const usage = response?.usage || {};

  const inputTokens = Number(
    usage.input_tokens || 0
  );

  const outputTokens = Number(
    usage.output_tokens || 0
  );

  const totalTokens = Number(
    usage.total_tokens ||
    (inputTokens + outputTokens)
  );

  const cachedInputTokens = Number(
    usage.input_tokens_details?.cached_tokens ??
    usage.inputTokensDetails?.cachedTokens ??
    0
  );

  const actualInputTokens = Math.max(
    0,
    inputTokens - cachedInputTokens
  );

  return {
    inputTokens,
    cachedInputTokens,
    actualInputTokens,
    outputTokens,
    totalTokens
  };
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
    return res.status(
      error.statusCode || 401
    ).json({
      error:
        error.message ||
        "Authentication failed.",

      code:
        error.code ||
        "AUTH_ERROR"
    });
  }

  const db = getDb();
  const admin = getFirebaseAdmin();

  const userRef = db
    .collection("users")
    .doc(decoded.uid);

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
    // This prevents two concurrent requests from bypassing the 100-tweet limit.
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

      transaction.update(
        userRef,
        updates
      );
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
      Math.random()
        .toString(36)
        .slice(2, 10);

    const personas = [
      "a casual reader",
      "a thoughtful reader",
      "a curious community member",
      "a busy user replying quickly",
      "a practical observer",
      "someone familiar with the topic"
    ];

    const persona =
      personas[
        Math.floor(
          Math.random() * personas.length
        )
      ];

    // ---------------------------------------------------------------------
    // Everything that varies per-request is appended AFTER the static block,
    // never interleaved with it, so the long static prefix stays
    // byte-identical across calls and remains cacheable.
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
      STATIC_SYSTEM_PROMPT +
      dynamicInstructions;

    const userMessage = `${tweet.trim()}
Write the replies now.
Understand what this tweet is actually about before replying.
Reply to its real content and topic, whatever that topic is.
Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed.
Never mention the voice hint.`;

    const model =
      process.env.OPENAI_MODEL;

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

      max_output_tokens: 1000,

      // Routing hint: groups all /api/generate requests under one cache key
      // so they're more likely to hit the same server that already holds
      // the cached static prefix, instead of landing on a fresh machine.
      prompt_cache_key:
        PROMPT_CACHE_KEY,

      // Keeps the cached prefix alive for up to 24h of inactivity instead of
      // the default 5-10 minute in-memory window, so gaps between users
      // don't reset the cache. If your OpenAI org/model doesn't support this
      // field yet, remove this line — it's safe to omit if unsupported.
      prompt_cache_retention: "24h"
    };

    // Only attach `reasoning` for models that actually support it.
    // gpt-4o / gpt-4o-mini reject the request with a 400 if it's present.
    if (REASONING_MODELS.has(model)) {
      requestPayload.reasoning = {
        effort: "low"
      };
    }

    const response =
      await openai.responses.create(
        requestPayload
      );

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
      .map((match) =>
        match[1].trim()
      )
      .filter(Boolean);

    const finalReplies =
      replies.length > 0
        ? replies
        : [text.trim()];

    // ---------------------------------------------------------------
    // USAGE ANALYTICS
    // ---------------------------------------------------------------

    const usage =
      getUsageMetrics(response);

    const date =
      getDhakaDate();

    // Daily aggregate:
    //
    // usageDaily/{uid}_{YYYY-MM-DD}
    //
    // Only lightweight daily statistics are stored.
    // No tweet text and no generated replies are stored.
    const dailyRef = db
      .collection("usageDaily")
      .doc(
        `${decoded.uid}_${date}`
      );

    const batch =
      db.batch();

    // Update existing user totals.
    batch.update(userRef, {
      totalRepliesGenerated:
        admin.firestore.FieldValue.increment(
          finalReplies.length
        ),

      updatedAt: timestamp()
    });

    // ---------------------------------------------------------------
    // DAILY AGGREGATE
    // ---------------------------------------------------------------

    batch.set(
      dailyRef,
      {
        uid: decoded.uid,

        email:
          decoded.email || "",

        date,

        // Tweet/generation count.
        tweets:
          admin.firestore.FieldValue.increment(1),

        // Number of generated replies.
        replies:
          admin.firestore.FieldValue.increment(
            finalReplies.length
          ),

        // Number of generation requests.
        requestCount:
          admin.firestore.FieldValue.increment(1),

        // OpenAI token statistics.
        inputTokens:
          admin.firestore.FieldValue.increment(
            usage.inputTokens
          ),

        cachedInputTokens:
          admin.firestore.FieldValue.increment(
            usage.cachedInputTokens
          ),

        actualInputTokens:
          admin.firestore.FieldValue.increment(
            usage.actualInputTokens
          ),

        outputTokens:
          admin.firestore.FieldValue.increment(
            usage.outputTokens
          ),

        totalTokens:
          admin.firestore.FieldValue.increment(
            usage.totalTokens
          ),

        updatedAt:
          timestamp()
      },
      {
        merge: true
      }
    );

    // Commit user totals + daily analytics together.
    await batch.commit();

    console.log(
      "Twit AI usage:",
      JSON.stringify({
        uid: decoded.uid,
        date,
        tweets: 1,
        replies: finalReplies.length,
        ...usage
      })
    );

    // ---------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------

    return res.status(200).json({
      text: text.trim(),

      replies: finalReplies,

      usage: {
        tweets: 1,

        replies:
          finalReplies.length,

        date,

        inputTokens:
          usage.inputTokens,

        cachedInputTokens:
          usage.cachedInputTokens,

        actualInputTokens:
          usage.actualInputTokens,

        outputTokens:
          usage.outputTokens,

        totalTokens:
          usage.totalTokens
      }
    });

  } catch (error) {
    console.error(
      "Generate API error:",
      error
    );

    // If we reserved a free submission and OpenAI failed,
    // give that free submission back.
    if (reservationMade) {
      try {
        const snap =
          await userRef.get();

        if (snap.exists) {
          const data =
            snap.data();

          const active =
            getActiveSubscription(data);

          const rollback = {
            totalTweetsSubmitted:
              admin.firestore.FieldValue.increment(-1),

            updatedAt:
              timestamp()
          };

          if (!active) {
            rollback.freeTweetsUsed =
              admin.firestore.FieldValue.increment(-1);
          }

          await userRef.update(
            rollback
          );
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
