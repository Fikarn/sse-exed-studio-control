use super::*;
use serde_json::Value;
use std::time::Duration;

const MOTION_CASES: &str = include_str!("motion-cases.json");

/// A script of `paragraphs` paragraphs of `words` plain words each.
fn script(paragraphs: usize, words: usize) -> Arc<Vec<PrompterParagraph>> {
    Arc::new(
        (0..paragraphs)
            .map(|paragraph| {
                PrompterParagraph::plain(
                    (0..words)
                        .map(|word| format!("p{paragraph}w{word}"))
                        .collect::<Vec<_>>()
                        .join(" "),
                )
            })
            .collect(),
    )
}

/// A layout of `per_line` words a line, `height` px a line and half a line
/// between paragraphs, with `END` half a 1,080 px screen below the last line.
fn layout_of(key: &str, paragraphs: &[PrompterParagraph], per_line: u32, height: f64) -> Layout {
    let mut lines = Vec::new();
    let mut top = 0.0;
    for (index, paragraph) in paragraphs.iter().enumerate() {
        let words = paragraph_word_count(paragraph) as u32;
        let mut word = 0;
        loop {
            lines.push(PrompterLayoutLine {
                paragraph: index as u32,
                word,
                top,
                height,
            });
            top += height;
            word += per_line;
            if word >= words {
                break;
            }
        }
        top += height / 2.0;
    }
    Layout::new(String::from(key), lines, top + 540.0, paragraphs).expect("the layout is sound")
}

fn laid_out_clock(now: Instant, paragraphs: Arc<Vec<PrompterParagraph>>, speed: u32) -> GlassClock {
    let mut clock = GlassClock::paused(
        now,
        String::from("script-a"),
        paragraphs.clone(),
        String::from("g1-l0"),
        PrompterPlace::TOP,
        speed,
    );
    clock.accept_layout(now, layout_of("g1-l0", &paragraphs, 5, 100.0));
    clock
}

fn after(now: Instant, milliseconds: u64) -> Instant {
    now + Duration::from_millis(milliseconds)
}

fn close(left: f64, right: f64) -> bool {
    (left - right).abs() < 1e-6
}

// First step 1a: the front end's copy of the formula and this one are held to
// the same table (motion-cases.json).
#[test]
fn the_motion_follows_the_shared_cases() {
    let cases: Value = serde_json::from_str(MOTION_CASES).expect("the cases parse");
    let now = Instant::now();
    for case in cases["cases"].as_array().expect("cases") {
        let anchor = &case["anchor"];
        let number = |key: &str| anchor[key].as_f64().expect(key);
        let motion = Motion {
            at: now,
            paragraph: 0,
            word_offset: 0.0,
            from_wpm: number("fromWpm"),
            to_wpm: number("toWpm"),
            ramp_ms: number("rampMs"),
            move_from: None,
            pixel: None,
        };
        for point in case["at"].as_array().expect("points") {
            let elapsed = point["elapsedMs"].as_f64().expect("elapsedMs");
            let position = (number("position")
                + number("pxPerReadWord") * motion.words_advanced(number("ageMs") + elapsed))
            .min(number("endPosition"));
            assert!(
                close(position, point["position"].as_f64().expect("position")),
                "{}: at {elapsed} ms the text stands at {position}, not {}",
                case["name"],
                point["position"]
            );
        }
    }
}

// §5.1: the pace keeps the words a minute whatever the look — the pixels a
// second follow the layout's height per read word.
#[test]
fn the_pace_is_words_a_minute_in_any_look() {
    let paragraphs = script(10, 55);
    let small = layout_of("small", &paragraphs, 11, 60.0);
    let large = layout_of("large", &paragraphs, 5, 123.2);
    // 5 words a line at 123.2 px (88 px text, 1.4 spacing) is about the
    // proposal's example: 55 px a second at 140 words a minute.
    let per_second = large.px_per_read_word * 140.0 / 60.0;
    assert!(per_second > 50.0 && per_second < 65.0, "{per_second}");
    // One minute at 140 words a minute moves 140 read words in either look.
    for layout in [small, large] {
        let moved = 60.0 * 140.0 / 60.0 * layout.px_per_read_word;
        let (paragraph, _) = layout.words_at(moved, 10);
        assert_eq!(paragraph, 2, "140 words on is the third paragraph");
    }
}

