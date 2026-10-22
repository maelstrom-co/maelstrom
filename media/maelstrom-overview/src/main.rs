use anyhow::Result;
use psychopomp::{
    author::{PlanBuilder, seconds},
    caption::{CaptionAlign, CaptionPlan, CaptionSpanPlan},
    face::Face,
    plan::ScenePlan,
    score::{Beat, Caption, CueTime, Stage},
    sfx,
    stage::{Arrow, Figure, Fill, Material, StageElement, StagePlan, StagePost},
    tone::Tone,
};

const DURATION: f64 = 26.0;
const LAYOUT: f64 = 13.3;
const ACTION: f64 = 16.8;
const RESET: f64 = 24.0;

fn label(id: &str, x: f32, y: f32, size: f32, text: &str, tone: Tone) -> StageElement {
    StageElement::label(id, [x, y, 0.0], size, &[(text, tone)])
}

fn panel(id: &str, at: [f32; 2], size: [f32; 2], tone: Tone) -> StageElement {
    StageElement::Shape {
        id: id.into(),
        at: [at[0], at[1], 0.0],
        shape: Figure::Rect(size),
        corner: 18.0,
        fill: Some(Fill::Material(Material::Surface)),
        fill_opacity: 1.0,
        stroke: Some(tone),
        width: 1.5,
        dash: None,
        arrow: Arrow::None,
    }
}

fn elements() -> Vec<StageElement> {
    let fixed = vec![
        label("brand", 80.0, 78.0, 52.0, "Maelstrom", Tone::Plain)
            .align(CaptionAlign::Left)
            .face(Face::SansBold),
        label(
            "tagline",
            80.0,
            145.0,
            28.0,
            "Your components. Arranged by intent.",
            Tone::Muted,
        )
        .align(CaptionAlign::Left)
        .face(Face::Sans),
        panel("chart", [660.0, 555.0], [1160.0, 500.0], Tone::Muted),
        label(
            "chart-label",
            115.0,
            335.0,
            21.0,
            "YOUR APP  /  <Chart />",
            Tone::Muted,
        )
        .align(CaptionAlign::Left),
        StageElement::card("intent", [660.0, 237.0, 0.0], [1000.0, 86.0], "").tone(Tone::Request),
        label(
            "intent-text",
            660.0,
            237.0,
            30.0,
            "\"Show today and my tasks\"",
            Tone::Plain,
        ),
        StageElement::card(
            "client",
            [660.0, 870.0, 0.0],
            [970.0, 100.0],
            "Maelstrom client",
        )
        .statuses(&[(
            "current state + Vessel definitions + Chart size",
            Tone::Muted,
        )]),
        label(
            "server-label",
            1570.0,
            340.0,
            21.0,
            "YOUR SERVER",
            Tone::Muted,
        ),
        StageElement::card("engine", [1570.0, 475.0, 0.0], [430.0, 190.0], "Engine")
            .tone(Tone::Accent)
            .statuses(&[
                ("your chosen LLM", Tone::Muted),
                ("planning", Tone::Request),
                ("plan ready", Tone::Accent),
            ]),
        label(
            "context-1",
            1570.0,
            640.0,
            23.0,
            "intent + current UI",
            Tone::Request,
        ),
        label(
            "context-2",
            1570.0,
            680.0,
            23.0,
            "registered capabilities",
            Tone::Muted,
        ),
        label(
            "context-3",
            1570.0,
            720.0,
            23.0,
            "available Chart space",
            Tone::Muted,
        ),
        label("response-1", 1570.0, 640.0, 25.0, "layout", Tone::Accent),
        label(
            "response-2",
            1570.0,
            682.0,
            25.0,
            "+ execution plan",
            Tone::Accent,
        ),
        label(
            "response-3",
            1570.0,
            741.0,
            21.0,
            "showDay(today)",
            Tone::Muted,
        ),
        StageElement::beam("request-wire", "client", "engine")
            .bend(120.0)
            .tone(Tone::Request),
        StageElement::packet("request", "request-wire").tone(Tone::Request),
        StageElement::beam("response-wire", "engine", "client")
            .bend(-120.0)
            .tone(Tone::Accent),
        StageElement::packet("response", "response-wire").tone(Tone::Accent),
        label(
            "layout-step",
            660.0,
            965.0,
            26.0,
            "1  set_layout",
            Tone::Accent,
        ),
        label(
            "action-step",
            660.0,
            965.0,
            26.0,
            "2  execute_actions  →  showDay(today)",
            Tone::Request,
        ),
    ];

    let calendar = vec![
        panel(
            "calendar-panel",
            [350.0, 555.0],
            [300.0, 330.0],
            Tone::Request,
        ),
        label(
            "calendar-title",
            350.0,
            428.0,
            25.0,
            "Calendar",
            Tone::Plain,
        ),
        label("calendar-month", 350.0, 470.0, 19.0, "MONTH", Tone::Request),
        label("calendar-day", 350.0, 470.0, 19.0, "TODAY", Tone::Request),
        label(
            "calendar-event-1",
            350.0,
            535.0,
            17.0,
            "09:00  Review PR",
            Tone::Plain,
        ),
        label(
            "calendar-event-2",
            350.0,
            585.0,
            17.0,
            "11:00  Ship release",
            Tone::Plain,
        ),
        label(
            "calendar-event-3",
            350.0,
            635.0,
            17.0,
            "14:00  Write docs",
            Tone::Muted,
        ),
    ];
    let dates = (0..28).map(|i| {
        label(
            &format!("calendar-date-{i}"),
            242.0 + (i % 7) as f32 * 36.0,
            525.0 + (i / 7) as f32 * 43.0,
            18.0,
            &(i + 1).to_string(),
            if i == 21 { Tone::Request } else { Tone::Muted },
        )
    });
    let others = vec![
        panel("tasks-panel", [680.0, 555.0], [300.0, 330.0], Tone::Muted),
        label("tasks-title", 680.0, 428.0, 25.0, "Tasks", Tone::Plain),
        label("tasks-count", 680.0, 470.0, 19.0, "3 OPEN", Tone::Muted),
        label(
            "tasks-item-1",
            680.0,
            535.0,
            19.0,
            "□ Review PR",
            Tone::Plain,
        ),
        label(
            "tasks-item-2",
            680.0,
            585.0,
            19.0,
            "□ Ship release",
            Tone::Plain,
        ),
        label(
            "tasks-item-3",
            680.0,
            635.0,
            19.0,
            "□ Write docs",
            Tone::Muted,
        ),
        panel("notes-panel", [1010.0, 555.0], [300.0, 330.0], Tone::Muted),
        label("notes-title", 1010.0, 428.0, 25.0, "Notes", Tone::Plain),
        label("notes-state", 1010.0, 470.0, 19.0, "SAVED", Tone::Muted),
        label(
            "notes-line-1",
            1010.0,
            535.0,
            19.0,
            "Launch checklist",
            Tone::Plain,
        ),
        label(
            "notes-line-2",
            1010.0,
            585.0,
            19.0,
            "Open source",
            Tone::Plain,
        ),
        label(
            "notes-line-3",
            1010.0,
            635.0,
            19.0,
            "Ready to share.",
            Tone::Muted,
        ),
    ];
    fixed
        .into_iter()
        .chain(calendar)
        .chain(dates)
        .chain(others)
        .collect()
}

