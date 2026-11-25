import { authorizeHeldAttempt } from './blog-narration-attempt';
import { recoverProductionNarration } from './blog-narration-production-publication';
import { putImmutableNarrationAsset } from './preview-narration-delivery';
import {
  narrationCacheClient,
  readNarrationConfig,
  requiredNarrationSetting,
  signedNarrationStore,
} from './publish-blog-narration';

const client = narrationCacheClient();
if (process.argv[2] === 'authorize') {
  const required = requiredNarrationSetting;
  const rawIndex = required('NARRATION_RETRY_CHUNK');
  if (!/^(?:0|[1-9]\d{0,3})$/u.test(rawIndex))
    throw new Error('Invalid narration chunk index');
  await authorizeHeldAttempt(signedNarrationStore(client), {
    version: required('NARRATION_RETRY_VERSION'),
    index: Number(rawIndex),
    attemptId: required('NARRATION_RETRY_ATTEMPT'),
  });
  console.log(
    'One narration attempt is authorized for the next eligible publisher.',
  );
} else {
  const publication = readNarrationConfig();
  const outcome = await recoverProductionNarration({
    publication,
    prioritizeRecent: process.env.GITHUB_EVENT_NAME === 'workflow_run',
    readDelivery: (key) => publication.store.get(key),
    deliver: (path, value, type) =>
      putImmutableNarrationAsset(client, path, value, type),
    report: (message) => console.log(message),
  });
  console.log(
    outcome.skipped ?? `Published ${outcome.published} production recordings.`,
  );
}
