//! The console link's tests: parsing the Global OSC vocabulary, read-backs
//! and their confirmations, the pull tracker, the status reports and the
//! eight snapshot slots. Split out of `rme_console_link.rs` under the
//! 2,000-line file-health guard (2026-10-01).

use super::*;

fn msg(address: &str, value: OscType) -> OscMessage {
    OscMessage {
        addr: String::from(address),
        args: vec![value],
    }
}

fn f(value: f64) -> OscType {
    OscType::Float(value as f32)
}

#[test]
fn parses_every_global_control_address_family() {
    let cases: Vec<(&str, OscType, ParamKey, ConsoleValue)> = vec![
        (
            "/input/8/mute",
            f(1.0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 8,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(true),
        ),
        (
            "/input/8/48v",
            OscType::Int(0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 8,
                flag: ChannelFlag::Phantom,
            },
            ConsoleValue::Flag(false),
        ),
        (
            "/input/9/phase",
            OscType::Bool(true),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 9,
                flag: ChannelFlag::Phase,
            },
            ConsoleValue::Flag(true),
        ),
        (
            "/input/10/instrument",
            f(1.0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 10,
                flag: ChannelFlag::Instrument,
            },
            ConsoleValue::Flag(true),
        ),
        (
            "/input/11/autoset",
            f(0.0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 11,
                flag: ChannelFlag::AutoSet,
            },
            ConsoleValue::Flag(false),
        ),
        (
            "/input/8/gain",
            f(41.0),
            ParamKey::InputGain { channel: 8 },
            ConsoleValue::Db(41.0),
        ),
        (
            "/playback/6/mute",
            f(1.0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Playback,
                channel: 6,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(true),
        ),
        (
            "/output/8/mute",
            f(0.0),
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Output,
                channel: 8,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(false),
        ),
        (
            "/output/8/volume",
            f(-16.6),
            ParamKey::OutputVolume { output: 8 },
            ConsoleValue::Db(-16.600_000_381_469_727),
        ),
        (
            "/output/0/faderlin",
            f(0.5),
            ParamKey::OutputVolume { output: 0 },
            ConsoleValue::Position(0.5),
        ),
        (
            "/mix/pb/6/10/fader",
            f(-61.974_41),
            ParamKey::MixFader {
                bus: ConsoleBus::Playback,
                channel: 6,
                output: 10,
            },
            ConsoleValue::Db(f64::from(-61.974_41_f32)),
        ),
        (
            "/mix/in/8/0/faderlin",
            f(0.25),
            ParamKey::MixFader {
                bus: ConsoleBus::Input,
                channel: 8,
                output: 0,
            },
            ConsoleValue::Position(0.25),
        ),
        (
            "/mix/in/8/0/solo",
            f(1.0),
            ParamKey::MixSolo {
                bus: ConsoleBus::Input,
                channel: 8,
                output: 0,
            },
            ConsoleValue::Flag(true),
        ),
        (
            "/controlroom/dim",
            f(1.0),
            ParamKey::ControlRoom(ControlRoomFunction::Dim),
            ConsoleValue::Flag(true),
        ),
        (
            "/controlroom/mainmono",
            f(0.0),
            ParamKey::ControlRoom(ControlRoomFunction::MainMono),
            ConsoleValue::Flag(false),
        ),
        (
            "/status/connection",
            f(1.0),
            ParamKey::StatusConnection,
            ConsoleValue::Number(1.0),
        ),
        (
            "/status/device",
            OscType::String(String::from("Fireface UFX III (1)")),
            ParamKey::StatusDevice,
            ConsoleValue::Text(String::from("Fireface UFX III (1)")),
        ),
        (
            "/status/dsp",
            f(8.0),
            ParamKey::StatusDsp,
            ConsoleValue::Number(8.0),
        ),
        (
            "/snapshot/load/3",
            f(2.0),
            ParamKey::SnapshotLoad { number: 3 },
            ConsoleValue::Number(2.0),
        ),
    ];
    for (address, value, key, expected) in cases {
        let parsed = parse_console_message(&msg(address, value))
            .unwrap_or_else(|| panic!("{address} should parse"));
        assert_eq!(parsed.key, key, "{address}");
        match (&parsed.value, &expected) {
            (ConsoleValue::Db(a), ConsoleValue::Db(b))
            | (ConsoleValue::Position(a), ConsoleValue::Position(b)) => {
                assert!((a - b).abs() < 1e-4, "{address}: {a} vs {b}")
            }
            (a, b) => assert_eq!(a, b, "{address}"),
        }
    }

    for ignored in [
        "/level/in/8",
        "/level/out/0",
        "/input/8/eq/band1freq",
        "/input/8/dynamics/enable",
        "/input/8/name",
        "/output/8/talkbacksel",
        "/controlroom/talkback",
        "/controlroom/dimreduction",
        "/mix/pb/6/10/balpan",
        "/sendall",
        "/durec/state",
    ] {
        assert!(
            parse_console_message(&msg(ignored, f(1.0))).is_none(),
            "{ignored} should be ignored"
        );
    }
    assert!(parse_console_message(&msg("/output/8/48v", f(1.0))).is_none());
    assert!(parse_console_message(&msg("/playback/6/phase", f(1.0))).is_none());
}

#[test]
fn outgoing_commands_share_keys_with_their_readbacks() {
    let sent = parse_console_message(&msg("/mix/pb/6/10/faderlin", f(0.02))).unwrap();
    let reported = parse_console_message(&msg("/mix/pb/6/10/fader", f(-61.974))).unwrap();
    assert_eq!(sent.key, reported.key);
    assert!(values_match(&sent.value, &reported.value));
    assert_eq!(
        sent.key.readback(),
        Some(ReadbackRequest::Submix { output: 10 })
    );
    assert_eq!(
        ReadbackRequest::Submix { output: 10 }.osc(),
        vec![
            (String::from("/sendsubmix/10"), OscType::Float(2.0)),
            (String::from("/sendstate"), OscType::Float(1.0)),
        ]
    );
    assert_eq!(
        ReadbackRequest::Channel {
            bus: ConsoleBus::Input,
            channel: 8
        }
        .osc(),
        vec![(String::from("/sendchan/input/8"), OscType::Float(1.0))]
    );
    assert_eq!(
        ReadbackRequest::Settings.osc(),
        vec![(String::from("/sendsettings"), OscType::Float(1.0))]
    );
    assert_eq!(
        ParamKey::MixFader {
            bus: ConsoleBus::Playback,
            channel: 6,
            output: 10
        }
        .describe(),
        "mix pb 6 -> out 10 fader"
    );
}

#[test]
fn readback_is_requested_once_the_send_settles() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(
        &[
            (String::from("/input/8/mute"), f(1.0)),
            (String::from("/input/8/gain"), f(44.0)),
        ],
        0,
    );
    assert_eq!(link.pending_count(), 2);
    assert!(link.due_readbacks(50).is_empty(), "too early");
    let requests = link.due_readbacks(130);
    assert_eq!(
        requests,
        vec![(String::from("/sendchan/input/8"), OscType::Float(1.0))],
        "both parameters share one channel read-back"
    );
    assert!(link.due_readbacks(140).is_empty(), "requested only once");

    // A fresh send of the same parameter restarts the clock.
    link.register_outgoing(&[(String::from("/input/8/gain"), f(45.0))], 200);
    assert!(link.due_readbacks(250).is_empty());
    assert_eq!(link.due_readbacks(330).len(), 1);
}

