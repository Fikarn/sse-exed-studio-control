//! RME TotalMix FX fader curve.
//!
//! Source: the "Fader curve" sheet of RME's Global OSC protocol table
//! (`OSCProtocoll_260721.ods`, TotalMix FX 2.1 beta 2, 2026-07-21). The app
//! sends fader positions as `faderlin` (linear 0..1), but TotalMix reports the
//! same faders back in dB (`/mix/{in|pb}/{ch}/{out}/fader`,
//! `/output/{ch}/volume`), so both directions are needed to ingest console
//! state and to compare a read-back against what was sent.
//!
//! Live-verified on the studio UFX III (2026-09-03): sending
//! `/mix/pb/6/10/faderlin 0.02` made TotalMix report `-61.97441 dB`, which is
//! `fader_lin_to_db(0.02)` to five decimals.

/// TotalMix fader resolution: positions are `0..=1023` steps mapped onto 0..1.
pub const FADER_POSITION_STEPS: f64 = 1023.0;
/// Below this the console treats the fader as off (`-∞`); TotalMix itself
/// reports off nodes as `-300 dB` and omits them from `/sendall 2` dumps.
#[allow(dead_code)] // Slice 5 moves the app's fader labels onto this curve.
pub const FADER_OFF_DB: f64 = -65.0;
/// Top of the fader.
pub const FADER_MAX_DB: f64 = 6.0;
/// Unity gain (0 dB) as a linear fader position: step 836 of 1023.
#[allow(dead_code)] // Slice 5 replaces the app's 0.80 unity with this value.
pub const AUDIO_FADER_UNITY: f64 = 836.0 / 1023.0;

const KNEE_POSITION: f64 = 649.0;
const LINEAR_SLOPE: f64 = 0.032_085_561_5;
const LINEAR_OFFSET: f64 = 26.823_529_411_8;
const CURVE_A: f64 = -1.0 / 11_033.0;
const CURVE_B: f64 = 0.149_732_620_3;
const CURVE_C: f64 = -65.0;
const OFF_THRESHOLD_DB: f64 = -64.9;

/// Fader position (linear 0..1) → dB. `None` means the fader is off (`-∞`).
pub fn fader_lin_to_db(position: f64) -> Option<f64> {
    let pos = (position.clamp(0.0, 1.0) * FADER_POSITION_STEPS).max(0.0);
    let db = if pos >= KNEE_POSITION {
        pos * LINEAR_SLOPE - LINEAR_OFFSET
    } else {
        pos * pos * CURVE_A + pos * CURVE_B + CURVE_C
    };
    if db < OFF_THRESHOLD_DB {
        None
    } else {
        Some(db)
    }
}

/// dB → fader position (linear 0..1). Anything at or below the off threshold
/// (including TotalMix's `-300 dB` sentinel) maps to `0.0`.
pub fn fader_db_to_lin(db: f64) -> f64 {
    if !db.is_finite() || fader_db_is_off(db) {
        return 0.0;
    }
    if db >= FADER_MAX_DB {
        return 1.0;
    }
    let pos = if db >= -6.0 {
        (db + LINEAR_OFFSET) / LINEAR_SLOPE
    } else {
        826.0 - (-34_869.0 - 11_033.0 * db).sqrt()
    };
    (pos / FADER_POSITION_STEPS).clamp(0.0, 1.0)
}

/// True when TotalMix would treat this dB value as an off fader.
pub fn fader_db_is_off(db: f64) -> bool {
    db < OFF_THRESHOLD_DB
}

/// Compares a sent linear position with a value the console reported back in
/// dB, allowing for the console's 1/1023 step quantisation.
pub fn fader_positions_match(sent_position: f64, reported_db: f64) -> bool {
    let reported_position = fader_db_to_lin(reported_db);
    (sent_position.clamp(0.0, 1.0) - reported_position).abs() <= FADER_MATCH_TOLERANCE
}

/// About two and a half fader steps.
pub const FADER_MATCH_TOLERANCE: f64 = 2.5 / FADER_POSITION_STEPS;

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tolerance: f64) -> bool {
        (a - b).abs() <= tolerance
    }

    #[test]
    fn fader_curve_matches_rme_published_anchors() {
        // Anchors from the "Fader curve" sheet.
        assert!(close(fader_lin_to_db(836.0 / 1023.0).unwrap(), 0.0, 0.001));
        assert!(close(fader_lin_to_db(649.0 / 1023.0).unwrap(), -6.0, 0.001));
        assert!(close(fader_lin_to_db(1.0).unwrap(), 6.0, 0.001));
        assert!(close(fader_lin_to_db(0.5).unwrap(), -12.13, 0.01));
        assert!(close(fader_lin_to_db(0.7).unwrap(), -3.85, 0.01));
        assert!(close(fader_lin_to_db(0.35).unwrap(), -23.01, 0.01));
        // Live console reading for position 0.02 (2026-09-03).
        assert!(close(fader_lin_to_db(0.02).unwrap(), -61.974, 0.001));
        assert_eq!(fader_lin_to_db(0.0), None);
        assert!(close(AUDIO_FADER_UNITY, 0.8172, 0.0001));
    }

    #[test]
    fn fader_curve_round_trips_and_handles_off() {
        for step in 1..=1023 {
            let position = step as f64 / 1023.0;
            let Some(db) = fader_lin_to_db(position) else {
                continue;
            };
            assert!(
                close(fader_db_to_lin(db), position, 1e-9),
                "round trip failed at step {step}"
            );
        }
        assert_eq!(fader_db_to_lin(-300.0), 0.0);
        assert_eq!(fader_db_to_lin(-65.0), 0.0);
        assert_eq!(fader_db_to_lin(f64::NEG_INFINITY), 0.0);
        assert!(close(fader_db_to_lin(0.0), 836.0 / 1023.0, 1e-9));
        assert!(close(fader_db_to_lin(-6.0), 649.0 / 1023.0, 1e-9));
        assert_eq!(fader_db_to_lin(12.0), 1.0);
        assert!(fader_db_is_off(-300.0));
        assert!(!fader_db_is_off(-64.0));
    }

    #[test]
    fn fader_positions_match_within_console_quantisation() {
        assert!(fader_positions_match(0.02, -61.974_41));
        assert!(fader_positions_match(0.5, -12.13));
        assert!(fader_positions_match(0.0, -300.0));
        assert!(!fader_positions_match(0.5, -6.0));
        assert!(!fader_positions_match(0.0, -30.0));
    }
}
