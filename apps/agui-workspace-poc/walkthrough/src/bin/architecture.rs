use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use psychopomp::{
    author::{PlanBuilder, seconds},
    callout::{CalloutAnchorPlan, CalloutPlan, CalloutSide},
    caption::CaptionSpanPlan,
    editor::diff::{Diff, keep},
    image::ImagePlan,
    narration::Narration,
    plan::{MediaKindPlan, MediaPlan, MediaRolePlan, ReelPlan, ScenePlan},
    score::{Beat, Callout, Caption, Image, Stage},
    stage::{StageElement as El, StagePlan, StagePost},
    tone::Tone::{Accent, Muted, Plain, Request, Success, Warning},
};

const HOST: &str = include_str!("../../../src/host.ts");
const PLANNER: &str = include_str!("../../../src/planner.ts");
const WIRE: &str = include_str!("../../../src/wire.ts");
const WORKSPACE: &str = include_str!("../../../src/workspace.ts");
const CHILD: &str = include_str!("../../../src/approved-lookup.ts");
const TESTS: &str = include_str!("../../../src/approval-flow.test.ts");
const ORCHESTRATOR: &str =
    include_str!("../../../../../packages/client/src/lib/orchestrator/orchestrator.ts");

struct CodeChapter {
    id: &'static str,
    title: &'static str,
    file: &'static str,
    source: &'static str,
    chunks: &'static [(&'static str, usize)],
    needle: &'static str,
    phrase: &'static str,
    label: &'static str,
    evidence: &'static str,
}

fn chrome(scene: &mut PlanBuilder, number: usize, title: &str, kind: &str) -> Result<()> {
    let header = Caption::header(scene, &format!("{number:02} / 13"), title)?;
    let chip = Caption::chip(scene, "kind", Accent, kind)?;
    scene.at(0, header.show().also(chip.show()));
    Ok(())
}

fn code(narration: &Narration, number: usize, part: CodeChapter) -> Result<ScenePlan> {
    let reading = narration.reading(seconds(0.8), [(part.id, seconds(1.5))])?;
    let mut scene = PlanBuilder::new(part.id, reading.duration());
    let [spoken] = reading.place(&mut scene);
    chrome(&mut scene, number, part.title, "source excerpt")?;
    let source = part.source.lines().collect::<Vec<_>>();
    let blocks = part
        .chunks
        .iter()
        .map(|(marker, count)| {
            let start = source
                .iter()
                .position(|line| line.contains(marker))
                .with_context(|| format!("{}: {marker}", part.file))?;
            Ok((start, &source[start..start + count]))
        })
        .collect::<Result<Vec<_>>>()?;
    let indent = blocks
        .iter()
        .flat_map(|(_, lines)| *lines)
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.len() - line.trim_start().len())
        .min()
        .unwrap_or(0);
    let selected = blocks
        .iter()
        .enumerate()
        .flat_map(|(index, (_, lines))| {
            let gap = (index > 0).then_some("// ...");
            gap.into_iter().chain(
                lines
                    .iter()
                    .map(|line| &line[indent.min(line.len() - line.trim_start().len())..]),
            )
        })
        .collect::<Vec<_>>();
    let focus = selected
        .iter()
        .position(|line| line.contains(part.needle))
        .context("missing focus")?;
    let lines = selected
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if index == focus {
                keep(line).range("focus", line.trim())
            } else {
                keep(line)
            }
        })
        .collect();
    let spans = blocks
        .iter()
        .map(|(start, lines)| format!("{}-{}", start + 1, start + lines.len()))
        .collect::<Vec<_>>()
        .join(", ");
    let file = format!(
        "{}:{}",
        part.file.rsplit('/').next().unwrap_or(part.file),
        spans
    )
    .leak();
    let editor = Diff {
        file_name: file,
        lines,
    }
    .declare(&mut scene, &[], 0, true)?;
    editor.target(&mut scene, "focus", focus, "focus")?;
    let plan = CalloutPlan {
        size: 20.0,
        ..CalloutPlan::new(
            CalloutAnchorPlan::Editor {
                id: "focus".into(),
                target: "focus".into(),
                edge: CalloutSide::Left,
                side: None,
            },
            vec![CaptionSpanPlan::new(part.label, Success)],
        )
        .side(CalloutSide::Left)
        .reach(100.0)
        .chip()
    };
    let callout = Callout::declare(&mut scene, "annotation", &plan)?;
    scene.at(spoken.at(part.phrase), callout.show());
    let footer = Caption::footer(&mut scene, "evidence", &[(part.evidence, Muted)])?;
    scene.at(spoken.at(part.phrase) + seconds(1.2), footer.show());
    Ok(scene.finish()?)
}