#[test]
fn readback_reply_within_tolerance_confirms_the_send() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(
        &[
            (String::from("/input/8/mute"), f(1.0)),
            (String::from("/mix/pb/6/10/faderlin"), f(0.02)),
            (String::from("/output/0/faderlin"), f(0.5)),
        ],
        0,
    );
    link.due_readbacks(130);
    assert_eq!(
        link.ingest(&msg("/input/8/mute", f(1.0)), 160),
        Classification::Confirmed
    );
    assert_eq!(
        link.ingest(&msg("/mix/pb/6/10/fader", f(-61.974_41)), 160),
        Classification::Confirmed
    );
    // Output 0 at position 0.5 is -12.13 dB on the RME curve.
    assert_eq!(
        link.ingest(&msg("/output/0/volume", f(-12.13)), 160),
        Classification::Confirmed
    );
    assert_eq!(link.pending_count(), 0);
    let summary = link.summary(200);
    assert_eq!(summary.confirmed_sends, 3);
    assert_eq!(summary.unconfirmed_sends, 0);
    assert_eq!(summary.last_echo_age_ms, Some(40));
    // 2026-09-22: each confirmation is queued as the app's own value (the
    // position it sent, not the dB the desk reported), so a report the
    // desk made before it cannot be written last. Was: "confirmations
    // queue nothing".
    let queued = link.take_queued();
    assert_eq!(queued.len(), 3);
    assert!(queued
        .iter()
        .all(|update| update.confirms_send && !update.adjusted));
    let fader = queued
        .iter()
        .find(|update| matches!(update.key, ParamKey::MixFader { .. }))
        .expect("the fader's confirmation");
    assert!(
        matches!(fader.value, ConsoleValue::Position(position) if (position - 0.02).abs() < 1e-6),
        "the value the app sent: {:?}",
        fader.value
    );
}

#[test]
fn readback_reply_with_a_different_value_is_adjusted_and_queued() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/input/8/gain"), f(41.0))], 0);
    link.due_readbacks(130);
    assert_eq!(
        link.ingest(&msg("/input/8/gain", f(44.0)), 160),
        Classification::Adjusted
    );
    assert_eq!(link.pending_count(), 0);
    let queued = link.take_queued();
    assert_eq!(
        queued,
        vec![ConsoleUpdate {
            key: ParamKey::InputGain { channel: 8 },
            value: ConsoleValue::Db(44.0),
            adjusted: true,
            confirms_send: false,
            during_load: false,
        }]
    );
    assert_eq!(link.summary(200).adjusted_sends, 1);
}

#[test]
fn stale_reply_does_not_override_a_newer_send() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.5))], 0);
    link.due_readbacks(130);
    // The operator keeps dragging before the first reply lands.
    link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.7))], 200);
    assert_eq!(
        link.ingest(&msg("/mix/pb/6/10/fader", f(-12.13)), 210),
        Classification::Stale
    );
    assert_eq!(link.pending_count(), 1, "the newer send stays pending");
    assert!(link.take_queued().is_empty());
    // The second read-back confirms the final position (-3.85 dB).
    assert_eq!(
        link.due_readbacks(330).len(),
        2,
        "submix read-back plus its /sendstate marker"
    );
    assert_eq!(
        link.ingest(&msg("/mix/pb/6/10/fader", f(-3.85)), 360),
        Classification::Confirmed
    );
    assert_eq!(link.pending_count(), 0);
}

