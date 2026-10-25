use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use psychopomp::{
    author::{PlanBuilder, millis, seconds},
    callout::{CalloutAnchorPlan, CalloutPlan, CalloutSide},
    caption::CaptionSpanPlan,
    editor::diff::{Diff, keep},
    image::ImagePlan,
    narration::{Narration, Spoken},
    plan::{MediaKindPlan, MediaPlan, MediaRolePlan, ReelPlan, ScenePlan},
    score::{Beat, Callout, Caption, CueTime, Image, Stage, Subtitles, stagger},
    stage::{StageElement as El, StagePlan, StagePost},
    subtitles::SubtitlesPlan,
    tone::Tone::{Accent, Error, Muted, Plain, Request, Success, Warning},
};

const ORCHESTRATOR: &str =
    include_str!("../../../../../packages/client/src/lib/orchestrator/orchestrator.ts");

fn scene<'a>(
    narration: &'a Narration,
    id: &str,
    title: &str,
    tag: &str,
) -> Result<(PlanBuilder, Spoken<'a>)> {
    let reading = narration.reading(seconds(0.8), [(id, seconds(1.3))])?;
    let mut scene = PlanBuilder::new(id, reading.duration());
    let [spoken] = reading.place(&mut scene);
    let header = Caption::header(&mut scene, "#344", title)?;
    let chip = Caption::chip(&mut scene, "kind", Accent, tag)?;
    let subtitles = Subtitles::declare(
        &mut scene,
        "subtitles",
        &SubtitlesPlan::from_spoken(&spoken, [960.0, 965.0], 1500.0).size(30.0),
    )?;
    scene.at(0, header.show().also(chip.show()).also(subtitles.show()));
    Ok((scene, spoken))
}

fn stage(scene: &mut PlanBuilder, elements: Vec<El>) -> Result<Stage> {
    Stage::declare(
        scene,
        "stage",
        &StagePlan {
            post: StagePost::RESTRAINED,
            elements,
        },
    )
}

fn footer(scene: &mut PlanBuilder, text: &str) -> Result<()> {
    let caption = Caption::footer(scene, "footer", &[(text, Muted)])?;
    scene.at(0, caption.show());
    Ok(())
}

fn intro(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "intro",
        "same demo · explicit completion",
        "what to observe",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card(
                "demo",
                [370.0, 500.0, 0.0],
                [440.0, 160.0],
                "same application",
            )
            .statuses(&[("Chart · Vessels · native voice", Plain)])
            .tone(Request),
            El::card(
                "protocol",
                [960.0, 500.0, 0.0],
                [440.0, 160.0],
                "protocol exchange",
            )
            .statuses(&[("plan → apply → acknowledge", Plain)])
            .tone(Accent),
            El::card(
                "runtime",
                [1550.0, 500.0, 0.0],
                [440.0, 160.0],
                "shared runtime",
            )
            .statuses(&[("demo + headless consumers", Plain)])
            .tone(Success),
            El::beam("request", "demo", "protocol"),
            El::beam("result", "protocol", "runtime"),
            El::packet("input", "request").tone(Request),
            El::packet("evidence", "result").tone(Success),
        ],
    )?;
    scene.at(0, s.settle_in("demo"));
    scene.at(
        spoken.at("protocol exchange"),
        s.settle_in("protocol")
            .then(s.connect("request", 0.5))
            .then(s.send("input", 0.7))
            .then(s.land("protocol")),
    );
    scene.at(
        spoken.at("reusable integration"),
        s.settle_in("runtime")
            .then(s.connect("result", 0.5))
            .then(s.send("evidence", 0.7))
            .then(s.land("runtime")),
    );
    footer(
        &mut scene,
        "opt-in workspace transport · experimental private package",
    )?;
    Ok(scene.finish()?)
}

fn screenshot(
    scene: &mut PlanBuilder,
    id: &str,
    path: &str,
    origin: [f32; 2],
    width: f32,
    duration: u64,
) -> Result<Image> {
    Image::declare(
        scene,
        id,
        &ImagePlan::new(id, origin, width).framed(),
        MediaPlan {
            id: id.into(),
            path: path.into(),
            kind: MediaKindPlan::Image,
            role: MediaRolePlan::Layer,
            source_start_nanos: 0,
            source_end_nanos: duration,
            timeline_start_nanos: 0,
            timeline_end_nanos: duration,
            gain_db: 0.0,
        },
    )
}

