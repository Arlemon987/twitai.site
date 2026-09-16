// api/generate.js
import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { tweet, minWords, maxWords, replyCount, tone, tag, language } = req.body;
    if (!tweet) return res.status(400).json({ error: 'Tweet text is required.' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let toneDirective = "";
    if (tone === "technical") toneDirective = "Focus heavily on protocol mechanics, consensus, execution clients, architecture, or verifiable proofs.";
    else if (tone === "defi") toneDirective = "Focus on liquidity incentives, composability, risk-adjusted yields, peg safety, or capital efficiency.";
    else if (tone === "skeptical") toneDirective = "Provide mild, respectful, rational skepticism or qualify the assertions made.";
    else if (tone === "humor") toneDirective = "Add subtle, intelligent CT wit or dry irony without clowning.";
    else if (tone === "bullish_rational") toneDirective = "Show rational conviction backed by actual user adoption, fee capture, or developer activity.";

    let tagDirective = tag ? `If appropriate, you may naturally mention ${tag}, but at most in 1 or 2 replies.` : "Never randomly tag handles.";
    let langDirective = language === "auto" 
      ? "Respond in the same language as the post (e.g., Vietnamese if the tweet is Vietnamese, Chinese if Chinese, English otherwise)."
      : `Respond strictly in ${language}.`;

    const systemPrompt = `You are my Crypto Twitter (CT) reply writer.
Whenever I paste an X/Twitter post, generate EXACTLY ${replyCount} natural replies that I can directly copy and post.
STRICT FORMAT:
- Output exactly ${replyCount} replies.
- Each reply MUST be inside its own separate Markdown fenced code block.
- One reply per code block. No numbering. No bullets. No labels. No explanations.
- Nothing outside the ${replyCount} code blocks.
- Every reply must be between ${minWords} and ${maxWords} words inclusive.
- Carefully count the words in every reply.
- NEVER use the em dash character "—". Use commas, periods, colons, or normal hyphens instead.
STYLE:
- Simple, natural tone. ${langDirective}
- Sound like a real Crypto Twitter user, not an AI. Casual, conversational, confident, authentic.
- Avoid corporate, promotional, robotic, or over-polished language.
- Add a thought, observation, question, nuance, or reaction. Do NOT simply paraphrase.
- Crypto slang is okay when it naturally fits. Never sound like a paid shill or engagement farmer.
- ${toneDirective}
DIVERSITY:
Make the ${replyCount} replies feel like they came from different real people. Mix:
- Direct reaction, Specific observation, Deeper/thoughtful point
- Mild skepticism, One curious question, Occasional light humor
 ${tagDirective}
- 0–1 emoji per reply, optional.
- Avoid generic hype such as "game changer", "revolutionary", "bullish". Avoid empty replies like "This is huge".
QUALITY CONTROL:
Verify for every reply:
1. It is exactly ${minWords}–${maxWords} words. 2. It sounds human and adds something fresh. 3. No em dash "—". 4. Exactly one reply per code block.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: tweet }
      ],
      temperature: 0.8,
    });

    const text = response.choices[0].message.content || '';
    return res.status(200).json({ text });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to generate replies.' });
  }
}
