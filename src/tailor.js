/**
 * AI tailoring — uses OpenAI to write a job-specific summary + cover letter
 * from the user's profile. Called by POST /api/tailor.
 * Falls back to a template if no OPENAI_API_KEY is set.
 */
const OpenAI = require('openai');

async function tailor({ job, profile }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return templateFallback(job, profile);

  try {
    const client = new OpenAI({ apiKey: key });
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a job-application copywriter. Given a job and a candidate profile, produce a tailored summary + a short cover letter.

Return JSON with exactly this shape:
{
  "summary": "2-3 sentence resume summary tailored to the job, first person",
  "coverLetter": "3-4 paragraph cover letter, warm but professional, first person, references specific job requirements",
  "keyPoints": ["bullet", "bullet", "bullet"],
  "matchScore": 0-100 estimate of how well the profile matches the role
}

Keep it concrete. No fluff. No exclamation marks. Never invent experience the candidate doesn't have — work with what's in their profile.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            job: {
              title: job.title, company: job.company, location: job.location,
              description: (job.description || '').slice(0, 1500),
              tags: job.tags || []
            },
            profile: {
              name: profile.name, title: profile.title, location: profile.location,
              keywords: profile.keywords, bio: profile.bio || ''
            }
          })
        }
      ]
    });
    const raw = msg.choices[0].message.content;
    return { ...JSON.parse(raw), source: 'openai' };
  } catch (e) {
    console.warn('[tailor] OpenAI failed, using template:', e.message);
    return templateFallback(job, profile);
  }
}

function templateFallback(job, profile) {
  const name = profile.name || 'I';
  const summary = `${name} — ${profile.title || 'engineer'} interested in ${job.title} at ${job.company}. ${profile.bio || ''}`.trim();
  const coverLetter = `Hi ${job.company} team,

I came across the ${job.title} role and it looks like a strong fit for what I'm looking for. ${profile.bio || `My background is in ${profile.keywords || 'the areas your posting calls out'}.`}

I'd love to talk. My resume is attached.

Best,
${profile.name || ''}`;
  return {
    summary,
    coverLetter,
    keyPoints: (profile.keywords || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5),
    matchScore: null,
    source: 'template'
  };
}

module.exports = { tailor };
