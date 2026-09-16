// api/generate.js

import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tweet, minWords, maxWords, replyCount, tone, tag, language } = req.body;

    if (!tweet || !tweet.trim()) {
      return res.status(400).json({ error: 'Tweet text is required.' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // -----------------------------
    // Tone (short directives)
    // -----------------------------

    const tones = {
      technical: 'When relevant, focus on one concrete practical detail, in plain words.',
      analytical: 'Focus on one deeper implication or tradeoff.',
      defi: 'Focus on one deeper implication or tradeoff.', // legacy
      skeptical: 'Mild, constructive skepticism about the idea, never the person.',
      humor: 'Light, clear humor. No sarcasm or mockery.',
      supportive: 'Give specific, genuine support for one concrete thing.',
      bullish_rational: 'Give specific, genuine support for one concrete thing.', // legacy
      casual: 'Light and friendly, like a quick comment between friends.'
    };

    const toneDirective = tones[tone] || 'Natural and conversational.';

    // -----------------------------
    // Tag
    // -----------------------------

    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply if truly relevant.`
      : 'Do not mention or tag anyone.';

    // -----------------------------
    // Language
    // -----------------------------

    const langDirective =
      language === 'auto'
        ? "Reply in the post's language; English if unclear. Keep the same simplicity in every language."
        : `Write strictly in ${language}, keeping the same simplicity.`;

    // -----------------------------
    // Style seed + persona (variety between runs)
    // -----------------------------

    const styleSeed = Math.random().toString(36).slice(2, 10);

    const personas = [
      'a sharp, direct commenter',
      'a busy professional replying quickly',
      'a thoughtful practitioner',
      'a friendly long-time user',
      'a curious reader',
      'a calm, measured observer'
    ];

    const persona = personas[Math.floor(Math.random() * personas.length)];

    // -----------------------------
    // System prompt (~250 words)
    // -----------------------------

    const systemPrompt = `You write X (Twitter) replies for posts on any topic. Each reply must sound like a real person reacting to the post, and a 12-year-old non-native speaker must understand it on first read.

UNDERSTAND FIRST: Identify the post's subject, type (opinion, question, announcement, joke, story, news), actual point, and register. Reply from inside that world with vocabulary that fits the topic.

MATCH THE TYPE: Answer questions directly. Match jokes lightly without explaining them. Add warmth to personal stories. React to one specific detail in announcements. Add an implication to news. Give your own angle on opinions, with mild pushback if it overclaims.

FORMAT:
- Exactly ${replyCount} replies, each inside its own code block, nothing outside.
- Each reply ${minWords}-${maxWords} words. Never use "—".
- ${langDirective}

STYLE:
- Short common words, short sentences (mostly 4-12, never over 18 words).
- Use contractions (don't, it's). No slang, texting abbreviations, or niche jargon.
- No idioms, sarcasm, or formal connectors ("however", "moreover").
- Vary length, openings, and structure. No two replies start with the same word. At least one reply carries a small opinion.
- No neat summary endings, no rule-of-three lists.

NEVER:
- Promote or repeatedly name the author, product, or company.
- Paraphrase the post; add a new thought instead.
- Invent facts.
- Generic hype ("game changer", "huge").
- Empty questions ("Thoughts?").
- Insults, doomposting, or dismissive negativity. Question ideas, never people.

TONE: ${toneDirective}
 ${tagDirective}`;

    // -----------------------------
    // OpenAI Responses API
    // -----------------------------

    const userMessage = `${tweet.trim()}

(Style seed: ${styleSeed}. Write as ${persona}. Voice hint only, never mention it.)`;

    const response = await openai.responses.create({
      model: 'gpt-5.4-mini-2026-03-17',
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_output_tokens: 2000,
      reasoning: { effort: 'minimal' }
    });

    const text = response.output_text || '';

    if (!text.trim()) {
      throw new Error('OpenAI returned an empty response.');
    }

    // Log usage to verify real costs
    if (response.usage) {
      console.log('Usage:', JSON.stringify(response.usage));
    }

    return res.status(200).json({ text: text.trim() });

  } catch (error) {
    console.error('OpenAI API ERROR:', error);
    return res.status(500).json({
      error: error?.message || error?.error?.message || 'Failed to generate replies.'
    });
  }
}
