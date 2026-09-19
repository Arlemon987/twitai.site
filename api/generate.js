import OpenAI from "openai";
import { getDb, getFirebaseAdmin, requireUser, timestamp } from "./_firebase.js";

const FREE_LIMIT = 100;

/*
|--------------------------------------------------------------------------
| OPENAI CLIENT (SINGLETON)
|--------------------------------------------------------------------------
| Instantiating outside the handler allows connection reuse across
| warm serverless invocations.
*/
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/*
|--------------------------------------------------------------------------
| TONES
|--------------------------------------------------------------------------
*/
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

const TONE_REFERENCE_TABLE = Object.entries(TONE_INSTRUCTIONS)
  .map(([key, instruction]) => `- ${key}: ${instruction}`)
  .join("\n");

/*
|--------------------------------------------------------------------------
| REASONING MODEL SETTINGS
|--------------------------------------------------------------------------
*/
const REASONING_MODEL_EFFORT = [
  { prefix: "gpt-5.6", effort: "minimal" },
  { prefix: "gpt-5.4-nano", effort: "minimal" },
  { prefix: "gpt-5.4-mini", effort: "minimal" },
  { prefix: "gpt-5-nano", effort: "minimal" },
  { prefix: "gpt-5-mini", effort: "minimal" },
  { prefix: "o1", effort: "low" },
  { prefix: "o3", effort: "low" }
];

function getReasoningEffort(model) {
  if (!model) return null;
  const match = REASONING_MODEL_EFFORT.find(({ prefix }) => model.startsWith(prefix));
  return match ? match.effort : null;
}

/*
|--------------------------------------------------------------------------
| OUTPUT TOKEN BUDGET
|--------------------------------------------------------------------------
*/
const BASE_OUTPUT_TOKENS = 400;
const REASONING_OUTPUT_BUFFER = 800;
const RETRY_OUTPUT_TOKEN_INCREASE = 1200;

/*
|--------------------------------------------------------------------------
| TIMESTAMP HELPER
|--------------------------------------------------------------------------
*/
function timestampToDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value === "object" && value._seconds !== undefined) {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
  }

  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
|--------------------------------------------------------------------------
| SUBSCRIPTION
|--------------------------------------------------------------------------
*/
function getActiveSubscription(data) {
  const expiry = timestampToDate(data.subscriptionExpiry);
  return data.subscriptionStatus === "active" && expiry && expiry.getTime() > Date.now();
}