#[test]
fn a_layout_that_does_not_fit_the_text_is_refused() {
    let paragraphs = script(2, 6);
    let good = |lines: Vec<(u32, u32, f64)>, end: f64| {
        Layout::new(
            String::from("k"),
            lines
                .into_iter()
                .map(|(paragraph, word, top)| PrompterLayoutLine {
                    paragraph,
                    word,
                    top,
                    height: 100.0,
                })
                .collect(),
            end,
            &paragraphs,
        )
    };
    assert!(good(vec![(0, 0, 0.0), (0, 3, 100.0), (1, 0, 250.0)], 900.0).is_ok());
    for (lines, end, why) in [
        (vec![], 900.0, "no lines"),
        (
            vec![(0, 1, 0.0), (1, 0, 150.0)],
            900.0,
            "not the first word",
        ),
        (vec![(0, 0, 0.0)], 900.0, "a paragraph missing"),
        (
            vec![(0, 0, 0.0), (1, 0, 150.0), (2, 0, 300.0)],
            900.0,
            "a paragraph too many",
        ),
        (
            vec![(0, 0, 0.0), (0, 9, 100.0), (1, 0, 250.0)],
            900.0,
            "a word past the paragraph",
        ),
        (vec![(0, 0, 0.0), (1, 0, 50.0)], 900.0, "lines overlap"),
        (
            vec![(0, 0, 0.0), (1, 2, 150.0)],
            900.0,
            "a paragraph starts mid-way",
        ),
        (
            vec![(0, 0, 0.0), (1, 0, 150.0)],
            200.0,
            "END above the last line",
        ),
    ] {
        assert!(good(lines, end).is_err(), "{why} should be refused");
    }
}

// §5 and D12: a start leaves the prompter paused; play eases up and the text
// moves at the pace; a pause eases down over 0.3 s and the text stands still.
#[test]
fn play_and_pause_ease_and_the_text_moves_at_the_pace() {
    let now = Instant::now();
    let paragraphs = script(20, 25);
    let mut clock = laid_out_clock(now, paragraphs, 120);
    assert!(!clock.playing);
    assert_eq!(clock.position_at(after(now, 5_000)), Some(0.0));

    clock.play(now);
    let per_ms = clock.layout.as_ref().unwrap().px_per_read_word * 120.0 / 60_000.0;
    let at_ramp = clock.position_at(after(now, 300)).unwrap();
    assert!(
        close(at_ramp, per_ms * 150.0),
        "half the ramp's distance: {at_ramp}"
    );
    let at_second = clock.position_at(after(now, 1_300)).unwrap();
    assert!(close(at_second - at_ramp, per_ms * 1_000.0));

    clock.pause(after(now, 1_300));
    let stopped = clock.position_at(after(now, 1_600)).unwrap();
    assert!(close(stopped - at_second, per_ms * 150.0), "the ease down");
    assert_eq!(clock.position_at(after(now, 60_000)).unwrap(), stopped);
    assert!(!clock.playing);
}

// The recording of 2026-10-02: the speed dial turned while the reading line
// crossed the half line between two paragraphs, and each new pace moved the
// text back to the end of the paragraph above (the anchor was kept in words,
// which cannot say a place between paragraphs).
#[test]
fn a_new_pace_never_moves_the_text_back() {
    let now = Instant::now();
    let paragraphs = script(4, 25);
    let mut clock = laid_out_clock(now, paragraphs, 140);
    clock.play(now);
    let mut last = 0.0;
    let mut in_a_gap = 0;
    let mut speed = 140;
    // A detent every 100 ms for 40 s, up for a second, then down.
    for step in 1..=400_u64 {
        let at = after(now, step * 100);
        let before = clock.position_at(at).expect("laid out");
        speed = if (step / 10) % 2 == 0 {
            (speed + 5).min(300)
        } else {
            (speed - 5).max(40)
        };
        clock.set_speed(at, speed);
        let then = clock.position_at(at).expect("laid out");
        assert!(
            close(then, before),
            "a new pace keeps the text where it is: {before} became {then} at step {step}"
        );
        assert!(
            then >= last - 1e-6,
            "the text never moves back: {last} became {then} at step {step}"
        );
        // Paragraph 0 ends at 500 px; paragraph 1 starts at 550.
        if (500.0..550.0).contains(&then) {
            in_a_gap += 1;
        }
        last = then;
    }
    assert!(in_a_gap > 0, "the dial turned between two paragraphs");
    // The anchor the views get carries the same position.
    let at = after(now, 40_000);
    assert!(close(
        clock.anchor(at).position.expect("laid out"),
        clock.position_at(at).expect("laid out")
    ));
}