#[test]
fn unsolicited_message_is_an_external_change() {
    let mut link = ConsoleLinkState::default();
    assert_eq!(
        link.ingest(&msg("/controlroom/dim", f(1.0)), 10),
        Classification::External
    );
    assert_eq!(
        link.ingest(&msg("/level/in/8", f(-20.0)), 11),
        Classification::Ignored
    );
    let queued = link.take_queued();
    assert_eq!(queued.len(), 1);
    assert_eq!(
        queued[0].key,
        ParamKey::ControlRoom(ControlRoomFunction::Dim)
    );
    assert!(!queued[0].adjusted);
    assert_eq!(link.summary(20).external_changes, 1);
    assert_eq!(link.summary(20).last_echo_age_ms, Some(10));
}

#[test]
fn off_send_is_confirmed_by_absence_once_the_submix_reply_finishes() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.0))], 0);
    assert_eq!(
        link.due_readbacks(130),
        vec![
            (String::from("/sendsubmix/10"), OscType::Float(2.0)),
            (String::from("/sendstate"), OscType::Float(1.0)),
        ]
    );
    // The reply burst mentions another node on the same submix only.
    assert_eq!(
        link.ingest(&msg("/mix/pb/0/10/fader", f(-12.0)), 160),
        Classification::External
    );
    link.tick(200);
    assert_eq!(link.pending_count(), 1, "burst not quiet yet");
    link.tick(250);
    assert_eq!(link.pending_count(), 0, "absence confirms the off node");
    assert_eq!(link.summary(250).confirmed_sends, 1);
    assert_eq!(link.summary(250).unconfirmed_sends, 0);
    // The other node is the desk's report; the off node's confirmation is
    // queued after it as the value the app sent (2026-09-22).
    let queued = link.take_queued();
    assert_eq!(queued.len(), 2);
    assert!(!queued[0].confirms_send);
    assert!(queued[1].confirms_send);
    assert_eq!(
        queued[1].key,
        ParamKey::MixFader {
            bus: ConsoleBus::Playback,
            channel: 6,
            output: 10,
        }
    );
    assert_eq!(queued[1].value, ConsoleValue::Position(0.0));
}

#[test]
fn off_send_on_an_empty_submix_is_confirmed_by_the_status_marker() {
    // Live-verified: `/sendsubmix 2` for a bus with no active nodes sends
    // nothing at all. Without the paired `/sendstate`, the first restore
    // to "off" on the studio console expired as unconfirmed (2026-09-03).
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.0))], 0);
    assert_eq!(link.due_readbacks(130).len(), 2);
    // Only the status marker comes back.
    assert_eq!(
        link.ingest(&msg("/status/connection", f(1.0)), 160),
        Classification::Status
    );
    link.ingest(
        &msg("/status/device", OscType::String(String::from("UFX III"))),
        161,
    );
    link.ingest(&msg("/status/dsp", f(8.0)), 162);
    link.tick(200);
    assert_eq!(link.pending_count(), 1, "quiet window not reached yet");
    link.tick(250);
    assert_eq!(
        link.pending_count(),
        0,
        "empty burst + status confirms the off node"
    );
    let summary = link.summary(250);
    assert_eq!(summary.confirmed_sends, 1);
    assert_eq!(summary.unconfirmed_sends, 0);
}

#[test]
fn channel_readback_that_omits_a_parameter_leaves_it_unconfirmed() {
    // The right side of a stereo-linked pair reports only its L/R
    // parameters; a mute sent to it is never echoed (live, 2026-09-03).
    // 2026-10-04 (the owner's decision). Old: absent from the answered burst,
    // the mute counted as confirmed. New: it expires unconfirmed. Reason: only
    // a report confirms; RME addresses a pair's mute by its left channel, so
    // TotalMix most likely never applied it.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/input/3/mute"), f(0.0))], 0);
    assert_eq!(
        link.due_readbacks(130),
        vec![(String::from("/sendchan/input/3"), OscType::Float(1.0))]
    );
    // The console answers for the channel, but only with L/R parameters.
    assert_eq!(
        link.ingest(&msg("/input/3/phase", f(0.0)), 160),
        Classification::External
    );
    link.tick(250);
    assert_eq!(link.pending_count(), 1, "absence confirms no channel value");
    link.tick(1_600);
    assert_eq!(link.pending_count(), 0);
    let summary = link.summary(1_600);
    assert_eq!(summary.confirmed_sends, 0);
    assert_eq!(summary.unconfirmed_sends, 1);
    assert_eq!(
        summary.unconfirmed_addresses,
        vec![String::from("input 3 mute")]
    );
}

#[test]
fn a_status_line_answers_no_channel_or_settings_readback() {
    // 2026-10-04 (the owner's decision). Old: any status line closed every
    // read-back still without a reply, so a channel read-back that TotalMix
    // never answered confirmed its sends by absence once a fader move's
    // `/sendstate` came back. New: a status line closes only a submix
    // read-back. Reason: it is that read-back's end-of-burst marker and no
    // other's.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(
        &[
            (String::from("/input/8/mute"), f(1.0)),
            (String::from("/controlroom/dim"), f(1.0)),
            (String::from("/mix/pb/6/0/faderlin"), f(0.0)),
        ],
        0,
    );
    assert_eq!(
        link.due_readbacks(130).len(),
        4,
        "channel, settings, submix + status"
    );
    // Only the submix's status marker comes back.
    link.ingest(&msg("/status/connection", f(1.0)), 160);
    link.tick(250);
    assert_eq!(
        link.pending_count(),
        2,
        "the off node is confirmed; the mute and the dim are not"
    );
    // A settings reply that comes late still answers its read-back: the desk's
    // value wins.
    assert_eq!(
        link.ingest(&msg("/controlroom/dim", f(0.0)), 400),
        Classification::Adjusted
    );
    link.tick(1_600);
    assert_eq!(link.pending_count(), 0);
    let summary = link.summary(1_600);
    assert_eq!(summary.confirmed_sends, 1);
    assert_eq!(summary.unconfirmed_sends, 1);
    assert_eq!(
        summary.unconfirmed_addresses,
        vec![String::from("input 8 mute")]
    );
}

