// api/generate.js

import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const {
      tweet,
      minWords = 8,
      maxWords = 28,
      replyCount = 3,
      tone,
      tag,
      language = 'auto'
    } = req.body;

    if (!tweet || !tweet.trim()) {
      return res.status(400).json({
        error: 'Tweet text is required.'
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // -----------------------------
    // Tone
    // -----------------------------
    let toneDirective = '';

    switch (tone) {
      case 'technical':
        toneDirective =
          'Zero hype. Zoom in on real bottlenecks, validation mechanics, latency, state verification, or execution limits.';
        break;

      case 'defi':
        toneDirective =
          'Focus on real yield sources, dilution mechanics, liquidity retention, or capital efficiency versus mercenary farmers.';
        break;

      case 'skeptical':
        toneDirective =
          'Call out obvious marketing abstractions, misaligned incentives, or low-signal claims without being insulting.';
        break;

      case 'humor':
        toneDirective =
          'Dry, deadpan CT irony. Avoid exclamation marks, meme clichés, or forced jokes.';
        break;

      case 'bullish_rational':
        toneDirective =
          'Focus purely on why the thesis holds up structurally, without buzzwords, emojis, or cheerleading.';
        break;

      default:
        toneDirective =
          'Grounded peer conversation. Talk like an active onchain operator who has seen hundreds of campaigns.';
    }

    // -----------------------------
    // Tag
    // -----------------------------
    const tagDirective = tag
      ? `You may naturally mention ${tag} in at most 1 reply only if context demands it. Otherwise, omit it.`
      : 'Never tag or @ any accounts.';

    // -----------------------------
    // Language
    // -----------------------------
    const langDirective =
      language === 'auto'
        ? 'Detect the source post language and respond naturally in that exact language and native slang style.'
        : `Write strictly in ${language}.`;

    // -----------------------------
    // Strict System Prompt
    // -----------------------------
    const systemPrompt = `You write genuine Crypto Twitter replies.

PRIMARY OBJECTIVE:
Simulate an experienced, slightly cynical crypto native replying from their phone. Zero corporate tone, zero enthusiastic assistant energy, zero empty agreement.

TARGET:
Generate EXACTLY ${replyCount} replies.

OUTPUT FORMAT REQUIREMENTS:
- Output exactly ${replyCount} markdown code blocks (fenced with triple backticks).
- Exactly ONE reply per code block.
- Absolute silence outside the code blocks (no markdown headers, greetings, conversational filler, or numbering).
- Word count: strictly between ${minWords} and ${maxWords} words per reply.
- Never use the em dash "—" or formal semicolon ";".

LANGUAGE:
${langDirective}

HARD RULES TO ELIMINATE AI FINGERPRINTS:

1. BANNED OPENERS:
Never start any reply with:
- "Honestly..."
- "Interesting take..."
- "This is..."
- "Really cool..."
- "Great point..."
- "Love how..."
- "I think..."
- "At the end of the day..."
- "The reality is..."

2. BANNED VOCABULARY & PHRASES:
Never use:
- testament, beacon, cornerstone, multifaceted, landscape, navigate, unlock, foster, delve, streamline, leverage, paramount, synergy, game-changer, revolutionary, frictionless, seamless.
- "cooking", "huge if true", "we are so early", "let's go", "lfg", "wagmi", "the future of", "matter of time", "building in silence".

3. ZERO SYCOPHANCY & ZERO AMBASSADOR SPEAK:
- Do not thank the author.
- Do not praise the graphic, thread, or idea.
- Do not frame repetitive user tasks or low-friction point farming as revolutionary data training unless pointing out the obvious catch.
- Do not say things like "Excited to see where this goes" or "Tracking this closely."

4. ANTI-PARAPHRASE & NEW ANGLE ONLY:
Do not summarize what was read.
If the post talks about:
- Training physical robots via simulation: Question the data cleanliness, telemetry bandwidth, or how browser clicks translate to kinematic policies.
- Leaderboard point loops: Highlight how users will simply bot or script the task.
- Base or L2 activity: Mention liquidity stickiness or fee extraction.

5. CASUAL SYNTAX & FLOW:
- Keep sentences punchy and unpolished.
- Sentence fragments are fine.
- Avoid perfectly symmetrical sentence constructions.
- 0 emojis preferred. Maximum 1 emoji across all generated replies combined.

TONE CONSTRAINT:
${toneDirective}

TAG CONSTRAINT:
${tagDirective}

Return only the code blocks.`;

    // -----------------------------
    // OpenAI Execution
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
          content: tweet.trim()
        }
      ],
      max_output_tokens: 2000
    });

    const text = response.output_text || '';

    if (!text.trim()) {
      throw new Error('OpenAI returned an empty response.');
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
