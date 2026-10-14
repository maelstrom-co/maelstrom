export type ControlledReferenceObservation = {
  readonly status: 'not-requested' | 'verified' | 'unavailable';
  readonly reason: string | null;
  readonly sameDevice: boolean | null;
  readonly referenceDspOff: boolean | null;
  readonly appTrackUnchanged: boolean | null;
};

export type ControlledReferenceWindow = Window & {
  __voiceReferenceMicrophone?: {
    acquire(
      native: MediaDevices['getUserMedia'],
      app: MediaStream,
    ): Promise<MediaStream>;
    snapshot(): ControlledReferenceObservation;
    dispose(): void;
  };
};

export function installControlledMicrophoneReference(configuration: {
  readonly acquisitionTimeoutMs: number;
}): void;
export function installControlledMicrophoneReference(): void;
export function installControlledMicrophoneReference(
  configuration = { acquisitionTimeoutMs: 2_000 },
): void {
  const target = window as ControlledReferenceWindow;
  if (target.__voiceReferenceMicrophone) return;
  const owned = new Set<MediaStreamTrack>();
  let disposed = false;
  let acquiring = false;
  let appTrack: MediaStreamTrack | undefined;
  let reference: MediaStream | undefined;
  let observation: ControlledReferenceObservation = {
    status: 'not-requested',
    reason: null,
    sameDevice: null,
    referenceDspOff: null,
    appTrackUnchanged: null,
  };
  const retireOwned = () => {
    for (const track of owned) if (track.readyState !== 'ended') track.stop();
    owned.clear();
  };
  const fail = (reason: string): never => {
    observation = { ...observation, status: 'unavailable', reason };
    retireOwned();
    throw new Error(`Controlled fixture reference unavailable: ${reason}`);
  };
  const fingerprint = (settings: MediaTrackSettings) =>
    JSON.stringify(
      Object.entries(settings).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  const settingsOf = (track: MediaStreamTrack): MediaTrackSettings => {
    try {
      return track.getSettings();
    } catch {
      return fail('settings-unverifiable');
    }
  };
  const unavailable = () => observation.status === 'unavailable';
  target.__voiceReferenceMicrophone = {
    async acquire(native, app) {
      if (disposed) return fail('disposed');
      if (unavailable())
        return fail(observation.reason ?? 'reference-unavailable');
      if (acquiring) return fail('concurrent-reference-acquisition');
      const tracks = app.getAudioTracks();
      const track = tracks[0];
      if (tracks.length !== 1 || !track) return fail('ambiguous-app-track');
      if (appTrack && appTrack !== track) return fail('app-track-changed');
      if (reference) return reference;
      appTrack = track;
      const before = settingsOf(track);
      const enabledBefore = track.enabled;
      if (!before.deviceId) return fail('device-unverifiable');
      if (!enabledBefore || track.readyState !== 'live')
        return fail('app-track-not-active');
      const beforeFingerprint = fingerprint(before);
      let acquired: MediaStream;
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remember = (stream: MediaStream) => {
        for (const candidate of stream.getTracks())
          if (!app.getTracks().includes(candidate)) owned.add(candidate);
      };
      try {
        acquiring = true;
        const acquisition = native({
          audio: {
            deviceId: { exact: before.deviceId },
            echoCancellation: { exact: false },
            noiseSuppression: { exact: false },
            autoGainControl: { exact: false },
          },
        });
        void acquisition.then(
          (stream) => {
            if (expired || disposed || unavailable()) {
              remember(stream);
              retireOwned();
            }
          },
          () => {},
        );
        acquired = await Promise.race([
          acquisition,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(new Error('Reference acquisition timeout'));
            }, configuration.acquisitionTimeoutMs);
          }),
        ]);
      } catch {
        return fail(
          expired
            ? 'reference-acquisition-timed-out'
            : 'reference-acquisition-failed',
        );
      } finally {
        acquiring = false;
        clearTimeout(timer);
      }
      remember(acquired);
      if (disposed) return fail('disposed');
      if (unavailable())
        return fail(observation.reason ?? 'reference-unavailable');
      const candidates = acquired.getAudioTracks();
      const candidate = candidates[0];
      if (candidates.length !== 1 || !candidate || candidate === track)
        return fail('reference-track-not-independent');
      const actual = settingsOf(candidate);
      observation = {
        status: 'unavailable',
        reason: null,
        sameDevice: actual.deviceId === before.deviceId,
        referenceDspOff:
          actual.echoCancellation === false &&
          actual.noiseSuppression === false &&
          actual.autoGainControl === false,
        appTrackUnchanged:
          fingerprint(settingsOf(track)) === beforeFingerprint &&
          track.enabled === enabledBefore &&
          track.readyState === 'live',
      };
      if (!observation.sameDevice) return fail('reference-device-mismatch');
      if (!observation.referenceDspOff)
        return fail('reference-dsp-unverifiable');
      if (!observation.appTrackUnchanged)
        return fail('app-track-settings-changed');
      if (!candidate.enabled || candidate.readyState !== 'live')
        return fail('reference-track-not-active');
      reference = acquired;
      observation = { ...observation, status: 'verified' };
      return acquired;
    },
    snapshot: () => ({ ...observation }),
    dispose() {
      disposed = true;
      retireOwned();
      delete target.__voiceReferenceMicrophone;
    },
  };
}