#[test]
fn solo_off_on_an_unlisted_node_confirms_by_absence_but_a_fader_does_not() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(
        &[
            (String::from("/mix/in/8/0/solo"), f(0.0)),
            (String::from("/mix/pb/6/0/faderlin"), f(0.3)),
        ],
        0,
    );
    assert_eq!(
        link.due_readbacks(130).len(),
        2,
        "one submix read-back + status marker"
    );
    // Only the status marker answers: the submix has no active nodes.
    link.ingest(&msg("/status/connection", f(1.0)), 160);
    link.tick(250);
    assert_eq!(
        link.pending_count(),
        1,
        "solo-off confirmed, the audible fader is not"
    );
    link.tick(1_600);
    assert_eq!(link.pending_count(), 0);
    let summary = link.summary(1_600);
    assert_eq!(summary.confirmed_sends, 1);
    assert_eq!(summary.unconfirmed_sends, 1);
    assert_eq!(
        summary.unconfirmed_addresses,
        vec![String::from("mix pb 6 -> out 0 fader")]
    );
}

#[test]
fn a_channel_send_with_no_reply_at_all_expires_as_unconfirmed() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 0);
    link.due_readbacks(130);
    link.tick(1_000);
    assert_eq!(link.pending_count(), 1);
    link.tick(1_600);
    assert_eq!(link.pending_count(), 0);
    let expired = link.take_expired();
    assert_eq!(expired.len(), 1);
    assert_eq!(
        expired[0].key,
        ParamKey::ChannelFlag {
            bus: ConsoleBus::Input,
            channel: 8,
            flag: ChannelFlag::Mute
        }
    );
    let summary = link.summary(1_600);
    assert_eq!(summary.unconfirmed_sends, 1);
    assert_eq!(
        summary.unconfirmed_addresses,
        vec![String::from("input 8 mute")]
    );
    link.reset_unconfirmed();
    assert_eq!(link.summary(1_700).unconfirmed_sends, 0);
}

#[test]
fn pull_applies_every_dump_value_even_when_it_confirms_a_pending_send() {
    // Outside a pull a confirming reply is queued as the value the app
    // sent (2026-09-22: the app's copy can be older than the desk's when a
    // report was written after the app's own write; before, it was not
    // queued at all). During a pull the dump is authoritative, so the
    // value the desk reported is queued — otherwise a value that happened
    // to match an in-flight send would never reach the database if the
    // app's copy was stale.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 0);
    assert_eq!(
        link.ingest(&msg("/input/8/mute", f(1.0)), 50),
        Classification::Confirmed
    );
    let queued = link.take_queued();
    assert_eq!(
        queued.len(),
        1,
        "no pull: the confirmation, as the app's value"
    );
    assert!(queued[0].confirms_send);
    assert_eq!(queued[0].value, ConsoleValue::Flag(true));

    link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 100);
    link.register_outgoing(&[(String::from("/input/8/gain"), f(41.0))], 100);
    link.begin_pull(120);
    assert_eq!(
        link.ingest(&msg("/input/8/mute", f(1.0)), 150),
        Classification::Confirmed
    );
    // A different value for a send made before the pull began is the
    // console's word: the pull asked after the send. (A send made during
    // the pull is the next test's case.)
    assert_eq!(
        link.ingest(&msg("/input/8/gain", f(33.0)), 151),
        Classification::Adjusted
    );
    let queued = link.take_queued();
    assert_eq!(queued.len(), 2);
    assert_eq!(queued[0].value, ConsoleValue::Flag(true));
    assert!(!queued[0].adjusted);
    assert!(queued[0].confirms_send);
    assert_eq!(queued[1].value, ConsoleValue::Db(33.0));
    assert!(queued[1].adjusted);
    assert!(!queued[1].confirms_send);

    // A fader confirmed during a pull carries the dB the desk reported,
    // not the position the app sent (0.5 is -12.13 dB on the RME curve).
    link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.5))], 160);
    assert_eq!(
        link.ingest(&msg("/mix/pb/6/10/fader", f(-12.13)), 170),
        Classification::Confirmed
    );
    let queued = link.take_queued();
    assert_eq!(queued.len(), 1);
    assert!(queued[0].confirms_send);
    assert!(
        matches!(queued[0].value, ConsoleValue::Db(_)),
        "{:?}",
        queued[0].value
    );
    assert_eq!(link.pending_count(), 0);
}

