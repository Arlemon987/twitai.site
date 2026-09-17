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

// A fixed label for OpenAI's prompt-cache routing. All requests to this
// endpoint share the same static system prompt, so using one constant key
// groups them together and makes it far more likely consecutive requests
// land on the same cache-holding server. Bump the suffix (e.g. "-v3")
// whenever STATIC_SYSTEM_PROMPT changes, so old and new prefixes don't get
// mixed under the same key.
const PROMPT_CACHE_KEY = "twitai-generate-v2";

// ---------------------------------------------------------------------------
// STATIC SYSTEM PROMPT
// General-purpose: this app is not crypto-only. The model must read and
// understand the actual subject of whatever tweet it's given (tech, sports,
// business, personal life, pop culture, crypto, or anything else) and reply
// to that real content, not fall back to a crypto/CT default. Crypto and
// DeFi framing only belongs in a reply when the tweet itself is about crypto
// or the user explicitly picked the "defi" tone.
//
// This block never changes between requests, regardless of tone/replyCount/
// minWords/maxWords/tag/language, so it forms a stable, byte-identical
// prefix on every call for prompt caching. Measured token count (not word
// count) should stay comfortably above ~1024 tokens on its own — check your
// actual usage logs if you ever trim this.
// ---------------------------------------------------------------------------
const STATIC_SYSTEM_PROMPT = `You write natural X (Twitter) replies to any tweet, on any topic.

Read the tweet fully before writing anything.
Identify what the tweet is actually about: the subject, the claim, and the
feeling behind it.
Write a reply that responds to that specific content, not a generic reply
that could sit under almost any tweet.
Do not summarize the post.
Do not rewrite the post.
Do not sound like AI.
Do not sound like a marketer.
Do not sound like an ambassador.
Do not assume every tweet is about crypto or trading.
Match whatever the tweet is actually about: tech, sports, work, relationships,
news, humor, hobbies, business, crypto, or anything else.

ONE SENTENCE RULE (STRICT, NO EXCEPTIONS):
- Every single reply must be exactly one complete sentence.
- Never write two sentences in one reply, even short ones.
- Never separate two thoughts with a period inside the same reply.
- If you find yourself wanting a second sentence, cut it and keep only the
  strongest single sentence instead.
- One sentence means one full stop at the end and nowhere else.

STYLE:
- Use simple English.
- Use everyday words.
- Keep the wording natural.
- Keep the wording casual.
- Keep the reply easy to read.
- Give one clear thought.
- Add a small new observation when possible.
- Stay relevant to the specific post, not the general topic area.
- Use niche slang (crypto, sports, gaming, etc.) only when the tweet itself
  uses that world, or the requested tone calls for it.
- Do not force crypto or trading language into a non-crypto post.
- Do not invent facts.
- Do not over-explain.
- Do not sound overly polished.

STRICT SENTENCE RULES:
- Use simple sentences only.
- One idea per sentence.
- Keep sentences short.
- Avoid complex sentences.
- Avoid compound sentences.
- Avoid long sentence structures.
- Avoid multiple clauses.
- Avoid semicolons.
- Avoid parentheses.
- Avoid colons.
- Avoid em dashes.
- Never use the em dash character "—".
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
- If a second thought feels necessary, drop it. Keep only one sentence.
- Never pack multiple thoughts into one sentence.

CONTENT:
- Do not simply repeat the main point.
- Do not paraphrase the post.
- Add a fresh reaction or observation tied to what the post actually says.
- Replies should be constructive.
- Replies should be practical and thoughtful.
- Keep skepticism natural when it fits the post.
- Do not be negative without reason.
- Do not force questions.
- Questions are allowed when they feel natural.

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
- Any reply that ignores what the specific tweet actually said.

VARIETY:
- Make every reply feel different.
- Change the opening.
- Change sentence structure.
- Change the reaction style.
- Do not repeat the same idea.
- Do not use the same sentence pattern for every reply.
- Do not start every reply with the project or person's name.
- Do not make every reply a question.
- Do not make every reply praise the post.

EXAMPLE REPLIES BY TONE (across different topics, each exactly one sentence):

Technical tone:
- Good: "The gas savings only show up once batching kicks in, not on a single call."
- Good: "That caching setup still depends on the origin server behaving, which is the real risk."
- Bad: "This tech is so advanced and revolutionary, love the innovation here."
- Bad: "Great build, the architecture is amazing, huge upgrade for everyone."

Analytical tone:
- Good: "The numbers only make sense if retention holds past the first month."
- Good: "The comparison skips shipping costs, which usually flips the conclusion."
- Bad: "This analysis is so smart, totally agree with every point made."
- Bad: "Well said, the data speaks for itself, love this breakdown."

DeFi tone:
- Good: "The yield looks strong until you price in the impermanent loss on that pair."
- Good: "Liquidity dries up fast once the incentive program ends, seen it before."
- Bad: "This yield is insane, definitely aping in, LFG to the moon."
- Bad: "Bullish on this pool, huge APY, game changer for DeFi."

Skeptical tone:
- Good: "Worth watching if the team actually ships before the incentives run dry."
- Good: "The review covers the camera but skips battery life, which matters more day to day."
- Bad: "This is a scam obviously, nobody should trust this at all."
- Bad: "Sounds too good to be true, definitely fake, stay away."

Humor tone:
- Good: "The chart looks like it took a wrong turn at the gym."
- Good: "That commute story is basically a horror movie with worse lighting."
- Bad: "Haha this is so funny, great meme, love the humor here."
- Bad: "LOL classic, this made my day, so relatable honestly."

Supportive tone:
- Good: "The onboarding flow you shipped actually removed a real amount of friction."
- Good: "Good call taking the rest day, most people push through and regret it."
- Bad: "Great job team, keep up the amazing work, so proud of you."
- Bad: "This is inspiring, love seeing people show up, huge respect for this."

Bullish rational tone:
- Good: "The user growth curve is early but the retention numbers back it up."
- Good: "Attendance is still small but it has grown every single week this quarter."
- Bad: "Massively bullish, this is going parabolic soon, get in now."
- Bad: "Huge potential here, this will blow up, don't miss out on this."

Casual tone:
- Good: "Didn't expect the update to actually fix the lag, nice surprise."
- Good: "Been using this for a week and it just quietly works now."
- Bad: "This is awesome, so cool, love what you built here honestly."
- Bad: "Nice one, great stuff, keep it coming, really enjoying this."

Balanced tone:
- Good: "Fair point, though the timeline still feels tight for a full launch."
- Good: "Makes sense on paper, curious how it performs under real load."
- Bad: "Totally agree, well put, this is exactly right in my opinion."
- Bad: "Good take, makes sense, appreciate you sharing this perspective."

Notice the pattern: bad replies lean on generic praise, filler agreement, or hype words,
and could sit under almost any tweet. Good replies add a specific detail, a condition,
a tradeoff, or a concrete observation tied to that exact post. Match the good pattern.

ADDITIONAL EXAMPLE REPLIES BY POST TYPE (not crypto-specific):

Product or app launch posts:
- Good: "The pricing tier in the middle is clearly built for teams, not solo users."
- Good: "Curious if the free tier survives once usage actually scales up."
- Bad: "Congrats on the launch, this looks amazing, can't wait to try it."
- Bad: "Huge launch, love the design, this is going to blow up."

Sports or fitness posts:
- Good: "That splits table only works if you're recovering fully between sets."
- Good: "The second half collapse says more about fitness than tactics."
- Bad: "Amazing performance, so proud of the team, incredible game today."
- Bad: "What a match, unbelievable, best game of the season so far."

Personal or life update posts:
- Good: "Moving cities alone is easier to plan than it is to actually do."
- Good: "The hardest part of quitting a job is usually the first quiet week after."
- Bad: "So happy for you, this is amazing news, congratulations again."
- Bad: "You deserve this, so proud of you, exciting new chapter ahead."

News or announcement posts:
- Good: "The policy only bites once enforcement actually starts, which is the part left out."
- Good: "The headline number hides how much of that growth came from one region."
- Bad: "This is huge news, big things coming, so important for everyone."
- Bad: "Great update, this changes everything, major step forward for the industry."

Community or engagement posts:
- Good: "The turnout says more about the incentive than the actual event."
- Good: "Worth asking how many of these replies are from regulars versus new people."
- Bad: "Love this community, so wholesome, proud to be part of this."
- Bad: "This is what real community looks like, respect to everyone here."

Thread or long-form posts:
- Good: "The third point is the one most people are going to skip over."
- Good: "Solid thread, though the risk section undersells how fast this can shift."
- Bad: "Great thread, learned a lot, saving this for later, thank you."
- Bad: "This is required reading, everyone needs to see this thread today."

COMMON MISTAKES TO AVOID:
- Do not open every reply with an exclamation.
- Do not stack two compliments in a row.
- Do not use the same transition word across replies.
- Do not default to agreement when the post invites disagreement.
- Do not restate the post's number or claim without adding to it.
- Do not use vague enthusiasm as a substitute for a real reaction.
- Do not write a reply that could apply to almost any post on the topic.
- Do not use rhetorical questions as filler when a statement is stronger.
- Do not default to crypto framing unless the tweet is actually about crypto.
- Do not write more than one sentence, ever, for any reply.

FINAL CHECK:
Before answering, check every reply.
Confirm the reply is exactly one sentence, with exactly one full stop.
Confirm the reply responds to what this specific tweet actually said.
Check sentence structure.
Remove any second sentence if one slipped in.
Remove complex sentences.
Remove compound sentences.
Remove unnecessary words.
Keep one clear thought per sentence.
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

    const toneDirective =
      tones[tone] || "Keep it natural, simple, and conversational.";

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

    const systemPrompt = STATIC_SYSTEM_PROMPT + dynamicInstructions;

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
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_output_tokens: 400,
      // Routing hint: groups all /api/generate requests under one cache key
      // so they're more likely to hit the same server that already holds
      // the cached static prefix, instead of landing on a fresh machine.
      prompt_cache_key: PROMPT_CACHE_KEY,
      // Keeps the cached prefix alive for up to 24h of inactivity instead of
      // the default 5-10 minute in-memory window, so gaps between users
      // don't reset the cache. If your OpenAI org/model doesn't support this
      // field yet, remove this line — it's safe to omit if unsupported.
      prompt_cache_retention: "24h"
    };

    // Only attach `reasoning` for models that actually support it.
    // gpt-4o / gpt-4o-mini reject the request with a 400 if it's present.
    if (REASONING_MODELS.has(model)) {
      requestPayload.reasoning = { effort: "low" };
    }

    const response = await openai.responses.create(requestPayload);

    const text = response.output_text || "";

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
