const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function draftEmails(jobs, profile) {
  if (!jobs.length) return [];
  const p = profile || {};
  const sig = p.sig || `Best regards,\n${p.name || 'Applicant'}\n${p.email || ''}\n${p.link || ''}`;
  const msg = await client.chat.completions.create({
    model: 'gpt-4o-mini', max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Write concise personalized cold application emails for influencer marketing jobs.\nReturn ONLY valid JSON. Format: {"emails":[{"id":"j1","subject":"...","body":"full email text"}]}\n150-180 words. Warm confident tone. Reference specific role details. No generic openers. Clear CTA.\nIMPORTANT: Never use em dashes (—) or en dashes (–) anywhere in the subject or body. Use commas, periods, or plain hyphens (-) instead.' },
      { role: 'user', content: `Candidate:\nName: ${p.name||'Applicant'}\nRole: ${p.role||'Influencer Marketing Specialist'}, ${p.exp||'3 years'} experience\nSkills: ${p.skills||'influencer outreach, TikTok, Instagram'}\nAchievements: ${p.achieve||''}\nPortfolio: ${p.link||''}\nSignature:\n${sig}\n\nWrite emails for:\n${jobs.map(j=>`ID:${j.id}\nTitle: ${j.title} at ${j.company}\nTo: ${j.email}\nDesc: ${j.description?.slice(0,400)}`).join('\n\n')}` }
    ]
  });
  try {
    const parsed = JSON.parse(msg.choices[0].message.content);
    return parsed.emails || [];
  } catch { return []; }
}

module.exports = { draftEmails };