// A pause and a play between two paragraphs keep the text where it is too.
#[test]
fn a_pause_and_a_play_between_two_paragraphs_keep_the_text_where_it_is() {
    let now = Instant::now();
    let paragraphs = script(4, 25);
    let mut clock = laid_out_clock(now, paragraphs, 140);
    clock.play(now);
    // Run until the reading line stands between paragraphs 0 and 1.
    let mut at = now;
    for step in 1..=20_000_u64 {
        at = after(now, step * 10);
        let position = clock.position_at(at).expect("laid out");
        if (510.0..540.0).contains(&position) {
            break;
        }
    }
    let between = clock.position_at(at).expect("laid out");
    assert!(
        (510.0..540.0).contains(&between),
        "found the gap: {between}"
    );
    clock.pause(at);
    assert!(close(clock.position_at(at).expect("laid out"), between));
    let rest = clock.position_at(after(at, 5_000)).expect("laid out");
    clock.play(after(at, 5_000));
    assert!(close(
        clock.position_at(after(at, 5_000)).expect("laid out"),
        rest
    ));
}

// §5.4 and D19: the scroll stops when END reaches the reading line and the
// text stands there; the clock says when that will be.
#[test]
fn the_text_stops_at_end() {
    let now = Instant::now();
    let paragraphs = script(2, 10);
    let mut clock = laid_out_clock(now, paragraphs.clone(), 300);
    clock.play(now);
    let to_end = clock
        .time_to_end_ms(now)
        .expect("a moving clock reaches END");
    assert!(!clock.settle(after(now, to_end as u64 - 5)));
    assert!(clock.settle(after(now, to_end as u64 + 5)));
    assert!(!clock.playing);
    assert!(clock.at_end(after(now, to_end as u64 + 5)));
    assert_eq!(clock.motion.paragraph, paragraphs.len() as u32);
    assert_eq!(
        clock.place_at(after(now, to_end as u64 + 5)),
        PrompterPlace::end_of(&paragraphs)
    );
    assert_eq!(clock.time_to_end_ms(after(now, 60_000)), None);
}

// §5 (answered in §14): a jump keeps the scroll as it was; only TOP pauses.
#[test]
fn a_jump_keeps_the_scroll_and_top_pauses() {
    let now = Instant::now();
    let mut clock = laid_out_clock(now, script(10, 12), 140);
    clock.play(now);
    let target = PrompterPlace {
        paragraph: 4,
        word: 0,
    };
    let before = clock.position_at(after(now, 2_000)).unwrap();
    clock.jump(after(now, 2_000), target.paragraph, 0.0, false);
    assert!(clock.playing);
    assert_eq!(clock.place_at(after(now, 2_000)), target);
    let anchor = clock.anchor(after(now, 2_000));
    assert_eq!(anchor.move_from_position, Some(before));
    assert_eq!(anchor.move_ms, JUMP_MOVE_MS);
    assert!(clock.position_at(after(now, 3_000)).unwrap() > anchor.position.unwrap());

    clock.jump(after(now, 3_000), 0, 0.0, true);
    assert!(!clock.playing);
    assert_eq!(clock.position_at(after(now, 9_000)), Some(0.0));
}

// §4.1 and §5.2: a new look keeps the words at the reading line. The motion
// goes on in words until the new layout is reported, then in its pixels, and
// the word at the reading line is the same word in both (review of
// 2026-09-27: the place was the line's first word and a share of the line's
// height, so a new size moved the reading line by up to a line — from word
// 19 of lines of ten words to word 14 of lines of five).
#[test]
fn a_new_look_keeps_the_words_at_the_reading_line() {
    let now = Instant::now();
    let paragraphs = script(12, 30);
    for (per_line_after, height_after) in [(5, 140.0), (20, 70.0), (7, 120.0)] {
        let mut clock = GlassClock::paused(
            now,
            String::from("script-a"),
            paragraphs.clone(),
            String::from("g1-l0"),
            PrompterPlace::TOP,
            150,
        );
        clock.accept_layout(now, layout_of("g1-l0", &paragraphs, 10, 100.0));
        clock.jump(now, 6, 19.4, false);
        let before = clock.words_at(after(now, 10));
        assert!((before.1 - 19.4).abs() < 0.01, "{before:?}");
        clock.relayout(after(now, 10), String::from("g1-l1"));
        assert_eq!(clock.anchor(after(now, 10)).position, None);
        assert!((clock.words_at(after(now, 10)).1 - 19.4).abs() < 0.01);
        clock.accept_layout(
            after(now, 20),
            layout_of("g1-l1", &paragraphs, per_line_after, height_after),
        );
        let (paragraph, offset) = clock.words_at(after(now, 20));
        assert_eq!(paragraph, 6);
        assert!(
            (offset - 19.4).abs() < 0.01,
            "{per_line_after} words a line: the reading line is at word {offset}, not 19.4"
        );
        assert_eq!(clock.place_at(after(now, 20)).word, 19);
    }
}

