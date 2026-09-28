export SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

export MAELSTROM_ROOT=$( cd -- "$SCRIPT_DIR/../../.." &> /dev/null && pwd )
export FIXTURES="$SCRIPT_DIR/audio"

mkdir -p "$FIXTURES"


# Add the Maelstrom test and host-port forwarding.
docker build \
  -t maelstrom-voice-test \
  "$SCRIPT_DIR"

docker run --name voice-devtools-prepare \
  --entrypoint /usr/local/bin/tts2mic-mcp \
  -e TTS_PROVIDER=elevenlabs \
  -e ELEVENLABS_API_KEY \
  -e ELEVENLABS_VOICE_ID \
  -e ELEVENLABS_OUTPUT_FORMAT=pcm_16000 \
  ghcr.io/maelstrom-co/voice-devtools:0.1.0 \
  prepare \
  --text "Close the calendar and leave only the existing tasks panel." \
  --out /work/only-tasks.wav

docker cp \
  voice-devtools-prepare:/work/only-tasks.wav \
  "$FIXTURES/only-tasks.wav"

docker rm voice-devtools-prepare



afplay "$FIXTURES/only-tasks.wav"

docker run --name maelstrom-voice-run \
  --init \
  --shm-size=1g \
  --mount "type=bind,src=$FIXTURES,dst=/work/maelstrom/e2e/voice/audio,readonly" \
  maelstrom-voice-test


export ARTIFACTS="$MAELSTROM_ROOT/apps/demo/dist/docker-voice"
mkdir -p "$ARTIFACTS"

docker cp \
  maelstrom-voice-run:/work/artifacts/. \
  "$ARTIFACTS/"

docker logs maelstrom-voice-run \
  > "$ARTIFACTS/docker.log" 2>&1

docker rm maelstrom-voice-run

open "$ARTIFACTS/report/index.html"

