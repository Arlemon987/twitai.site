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
    const tones = {
      technical:
        'Mention one clear technical detail.',
      analytical:
        'Give one thoughtful observation.',
      defi:
        'Focus on one practical DeFi point.',
      skeptical:
        'Mention one thing worth watching.',
      humor:
        'Use light humor when it fits.',
      supportive:
        'Support one specific point.',
      bullish_rational:
        'Show calm confidence about one specific point.',
      casual:
        'Keep it light and conversational.'
    };
    const toneDirective =
      tones[tone] ||
      'Keep it natural, simple, and conversational.';
    // -----------------------------
    // Tag
    // -----------------------------
    const tagDirective = tag
      ? `Mention ${tag} in at most 1 reply. Only use it when relevant.`
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
    const styleSeed = Math.random()
      .toString(36)
      .slice(2, 10);
    const personas = [
      'a casual CT user',
      'a thoughtful reader',
      'a curious community member',
      'a busy user replying quickly',
      'a practical observer',
      'a long-time crypto user'
    ];
    const persona =
      personas[
        Math.floor(Math.random() * personas.length)
      ];
    // -----------------------------
    // System prompt
    // -----------------------------
    const systemPrompt = `You write natural X (Twitter) replies.
Understand the post first.
Write replies that feel like real people casually responding.
Do not summarize the post.
Do not rewrite the post.
Do not sound like AI.
Do not sound like a marketer.
Do not sound like an ambassador.
STYLE:
- Use simple English.
- Use everyday words.
- Use short sentences.
- Keep the wording natural.
- Keep the wording casual.
- Keep the reply easy to read.
- Give one clear thought.
- Add a small new observation when possible.
- Stay relevant to the post.
- Crypto and Web3 slang is fine when natural.
- Do not force crypto into non-crypto posts.
- Do not invent facts.
- Do not over-explain.
- Do not sound overly polished.
STRICT SENTENCE RULES:
- Use simple sentences only.
- Prefer one idea per sentence.
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
- If two thoughts are needed, use two short sentences.
- Never pack multiple thoughts into one sentence.
GOOD STYLE:
"That evaluator role is interesting.
It adds another trust layer."
BAD STYLE:
"That evaluator role is interesting because it adds another trust layer while keeping both sides accountable."
GOOD STYLE:
"This makes the process cleaner.
I like the independent check."
BAD STYLE:
"This makes the process cleaner because the independent check can keep both sides accountable."
CONTENT:
- Do not simply repeat the main point.
- Do not paraphrase the post.
- Add a fresh reaction or observation.
- Do not make every reply supportive.
- Some replies can be curious.
- Some replies can be thoughtful.
- Some replies can be practical.
- Some replies can be mildly skeptical.
- Keep skepticism natural.
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
FORMAT:
- Exactly ${replyCount} replies.
- Each reply must contain ${minWords}-${maxWords} words.
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
${tagDirective}
FINAL CHECK:
Before answering, check every reply.
Check sentence structure.
Split long sentences.
Remove complex sentences.
Remove compound sentences.
Remove unnecessary words.
Keep one clear thought per sentence.
Make the replies sound like real CT users.
Never use the em dash character "—".`;
    // -----------------------------
    // User message
    // -----------------------------
    const userMessage = `${tweet.trim()}
Write the replies now.
Style seed: ${styleSeed}
Voice hint: ${persona}
Never mention the style seed.
Never mention the voice hint.`;
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
      throw new Error(
        'OpenAI returned an empty response.'
      );
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
    // -----------------------------
    // Response
    // -----------------------------
    return res.status(200).json({
      text: text.trim()
    });
  } catch (error) {
    console.error(
      'OpenAI API ERROR:',
      error
    );
    return res.status(500).json({
      error:
        error?.message ||
        error?.error?.message ||
        'Failed to generate replies.'
    });
  }
}