// A layout that arrives while the text scrolls takes the motion over from
// the words, so nothing jumps: the view reports its layout within moments of
// a new look, and in that time the words the text moved and the pixels it
// moved agree to a small part of a word. (Over a long wait they drift apart
// by the gaps between paragraphs, which the pixels spread over every word.)
#[test]
fn a_layout_arriving_mid_scroll_carries_the_motion_on() {
    let now = Instant::now();
    let paragraphs = script(12, 30);
    let mut clock = GlassClock::paused(
        now,
        String::from("script-a"),
        paragraphs.clone(),
        String::from("g1-l0"),
        PrompterPlace::TOP,
        120,
    );
    clock.accept_layout(now, layout_of("g1-l0", &paragraphs, 6, 100.0));
    clock.play(now);
    let before = clock.place_at(after(now, 10_000));
    clock.relayout(after(now, 10_000), String::from("g1-l1"));
    let in_words = clock.words_at(after(now, 10_200));
    assert!(clock.place_at(after(now, 10_200)) >= before);
    clock.accept_layout(
        after(now, 10_200),
        layout_of("g1-l1", &paragraphs, 6, 100.0),
    );
    let in_pixels = clock.words_at(after(now, 10_200));
    assert_eq!(in_pixels.0, in_words.0);
    assert!(
        (in_pixels.1 - in_words.1).abs() < 0.1,
        "{in_pixels:?} {in_words:?}"
    );
    assert!(clock.playing);
}

// Review of 2026-09-27: a pause saves where the 0.3 s ease stops the text,
// not where it was at the press.
#[test]
fn a_pause_rests_where_its_ease_stops() {
    let now = Instant::now();
    let paragraphs = script(4, 40);
    let mut clock = laid_out_clock(now, paragraphs, 300);
    clock.jump(now, 0, 4.9, false);
    clock.play(now);
    clock.pause(after(now, 300));
    let at_press = clock.place_at(after(now, 300));
    let resting = clock.resting_place(after(now, 300));
    assert!(resting > at_press, "{resting:?} after {at_press:?}");
    assert_eq!(resting, clock.place_at(after(now, 5_000)));
}

// Review of 2026-09-27: a script of cues alone has no read word; it is paced
// by all its words instead of running through in one word's time.
#[test]
fn a_script_of_cues_alone_is_paced_by_its_words() {
    let paragraphs: Vec<PrompterParagraph> = (0..20)
        .map(|index| PrompterParagraph::plain(format!("[CUE {index}]")))
        .collect();
    let layout = layout_of("k", &paragraphs, 5, 100.0);
    // Forty words (two to a cue) share the height.
    let text_height = layout.lines.last().unwrap().top + 100.0;
    assert!(close(layout.px_per_read_word, text_height / 40.0));
}

// The walk of 2026-10-07, finding 13: the pace's pixels per read word come
// from the full lines of running text (the owner's choice), not from the
// whole height, which spread the paragraph gaps, the cue lines and the short
// last lines over the words and read 22 to 29 % faster than the number.
#[test]
fn the_pace_comes_from_the_full_lines_of_running_text() {
    // Two paragraphs of seven words, three a line (3, 3, 1), then a cue on a
    // line of its own: four full lines of three read words at 100 px.
    let mut paragraphs: Vec<PrompterParagraph> = (*script(2, 7)).clone();
    paragraphs.push(PrompterParagraph::plain("[CUE]"));
    let layout = layout_of("k", &paragraphs, 3, 100.0);
    assert!(
        close(layout.px_per_read_word, 100.0 / 3.0),
        "{}",
        layout.px_per_read_word
    );

    // No line wraps: the lines that hold a read word, without the gaps.
    let short = script(3, 2);
    let layout = layout_of("k", &short, 5, 100.0);
    assert!(
        close(layout.px_per_read_word, 50.0),
        "{}",
        layout.px_per_read_word
    );

    // So a script takes a little longer than its words at the pace: the time
    // left comes from the pixels to END.
    let now = Instant::now();
    let mut clock = GlassClock::paused(
        now,
        String::from("script-a"),
        short.clone(),
        String::from("k"),
        PrompterPlace::TOP,
        140,
    );
    clock.accept_layout(now, layout);
    let (left, estimated) = clock.time_left(now);
    assert!(!estimated);
    let words_at_the_pace = read_words_from(&short, PrompterPlace::TOP) as f64 * 60.0 / 140.0;
    assert!(
        left > words_at_the_pace,
        "{left} s for {words_at_the_pace} s of words"
    );
}

