# Rebuild the overview animation

This Scene Program produces the README animation with
[Psychopomp](https://github.com/kitlangton/psychopomp). It is an illustration of
the runtime, not a screen recording. The timing explains the sequence; it does
not measure latency. `showDay(today)` is display notation for an Action.

The GIF loops without audio. The MP4 includes sound effects and needs no
narration. The PNG provides a still alternative.

## Before you start

Use a fresh Psychopomp checkout at commit
`1813f2f1d4170679a514cb16e8678f88210b9ac4`, Rust, Bun, FFmpeg with `libx264`,
and a supported GPU. The render was verified on macOS with Metal. The title
uses macOS Helvetica; body text uses Psychopomp's bundled CommitMono.

Set these paths from the Maelstrom repository root:

```sh
export MAELSTROM_ROOT="$PWD"
export PSYCHOPOMP_ROOT="/absolute/path/to/psychopomp"
```

## Prepare the Scene Program

Copy this directory into Psychopomp's `scenes/` workspace. The Cargo manifest
resolves its dependency there, not inside the Maelstrom workspace.

```sh
cp -R "$MAELSTROM_ROOT/media/maelstrom-overview" "$PSYCHOPOMP_ROOT/scenes/maelstrom-overview"
patch -d "$PSYCHOPOMP_ROOT" -p1 < "$MAELSTROM_ROOT/media/maelstrom-overview/psychopomp-theme.patch"
```

The patch adds the `maelstrom` palette: navy surfaces, cyan requests, and violet
responses. It leaves existing palettes unchanged. Sound effects come from
Psychopomp's catalog. No API keys or generated speech are required.

## Review and render

Run these commands from the Psychopomp checkout:

```sh
cd "$PSYCHOPOMP_ROOT"
cargo run -p psychopomp-maelstrom-overview
cargo run --release -- plan validate target/maelstrom-overview/plan.json
bun scripts/sheet.ts target/maelstrom-overview/plan.json 2,7,9.8,12.4,14.5,18.5,22.5,25.9 --theme maelstrom --shutter --out output/maelstrom-sheet.jpg
cargo run --release -- plan render target/maelstrom-overview/plan.json output/maelstrom-study.mp4 --range 11.8..14.8 --theme maelstrom
```

Inspect the sheet and motion study before rendering the full 26 seconds:

```sh
cargo run --release -- plan render target/maelstrom-overview/plan.json output/maelstrom-overview-raw.mp4 --theme maelstrom
```

## Export the README assets

Normalize the sound effects, pad audio to the video duration, and preserve the
rendered video without another video encode:

```sh
ffmpeg -y -i output/maelstrom-overview-raw.mp4 \
  -map 0:v:0 -map 0:a:0 -c:v copy \
  -af 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-54.52:measured_TP=-40.42:measured_LRA=7.50:measured_thresh=-64.89:offset=0:linear=true,volume=0.5dB,apad=whole_dur=26' \
  -c:a aac -b:a 192k -ar 48000 -t 26 -movflags +faststart \
  "$MAELSTROM_ROOT/media/maelstrom-overview.mp4"
```

These loudness measurements apply to the current sound placements. If you change
them, measure the raw mix again with FFmpeg's `loudnorm` filter and update the
`measured_*` values before export.

Create the silent loop and still frame:

```sh
ffmpeg -y -i output/maelstrom-overview-raw.mp4 \
  -filter_complex 'fps=16,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle' \
  -an -loop 0 "$MAELSTROM_ROOT/media/maelstrom-overview.gif"
ffmpeg -y -ss 22.5 -i output/maelstrom-overview-raw.mp4 \
  -frames:v 1 "$MAELSTROM_ROOT/media/maelstrom-overview.png"
```

## Verify changes

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
ffprobe -v error -show_streams -show_format "$MAELSTROM_ROOT/media/maelstrom-overview.mp4"
ffmpeg -i "$MAELSTROM_ROOT/media/maelstrom-overview.mp4" -vn \
  -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
```

Expect 1920×1080 video at 60 fps, AAC audio, and 26-second video and audio
streams. Check loudness near −16 LUFS and true peaks below −1 dBFS. Inspect the
GIF at README width, especially the captions and calendar Variant change.

When changing the renderer, capture a Psychopomp `verify baseline` first. Add
the object in `verify-scene.json` to the `scenes` array in its `verify.json`,
then compare with `--expect maelstrom-overview`. The initial comparison preserved
all 240 existing baseline frames. Two other scenes had unavailable image assets
and received plan-only checks.

The runtime facts come from
[`docs/architecture.md`](../../docs/architecture.md), the client's ordered
[`set_layout` / `execute_actions` batch](../../packages/client/src/lib/orchestrator/orchestrator.ts),
and the demo's
[`showDay` definition](../../apps/demo/src/vessels/calendar.vessel.def.ts).
In particular, layout must precede Actions so an Action can target a new Instance.

Third-party terms are in [THIRD-PARTY-LICENSE](THIRD-PARTY-LICENSE).