fn caption(scene: &mut PlanBuilder, id: &str, text: &str) -> Result<Caption> {
    Caption::declare(
        scene,
        id,
        &CaptionPlan::line(
            [960.0, 1030.0],
            29.0,
            vec![CaptionSpanPlan::new(text, Tone::Plain)],
        )
        .aligned(CaptionAlign::Center),
    )
}

fn visible(scene: &mut PlanBuilder, stage: &Stage, ids: &[&str], at: f64, opacity: f32) {
    for id in ids {
        stage
            .to(format!("{id}.opacity"), opacity, 0.28)
            .play(scene, seconds(at));
    }
}

fn arrange(scene: &mut PlanBuilder, stage: &Stage, at: f64, reset: bool) {
    for (prefix, from, to, scale) in [
        ("calendar-", [350.0, 555.0], [440.0, 555.0], 1.22),
        ("tasks-", [680.0, 555.0], [970.0, 555.0], 1.12),
        ("notes-", [1010.0, 555.0], [1135.0, 555.0], 0.7),
    ] {
        for element in stage
            .plan()
            .elements
            .iter()
            .filter(|e| e.id().starts_with(prefix))
        {
            let position = match element {
                StageElement::Shape { at, .. } | StageElement::Label { at, .. } => *at,
                _ => unreachable!(),
            };
            let offset = if reset {
                [0.0, 0.0]
            } else {
                [
                    to[0] - from[0] + (position[0] - from[0]) * (scale - 1.0),
                    to[1] - from[1] + (position[1] - from[1]) * (scale - 1.0),
                ]
            };
            stage
                .to(format!("{}.x", element.id()), offset[0], 0.85)
                .also(stage.to(format!("{}.y", element.id()), offset[1], 0.85))
                .also(stage.to(
                    format!("{}.scale", element.id()),
                    if reset { 1.0 } else { scale },
                    0.85,
                ))
                .play(scene, seconds(at));
            if prefix == "notes-" {
                stage
                    .to(
                        format!("{}.opacity", element.id()),
                        if reset { 1.0 } else { 0.0 },
                        0.35,
                    )
                    .play(scene, seconds(at));
            }
        }
    }
}