fn browser(narration: &Narration, id: &str) -> Result<ScenePlan> {
    let title = if id == "native" {
        "baseline: Maelstrom mode"
    } else {
        "switch: AG-UI mode"
    };
    let (mut scene, spoken) = scene(narration, id, title, "local fixture · real UI")?;
    let duration = spoken.end() + seconds(1.3);
    let full = screenshot(
        &mut scene,
        "workspace",
        &format!("assets/{id}.png"),
        [960.0, 495.0],
        1200.0,
        duration,
    )?;
    let header = screenshot(
        &mut scene,
        "selector",
        &format!("assets/{id}-header.png"),
        [960.0, 230.0],
        1060.0,
        duration,
    )?;
    scene.at(0, full.fly_in());
    scene.at(seconds(0.9), header.fly_in());
    let phrase = if id == "native" {
        "observe the entry appear"
    } else {
        "same visible workspace"
    };
    scene.at(spoken.at(phrase), header.hide());
    let annotation = Callout::declare(
        &mut scene,
        "result",
        &CalloutPlan::new(
            CalloutAnchorPlan::Point {
                id: "entry".into(),
                at: [410.0, 243.0],
                side: None,
            },
            vec![CaptionSpanPlan::new("same Journal renderer", Success)],
        )
        .side(CalloutSide::BottomRight)
        .reach(80.0)
        .chip(),
    )?;
    scene.at(spoken.at(phrase) + seconds(0.7), annotation.show());
    footer(
        &mut scene,
        if id == "native" {
            "fixed planner output · no live model or audio claim"
        } else {
            "fresh workspace session · voice disconnects · tab data remains"
        },
    )?;
    Ok(scene.finish()?)
}

fn wire(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "wire",
        "inspect the WebSocket boundary",
        "protocol diagram",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card("native", [450.0, 325.0, 0.0], [600.0, 150.0], "native /ws").statuses(&[
                ("chart_request", Request),
                ("engine.maelstrom.response", Success),
            ]),
            El::card(
                "plan",
                [1350.0, 325.0, 0.0],
                [650.0, 150.0],
                "AG-UI planning run",
            )
            .statuses(&[
                ("RUN_STARTED", Request),
                ("CUSTOM workspace-result", Accent),
                ("RUN_FINISHED", Success),
            ]),
            El::card(
                "apply",
                [1350.0, 640.0, 0.0],
                [650.0, 150.0],
                "AG-UI application run",
            )
            .statuses(&[("CUSTOM application-result", Success)]),
            El::beam("ack", "plan", "apply"),
            El::packet("evidence", "ack")
                .labeled("correlated evidence")
                .tone(Success),
        ],
    )?;
    scene.at(0, s.settle_in("native"));
    scene.at(
        spoken.at("Engine response"),
        s.swap_status("native", [0, 1], 0.35),
    );
    scene.at(spoken.at("wraps planning"), s.settle_in("plan"));
    scene.at(
        spoken.at("custom workspace result"),
        s.swap_status("plan", [0, 1], 0.35),
    );
    scene.at(
        spoken.at("then finished"),
        s.swap_status("plan", [1, 2], 0.35),
    );
    scene.at(
        spoken.at("second run"),
        s.settle_in("apply")
            .then(s.connect("ack", 0.5))
            .then(s.send("evidence", 0.6))
            .then(s.land("apply")),
    );
    footer(
        &mut scene,
        "private demo.agui.run ingress · native history controls still share the socket",
    )?;
    Ok(scene.finish()?)
}

