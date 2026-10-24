# Rebuild the walkthrough

Use the local Psychopomp checkout at `../psychopomp` relative to this repository.
The scene uses that checkout as a path dependency. Rust, Bun, FFmpeg, Phonon,
and the saved Garret draft voice must be available. Generated audio, word
timings, and the Scene Plan are included in the delivered source archive.

Run from the Maelstrom repository root:

```sh
bun ../psychopomp/scripts/narrate.ts apps/agui-workspace-poc/walkthrough/narration/script.json --draft
cargo run --manifest-path apps/agui-workspace-poc/walkthrough/Cargo.toml
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