// §5.3: the time left is exact from the layout, estimated from the words
// without one, and the same when the layout and the words agree.
#[test]
fn the_time_left_comes_from_the_layout_or_the_words() {
    let now = Instant::now();
    let paragraphs = script(4, 35);
    let mut clock = GlassClock::paused(
        now,
        String::from("script-a"),
        paragraphs.clone(),
        String::from("g1-l0"),
        PrompterPlace::TOP,
        140,
    );
    let (estimate, estimated) = clock.time_left(now);
    assert!(estimated);
    assert!(close(estimate, 140.0 * 60.0 / 140.0));
    assert!(close(clock.length().0, 60.0));

    clock.accept_layout(now, layout_of("g1-l0", &paragraphs, 5, 100.0));
    let (exact, estimated) = clock.time_left(now);
    assert!(!estimated);
    // The layout adds the gaps between paragraphs and END's half screen.
    assert!(exact > estimate, "{exact} > {estimate}");
}

#[test]
fn a_line_step_moves_one_line_and_stays_inside_the_script() {
    let paragraphs = script(3, 10);
    let layout = layout_of("k", &paragraphs, 5, 100.0);
    assert!(close(layout.line_step(30.0, true), 130.0));
    assert!(close(layout.line_step(130.0, false), 30.0));
    assert!(close(layout.line_step(0.0, false), 0.0));
    assert!(close(
        layout.line_step(layout.end_top, true),
        layout.end_top
    ));
}

#[test]
fn counting_read_words_skips_the_cues() {
    let paragraphs = vec![
        PrompterParagraph::plain("[INTRO]"),
        PrompterParagraph::plain("One two [smile] three"),
        PrompterParagraph::plain("Four five"),
    ];
    assert_eq!(read_words_from(&paragraphs, PrompterPlace::TOP), 5);
    assert_eq!(
        read_words_from(
            &paragraphs,
            PrompterPlace {
                paragraph: 1,
                word: 2
            }
        ),
        3
    );
    assert_eq!(
        advance_by_read_words(&paragraphs, PrompterPlace::TOP, 2),
        PrompterPlace {
            paragraph: 1,
            word: 2
        },
        "two words read, the reading line is on the cue after them"
    );
    assert_eq!(
        advance_by_read_words(&paragraphs, PrompterPlace::TOP, 3),
        PrompterPlace {
            paragraph: 2,
            word: 0
        }
    );
    assert_eq!(
        advance_by_read_words(&paragraphs, PrompterPlace::TOP, 99),
        PrompterPlace::end_of(&paragraphs)
    );
}

#[test]
fn a_place_is_kept_inside_its_script() {
    let paragraphs = script(3, 4);
    assert_eq!(
        PrompterPlace {
            paragraph: 1,
            word: 9
        }
        .clamped(&paragraphs),
        PrompterPlace {
            paragraph: 1,
            word: 3
        }
    );
    assert_eq!(
        PrompterPlace {
            paragraph: 7,
            word: 1
        }
        .clamped(&paragraphs),
        PrompterPlace::end_of(&paragraphs)
    );
    assert!(speed_is_valid(140) && !speed_is_valid(142) && !speed_is_valid(35));
}

// A pause's ease that runs into END stops there, even when nobody looks
// until the ease is over (the review of #288: the text stood past END, and
// nobody said so).
#[test]
fn a_pause_that_eases_into_end_stops_there_when_looked_at_after() {
    let now = Instant::now();
    let paragraphs = script(2, 10);
    let mut clock = laid_out_clock(now, paragraphs.clone(), 300);
    clock.play(now);
    let to_end = clock
        .time_to_end_ms(now)
        .expect("a moving clock reaches END") as u64;
    let paused_at = after(now, to_end - 30);
    clock.pause(paused_at);
    let looked_at = after(paused_at, 400);
    assert!(clock.at_end(looked_at), "the ease carries the text to END");
    assert!(clock.settle(looked_at), "it stops there and says so");
    assert_eq!(clock.motion.paragraph, paragraphs.len() as u32);
    assert!(!clock.settle(after(looked_at, 100)), "once");
}