#[test]
fn a_dump_line_for_a_send_made_during_the_pull_does_not_answer_it() {
    // 2026-09-23 (a finding recorded under 919047b): a dump line the desk
    // sent before the app's send reached it, but read after the send was
    // registered, was taken as the desk adjusting the send. It was written,
    // the send was never read back, and Sync wrote aligned over a value
    // the desk no longer held. Nothing asked the desk after the send, so
    // the line is stale; the send's own read-back decides it.
    let mut link = ConsoleLinkState::default();
    link.begin_pull(100);
    link.register_outgoing(&[(String::from("/input/8/gain"), f(41.0))], 150);
    assert_eq!(
        link.ingest(&msg("/input/8/gain", f(33.0)), 160),
        Classification::Stale
    );
    assert_eq!(link.pending_count(), 1, "the send stays pending");
    assert!(
        link.take_queued().is_empty(),
        "the older dump value is not written"
    );

    // The read-back, asked after the send, confirms the app's value.
    let asked = 150 + READBACK_DELAY_MS;
    assert!(!link.due_readbacks(asked).is_empty());
    assert_eq!(
        link.ingest(&msg("/input/8/gain", f(41.0)), asked + 20),
        Classification::Confirmed
    );
    assert_eq!(link.pending_count(), 0);
    link.take_queued();

    // A different value that follows a read-back asked after the send is
    // the desk's word, pull or not.
    link.register_outgoing(&[(String::from("/input/8/gain"), f(45.0))], 400);
    let asked = 400 + READBACK_DELAY_MS;
    assert!(!link.due_readbacks(asked).is_empty());
    assert_eq!(
        link.ingest(&msg("/input/8/gain", f(47.0)), asked + 20),
        Classification::Adjusted
    );
    let queued = link.take_queued();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].value, ConsoleValue::Db(47.0));
    assert!(queued[0].adjusted);
    link.finish_pull(asked + 40);
}

#[test]
fn a_send_stamped_in_the_pulls_own_millisecond_is_not_answered_by_the_dump() {
    // The review of the fix above: the pull's time is stamped before its
    // request leaves, in whole milliseconds, so a send stamped in the same
    // millisecond may have left after the request. Its dump line may
    // predate it, so it is stale; a send made the millisecond before the
    // pull is still settled by the dump.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/input/2/mute"), f(1.0))], 99);
    link.begin_pull(100);
    link.register_outgoing(&[(String::from("/input/3/mute"), f(1.0))], 100);
    assert_eq!(
        link.ingest(&msg("/input/3/mute", f(0.0)), 101),
        Classification::Stale
    );
    assert_eq!(
        link.ingest(&msg("/input/2/mute", f(0.0)), 102),
        Classification::Adjusted
    );
    link.finish_pull(103);
}

#[test]
fn pull_tracker_counts_the_dump_and_reports_quiet() {
    let mut link = ConsoleLinkState::default();
    assert!(link.pull_progress(0).is_none());
    link.begin_pull(100);
    let early = link.pull_progress(150).expect("pull in progress");
    assert_eq!(early.control_messages, 0);
    assert!(!early.is_complete(300), "nothing arrived yet");

    // The dump: status first, then parameters, including an EQ detail
    // message the app does not model (counts as traffic, not as parsed).
    link.ingest(&msg("/status/connection", f(1.0)), 160);
    link.ingest(&msg("/input/8/mute", f(0.0)), 170);
    link.ingest(&msg("/input/8/gain", f(41.0)), 171);
    link.ingest(&msg("/input/8/eq/band1freq", f(100.0)), 172);
    link.ingest(&msg("/output/8/volume", f(-16.6)), 180);
    link.ingest(&msg("/mix/in/8/8/fader", f(0.0)), 190);
    link.ingest(&msg("/mix/pb/2/0/fader", f(-6.0)), 191);
    link.ingest(&msg("/level/in/8", f(-20.0)), 400);

    let progress = link.pull_progress(420).expect("pull in progress");
    assert_eq!(progress.control_messages, 7, "levels are not dump traffic");
    assert_eq!(progress.parsed_messages, 6);
    assert!(progress.status_seen);
    assert_eq!(progress.channels_seen, vec![(ConsoleBus::Input, 8)]);
    assert_eq!(progress.outputs_seen, vec![8]);
    assert_eq!(
        progress.mix_nodes_seen,
        vec![(ConsoleBus::Input, 8, 8), (ConsoleBus::Playback, 2, 0)]
    );
    assert_eq!(progress.last_message_age_ms, Some(229));
    assert!(!progress.is_complete(300));
    assert!(link.pull_progress(500).unwrap().is_complete(300));

    let finished = link.finish_pull(500).expect("pull should finish");
    assert_eq!(finished.parsed_messages, 6);
    assert!(link.pull_progress(600).is_none());
    // Traffic after the pull is no longer counted against it.
    link.ingest(&msg("/input/9/mute", f(1.0)), 700);
    assert!(link.finish_pull(700).is_none());
}

#[test]
fn status_messages_drive_the_link_state_only() {
    let mut link = ConsoleLinkState::default();
    assert_eq!(link.connection(), ConsoleConnection::Unknown);
    assert_eq!(
        link.ingest(&msg("/status/connection", f(1.0)), 5),
        Classification::Status
    );
    assert_eq!(link.connection(), ConsoleConnection::Connected);
    assert!(!link.take_connection_lost());
    link.ingest(
        &msg(
            "/status/device",
            OscType::String(String::from("Fireface UFX III (1)")),
        ),
        6,
    );
    link.ingest(&msg("/status/dsp", f(8.0)), 7);
    link.ingest(&msg("/snapshot/load/2", f(2.0)), 8);
    assert_eq!(link.summary(8).snapshot_slots[1], SnapshotSlotState::Active);
    assert_eq!(
        link.ingest(&msg("/status/connection", f(0.0)), 9),
        Classification::Status
    );
    assert_eq!(link.connection(), ConsoleConnection::Disconnected);
    assert!(link.take_connection_lost());
    assert!(!link.take_connection_lost(), "flag is consumed once");
    let summary = link.summary(10);
    assert_eq!(summary.device.as_deref(), Some("Fireface UFX III (1)"));
    assert_eq!(summary.dsp_load, Some(8.0));
    // 2026-10-01: the lost connection forgets the desk's snapshots. Was: the
    // active snapshot (2) outlived it.
    assert_eq!(
        summary.snapshot_slots,
        [SnapshotSlotState::Unknown; SNAPSHOT_SLOTS]
    );
    assert!(link.take_queued().is_empty(), "status never queues state");
}

