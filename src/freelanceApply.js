const OpenAI = require('openai');
const { sendEmail } = require('./mailer');
const { autoApplyToJob } = require('./autoApply');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ATS_PATTERNS = /(ashbyhq|workable|greenhouse|lever\.co|myworkdayjobs)/i;

async function draftProposal(opp, profile, tone = 'casual') {
  const p = profile || {};
  const sig = p.sig || `${p.name || 'Abhishek Khandelwal'}\n${p.email || ''}\n${p.link || ''}`;
  const toneRules = {
    casual: 'Casual, like texting a friend who happens to be a hiring manager. Contractions ok (I\'d, you\'re, it\'s). Start sentences with "And" or "But" if it flows.',
    direct: 'Direct and no-nonsense. Short sentences. No filler. Get to the point in line one.',
    warm: 'Warm and curious. Show you actually find their problem interesting. Still concise.'
  };
  try {
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write freelance proposals that sound like a real human typed them in 90 seconds, not a template.

Candidate: ${p.name || 'Abhishek Khandelwal'}, ${p.exp || '3 years'} in influencer marketing. Past work to pull from ONLY if directly useful (max one reference): Netflix, Swiggy ORM, Dabur nano-influencer program, Hero Motors, Keychron India.

TONE: ${toneRules[tone] || toneRules.casual}

LENGTH: 55-85 words. Hard cap. Anything longer reads as spam.

STRUCTURE (no headings, no bullets, just plain text):
- Line 1: react to something specific in their brief - the problem, the platform mix, the audience, the constraint. Like you actually read it.
- Line 2: one concrete thing you'd do or try. Specific, not "I'll deliver high-quality results."
- Line 3 (optional, skip if not natural): a quick "done X before" reference, max 8 words.
- Closing line: one real question. Something that requires them to think, not "what's the timeline."

HARD BANS:
- Never open with "I" or "I'm" or "My name is" or "I would love to"
- Never use: "excellent fit", "passionate about", "committed to delivering", "leverage my expertise", "results-driven", "execution-focused", "I understand", "nuanced", "directly relevant to your goal"
- Never re-state their company name or job title back at them
- No em or en dashes
- No bullet points or numbered lists
- No "Hi [Name] Team" - just "Hi," or "Hey,"

Sign off with just the signature provided. No "Best regards," prefix unless it's in the signature.

Return JSON: {"subject":"short, plain, 4-7 words, no buzzwords","body":"full proposal with signature"}`
        },
        {
          role: 'user',
          content: `Brief:\n${opp.description?.slice(0, 700)}\n\nTitle hint: ${opp.title}\nBudget: ${opp.budget}\n\nSignature:\n${sig}`
        }
      ]
    });
    let result = { subject: '', body: '' };
    try { result = JSON.parse(msg.choices[0].message.content); } catch {}
    return result;
  } catch (e) {
    const fallback = `Hi,

Read the brief. Sounds like the real ask is creators who fit the brand voice and don't need a week of back-and-forth to ship.

I'd start with a 10-12 person shortlist, sorted by past brand work in your category rather than follower count, and run a quick test batch before scaling.

Are you locked on platform mix or open to wherever the right creators are?

${sig}`;
    return { subject: `Proposal for ${opp.title}`, body: fallback };
  }
}

async function sendProposal(opp, proposal, profile, resumePath, emailCfg) {
  const attachments = [];
  if (resumePath) {
    const fs = require('fs');
    if (fs.existsSync(resumePath)) attachments.push({ filename: 'Resume_Abhishek_Khandelwal.pdf', path: resumePath });
  }
  await sendEmail({
    to: opp.contactEmail,
    subject: proposal.subject,
    body: proposal.body,
    attachments,
    overrides: emailCfg
  });
  return { ok: true, reason: `Proposal emailed to ${opp.contactEmail}` };
}

async function draftFollowUp(opp, profile) {
  const p = profile || {};
  const sig = p.sig || `${p.name || 'Abhishek Khandelwal'}`;
  try {
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Write a short, human follow-up to a freelance proposal sent days ago with no reply. 30-50 words. Casual, no guilt-tripping, no "just checking in" cliche. Reference one specific thing from the original brief or add a fresh angle. End with a low-pressure question they can answer in one line. No em dashes. Return JSON: {"subject":"Re: ...","body":"..."}` },
        { role: 'user', content: `Original brief: ${opp.description?.slice(0,400)}\nOriginal proposal sent: ${opp.proposalDraft?.slice(0,300)}\nSign off:\n${sig}` }
      ]
    });
    try { return JSON.parse(msg.choices[0].message.content); } catch { return { subject: `Re: ${opp.title}`, body: `Hi,\n\nCircling back on this. Had one more idea worth running by you - happy to share if it's still open.\n\n${sig}` }; }
  } catch (e) {
    return { subject: `Re: ${opp.title}`, body: `Hi,\n\nCircling back on this. Still around if you'd like to chat.\n\n${sig}` };
  }
}

async function applyToOpportunity(opp, profile, resumePath, emailCfg, broadcast, tone) {
  const proposal = await draftProposal(opp, profile, tone);
  opp.proposalDraft = proposal.body;

  if (opp.contactEmail) {
    try {
      const result = await sendProposal(opp, proposal, profile, resumePath, emailCfg);
      opp.proposalSentAt = new Date().toISOString();
      opp.proposalMethod = 'email';
      opp.status = 'proposal-sent';
      return result;
    } catch (e) {
      return { ok: false, reason: 'Email failed: ' + e.message.slice(0, 80) };
    }
  }

  // No email — try ATS auto-submit if URL is recognizable
  if (opp.applyUrl && ATS_PATTERNS.test(opp.applyUrl)) {
    try {
      const jobLike = {
        applyUrl: opp.applyUrl,
        title: opp.title,
        company: opp.clientName,
        proposalDraft: proposal.body
      };
      const result = await autoApplyToJob(jobLike, profile, resumePath);
      if (result.ok) {
        opp.proposalSentAt = new Date().toISOString();
        opp.proposalMethod = 'ats';
        opp.status = 'proposal-sent';
        return { ok: true, reason: 'Submitted via ATS: ' + result.reason };
      }
      opp.proposalMethod = 'manual';
      return { ok: false, manual: true, reason: 'ATS submission unconfirmed: ' + result.reason, proposalDraft: proposal.body };
    } catch (e) {
      opp.proposalMethod = 'manual';
      return { ok: false, manual: true, reason: 'ATS error: ' + e.message.slice(0, 80), proposalDraft: proposal.body };
    }
  }

  // Platforms like Upwork/Internshala — login wall, manual only
  opp.proposalMethod = 'manual';
  return {
    ok: false,
    reason: 'No email and platform requires login — copy proposal and apply manually',
    manual: true,
    proposalDraft: proposal.body
  };
}

module.exports = { draftProposal, draftFollowUp, applyToOpportunity };