fn build_plan() -> Result<ScenePlan> {
    let mut scene = PlanBuilder::new("maelstrom-overview", seconds(DURATION));
    let stage = Stage::declare(
        &mut scene,
        "stage",
        &StagePlan {
            post: StagePost {
                grain: 0.0,
                ..StagePost::RESTRAINED
            },
            elements: elements(),
        },
    )?;
    let camera = stage.camera();
    let captions = [
        (
            0.0,
            "components",
            "You register components, their Variants, and their Actions.",
        ),
        (
            5.0,
            "intent-caption",
            "The user asks. The client sends intent and the current UI.",
        ),
        (
            8.5,
            "engine-caption",
            "The Engine plans with your components and available space.",
        ),
        (
            12.0,
            "response-caption",
            "It returns a layout and an execution plan.",
        ),
        (
            LAYOUT,
            "layout-caption",
            "First, the client applies the layout.",
        ),
        (
            ACTION,
            "action-caption",
            "Then, it runs Actions. The calendar switches to day view.",
        ),
        (
            20.5,
            "result-caption",
            "Your components stay interactive. The UI follows intent.",
        ),
        (
            RESET,
            "reset-caption",
            "You register components, their Variants, and their Actions.",
        ),
    ];
    for (index, (at, id, text)) in captions.iter().enumerate() {
        let c = caption(&mut scene, id, text)?;
        c.show().play(&mut scene, seconds(*at));
        if let Some((next, ..)) = captions.get(index + 1) {
            c.hide().play(&mut scene, seconds(*next - 0.15));
        }
    }

    for id in [
        "intent",
        "intent-text",
        "context-1",
        "context-2",
        "context-3",
        "response-1",
        "response-2",
        "response-3",
        "calendar-day",
        "calendar-event-1",
        "calendar-event-2",
        "calendar-event-3",
        "layout-step",
        "action-step",
    ] {
        stage
            .channel(format!("{id}.opacity"), 0.0)
            .play(&mut scene, 0);
    }
    for id in ["request-wire", "response-wire"] {
        stage.channel(format!("{id}.flow"), 0.0).play(&mut scene, 0);
    }
    stage.settle_in("client").play(&mut scene, seconds(0.2));
    stage.settle_in("engine").play(&mut scene, seconds(0.32));
    visible(&mut scene, &stage, &["intent", "intent-text"], 4.2, 1.0);
    sfx::TICK
        .beat("intent-enter", -14.0)
        .play(&mut scene, seconds(4.35));

    stage
        .connect("request-wire", 0.65)
        .play(&mut scene, seconds(5.2));
    let request = stage
        .send("request", 1.05)
        .with(sfx::SEND.beat("request-send", -10.0))
        .on_end(stage.land("engine"))
        .play(&mut scene, seconds(6.5));
    stage
        .to("engine.status", 1.0, 0.25)
        .play(&mut scene, request.after(seconds(0.15)));
    for (index, id) in ["context-1", "context-2", "context-3"].iter().enumerate() {
        visible(&mut scene, &stage, &[id], 8.0 + index as f64 * 0.45, 1.0);
    }
    visible(
        &mut scene,
        &stage,
        &["context-1", "context-2", "context-3"],
        10.5,
        0.0,
    );
    visible(
        &mut scene,
        &stage,
        &["response-1", "response-2", "response-3"],
        11.0,
        1.0,
    );
    stage
        .to("engine.status", 2.0, 0.25)
        .play(&mut scene, seconds(11.0));
    stage
        .connect("response-wire", 0.55)
        .play(&mut scene, seconds(10.7));
    let response = stage
        .send("response", 0.9)
        .with(sfx::SEND.beat("response-send", -12.0))
        .on_end(stage.land("client"))
        .play(&mut scene, seconds(11.9).not_before(request.reply()));
    sfx::CONFIRM
        .beat("response-arrive", -14.0)
        .play(&mut scene, response.end);

    visible(&mut scene, &stage, &["layout-step"], LAYOUT, 1.0);
    arrange(&mut scene, &stage, LAYOUT, false);
    sfx::TICK
        .beat("layout-apply", -12.0)
        .play(&mut scene, seconds(LAYOUT + 0.5));
    visible(&mut scene, &stage, &["layout-step"], ACTION - 0.3, 0.0);
    visible(&mut scene, &stage, &["action-step"], ACTION, 1.0);
    visible(&mut scene, &stage, &["calendar-month"], ACTION, 0.0);
    for i in 0..28 {
        visible(
            &mut scene,
            &stage,
            &[&format!("calendar-date-{i}")],
            ACTION,
            0.0,
        );
    }
    visible(
        &mut scene,
        &stage,
        &[
            "calendar-day",
            "calendar-event-1",
            "calendar-event-2",
            "calendar-event-3",
        ],
        ACTION + 0.35,
        1.0,
    );
    sfx::SUCCESS
        .beat("action-complete", -13.0)
        .play(&mut scene, seconds(ACTION + 0.6));
    visible(&mut scene, &stage, &["action-step"], 20.35, 0.0);
    camera
        .push_in(28.0, psychopomp::stage::Move::Spring(1.7))
        .play(&mut scene, seconds(20.5));

    arrange(&mut scene, &stage, RESET, true);
    camera
        .pull_back(28.0, psychopomp::stage::Move::Spring(0.8))
        .play(&mut scene, seconds(RESET));
    visible(
        &mut scene,
        &stage,
        &[
            "intent",
            "intent-text",
            "response-1",
            "response-2",
            "response-3",
            "calendar-day",
            "calendar-event-1",
            "calendar-event-2",
            "calendar-event-3",
            "request-wire",
            "response-wire",
        ],
        RESET,
        0.0,
    );
    visible(&mut scene, &stage, &["calendar-month"], RESET + 0.3, 1.0);
    for i in 0..28 {
        visible(
            &mut scene,
            &stage,
            &[&format!("calendar-date-{i}")],
            RESET + 0.3,
            1.0,
        );
    }
    stage
        .to("engine.status", 0.0, 0.3)
        .play(&mut scene, seconds(RESET));
    for (id, start, end) in [
        ("components", 0.0, 5.0),
        ("request", 5.0, 8.5),
        ("decision", 8.5, 12.0),
        ("layout", LAYOUT, ACTION),
        ("actions", ACTION, 20.5),
        ("result", 20.5, RESET),
        ("reset", RESET, DURATION),
    ] {
        scene.cue(id, seconds(start), seconds(end));
    }
    let plan = scene.finish()?;
    // Plans live under target/, not beside the Scene Program as the sound catalog expects.
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
    Ok(ScenePlan {
        media: plan
            .media
            .into_iter()
            .map(|mut media| {
                media.path = assets.join(
                    media
                        .path
                        .strip_prefix("../../assets")
                        .expect("catalog sound"),
                );
                media
            })
            .collect(),
        ..plan
    })
}