// ---------------------------------------------------------------------------
// Overlapping read-backs of one submix (2026-10-01).
// ---------------------------------------------------------------------------

fn off_fader(channel: usize, output: usize) -> ParamKey {
    ParamKey::MixFader {
        bus: ConsoleBus::Input,
        channel,
        output,
    }
}

#[test]
fn a_second_read_back_of_the_submix_does_not_strand_the_first_bursts_off_sends() {
    // On the studio desk a recall left off faders unconfirmed and the Console
    // assumed: a second burst of sends to the same submix settled on a later
    // check, its read-back restamped the submix's request before the first
    // reply had gone quiet, and the first burst's sends, asked at the earlier
    // time, never matched the request that completed.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/mix/in/0/0/faderlin"), f(0.0))], 0);
    link.register_outgoing(&[(String::from("/mix/in/1/0/faderlin"), f(0.0))], 50);

    let first_asked = READBACK_DELAY_MS;
    link.tick(first_asked);
    assert_eq!(
        link.due_readbacks(first_asked),
        vec![
            (String::from("/sendsubmix/0"), OscType::Float(2.0)),
            (String::from("/sendstate"), OscType::Float(1.0)),
        ],
        "the first node's read-back; the second has not settled"
    );
    // The desk lists neither node (both off): only the status marker.
    link.ingest(&msg("/status/connection", f(1.0)), first_asked + 30);

    // The second node settles before that reply has gone quiet, and a second
    // `/sendsubmix` for the same output goes out.
    let second_asked = 50 + READBACK_DELAY_MS;
    assert!(second_asked < first_asked + 30 + REPLY_QUIET_MS);
    link.tick(second_asked);
    assert_eq!(link.pending_count(), 2, "the first reply is not quiet yet");
    assert_eq!(
        link.due_readbacks(second_asked),
        vec![
            (String::from("/sendsubmix/0"), OscType::Float(2.0)),
            (String::from("/sendstate"), OscType::Float(1.0)),
        ]
    );
    link.ingest(&msg("/status/connection", f(1.0)), second_asked + 30);

    link.tick(second_asked + 30 + REPLY_QUIET_MS);
    assert_eq!(
        link.pending_count(),
        0,
        "both off nodes are confirmed by their absence"
    );
    link.tick(CONFIRM_TIMEOUT_MS + 100);
    assert!(link.take_expired().is_empty(), "nothing expires");
    let summary = link.summary(CONFIRM_TIMEOUT_MS + 100);
    assert_eq!(summary.confirmed_sends, 2);
    assert_eq!(summary.unconfirmed_sends, 0);
    let confirmed: Vec<ParamKey> = link
        .take_queued()
        .into_iter()
        .filter(|update| update.confirms_send)
        .map(|update| update.key)
        .collect();
    assert_eq!(confirmed.len(), 2);
    assert!(confirmed.contains(&off_fader(0, 0)));
    assert!(confirmed.contains(&off_fader(1, 0)));
}

#[test]
fn a_send_asked_after_the_completed_read_back_is_not_answered_by_it() {
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(&[(String::from("/mix/in/0/0/faderlin"), f(0.0))], 0);
    let asked = READBACK_DELAY_MS;
    assert_eq!(link.due_readbacks(asked).len(), 2);
    // A second off send to the same submix leaves after the request did.
    link.register_outgoing(&[(String::from("/mix/in/1/0/faderlin"), f(0.0))], asked + 5);
    link.ingest(&msg("/status/connection", f(1.0)), asked + 30);
    link.tick(asked + 30 + REPLY_QUIET_MS);
    assert_eq!(link.pending_count(), 1, "the first is confirmed");
    assert!(
        link.has_pending(&off_fader(1, 0)),
        "the reply may predate the later send, so it does not answer it"
    );

    // Its own read-back does.
    let own = asked + 5 + READBACK_DELAY_MS;
    link.tick(own);
    assert_eq!(link.due_readbacks(own).len(), 2);
    link.ingest(&msg("/status/connection", f(1.0)), own + 30);
    link.tick(own + 30 + REPLY_QUIET_MS);
    assert_eq!(link.pending_count(), 0);
    assert_eq!(link.summary(own + 200).confirmed_sends, 2);

    // The rule itself: a read-back answers a send asked at or before it,
    // never one asked after it or not yet asked.
    let pending = |requested_at_ms: Option<u64>| PendingSend {
        key: off_fader(2, 0),
        value: ConsoleValue::Position(0.0),
        sent_at_ms: 0,
        requested_at_ms,
    };
    assert!(read_back_answers(&pending(Some(120)), 170));
    assert!(read_back_answers(&pending(Some(170)), 170));
    assert!(!read_back_answers(&pending(Some(171)), 170));
    assert!(!read_back_answers(&pending(None), 170));
}

// ---------------------------------------------------------------------------
// Channel names from TotalMix (2026-10-01).
// ---------------------------------------------------------------------------

