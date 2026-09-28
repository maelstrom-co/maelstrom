FROM ghcr.io/maelstrom-co/voice-devtools:0.1.0

USER root
WORKDIR /work/maelstrom
# Match the installed browser version instead of installing @latest or mounting
# macOS node_modules. The base image currently pins playwright-core to 1.58.2.
RUN node -e 'const fs = require("node:fs"); const v = require("/work/e2e/node_modules/playwright-core/package.json").version; fs.writeFileSync("package.json", JSON.stringify({private:true,type:"module",devDependencies:{"@playwright/test":v}},null,2));' \
    && npm install --ignore-scripts --no-audit --no-fund \
    && chown -R pwuser:pwuser /work/maelstrom

COPY --chown=pwuser:pwuser . ./

USER pwuser
RUN node --test forward.test.mjs tests/evidence.unit.test.mjs

ENV TTS2MIC_BIN=/usr/local/bin/tts2mic-mcp \
    MAELSTROM_BASE_URL=http://localhost:3000 \
    ARTIFACT_DIR=/work/artifacts/audio \
    PLAYWRIGHT_HTML_OPEN=never \
    PLAYWRIGHT_HTML_OUTPUT_DIR=/work/artifacts/report

# Use an absolute path: the inherited entrypoint was relative to /work.
ENTRYPOINT ["bash", "/work/scripts/with-audio.sh"]
CMD ["node", "/work/maelstrom/docker-run-tests.mjs"]
