use std::{fs, path::PathBuf};

use anyhow::Result;
use psychopomp_media::{Media, Voice};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Script {
    clips: Vec<Clip>,
}

#[derive(Deserialize)]
struct Clip {
    id: String,
    text: String,
}

fn main() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let output = root.join("narration-nacho");
    let script: Script = serde_json::from_slice(&fs::read(root.join("narration-v2/script.json"))?)?;
    let media = Media::open(&output)?;
    let voice = Voice::eleven("5UCicP8dmqTJ8xCC4Q6h")
        .v4()
        .stability(0.5)
        .similarity(0.75)
        .format("mp3_44100_128");
    let clips = script
        .clips
        .iter()
        .map(|clip| {
            let text = format!("[warm, conversational, measured pace] {}", clip.text);
            media.dialogue(&clip.id, [(&voice, text.as_str())])
        })
        .collect::<Result<Vec<_>>>()?;
    media.finish()?;

    // Keep the scene's existing Narration reader while Media owns paid generation and caching.
    let manifest = clips.iter().map(|clip| {
        let words = format!("{}.words.json", clip.id());
        let timings = clip.transcript().words().iter().map(|word| {
            json!({"word": word.word, "start": word.start, "end": word.end})
        }).collect::<Vec<_>>();
        fs::write(output.join(&words), serde_json::to_vec_pretty(&json!({"wordTimings": timings}))?)?;
        Ok(json!({"id": clip.id(), "file": clip.path(), "words": words, "durationNanos": clip.duration()}))
    }).collect::<Result<Vec<_>>>()?;
    fs::write(
        output.join("narration.json"),
        serde_json::to_vec_pretty(&json!({"clips": manifest}))?,
    )?;
    Ok(())
}
