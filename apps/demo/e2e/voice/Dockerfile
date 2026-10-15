FROM ghcr.io/maelstrom-co/voice-devtools:0.1.0

USER root
WORKDIR /work/maelstrom
# Match the installed browser version instead of installing @latest or mounting
# macOS node_modules. The base image currently pins playwright-core to 1.58.2.
RUN node -e 'const fs = require("node:fs"); const v = require("/work/e2e/node_modules/playwright-core/package.json").version; fs.writeFileSync("package.json", JSON.stringify({private:true,type:"module",devDependencies:{"@playwright/test":v,"tsx":"^4.20.6"}},null,2));' \
    && npm install --ignore-scripts --no-audit --no-fund \
    && chown -R pwuser:pwuser /work/maelstrom

COPY --chown=pwuser:pwuser . ./

USER pwuser
RUN node_modules/.bin/tsx --test forward.node-test.ts runner-target.node-test.ts benchmark-selection.unit.node-test.ts tests/evidence.unit.node-test.ts tests/reply-recorder.unit.node-test.ts tests/benchmark-metrics.unit.node-test.ts tests/barge-in-measurement.unit.node-test.ts tests/barge-in-observer.unit.node-test.ts tests/barge-in-report.unit.node-test.ts tests/controlled-reference-microphone.unit.node-test.ts tests/task-barge-in-gate.unit.node-test.ts tests/shared-audio-timeline.unit.node-test.ts tests/session-audio-artifacts.unit.node-test.ts tests/tts-cache-dir.node-test.ts tests/inter-turn-schedule.unit.node-test.ts tests/playback-observability.unit.node-test.ts tests/single-turn-validity.unit.node-test.ts tests/voice-test-driver.unit.node-test.ts \
    && node_modules/.bin/playwright test --config playwright.voice.config.ts tests/key-bootstrap.live.e2e.ts --reporter=line

ENV TTS2MIC_BIN=/usr/local/bin/tts2mic-mcp \
    MAELSTROM_BASE_URL="" \
    ARTIFACT_DIR=/work/artifacts/audio \
    PLAYWRIGHT_HTML_OPEN=never \
    PLAYWRIGHT_NO_COPY_PROMPT=1 \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/work/artifacts/report

# Use an absolute path: the inherited entrypoint was relative to /work.
ENTRYPOINT ["bash", "/work/scripts/with-audio.sh"]
CMD ["/work/maelstrom/node_modules/.bin/tsx", "/work/maelstrom/docker-run-tests.ts"]