fn architecture(narration: &Narration) -> Result<ScenePlan> {
    let reading = narration.reading(seconds(0.8), [("architecture", seconds(1.5))])?;
    let mut scene = PlanBuilder::new("architecture", reading.duration());
    let [spoken] = reading.place(&mut scene);
    chrome(
        &mut scene,
        1,
        "Who owns each part of the goal?",
        "architecture",
    )?;
    let stage = Stage::declare(
        &mut scene,
        "system",
        &StagePlan {
            post: StagePost::RESTRAINED,
            elements: vec![
                El::card(
                    "host",
                    [520.0, 340.0, 0.0],
                    [490.0, 145.0],
                    "Host / TanStack chat()",
                )
                .statuses(&[("server · goal + continuation", Plain)])
                .tone(Request),
                El::card(
                    "engine",
                    [1390.0, 340.0, 0.0],
                    [490.0, 145.0],
                    "Maelstrom Engine",
                )
                .statuses(&[("server · validates candidates", Plain)])
                .tone(Accent),
                El::card(
                    "browser",
                    [520.0, 720.0, 0.0],
                    [490.0, 145.0],
                    "Orchestrator + React Chart",
                )
                .statuses(&[("browser · layout + Actions", Plain)])
                .tone(Success),
                El::card(
                    "store",
                    [1390.0, 720.0, 0.0],
                    [490.0, 145.0],
                    "Application record store",
                )
                .statuses(&[("loopback server · ID + version", Plain)]),
                El::beam("validate", "host", "engine"),
                El::beam("transport", "host", "browser"),
                El::beam("create", "browser", "store"),
                El::packet("proposal", "validate")
                    .labeled("candidate")
                    .tone(Accent),
                El::packet("apply", "transport")
                    .labeled("AG-UI / SSE")
                    .tone(Request),
                El::packet("write", "create")
                    .labeled("POST /record")
                    .tone(Success),
            ],
        },
    )?;
    scene.at(0, stage.settle_in("host"));
    scene.at(
        spoken.at("engine checks"),
        stage
            .settle_in("engine")
            .then(stage.connect("validate", 0.5))
            .then(stage.send("proposal", 0.7))
            .then(stage.land("engine")),
    );
    scene.at(
        spoken.at("HTTP boundary"),
        stage
            .settle_in("browser")
            .then(stage.connect("transport", 0.5))
            .then(stage.send("apply", 0.7))
            .then(stage.land("browser")),
    );
    scene.at(
        spoken.at("application still"),
        stage
            .settle_in("store")
            .then(stage.connect("create", 0.5))
            .then(stage.send("write", 0.7))
            .then(stage.land("store")),
    );
    let footer = Caption::footer(
        &mut scene,
        "scope",
        &[(
            "New code: apps/agui-workspace-poc/   |   Published packages unchanged",
            Plain,
        )],
    )?;
    scene.at(spoken.at("private app"), footer.show());
    Ok(scene.finish()?)
}

