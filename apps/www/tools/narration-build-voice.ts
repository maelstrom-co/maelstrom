import { narrationVoiceHash } from './blog-narration-publication';

const voiceId = process.env.ELEVENLABS_MYVOICE_ID?.trim();
const voiceRevision = process.env.ELEVENLABS_MYVOICE_REVISION?.trim();
if (voiceId && voiceRevision)
  console.log(await narrationVoiceHash({ voiceId, voiceRevision }));
