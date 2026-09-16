// api/generate.js

import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      tweet,
      minWords = 10,
      maxWords = 15,
      replyCount = 5,
      tone = 'casual',
      tag,
      language = 'auto'
    } = req.body;

    if (!tweet || !tweet.trim()) {
      return res.status(400).json({ error: 'Tweet text is required.' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // -----------------------------
    // Tone
    // -----------------------------

    const tones = {
      technical:
        'Focus on one concrete technical or practical detail.',

      analytical:
        'Add one thoughtful observation or useful implication.',

      defi:
        'Focus on mechanism, utility, liquidity, incentives, or practical value.',

      skeptical:
        'Add a mild qualification or something worth watching without being negative.',

      humor:
        'Use light, natural humor when it fits. No sarcasm or mockery.',

      supportive:
        'Give specific, genuine support for one concrete point.',

      bullish_rational:
        'Show measured confidence based on a specific point, without exaggeration.',

      casual:
        'Keep it light, natural, and conversational.'
    };

    const toneDirective =
      tones[tone] || 'Keep it natural, conversational, and relevant.';

    // -----------------------------
    // Tag
    // -----------------------------

    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply, only when genuinely relevant.`
      : 'Do not force mentions or tags.';

    // -----------------------------
    // Language
    // -----------------------------

    const langDirective =
      language === 'auto'
        ? "Reply in the post's language. Use English if the language is unclear."
        : `Write strictly in ${language}.`;

    // -----------------------------
    // Style variation
    // -----------------------------

    const styleSeed = Math.random().toString(36).slice(2, 10);

    const personas = [
      'a casual CT user',
      'a thoughtful reader',
      'a curious community member',
      'a busy user replying quickly',
      'a practical observer',
      'a long-time crypto user'
    ];

    const persona =
      personas[Math.floor(Math.random() * personas.length)];

    // -----------------------------
    // System prompt
    // -----------------------------

    const systemPrompt = `You write natural X (Twitter) replies.

Understand the post first. Then write replies that feel like real people casually responding, not AI summaries or promotional comments.

STYLE:
- Simple, natural language.
- Sound human, casual, and conversational.
- Add a new thought, observation, reaction, or useful nuance.
- Do not simply repeat or paraphrase the post.
- Stay relevant to the actual topic.
- Crypto/Web3 slang is fine when natural.
- Do not force crypto into non-crypto posts.
- Avoid corporate, robotic, overly polished, or ambassador-like language.
- Avoid generic hype such as "game changer", "revolutionary", "huge", or "bullish" unless genuinely justified.
- Questions are okay when they naturally fit. Do not force questions.
- Do not invent facts or details.
- Do not over-explain.
- Keep replies easy to read.

VARIETY:
- Every reply should feel like a different real person.
- Vary openings, sentence structure, and phrasing.
- Mix reactions, observations, deeper thoughts, curiosity, and mild skepticism when appropriate.
- Do not repeat the same idea in different words.
- Do not make every reply agree with the post.
- Avoid repeated phrases such as "Great post", "Exactly", "Well said", or "This is huge".

FORMAT:
- Exactly ${replyCount} replies.
- Each reply must be ${minWords}-${maxWords} words.
- Put each reply inside its own Markdown fenced code block.
- Nothing outside the code blocks.
- Do not add labels, numbering, IDs, or explanations.
- Never use the em dash character "—".

LANGUAGE:
${langDirective}

TONE:
${toneDirective}

MENTION RULE:
${tagDirective}`;

    // -----------------------------
    // User message
    // -----------------------------

    const userMessage = `${tweet.trim()}

Write the replies now.

Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed or voice hint.`;

    // -----------------------------
    // OpenAI Responses API
    // -----------------------------

    const response = await openai.responses.create({
      model: 'gpt-5.4-mini-2026-03-17',
      input: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      max_output_tokens: 2000,
      reasoning: {
        effort: 'medium'
      }
    });

    const text = response.output_text || '';

    if (!text.trim()) {
      throw new Error('OpenAI returned an empty response.');
    }

    // -----------------------------
    // Log usage
    // -----------------------------

    if (response.usage) {
      console.log(
        'Usage:',
        JSON.stringify(response.usage)
      );
    }

    return res.status(200).json({
      text: text.trim()
    });

  } catch (error) {
    console.error('OpenAI API ERROR:', error);

    return res.status(500).json({
      error:
        error?.message ||
        error?.error?.message ||
        'Failed to generate replies.'
    });
  }
}
