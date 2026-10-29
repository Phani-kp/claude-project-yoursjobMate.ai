import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export const aiEnabled = () => !!client;
// Shared with resume tailoring (server/src/resume.js).
export const aiClient = client;
export const AI_MODEL = MODEL;

function templateLetter(job, profile, user) {
  const skills = (profile.skills || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return `Dear ${job.company} Hiring Team,

I'm excited to apply for the ${job.title} role. ${profile.headline ? `As a ${profile.headline}` : 'As an experienced professional'}${profile.experience_years ? ` with ${profile.experience_years}+ years of experience` : ''}, I've built a strong foundation in ${skills.length ? skills.join(', ') : 'the core skills this role requires'}.

What draws me to ${job.company} is the opportunity to have real impact on the team's goals. I take ownership of my work, communicate clearly, and learn fast, and I'd welcome the chance to bring that to your team.

Thank you for your time and consideration.

Best regards,
${user.name}`;
}

/** Writes a short cover letter tailored to the job. Uses Claude when ANTHROPIC_API_KEY is set, a template otherwise. */
export async function generateCoverLetter(job, profile, user) {
  if (!client) return templateLetter(job, profile, user);
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: 'You write concise, specific, honest cover letters (180-250 words). Never invent experience that is not in the candidate profile. Output only the letter text.',
      messages: [{
        role: 'user',
        content: `Candidate: ${user.name}
Headline: ${profile.headline}
Years of experience: ${profile.experience_years}
Skills: ${profile.skills}
Resume:
${(profile.resume_text || '').slice(0, 6000)}

Job: ${job.title} at ${job.company} (${job.location})
Description:
${(job.description || '').slice(0, 4000)}`,
      }],
    });
    if (response.stop_reason === 'refusal') return templateLetter(job, profile, user);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return text || templateLetter(job, profile, user);
  } catch (e) {
    console.error('Cover letter generation failed, using template:', e.message);
    return templateLetter(job, profile, user);
  }
}