fn settlement(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "settlement",
        "a response is not application success",
        "one client FIFO",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card(
                "layout",
                [360.0, 360.0, 0.0],
                [440.0, 140.0],
                "1 · set layout",
            )
            .statuses(&[("mount target Instances", Plain)])
            .tone(Request),
            El::card(
                "actions",
                [960.0, 360.0, 0.0],
                [440.0, 140.0],
                "2 · execute Actions",
            )
            .statuses(&[("record actual outcomes", Plain)])
            .tone(Accent),
            El::card(
                "snapshot",
                [1560.0, 360.0, 0.0],
                [440.0, 140.0],
                "3 · capture snapshot",
            )
            .statuses(&[("authoritative client state", Plain)])
            .tone(Success),
            El::card(
                "ack",
                [1560.0, 700.0, 0.0],
                [440.0, 140.0],
                "4 · acknowledge",
            )
            .statuses(&[("server accepts evidence", Success)]),
            El::card(
                "next",
                [640.0, 700.0, 0.0],
                [700.0, 140.0],
                "5 · admit next intent",
            )
            .statuses(&[("typed + voice use the same queue", Plain)]),
            El::beam("mounted", "layout", "actions"),
            El::beam("settled", "actions", "snapshot"),
            El::beam("report", "snapshot", "ack"),
            El::beam("admit", "ack", "next"),
            El::packet("ready", "mounted").tone(Request),
            El::packet("outcome", "settled").tone(Success),
            El::packet("evidence", "report").tone(Success),
            El::packet("release", "admit").tone(Success),
        ],
    )?;
    scene.at(spoken.at("layout first"), s.settle_in("layout"));
    let action = scene.at(
        spoken.at("executes Actions"),
        s.settle_in("actions")
            .then(s.connect("mounted", 0.4))
            .then(s.send("ready", 0.5))
            .then(s.land("actions")),
    );
    let snapshot = scene.at(
        spoken.at("structural snapshot").not_before(action.reply()),
        s.settle_in("snapshot")
            .then(s.connect("settled", 0.4))
            .then(s.send("outcome", 0.5))
            .then(s.land("snapshot")),
    );
    let ack = scene.at(
        spoken.at("server accepts").not_before(snapshot.reply()),
        s.settle_in("ack")
            .then(s.connect("report", 0.4))
            .then(s.send("evidence", 0.5))
            .then(s.land("ack")),
    );
    scene.at(
        spoken.at("later planning").not_before(ack.reply()),
        s.settle_in("next")
            .then(s.connect("admit", 0.4))
            .then(s.send("release", 0.7))
            .then(s.land("next")),
    );
    footer(
        &mut scene,
        "RUN_FINISHED ≠ applied workspace · no second workspace writer",
    )?;
    Ok(scene.finish()?)
}

fn ownership(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "ownership",
        "move ownership into reusable libraries",
        "before → after extraction",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card(
                "demo",
                [960.0, 290.0, 0.0],
                [1020.0, 150.0],
                "demo application",
            )
            .statuses(&[
                ("protocol + React acknowledgment observer", Warning),
                ("auth · Vessels · voice · deployment", Plain),
            ]),
            El::card(
                "browser",
                [390.0, 585.0, 0.0],
                [460.0, 140.0],
                "agui/browser",
            )
            .statuses(&[("connector + run validation", Plain)])
            .tone(Request),
            El::card(
                "contract",
                [960.0, 585.0, 0.0],
                [460.0, 140.0],
                "agui/contract",
            )
            .statuses(&[("wire schemas + correlation", Plain)])
            .tone(Accent),
            El::card(
                "server",
                [1530.0, 585.0, 0.0],
                [460.0, 140.0],
                "agui/server",
            )
            .statuses(&[("admission + checkpoint", Plain)])
            .tone(Success),
            El::card(
                "client",
                [960.0, 790.0, 0.0],
                [760.0, 105.0],
                "client lifecycle owns settlement",
            )
            .statuses(&[("React only displays protocol errors", Success)]),
            El::beam("extract", "demo", "contract"),
            El::packet("move", "extract").tone(Accent),
        ],
    )?;
    scene.at(0, s.settle_in("demo"));
    scene.at(
        spoken.at("moves into libraries"),
        s.rewind(0.25)
            .then(stagger(
                millis(120),
                ["browser", "contract", "server"],
                |id| s.settle_in(id),
            ))
            .then(s.connect("extract", 0.5))
            .then(s.send("move", 0.6))
            .then(s.land("contract")),
    );
    scene.at(spoken.at("client owns settlement"), s.settle_in("client"));
    scene.at(
        spoken.at("demo supplies"),
        s.swap_status("demo", [0, 1], 0.5),
    );
    footer(
        &mut scene,
        "benefit: consume one adapter instead of copying demo-specific runtime wiring",
    )?;
    Ok(scene.finish()?)
}

fn code(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "code",
        "the shared completion boundary",
        "real source excerpt",
    )?;
    let source = ORCHESTRATOR.lines().collect::<Vec<_>>();
    let selected = [
        (
            "const result = await this.#commandProcessor.dispatchSettled(",
            4,
        ),
        ("await connector.applicationSettled?.({", 6),
    ]
    .into_iter()
    .enumerate()
    .flat_map(|(index, (marker, count))| {
        let start = source
            .iter()
            .position(|line| line.contains(marker))
            .expect("source anchor");
        (index > 0)
            .then_some("// ...")
            .into_iter()
            .chain(source[start..start + count].iter().copied())
    })
    .map(|line| line.strip_prefix("        ").unwrap_or(line))
    .collect::<Vec<_>>();
    let focus = selected
        .iter()
        .position(|line| line.contains("await connector"))
        .context("callback anchor")?;
    let lines = selected
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if index == focus {
                keep(line).range("callback", "applicationSettled")
            } else {
                keep(line)
            }
        })
        .collect();
    let editor = Diff {
        file_name: "packages/client/.../orchestrator.ts",
        lines,
    }
    .declare(&mut scene, &[], 0, true)?;
    editor.target(&mut scene, "callback", focus, "callback")?;
    let callout = Callout::declare(
        &mut scene,
        "awaited",
        &CalloutPlan::new(
            CalloutAnchorPlan::Editor {
                id: "callback".into(),
                target: "callback".into(),
                edge: CalloutSide::Right,
                side: None,
            },
            vec![CaptionSpanPlan::new("await acknowledgment", Success)],
        )
        .side(CalloutSide::TopRight)
        .reach(180.0)
        .chip(),
    )?;
    scene.at(spoken.at("awaits acknowledgment"), callout.show());
    footer(
        &mut scene,
        "source excerpt with an explicit gap · canonical batch result + structural snapshot",
    )?;
    Ok(scene.finish()?)
}