fn main() -> Result<()> {
    std::fs::create_dir_all("target/maelstrom-overview")?;
    build_plan()?.write_or_print(Some("target/maelstrom-overview/plan.json"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_precedes_actions_so_new_instances_can_receive_them() {
        let plan = build_plan().unwrap();
        let layout = plan
            .continuous_channels
            .iter()
            .find(|c| c.property == "calendar-panel.x")
            .unwrap();
        let day = plan
            .continuous_channels
            .iter()
            .find(|c| c.property == "calendar-day.opacity")
            .unwrap();
        let layout_start = layout.events.first().unwrap().at_nanos();
        let day_start = day.events.first().unwrap().at_nanos();
        assert!(layout_start + seconds(0.85) < day_start);
        let response = plan
            .media
            .iter()
            .find(|media| media.id == "response-arrive")
            .unwrap();
        assert!(response.timeline_start_nanos < layout_start);
        assert_eq!(plan.duration_nanos, seconds(DURATION));
    }

    #[test]
    fn optional_sound_does_not_replace_the_silent_explanation() {
        let plan = build_plan().unwrap();
        assert!(plan.media.iter().all(|media| media.path.is_file()));
        assert!(
            plan.media
                .iter()
                .all(|media| media.timeline_end_nanos < seconds(RESET))
        );
        for id in [
            "components",
            "intent-caption",
            "engine-caption",
            "layout-caption",
            "action-caption",
            "result-caption",
        ] {
            assert!(plan.actors.iter().any(|actor| actor.id == id));
        }
    }
}