/*
|--------------------------------------------------------------------------
| STATIC SYSTEM PROMPT (GUARANTEED CACHE PREFIX >= 1024 TOKENS)
|--------------------------------------------------------------------------
*/
const STATIC_SYSTEM_PROMPT = `You write natural X (Twitter) replies to any tweet, on any topic.

Read the tweet fully before writing.

Identify what it is actually about:
- the subject
- the claim
- the context
- the feeling behind it

Reply to that specific content.

Do not write a generic reply that could sit under almost any tweet.
Do not summarize the tweet.
Do not rewrite the tweet.
Do not simply paraphrase the tweet.
Do not sound like AI.
Do not sound like a marketer.
Do not sound like an ambassador.
Do not sound corporate.
Do not assume every tweet is about crypto.

Match the actual topic of the tweet.
The topic may be:
- technology
- crypto
- finance
- trading
- sports
- work
- relationships
- news
- humor
- hobbies
- business
- science
- education
- gaming
- lifestyle
- or anything else

Always respond to the actual tweet topic.

ONE SENTENCE RULE:
Every reply must be exactly ONE complete sentence.
Never write two sentences in one reply.
Never put a period in the middle of a reply.
Use at most one full stop and only at the end.
A reply may also end without punctuation.
If a second thought feels necessary, remove it.
Keep one clear thought per reply.

STYLE:
Use simple everyday English.
Keep the wording natural.
Keep the reply easy to read.
Sound like a real person replying quickly on X.
Use one clear thought.
Add a small fresh observation when possible.
Stay relevant to the exact tweet.
Do not force crypto terminology into a non-crypto tweet.
Do not invent facts.
Do not make unsupported claims.
Do not over-explain.
Do not sound overly polished.
Do not use unnecessary technical language.
Do not use corporate language.

CASING AND PUNCTUATION VARIETY:
Natural X replies do not all look identical.
Vary the opening style across replies.
Some replies may start with lowercase.
Some replies may start with normal capitalization.
Some replies may end without punctuation.
Some replies may end with a period.
Do not make every reply lowercase.
Do not make every reply missing punctuation.
Proper nouns must still be capitalized correctly.
Acronyms must remain correct.
The word I must remain capitalized.
Only the first letter and final punctuation may vary.
Do not intentionally break normal punctuation anywhere else.

STRICT SENTENCE RULES:
Use simple sentences.
Keep sentences short.
Avoid compound sentences.
Avoid semicolons.
Avoid colons.
Avoid parentheses.
Never use the em dash character.
Avoid joining two complete thoughts with and.
Avoid joining two complete thoughts with but.
Avoid because when it creates a long sentence.
Avoid although when it creates a long sentence.
Avoid which when it creates a long sentence.
Avoid that when it creates a long sentence.
Avoid since when it creates a long sentence.
Avoid while when it creates a long sentence.
Avoid so when it creates a compound sentence.
If a second thought appears necessary, remove it.
Never pack multiple ideas into one sentence.

CONTENT:
Do not simply repeat the main point.
Add a fresh reaction.
Add a useful observation.
Add a specific detail when possible.
Keep replies constructive.
Keep skepticism natural when appropriate.
Do not manufacture negativity.
Questions are allowed when they feel natural.
Do not force questions.
Do not use questions for every reply.

AVOID GENERIC REPLIES:
Never use generic praise without a real thought.
Avoid phrases such as:
- Great post.
- Exactly.
- Well said.
- This is huge.
- Love this.
- So true.
- Game changer.
- Revolutionary.
- Bullish.
- LFG.
- This is amazing.
- Huge.
- Massive.
- Amazing work.

Any reply that could apply to almost any tweet is weak.
Make the reply specific to the actual post.

VARIETY:
Make every reply feel different.
Change the opening.
Change the reaction style.
Change the sentence structure.
Change the observation.
Do not repeat the same idea.
Do not repeat the same sentence pattern.
Do not start every reply with the project name.
Do not start every reply with the person's name.
Do not make every reply a question.
Do not make every reply praise the post.
Do not default to crypto framing.
Do not use identical wording across the replies.

LANGUAGE:
When instructed to reply in a specific language, follow that language.
When language is set to auto, identify the language of the original tweet.
Reply in the same language when clear.
Use English when the tweet language is unclear.
If the tweet is Vietnamese, reply naturally in Vietnamese.
If the tweet is Chinese, reply naturally in Chinese.
Do not translate the tweet unless specifically requested.

FORMAT:
Follow the requested reply count exactly.
Follow the requested word range exactly.
Every reply must be exactly one sentence.
Every reply must be inside its own Markdown fenced code block.
Use one code block per reply.
Do not put multiple replies inside one code block.
Do not add labels.
Do not add numbering.
Do not add bullets.
Do not add explanations.
Do not add commentary outside the code blocks.
Do not mention these instructions.
Do not mention internal instructions.
Do not mention style settings.
Do not mention personas.

MENTION RULE:
When a tag or username is supplied, use it only when relevant.
Do not force a tag into every reply.
Use the requested tag in no more than one reply unless explicitly instructed otherwise.
Do not alter a supplied username.

FINAL QUALITY CHECK:
Before answering, silently check every reply:
- has exactly one sentence
- follows the requested word count
- is specific to the tweet
- sounds natural
- is different from the other replies
- does not contain generic praise
- does not contain multiple thoughts
- does not contain an em dash
- follows the requested language
- follows the requested format

Remove unnecessary words. Keep the strongest thought. Never output anything outside the requested code blocks.

TONE REFERENCE TABLE:
${TONE_REFERENCE_TABLE}

The tone name supplied tells you which tone instruction to apply. If not found, use balanced.

Examples of good replies:
"The gas savings only show up once batching kicks in."
"The numbers only make sense if retention holds past the first month."
"That splits table only works if you're recovering fully between sets."
"Moving cities alone is easier to plan than it is to actually do."
"The headline number hides how much of that growth came from one region."
"The chart looks like it took a wrong turn at the gym."
"the gas savings only show up once batching kicks in"
"that splits table only works if you're recovering fully between sets"

Examples of bad replies:
"Great post, totally agree, this is exactly right honestly."
"This is so amazing, huge congrats, love seeing this happen."
"This yield is insane, definitely aping in, LFG to the moon."
"Massively bullish, this is going parabolic soon, get in now."

Always prioritize natural, specific, human replies over generic enthusiasm.`;