fn browser(narration: &Narration) -> Result<ScenePlan> {
    let reading = narration.reading(seconds(0.8), [("browser", seconds(1.5))])?;
    let mut scene = PlanBuilder::new("browser", reading.duration());
    let [spoken] = reading.place(&mut scene);
    chrome(
        &mut scene,
        8,
        "Inspect the workspace while the child waits",
        "Chromium evidence",
    )?;
    let image = Image::declare(
        &mut scene,
        "browser",
        &ImagePlan::new("waiting", [960.0, 550.0], 1340.0).framed(),
        MediaPlan {
            id: "waiting".into(),
            path: "assets/approval-pause.png".into(),
            kind: MediaKindPlan::Image,
            role: MediaRolePlan::Layer,
            source_start_nanos: 0,
            source_end_nanos: reading.duration(),
            timeline_start_nanos: 0,
            timeline_end_nanos: reading.duration(),
            gain_db: 0.0,
        },
    )?;
    scene.at(0, image.fly_in());
    let footer = Caption::footer(
        &mut scene,
        "checkpoint",
        &[(
            "Paused: creates = 1, child reads = 0, focused = none",
            Success,
        )],
    )?;
    scene.at(spoken.at("record already exists"), footer.show());
    Ok(scene.finish()?)
}

fn verdict(narration: &Narration) -> Result<ScenePlan> {
    let reading = narration.reading(seconds(0.8), [("verdict", seconds(1.5))])?;
    let mut scene = PlanBuilder::new("verdict", reading.duration());
    let [spoken] = reading.place(&mut scene);
    chrome(
        &mut scene,
        13,
        "What we can conclude, and what comes next",
        "experiment verdict",
    )?;
    let stage = Stage::declare(
        &mut scene,
        "verdict",
        &StagePlan {
            post: StagePost::RESTRAINED,
            elements: vec![
                El::card(
                    "verified",
                    [520.0, 400.0, 0.0],
                    [640.0, 180.0],
                    "Verified in the combined flow",
                )
                .statuses(&[("create → approval → read → focus", Success)]),
                El::card(
                    "limits",
                    [1400.0, 400.0, 0.0],
                    [640.0, 180.0],
                    "Still a private fixture",
                )
                .statuses(&[("scripted models · in-memory host", Warning)]),
                El::card(
                    "next",
                    [960.0, 760.0, 0.0],
                    [980.0, 130.0],
                    "Next: reconcile a lost acknowledgment",
                )
                .statuses(&[("recover the outcome without repeating create", Plain)]),
            ],
        },
    )?;
    scene.at(0, stage.settle_in("verified"));
    scene.at(spoken.at("Model choices"), stage.settle_in("limits"));
    scene.at(spoken.at("next useful experiment"), stage.settle_in("next"));
    Ok(scene.finish()?)
}

