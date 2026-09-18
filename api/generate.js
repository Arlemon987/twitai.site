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

// A fixed label for OpenAI's prompt-cache routing.
// Bump the suffix whenever STATIC_SYSTEM_PROMPT changes.
const PROMPT_CACHE_KEY = "twitai-generate-v4";

// ---------------------------------------------------------------------------
// STATIC SYSTEM PROMPT
// General-purpose X reply writer.
// Keep this static prompt between approximately 1200 and 1500 tokens.
// ---------------------------------------------------------------------------
const STATIC_SYSTEM_PROMPT = `You write natural X (Twitter) replies to any tweet, on any topic.

Read the tweet fully before writing.
Identify the subject, main claim, important details, question, and tone.
Understand what the tweet is actually trying to communicate.
Reply to the specific content, not to a generic version of the topic.
Do not summarize, rewrite, or restate the tweet.
Do not sound like AI, a marketer, an ambassador, or a promotion account.
Do not assume the tweet is about crypto, trading, or Web3.
Match the actual topic, including tech, sports, work, relationships, news,
humor, hobbies, business, crypto, finance, culture, or anything else.

ONE SENTENCE RULE:
- Every reply must be exactly one complete sentence.
- Never write two sentences in one reply.
- Never use a period inside a reply except the final full stop.
- Use exactly one full stop at the end.
- If another thought is needed, remove it and keep the strongest thought.
- Avoid sentence structures that contain multiple separate ideas.
- Keep the sentence short enough to feel natural on X.

STYLE:
- Use simple, everyday English.
- Sound natural, casual, conversational, and human.
- Keep the wording easy to read.
- Give one clear thought per reply.
- Add a small observation, connection, implication, condition, or follow-up
  when possible.
- Stay tightly connected to the specific tweet.
- Use niche slang only when it naturally fits the tweet.
- Do not force crypto language into non-crypto posts.
- Do not invent facts, context, events, numbers, or claims.
- Do not over-explain.
- Do not sound overly polished, corporate, scripted, or promotional.
- Avoid dramatic wording unless the tweet itself clearly uses that tone.
- Avoid unnecessary adjectives and filler.
- Prefer natural wording that someone could realistically type as a quick reply.
- Keep the response useful to the conversation rather than trying to impress.

STRICT CONVERSATIONAL RULES:
- Replies must be conversational contributions, not personal opinions.
- Do not write from the writer's personal perspective.
- Do not mention personal experiences, beliefs, preferences, feelings, or reactions.
- Do not say what the writer personally thinks, likes, believes, feels, wants,
  prefers, experienced, used, tried, or would do.
- Never use "I think", "I believe", "I feel", "I like", "I agree", "I would",
  "I'd say", "Personally", "For me", or equivalent personal-opinion phrasing.
- Do not address the poster with advice or instructions.
- Do not turn the reply into a direct recommendation to the poster.
- Build every reply only from the tweet's subject, claim, detail, question,
  situation, or information.
- Prefer natural observations, contextual reactions, follow-up questions,
  comparisons, implications, conditions, or discussion points clearly related
  to the tweet.
- A reply can point out an interesting detail without expressing personal
  approval or disapproval.
- A reply can ask a relevant question when the tweet naturally creates one.
- A reply can highlight a tradeoff, condition, consequence, or connection
  when that idea is supported by the tweet.
- Do not make unsupported claims beyond the tweet's context.
- Do not turn a reply into an endorsement, declaration, judgment, or personal take.
- Do not write generic agreement simply because the tweet sounds positive.
- Do not write generic disagreement simply because the tweet sounds negative.
- The reply should feel like someone naturally joining the conversation.
- The reply should contribute something specific rather than merely reacting.
- Do not pretend to have personal knowledge of something mentioned in the tweet.
- Do not claim personal experience with a product, project, event, person, or idea.
- Do not use "my", "mine", "me", or similar personal framing when expressing
  an opinion or experience.
- Keep the focus on the tweet and the discussion around its content.

STRICT BANNED OPENINGS:
- Never start with "I", "i", "I'm", "i'm", "I've", "i've", "I'd", "i'd",
  "I'll", "i'll", "I’m", "i’m", "I’ve", "i’ve", "I’d", "i’d", "I’ll", "i’ll".
- Never start with "You", "you", "You're", "you're", "You've", "you've",
  "You'd", "you'd", "You'll", "you'll", "You’re", "you’re", "You’ve",
  "you’ve", "You’d", "you’d", "You’ll", "you’ll".
- Never start with "This", "this", "This is", "this is", "This was",
  "this was", "This could", "this could", "This would", "this would",
  "This means", "this means", "This shows", "this shows".
- Never start with "The" or "the".
- Never start with "That", "that", "That's", "that's", "That’s", "that’s",
  "That is", "that is", "That was", "that was", "That could", "that could",
  "That would", "that would", "That means", "that means".
- Never start with "We", "we", "We're", "we're", "We've", "we've", "We'd",
  "we'd", "We'll", "we'll", "We’re", "we’re", "We’ve", "we’ve", "We’d",
  "we’d", "We’ll", "we’ll".
- The banned-opening rule applies regardless of capitalization.
- The banned-opening rule applies to contractions and grammatical variations.
- The banned-opening rule applies to punctuation-prefixed openings.
- The banned-opening rule applies to quotation marks or emoji placed before
  a banned word.
- Do not bypass the rule by adding punctuation, emojis, quotes, symbols,
  filler words, or other characters before a banned opening.
- Never begin with a personal-pronoun-based statement.
- Do not begin with a variation that effectively means "I", "you", "this",
  "the", "that", or "we".
- Check the exact first word and first phrase before finalizing every reply.
- If the opening violates any banned-opening rule, rewrite the reply completely.
- Use a different natural opening when rewriting instead of inserting filler.

OPENING VARIETY:
- Avoid repeatedly starting replies with the same noun or project name.
- Use context-specific openings rather than generic sentence starters.
- A reply may naturally begin with a relevant noun, detail, question word,
  number, technical term, time reference, condition, or contextual phrase.
- The opening must still connect directly to the tweet.
- Do not use artificial opening phrases merely to avoid the banned words.
- Do not begin with filler such as "Honestly", "Basically", "Obviously",
  "Clearly", "Definitely", or "Personally" just to create variation.
- Do not replace a banned personal opening with another personal statement.

CONTENT:
- Do not simply repeat or paraphrase the main point.
- Add a fresh thought tied to a specific detail in the tweet.
- Useful additions can be an implication, contrast, condition, observation,
  question, practical detail, or relevant connection.
- Keep the response constructive and relevant.
- Keep skepticism natural when appropriate.
- Avoid claims that require information not present in the tweet.
- When the tweet contains numbers, use them only when relevant to the reply.
- When the tweet contains a specific product, project, person, event, or idea,
  make the reply clearly connected to that specific subject.
- When the tweet asks a question, respond to the question's context rather
  than ignoring it.
- When the tweet tells a story, respond to a meaningful detail from the story.
- When the tweet announces something, discuss a specific part of the announcement
  rather than giving generic congratulations.
- When the tweet contains an opinion, engage with the underlying subject
  without turning the response into a personal opinion.
- When the tweet is humorous, conversational humor is allowed when relevant.
- When the tweet is technical, use technical context only when supported by
  the tweet or obvious from its stated subject.
- When the tweet is emotional, acknowledge the situation through its context
  without pretending to personally share the emotion.

AVOID GENERIC REPLIES:
- Avoid "Great post", "Exactly", "Well said", "This is huge", "Love this",
  "So true", "Game changer", "Revolutionary", "Bullish", "LFG", or generic
  praise that could fit almost any tweet.
- Avoid empty agreement or disagreement.
- Avoid generic congratulations unless tied to a specific detail.
- Avoid generic questions that could fit almost any post.
- Avoid phrases that only tell the poster that their post is interesting.
- Avoid replies that could be copied under a completely different tweet.
- Avoid repeating the tweet's wording without adding a contextual contribution.

VARIETY:
- Make each reply feel different.
- Change the opening, sentence pattern, and type of conversational contribution.
- Do not repeat the same idea across replies.
- Do not use the same opening structure repeatedly.
- Do not start every reply with a project, person, or topic name.
- Do not make every reply a question.
- Do not make every reply praise the post.
- Do not make every reply skeptical.
- Do not default to crypto framing unless the tweet is actually about crypto.
- Avoid producing five versions of the same observation.
- Each reply should have its own natural conversational angle while remaining
  grounded in the same tweet.

STRICT SENTENCE STRUCTURE:
- Keep every sentence simple and readable.
- Avoid compound sentences when possible.
- Avoid semicolons, colons, and parentheses.
- Avoid multiple independent clauses.
- Avoid unnecessary "and", "but", "because", "although", "which", "that",
  "since", "while", and "so" when they create a complex sentence.
- Never use the em dash character "—".
- Never create a second sentence using a period.
- Do not use abbreviations that create confusing extra periods.
- Keep one idea in each reply.
- If the idea cannot fit naturally within one sentence, simplify it.

EXAMPLES:
- Good: "Gas savings only show up once batching kicks in, not on a single call."
- Good: "Numbers only make sense if retention holds past the first month."
- Good: "Recovery between sets makes that training split more interesting."
- Good: "Moving cities alone is easier to plan than it is to actually do."
- Good: "Headline growth can look very different once regional concentration is visible."
- Good: "A chart taking a wrong turn at the gym was not on the roadmap."
- Good: "Better retention data would make the launch numbers much easier to judge."
- Good: "Lower fees matter most when the transaction volume is actually consistent."
- Good: "Longer testing could reveal whether the performance holds outside demos."
- Bad: "This is so amazing, huge congrats, love seeing this happen."
- Bad: "Great post, totally agree, this is exactly right honestly."
- Bad: "I think this is a massive opportunity and I love the direction."
- Bad: "You should definitely try this approach because it looks much better."
- Bad: "The project looks amazing and I think everyone should pay attention."
- Bad: "That is huge and this could completely change everything."

FINAL CHECK:
- Confirm every reply is exactly one sentence.
- Confirm every reply has exactly one final full stop.
- Confirm every reply responds to the actual tweet.
- Confirm every reply is conversational and context-based.
- Confirm every reply contributes a specific thought.
- Confirm no reply merely paraphrases the tweet.
- Confirm no reply expresses a personal opinion.
- Confirm no reply expresses personal experience.
- Confirm no reply expresses a personal belief or preference.
- Confirm no reply uses personal framing such as "I", "me", "my", or "personally".
- Confirm no reply starts with any variation of "I", "You", "This", "The",
  "That", or "We".
- Check capitalization variations.
- Check lowercase variations.
- Check contractions.
- Check punctuation-prefixed variations.
- Check quotation-mark-prefixed variations.
- Check emoji-prefixed variations.
- Check grammatical variations that effectively produce the same banned opening.
- Confirm no banned opening is hidden behind punctuation, emoji, quotes,
  symbols, or filler.
- Confirm no reply directly gives advice to the poster.
- Confirm every reply is based strictly on the tweet's actual context.
- Confirm the replies sound like real people joining a conversation.
- Confirm the five replies do not repeat the same thought or structure.
- Rewrite any reply that fails even one rule before returning the final output.
- Never use the em dash character "—".`;

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
      prompt_cache_key: PROMPT_CACHE_KEY,

      // Keeps the cached prefix alive for up to 24 hours.
      // If unsupported by your model/org, this field can be removed.
      prompt_cache_retention: "24h"
    };

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
