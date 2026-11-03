use std::{fs, path::PathBuf};

use anyhow::Result;
use psychopomp::{
    author::{PlanBuilder, seconds},
    narration::Narration,
    plan::{ReelPlan, ScenePlan},
    score::{Beat, Caption, Stage},
    stage::{StageElement as El, StagePlan, StagePost},
    tone::Tone::{Accent, Muted, Plain, Request, Success, Warning},
};

struct Chapter {
    id: &'static str,
    title: &'static str,
    cards: [(&'static str, &'static str, &'static str); 3],
    cues: [&'static str; 3],
    links: [&'static str; 2],
    footer: &'static str,
}

fn chapter(narration: &Narration, chapter: Chapter) -> Result<ScenePlan> {
    let reading = narration.reading(seconds(1.0), [(chapter.id, seconds(1.8))])?;
    let mut scene = PlanBuilder::new(chapter.id, reading.duration());
    let [spoken] = reading.place(&mut scene);
    let positions = [360.0, 960.0, 1560.0];
    let cards = chapter
        .cards
        .iter()
        .enumerate()
        .flat_map(|(i, (title, status, detail))| {
            let id = format!("card-{i}");
            [
                El::card(&id, [positions[i], 470.0, 0.0], [440.0, 150.0], title)
                    .tone([Request, Accent, Success][i])
                    .statuses(&[(status, Plain)]),
                El::label(
                    &format!("detail-{i}"),
                    [positions[i], 660.0, 0.0],
                    22.0,
                    &[(detail, Muted)],
                ),
            ]
        });
    let stage = Stage::declare(
        &mut scene,
        "stage",
        &StagePlan {
            post: StagePost::RESTRAINED,
            elements: cards
                .chain([
                    El::beam("link-0", "card-0", "card-1").tone(Request),
                    El::beam("link-1", "card-1", "card-2").tone(Accent),
                    El::packet("packet-0", "link-0")
                        .labeled(chapter.links[0])
                        .tone(Request),
                    El::packet("packet-1", "link-1")
                        .labeled(chapter.links[1])
                        .tone(Success),
                ])
                .collect(),
        },
    )?;
    let header = Caption::header(&mut scene, "PRIVATE POC", chapter.title)?;
    let chip = Caption::chip(&mut scene, "chip", Warning, "scripted models")?;
    let footer = Caption::footer(&mut scene, "footer", &[(chapter.footer, Plain)])?;
    scene.at(0, header.show().also(chip.show()));
    for i in 0..3 {
        let at = spoken.at(chapter.cues[i]);
        scene.at(at, stage.settle_in(&format!("card-{i}")));
        scene.at(
            at + seconds(0.6),
            stage.fade_in(&format!("detail-{i}"), 1.0, 0.4),
        );
        if i > 0 {
            scene.at(
                at + seconds(0.6),
                stage
                    .connect(&format!("link-{}", i - 1), 0.5)
                    .then(stage.send(&format!("packet-{}", i - 1), 0.8))
                    .then(stage.land(&format!("card-{i}"))),
            );
        }
    }
    scene.at(spoken.at(chapter.cues[2]) + seconds(3.0), footer.show());
    Ok(scene.finish()?)
}

fn main() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let narration = Narration::load(&root.join("narration"))?;
    let chapters = [
        Chapter {
            id: "goal",
            title: "An external goal reaches a real workspace",
            cards: [
                ("TanStack agent", "owns the goal", "AG-UI run + tool call"),
                (
                    "Maelstrom Engine",
                    "validates the proposal",
                    "Vessels · Variants · Actions",
                ),
                (
                    "React Chart",
                    "mounts, then runs create",
                    "set_layout → execute_actions",
                ),
            ],
            cues: ["external agent", "engine validates", "browser mounts"],
            links: ["propose", "apply"],
            footer: "A correlated acknowledgment reports structural settlement.",
        },
        Chapter {
            id: "loop",
            title: "Later Actions use observed results",
            cards: [
                (
                    "Run 1 / create",
                    "new record allocated",
                    "ID absent from the user goal",
                ),
                (
                    "Run 2 / read",
                    "canonical ID + version",
                    "delegated application read",
                ),
                (
                    "Run 3 / complete",
                    "exact record focused",
                    "no second user goal",
                ),
            ],
            cues: ["first action", "delegated read", "Three runs"],
            links: ["settled", "focus"],
            footer: "The workspace Action returns status. The explicit read supplies business data.",
        },
        Chapter {
            id: "code",
            title: "The adapter lives in one private app",
            cards: [
                (
                    "host.ts",
                    "chat() + resume",
                    "correlates the pending result",
                ),
                (
                    "planner.ts",
                    "engine.handle()",
                    "validates declared capabilities",
                ),
                (
                    "workspace.ts",
                    "push → waitForIdle()",
                    "reports Action outcomes",
                ),
            ],
            cues: ["Host handles", "Planner uses", "Workspace applies"],
            links: ["plan", "dispatch"],
            footer: "boundary.ts normalizes terminals and frontend interrupts. Unknown outcome → stop.",
        },
        Chapter {
            id: "proof",
            title: "What the experiments establish",
            cards: [
                (
                    "Browser / verified",
                    "real Chart + React handlers",
                    "12 × 8 container cells",
                ),
                (
                    "Child / verified",
                    "same identity after approval",
                    "denied read never executes",
                ),
                (
                    "Still unproven",
                    "production recovery + voice",
                    "multi-writer reconciliation",
                ),
            ],
            cues: [
                "browser experiment",
                "subagent experiment",
                "Production recovery",
            ],
            links: ["+", "limits"],
            footer: "Gain: an external agent loop can use Maelstrom's existing workspace semantics.",
        },
    ];
    let scenes = chapters
        .into_iter()
        .map(|part| chapter(&narration, part))
        .collect::<Result<Vec<_>>>()?;
    let reel = ReelPlan::dipped("agui-workspace-walkthrough", scenes, seconds(0.6))?;
    fs::write(
        root.join("walkthrough.reel.json"),
        serde_json::to_string_pretty(&reel)?,
    )?;
    println!("{:.2}s", reel.duration_nanos() as f64 / 1e9);
    Ok(())
}