fn failure(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "failure",
        "uncertain writes stop continuation",
        "failure path",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card(
                "write",
                [400.0, 410.0, 0.0],
                [500.0, 160.0],
                "application write",
            )
            .statuses(&[("one write completed", Success)]),
            El::card(
                "ack",
                [1330.0, 410.0, 0.0],
                [600.0, 160.0],
                "acknowledgment",
            )
            .statuses(&[
                ("waiting for acceptance", Plain),
                ("connection lost", Error),
            ]),
            El::card(
                "stopped",
                [960.0, 740.0, 0.0],
                [950.0, 140.0],
                "outcome: unknown",
            )
            .statuses(&[("stop continuation · do not replay the write", Warning)]),
            El::beam("ack-link", "write", "ack"),
            El::packet("sent", "ack-link").tone(Success),
        ],
    )?;
    scene.at(
        0,
        s.settle_in("write")
            .also(s.settle_in("ack"))
            .then(s.connect("ack-link", 0.5)),
    );
    scene.at(spoken.at("write happens"), s.land("write"));
    scene.at(
        spoken.at("acknowledgment is lost"),
        s.disconnect("ack-link", 0.45)
            .also(s.swap_status("ack", [0, 1], 0.3)),
    );
    scene.at(spoken.at("outcome is unknown"), s.settle_in("stopped"));
    footer(
        &mut scene,
        "benefit: no premature success claim and no automatic duplicate write",
    )?;
    Ok(scene.finish()?)
}

fn evidence(narration: &Narration) -> Result<ScenePlan> {
    let (mut scene, spoken) = scene(
        narration,
        "evidence",
        "what the evidence establishes",
        "experimental · draft PR",
    )?;
    let s = stage(
        &mut scene,
        vec![
            El::card(
                "local",
                [490.0, 380.0, 0.0],
                [700.0, 190.0],
                "current local checks",
            )
            .statuses(&[("headless + protocol + voice fixtures", Success)]),
            El::card(
                "live",
                [1430.0, 380.0, 0.0],
                [700.0, 190.0],
                "earlier deployed evidence",
            )
            .statuses(&[("c1992ec1 · live voice + 16 min idle", Plain)]),
            El::card(
                "next",
                [960.0, 730.0, 0.0],
                [1060.0, 150.0],
                "next: native / AG-UI parity evals",
            )
            .statuses(&[("same runtime · compare applied results", Accent)]),
        ],
    )?;
    scene.at(0, s.settle_in("local"));
    scene.at(spoken.at("earlier deployed revision"), s.settle_in("live"));
    scene.at(
        spoken.at("predates this extraction"),
        s.dim(["live"], 0.55, 0.4),
    );
    scene.at(spoken.at("paired evaluations"), s.settle_in("next"));
    footer(
        &mut scene,
        "private package · no model-quality, speed, or durable-recovery claim",
    )?;
    Ok(scene.finish()?)
}

fn main() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pr344");
    let narration = Narration::load(&root.join("narration"))?;
    let scenes = vec![
        intro(&narration)?,
        browser(&narration, "native")?,
        browser(&narration, "agui")?,
        wire(&narration)?,
        settlement(&narration)?,
        ownership(&narration)?,
        code(&narration)?,
        failure(&narration)?,
        evidence(&narration)?,
    ];
    let reel = ReelPlan::dipped("maelstrom-pr344-workspace-adapter", scenes, seconds(0.6))?;
    fs::write(
        root.join("walkthrough.reel.json"),
        serde_json::to_vec_pretty(&reel)?,
    )?;
    println!("{:.2}s", reel.duration_nanos() as f64 / 1e9);
    Ok(())
}