fn main() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let narration = Narration::load(&root.join("narration-v2"))?;
    let chapters = [
        CodeChapter {
            id: "planner",
            title: "Propose a layout and one declared Action",
            file: "src/planner.ts",
            source: PLANNER,
            chunks: &[("layout: {", 14)],
            needle: "instanceId: 'notes-1'",
            phrase: "same instance",
            label: "same Instance",
            evidence: "The Engine validates this candidate against the registered Notes capability.",
        },
        CodeChapter {
            id: "wire",
            title: "Dispatch only a complete frontend call",
            file: "src/wire.ts",
            source: WIRE,
            chunks: &[
                ("const terminal = events.at(-1);", 4),
                ("if (endIndex <= startIndex)", 1),
                ("const argumentsJson = events", 7),
            ],
            needle: "endIndex <= startIndex",
            phrase: "completed arguments",
            label: "requires CALL_END",
            evidence: "Truncated delivery fails before Workspace.apply() can dispatch an Action.",
        },
        CodeChapter {
            id: "mount",
            title: "Apply layout before running Actions",
            file: "client/orchestrator.ts",
            source: ORCHESTRATOR,
            chunks: &[
                ("const layoutCommand =", 9),
                ("return this.#commandProcessor.dispatchSettled(", 4),
            ],
            needle: "layoutCommand,",
            phrase: "batch first",
            label: "ordered batch",
            evidence: "Existing client code. React useActions registers the newly mounted runner.",
        },
        CodeChapter {
            id: "settlement",
            title: "Wait for outcomes before acknowledging",
            file: "src/workspace.ts",
            source: WORKSPACE,
            chunks: &[
                ("const release = this.orchestrator", 8),
                ("actions.every((a)", 4),
            ],
            needle: "waitForIdle()",
            phrase: "become idle",
            label: "await settlement",
            evidence: "Action status + structural snapshot; the record ID requires an explicit read.",
        },
        CodeChapter {
            id: "correlation",
            title: "Reject an acknowledgment for the wrong operation",
            file: "src/host.ts",
            source: HOST,
            chunks: &[("ack.callId !==", 6), ("ack.status === 'applied'", 5)],
            needle: "ack.revision !==",
            phrase: "revision",
            label: "expected + 1",
            evidence: "Delayed work waits. A stale result is rejected. Unknown outcomes stop the goal.",
        },
        CodeChapter {
            id: "child",
            title: "Add a native child with an approval checkpoint",
            file: "src/approved-lookup.ts",
            source: CHILD,
            chunks: &[("const read = toolDefinition", 7), ("return ctx.chat({", 6)],
            needle: "needsApproval: true",
            phrase: "Needs approval",
            label: "pauses the read",
            evidence: "ctx.forward preserves the child identity and resume fields across parent runs.",
        },
        CodeChapter {
            id: "resume",
            title: "Accept only the pending child's answer",
            file: "src/host.ts",
            source: HOST,
            chunks: &[("if (resumingChild) {", 13)],
            needle: "resume[0]?.interruptId",
            phrase: "exact interrupt identifier",
            label: "bound answer",
            evidence: "Approval mode adds this branch; the previous host rejected every resume field.",
        },
        CodeChapter {
            id: "envelope",
            title: "Normalize the resumed run at the wire boundary",
            file: "src/host.ts",
            source: HOST,
            chunks: &[
                ("const start = {", 8),
                ("host.history = MessagesSnapshotEventSchema.parse({", 5),
            ],
            needle: "uiMessagesToWire",
            phrase: "serializes the final snapshot",
            label: "AG-UI messages",
            evidence: "The host owns the outer run start; boundary.ts retains one terminal event.",
        },
        CodeChapter {
            id: "dependent",
            title: "Bind the observed ID and version into focus",
            file: "src/host.ts",
            source: HOST,
            chunks: &[
                ("const result = z", 4),
                ("expectedRevision: settled.revision,", 7),
            ],
            needle: "candidate(fact)",
            phrase: "next engine plan",
            label: "observed record",
            evidence: "One user goal; four runs when approval pauses the child between create and focus.",
        },
        CodeChapter {
            id: "failures",
            title: "Disconnect the child and check the side effects",
            file: "src/approval-flow.test.ts",
            source: TESTS,
            chunks: &[("await ready;", 8)],
            needle: "reads).toBe(0)",
            phrase: "zero reads",
            label: "no read or focus",
            evidence: "24 tests + Chromium approval/denial checks. A fresh host refuses old continuation.",
        },
    ];
    let middle = chapters
        .into_iter()
        .enumerate()
        .flat_map(|(index, chapter)| {
            let number = if index < 6 { index + 2 } else { index + 3 };
            (index == 6)
                .then(|| browser(&narration))
                .into_iter()
                .chain(std::iter::once(code(&narration, number, chapter)))
        });
    let scenes = std::iter::once(architecture(&narration))
        .chain(middle)
        .chain(std::iter::once(verdict(&narration)))
        .map(|scene| {
            let scene = scene?;
            // Narration::load assumes the original narration/ directory.
            let media = scene
                .media
                .into_iter()
                .map(|media| {
                    let path = match media.path.strip_prefix("narration") {
                        Ok(file) => PathBuf::from("narration-v2").join(file),
                        Err(_) => media.path.clone(),
                    };
                    MediaPlan { path, ..media }
                })
                .collect();
            Ok(ScenePlan { media, ..scene })
        })
        .collect::<Result<Vec<_>>>()?;
    let reel = ReelPlan::dipped("agui-architecture-code", scenes, seconds(0.6))?;
    fs::write(
        root.join("architecture.reel.json"),
        serde_json::to_string_pretty(&reel)?,
    )?;
    println!("{:.2}s", reel.duration_nanos() as f64 / 1e9);
    Ok(())
}