#[test]
fn channel_names_parse_as_text_and_are_external_changes() {
    let name = |address: &str, value: &str| {
        parse_console_message(&msg(address, OscType::String(String::from(value))))
            .unwrap_or_else(|| panic!("{address} should parse"))
    };
    let cases = [
        ("/input/8/name", ConsoleBus::Input, 8, "Host"),
        ("/playback/6/name", ConsoleBus::Playback, 6, "Music 7/8"),
        ("/output/8/name", ConsoleBus::Output, 8, "Phones Guest"),
    ];
    for (address, bus, channel, value) in cases {
        let parsed = name(address, value);
        assert_eq!(parsed.key, ParamKey::ChannelName { bus, channel });
        assert_eq!(parsed.value, ConsoleValue::Text(String::from(value)));
        assert_eq!(parsed.key.readback(), None, "nothing reads a name back");
    }
    assert_eq!(
        ParamKey::ChannelName {
            bus: ConsoleBus::Input,
            channel: 8
        }
        .describe(),
        "input 8 name"
    );
    assert!(parse_console_message(&msg("/input/8/name", OscType::Int(3))).is_none());
    assert!(
        parse_console_message(&msg("/mixer/8/name", OscType::String(String::from("Host"))))
            .is_none()
    );

    // A name is a change made at TotalMix, and the app never sends one, so
    // registering it as outgoing leaves nothing to confirm.
    let mut link = ConsoleLinkState::default();
    link.register_outgoing(
        &[(
            String::from("/input/8/name"),
            OscType::String(String::from("Host")),
        )],
        0,
    );
    assert_eq!(link.pending_count(), 0);
    link.begin_pull(10);
    assert_eq!(
        link.ingest(
            &msg("/input/8/name", OscType::String(String::from("Host"))),
            20
        ),
        Classification::External
    );
    link.ingest(
        &msg("/output/10/name", OscType::String(String::from("Phones 2"))),
        21,
    );
    let queued = link.take_queued();
    assert_eq!(queued.len(), 2);
    assert!(queued
        .iter()
        .all(|update| !update.adjusted && !update.confirms_send));
    let progress = link.finish_pull(30).expect("pull in progress");
    assert_eq!(progress.channels_seen, vec![(ConsoleBus::Input, 8)]);
    assert_eq!(progress.outputs_seen, vec![10]);
}

#[test]
fn a_pull_keeps_every_name_the_dump_carried_as_sent_the_last_one_winning() {
    let mut link = ConsoleLinkState::default();
    let name = |link: &mut ConsoleLinkState, address: &str, value: &str, at: u64| {
        link.ingest(&msg(address, OscType::String(String::from(value))), at);
    };
    // Before the pull: not the pull's.
    name(&mut link, "/input/0/name", "Before", 5);
    link.begin_pull(10);
    name(&mut link, "/input/9/name", "Boom", 11);
    name(&mut link, "/input/0/name", "", 12);
    name(&mut link, "/playback/0/name", "Windows Out", 13);
    name(&mut link, "/input/9/name", "Röst", 14);
    link.ingest(&msg("/input/9/mute", f(0.0)), 15);
    let progress = link.finish_pull(30).expect("pull in progress");
    assert_eq!(
        progress.names,
        vec![
            (ConsoleBus::Input, 0, String::new()),
            (ConsoleBus::Playback, 0, String::from("Windows Out")),
            (ConsoleBus::Input, 9, String::from("Röst")),
        ]
    );
}

#[test]
fn an_out_of_touch_mark_is_activity_until_a_flush_takes_it() {
    let mut link = ConsoleLinkState::default();
    assert!(!link.has_activity());
    let mark = |secs| OutOfTouch { secs };
    link.mark_out_of_touch(mark(31));
    link.mark_out_of_touch(mark(5));
    assert!(link.has_activity());
    assert_eq!(
        link.take_out_of_touch(),
        Some(mark(31)),
        "the longer quiet stays"
    );
    assert!(!link.has_activity());
    assert_eq!(link.take_out_of_touch(), None);

    link.mark_out_of_touch(mark(7));
    link.reset_for_test();
    assert_eq!(link.take_out_of_touch(), None, "a reset clears the mark");
}

#[test]
fn the_device_s_name_is_logged_when_first_heard_and_when_it_changes() {
    let mut link = ConsoleLinkState::default();
    assert_eq!(
        link.note_device("Fireface UFX III (1)"),
        Some(String::from(
            "TotalMix's device: \"Fireface UFX III (1)\" (its names file is last.FirefaceUFXIII1.xml)."
        ))
    );
    assert_eq!(link.note_device("Fireface UFX III (1)"), None);
    assert_eq!(
        link.note_device("UFX II"),
        Some(String::from(
            "TotalMix's device is now \"UFX II\", was \"Fireface UFX III (1)\" (its names file is last.UFXII.xml)."
        ))
    );
    assert_eq!(
        link.note_device("()"),
        Some(String::from(
            "TotalMix's device is now \"()\", was \"UFX II\" (no names file is named after it)."
        ))
    );
    assert_eq!(link.summary(0).device.as_deref(), Some("()"));
}

// ---------------------------------------------------------------------------
// TotalMix's eight snapshot slots (2026-10-01).
// ---------------------------------------------------------------------------

