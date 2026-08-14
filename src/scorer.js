const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function scoreJobs(jobs, profile) {
  if (!jobs.length) return [];
  const profileStr = `Role: ${profile?.role || 'Influencer Marketing Specialist'}\nExperience: ${profile?.exp || '3 years'}\nSkills: ${profile?.skills || 'influencer outreach, TikTok, Instagram'}\nAchievements: ${profile?.achieve || ''}`;
  const msg = await client.chat.completions.create({
    model: 'gpt-4o-mini', max_tokens: 1000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Score job relevance 0-100. Return ONLY valid JSON.\nFormat: {"scores":[{"id":"j1","score":85,"reason":"Short reason under 12 words"}]}' },
      { role: 'user', content: `Candidate:\n${profileStr}\n\nScore these jobs:\n${jobs.map(j=>`ID:${j.id} | ${j.title} at ${j.company} | ${j.description?.slice(0,200)}`).join('\n')}` }
    ]
  });
  let scores = [];
  try {
    const parsed = JSON.parse(msg.choices[0].message.content);
    scores = parsed.scores || [];
  } catch { return jobs.map(j => ({ ...j, score: 50, reason: 'Scoring unavailable' })); }
  const scoreMap = {};
  scores.forEach(s => scoreMap[s.id] = s);
  return jobs.map(j => ({ ...j, score: scoreMap[j.id]?.score ?? 50, reason: scoreMap[j.id]?.reason ?? '' }));
}

module.exports = { scoreJobs };