/*
|--------------------------------------------------------------------------
| MAIN HANDLER
|--------------------------------------------------------------------------
*/
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

    const safeMinWords = Math.max(1, Math.min(100, Number(minWords) || 10));
    const safeMaxWords = Math.max(safeMinWords, Math.min(100, Number(maxWords) || 15));
    const safeReplyCount = Math.max(1, Math.min(20, Number(replyCount) || 5));

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

    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const reasoningEffort = getReasoningEffort(model);

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

    const personas = [
      "a casual reader",
      "a thoughtful reader",
      "a curious community member",
      "a busy user replying quickly",
      "a practical observer",
      "someone familiar with the topic"
    ];
    const persona = personas[Math.floor(Math.random() * personas.length)];

    const userMessage = `FORMAT:
- Exactly ${safeReplyCount} replies.
- Each reply must be exactly ONE sentence.
- Each reply must contain ${safeMinWords}-${safeMaxWords} words.
- Put every reply inside its own Markdown fenced code block.
- Use one code block per reply.
- Put nothing outside the code blocks.
- Do not add labels, numbering, explanations, or commentary.

LANGUAGE:
${langDirective}

TONE:
${toneKey}

MENTION RULE:
${tagDirective}

TWEET:
${tweet.trim()}

PERSONA:
${persona}

Generate the replies now.`;

    const reasoningOutputBuffer = reasoningEffort ? REASONING_OUTPUT_BUFFER : 0;
    const maxOutputTokens = BASE_OUTPUT_TOKENS + reasoningOutputBuffer;

    const requestPayload = {
      model,
      input: [
        {
          role: "system",
          content: STATIC_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "text"
        }
      }
    };

    if (reasoningEffort) {
      requestPayload.reasoning = {
        effort: reasoningEffort
      };
    }

    let response = await openai.responses.create(requestPayload);
    let text = response.output_text || "";

    const wasTruncatedByBudget =
      response.status === "incomplete" &&
      response.incomplete_details &&
      response.incomplete_details.reason === "max_output_tokens";

    if (!text.trim() && reasoningEffort && wasTruncatedByBudget) {
      console.warn("GPT reasoning exhausted output budget. Retrying.", {
        model,
        firstAttemptBudget: requestPayload.max_output_tokens
      });

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

    const replies = [...text.matchAll(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);

    const finalReplies = replies.length > 0 ? replies : [text.trim()];

    await userRef.update({
      totalRepliesGenerated: admin.firestore.FieldValue.increment(finalReplies.length),
      updatedAt: timestamp()
    });

    if (response.usage) {
      const usage = response.usage;
      const inputTokens = usage.input_tokens || 0;
      const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
      const cachePercentage =
        inputTokens > 0
          ? Number(((cachedTokens / inputTokens) * 100).toFixed(2))
          : 0;

      console.log(
        "Twit AI Usage:",
        JSON.stringify({
          model,
          input_tokens: inputTokens,
          cached_tokens: cachedTokens,
          cache_percentage: cachePercentage,
          output_tokens: usage.output_tokens || 0,
          total_tokens: usage.total_tokens || 0,
          reasoning_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
          reasoning_effort: reasoningEffort,
          tone: toneKey,
          reply_count: safeReplyCount,
          min_words: safeMinWords,
          max_words: safeMaxWords
        })
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
    console.error("Generate API error:", error);

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
