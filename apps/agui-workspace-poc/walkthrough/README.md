# Rebuild the walkthrough

## Final narration in Nacho's voice

The final cut uses ElevenLabs `eleven_v4` with the saved Nacho voice, stability
`0.5`, and similarity `0.75`. Its delivery cue is warm, conversational, and
measured. The scene uses provider word alignment to retime every phrase anchor.

`src/bin/voice.rs` reads the same script as the draft. Psychopomp Media saves
each generated clip in `narration-nacho/media.lock.json` and reuses it on later
runs. Set `ELEVENLABS_API_KEY` in the environment for new generations.

```sh
PSYCHOPOMP_MEDIA=plan cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml --bin voice
cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml --bin voice
cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml --bin architecture -- nacho
../psychopomp/target/release/psychopomp plan validate apps/agui-workspace-poc/walkthrough/architecture-nacho.reel.json
../psychopomp/target/release/psychopomp plan render apps/agui-workspace-poc/walkthrough/architecture-nacho.reel.json tmp/research/agui-architecture-nacho-raw.mp4 --theme neutral
```

Plan mode exits with a cost estimate when audio needs generating. Once generated,
the voice command reports 13 cached clips and zero API calls.

The delivered files are in `~/Movies/`:

- `maelstrom-agui-architecture-code-nacho.mp4`: retimed 334.13-second film.
- `maelstrom-agui-architecture-code-nacho.m4a`: audio-only export.
- `maelstrom-agui-architecture-code-nacho-source.tar.gz`: editable source and media.

The final MP4 is 1920×1080 at 60 fps with H.264 video and AAC audio. After the
audio-only normalization pass, it measures `-16.51 LUFS` and `-1.43 dBTP`.
The archive includes the generation lock, voice assets, and provider word timings.

## Architectural and code walkthrough

The replacement film uses `src/bin/architecture.rs` and `narration-v2/script.json`.
It embeds actual source excerpts from the PoC and the existing Orchestrator.
Its browser frame comes from the approved Playwright run. Run that check before
rebuilding the scene assets:

```sh
APPROVAL=1 bun apps/agui-workspace-poc/src/browser-check.ts
mkdir -p apps/agui-workspace-poc/walkthrough/assets
ffmpeg -y -i tmp/research/agui-approve-waiting.png -vf crop=1050:600:0:0 -frames:v 1 -update 1 apps/agui-workspace-poc/walkthrough/assets/approval-pause.png
bun ../psychopomp/scripts/narrate.ts apps/agui-workspace-poc/walkthrough/narration-v2/script.json --draft
cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml --bin architecture
../psychopomp/target/release/psychopomp plan validate apps/agui-workspace-poc/walkthrough/architecture.reel.json
../psychopomp/target/release/psychopomp plan render apps/agui-workspace-poc/walkthrough/architecture.reel.json tmp/research/agui-architecture-code.mp4 --theme neutral
```

The film has 13 sections and lasts 332.53 seconds. Source excerpts retain their
file and line references. Gaps are marked with `// ...`. Narration anchors time
the diagram messages and code annotations. The code panels show current source,
not a fabricated diff.

Delivered artifacts:

- Video: `~/Movies/maelstrom-agui-architecture-code-v2.mp4`
- Editable archive: `~/Movies/maelstrom-agui-architecture-code-v2-source.tar.gz`

The final export is 1920×1080 at 60 fps with H.264 video and AAC narration.
Its audio measures `-16.34 LUFS` and `-1.36 dBTP` after normalization. The archive
includes both narration directories, word timings, the browser image, generated
plans, and the source files embedded by the scene. Extract it into a repository
folder beside the Psychopomp checkout to retain the relative paths.

## Original overview

Use the local Psychopomp checkout at `../psychopomp` relative to this repository.
The scene uses that checkout as a path dependency. Rust, Bun, FFmpeg, Phonon,
and the saved Garret draft voice must be available. Generated audio, word
timings, and the Scene Plan are included in the delivered source archive.

Run from the Maelstrom repository root:

```sh
bun ../psychopomp/scripts/narrate.ts apps/agui-workspace-poc/walkthrough/narration/script.json --draft
cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml --bin agui-workspace-walkthrough
../psychopomp/target/release/psychopomp plan validate apps/agui-workspace-poc/walkthrough/walkthrough.reel.json
../psychopomp/target/release/psychopomp plan render apps/agui-workspace-poc/walkthrough/walkthrough.reel.json tmp/research/agui-walkthrough.mp4 --theme neutral
```

The generated reel lasts 95.4 seconds. The renderer exports 1920×1080 at 60 fps
with AAC narration. Phrase anchors bind the animation to the word timings.
The delivered MP4 has a final audio-only loudness pass targeting `-16 LUFS`.

The source follows Psychopomp's Stage walkthrough examples. It is a standalone
crate here because the active Psychopomp checkout contains concurrent scene work.
It changes no renderer source or existing scene. Its checks are `cargo fmt
--check` and `cargo clippy --all-targets -- -D warnings`, with the same manifest
argument. Plan validation, contact sheets, and a short motion render verify the
scene; it has no separate Rust unit tests.