#[test]
fn snapshot_reports_move_each_slot_and_mark_the_change() {
    let mut link = ConsoleLinkState::default();
    assert_eq!(link.snapshot_slot(3), Some((SnapshotSlotState::Unknown, 0)));
    assert!(!link.has_activity());

    assert_eq!(
        link.ingest(&msg("/snapshot/load/3", f(2.0)), 10),
        Classification::Status
    );
    assert_eq!(link.snapshot_slot(3), Some((SnapshotSlotState::Active, 1)));
    assert!(link.has_activity(), "a changed slot is reported");
    assert!(link.take_snapshot_slots_changed());
    assert!(!link.has_activity(), "the mark is taken once");

    link.ingest(&msg("/snapshot/load/3", f(3.0)), 20);
    assert_eq!(link.snapshot_slot(3), Some((SnapshotSlotState::Changed, 2)));
    assert!(link.take_snapshot_slots_changed());
    link.ingest(&msg("/snapshot/load/3", f(0.0)), 30);
    assert_eq!(link.snapshot_slot(3), Some((SnapshotSlotState::Off, 3)));
    assert!(link.take_snapshot_slots_changed());

    // The same state again is a report (the count rises) but not a change.
    link.ingest(&msg("/snapshot/load/3", f(0.0)), 40);
    assert_eq!(link.snapshot_slot(3), Some((SnapshotSlotState::Off, 4)));
    assert_eq!(link.snapshot_report_seq(), 4);
    assert!(!link.has_activity());

    // Slot 1 and slot 8 are the ends; the others stay unknown.
    link.ingest(&msg("/snapshot/load/1", f(2.0)), 50);
    link.ingest(&msg("/snapshot/load/8", f(0.0)), 51);
    let slots = link.summary(60).snapshot_slots;
    assert_eq!(slots[0], SnapshotSlotState::Active);
    assert_eq!(slots[2], SnapshotSlotState::Off);
    assert_eq!(slots[7], SnapshotSlotState::Off);
    assert_eq!(slots[1], SnapshotSlotState::Unknown);
    assert_eq!(link.snapshot_report_seq(), 6);
    assert_eq!(link.snapshot_slot(1), Some((SnapshotSlotState::Active, 5)));
    assert_eq!(link.snapshot_slot(0), None);
    assert_eq!(link.snapshot_slot(9), None);
    assert!(link.take_queued().is_empty(), "slots never queue state");
}

#[test]
fn snapshot_reports_outside_the_eight_slots_or_values_are_ignored() {
    let mut link = ConsoleLinkState::default();
    link.ingest(&msg("/snapshot/load/2", f(2.0)), 5);
    assert!(link.take_snapshot_slots_changed());
    let before = link.summary(6).snapshot_slots;
    for (address, value) in [
        ("/snapshot/load/0", f(2.0)),
        ("/snapshot/load/9", f(2.0)),
        ("/snapshot/load/2", f(1.0)),
        ("/snapshot/load/2", f(4.0)),
        ("/snapshot/load/2", OscType::Double(f64::NAN)),
        ("/snapshot/load/2", OscType::Float(f32::NAN)),
        ("/snapshot/load/2", OscType::String(String::from("2"))),
    ] {
        link.ingest(&msg(address, value), 10);
    }
    assert_eq!(link.summary(20).snapshot_slots, before);
    assert_eq!(link.snapshot_report_seq(), 1, "none of them is a report");
    assert!(!link.has_activity());
}

#[test]
fn a_lost_connection_forgets_the_snapshot_slots() {
    let mut link = ConsoleLinkState::default();
    link.ingest(&msg("/status/connection", f(1.0)), 1);
    link.ingest(&msg("/snapshot/load/4", f(3.0)), 2);
    link.ingest(&msg("/snapshot/load/5", f(0.0)), 3);
    assert!(link.take_snapshot_slots_changed());

    link.ingest(&msg("/status/connection", f(0.0)), 4);
    assert_eq!(
        link.summary(5).snapshot_slots,
        [SnapshotSlotState::Unknown; SNAPSHOT_SLOTS]
    );
    assert!(link.take_connection_lost());
    assert!(
        link.take_snapshot_slots_changed(),
        "the forgotten slots are a change"
    );
    assert_eq!(
        link.snapshot_slot(4),
        Some((SnapshotSlotState::Unknown, 1)),
        "the count of its last report stays"
    );
    // Still disconnected, nothing more to forget.
    link.ingest(&msg("/status/connection", f(0.0)), 6);
    assert!(!link.take_snapshot_slots_changed());
}

#[test]
fn a_load_the_desk_did_not_echo_is_marked_on_the_link() {
    let mut link = ConsoleLinkState::default();
    link.ingest(&msg("/snapshot/load/1", f(2.0)), 1);
    link.ingest(&msg("/snapshot/load/2", f(3.0)), 2);
    assert!(link.take_snapshot_slots_changed());

    link.mark_snapshot_loaded(6);
    let slots = link.summary(3).snapshot_slots;
    assert_eq!(slots[5], SnapshotSlotState::Active);
    assert_eq!(slots[0], SnapshotSlotState::Off);
    assert_eq!(slots[1], SnapshotSlotState::Off);
    assert_eq!(
        slots[2],
        SnapshotSlotState::Unknown,
        "a slot the desk never reported stays unknown"
    );
    assert!(link.take_snapshot_slots_changed());
    assert_eq!(link.snapshot_report_seq(), 2, "a mark is not a report");
    assert_eq!(link.snapshot_slot(6), Some((SnapshotSlotState::Active, 0)));

    link.mark_snapshot_loaded(0);
    link.mark_snapshot_loaded(9);
    assert!(
        !link.take_snapshot_slots_changed(),
        "outside 1 to 8: nothing"
    );
}

#[test]
fn the_shared_link_forgets_its_slots_for_the_next_test() {
    let _serial = SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let link = shared_console_link();
    let mut link = link.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    link.reset_for_test();
    link.ingest(&msg("/snapshot/load/7", f(2.0)), link_now_ms());
    assert_eq!(link.snapshot_slot(7), Some((SnapshotSlotState::Active, 1)));
    link.reset_for_test();
    assert_eq!(link.snapshot_slot(7), Some((SnapshotSlotState::Unknown, 0)));
    assert_eq!(link.snapshot_report_seq(), 0);
    assert!(!link.has_activity());
}
