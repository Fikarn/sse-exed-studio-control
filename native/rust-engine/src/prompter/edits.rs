//! Where a place goes when a script's text changes: an edit of a script that
//! is not on the glass, an Update of the one that is (the proposal §6.3: "the
//! same words stay at the reading line; if the paragraph at the reading line
//! was deleted, the place moves to the start of the next paragraph"), a file
//! opened again, a version brought back.
//!
//! The two texts are compared paragraph by paragraph from both ends: the
//! paragraphs they share at the start and at the end are the same, and what
//! lies between is what changed. The editor saves within a second of typing,
//! so an edit is nearly always one change in one place; an Update may gather
//! several. A place in an unchanged paragraph keeps its word. A place in a
//! changed paragraph goes to the new paragraph most like it — half its words
//! or more in common — keeping its word as far as that paragraph goes; when
//! none is that alike and the stretch kept its number of paragraphs, to the
//! paragraph in the same position (rewritten in place); else the paragraph was
//! taken away, and the place moves to the start of the next paragraph: the
//! match of the next old paragraph in the stretch, or the first after it.
//! (Until the review of 2026-09-27 a place kept its position in the stretch,
//! so a paragraph cut above the reading line, or one added above it, put the
//! reading line on the wrong paragraph.)

use crate::prompter::clock::PrompterPlace;
use crate::prompter::model::PrompterParagraph;
use std::collections::HashMap;

/// A match needs half the longer paragraph's words in common.
const ALIKE: f64 = 0.5;

/// How alike two paragraphs are: the words they have in common (each word as
/// often as both have it) over the longer one's words.
fn likeness(before: &PrompterParagraph, after: &PrompterParagraph) -> f64 {
    let before_text = before.text();
    let after_text = after.text();
    let before_words: Vec<&str> = before_text.split_whitespace().collect();
    let after_words: Vec<&str> = after_text.split_whitespace().collect();
    let longer = before_words.len().max(after_words.len());
    if longer == 0 {
        return 1.0;
    }
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for word in &before_words {
        *counts.entry(word).or_insert(0) += 1;
    }
    let common = after_words
        .iter()
        .filter(|word| match counts.get_mut(*word) {
            Some(count) if *count > 0 => {
                *count -= 1;
                true
            }
            _ => false,
        })
        .count();
    common as f64 / longer as f64
}

/// The new paragraph in `candidates` (indexes into `new`) most like `old`,
/// when one is alike enough.
fn best_match(
    old: &PrompterParagraph,
    new: &[PrompterParagraph],
    candidates: std::ops::Range<usize>,
) -> Option<usize> {
    candidates
        .map(|index| (index, likeness(old, &new[index])))
        .filter(|(_, likeness)| *likeness >= ALIKE)
        .fold(
            None,
            |best: Option<(usize, f64)>, (index, likeness)| match best {
                Some((_, best_likeness)) if best_likeness >= likeness => best,
                _ => Some((index, likeness)),
            },
        )
        .map(|(index, _)| index)
}

/// Where `place` in `old` stands in `new`, and whether its paragraph was
/// taken away (so the place moved on to the next paragraph).
pub(crate) fn map_place(
    old: &[PrompterParagraph],
    new: &[PrompterParagraph],
    place: PrompterPlace,
) -> (PrompterPlace, bool) {
    let paragraph = place.paragraph as usize;
    if paragraph >= old.len() {
        return (PrompterPlace::end_of(new), false);
    }
    let prefix = old
        .iter()
        .zip(new.iter())
        .take_while(|(before, after)| before == after)
        .count();
    let most = old.len().min(new.len()) - prefix;
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take(most)
        .take_while(|(before, after)| before == after)
        .count();
    let word = place.word;
    let at = |paragraph: usize| {
        PrompterPlace {
            paragraph: paragraph as u32,
            word,
        }
        .clamped(new)
    };
    if paragraph < prefix {
        return (at(paragraph), false);
    }
    let old_changed_end = old.len() - suffix;
    let new_changed_end = new.len() - suffix;
    if paragraph >= old_changed_end {
        return (at(paragraph - old_changed_end + new_changed_end), false);
    }
    let candidates = prefix..new_changed_end;
    if let Some(index) = best_match(&old[paragraph], new, candidates.clone()) {
        return (at(index), false);
    }
    if old_changed_end - prefix == new_changed_end - prefix {
        return (at(paragraph), false);
    }
    // Taken away: the start of the next paragraph that is still there.
    let next = (paragraph + 1..old_changed_end)
        .find_map(|later| best_match(&old[later], new, candidates.clone()))
        .unwrap_or(new_changed_end);
    (
        PrompterPlace {
            paragraph: next as u32,
            word: 0,
        }
        .clamped(new),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(paragraphs: &[&str]) -> Vec<PrompterParagraph> {
        paragraphs
            .iter()
            .map(|text| PrompterParagraph::plain(*text))
            .collect()
    }

    fn place(paragraph: u32, word: u32) -> PrompterPlace {
        PrompterPlace { paragraph, word }
    }

    #[test]
    fn an_unchanged_paragraph_keeps_its_words() {
        let old = text(&["a b c", "d e f", "g h i"]);
        let new = text(&["new first", "a b c", "d e f", "g h i"]);
        assert_eq!(map_place(&old, &new, place(1, 2)), (place(2, 2), false));
        let new = text(&["a b c", "d e f", "g h i", "added at the end"]);
        assert_eq!(map_place(&old, &new, place(2, 1)), (place(2, 1), false));
    }

    #[test]
    fn a_changed_paragraph_keeps_the_word_as_far_as_it_goes() {
        let old = text(&["a b c", "d e f g h", "i j"]);
        let new = text(&["a b c", "d e changed", "i j"]);
        assert_eq!(map_place(&old, &new, place(1, 1)), (place(1, 1), false));
        assert_eq!(map_place(&old, &new, place(1, 4)), (place(1, 2), false));
    }

    // §6.3: the paragraph at the reading line was deleted, so the place moves
    // to the start of the next paragraph.
    #[test]
    fn a_deleted_paragraph_moves_the_place_to_the_next() {
        let old = text(&["a b", "gone now", "c d", "e f"]);
        let new = text(&["a b", "c d", "e f"]);
        assert_eq!(map_place(&old, &new, place(1, 1)), (place(1, 0), true));
        let new = text(&["a b"]);
        let old = text(&["a b", "gone"]);
        assert_eq!(
            map_place(&old, &new, place(1, 0)),
            (PrompterPlace::end_of(&new), true),
            "with nothing after it, the place is the end"
        );
    }

    // Review of 2026-09-27: an Update gathers every edit since the script went
    // on. A paragraph cut above the reading line while the reading paragraph
    // got a typo fixed, and one added above it while it was edited, both keep
    // the reading line on its paragraph. (By position in the changed stretch,
    // the first moved on to the next paragraph and said the reading one was
    // deleted, and the second landed on the new paragraph.)
    #[test]
    fn an_update_of_several_edits_keeps_the_reading_paragraph() {
        let old = text(&["a b c", "cut this one", "we read here now", "z z"]);
        let new = text(&["a b c", "we read hear now", "z z"]);
        assert_eq!(map_place(&old, &new, place(2, 3)), (place(1, 3), false));

        let old = text(&["a b c", "we read here now", "z z"]);
        let new = text(&["a b c", "a new thought above", "we read here, now", "z z"]);
        assert_eq!(map_place(&old, &new, place(1, 2)), (place(2, 2), false));
    }

    #[test]
    fn the_end_stays_the_end() {
        let old = text(&["a", "b"]);
        let new = text(&["a", "b", "c"]);
        assert_eq!(
            map_place(&old, &new, PrompterPlace::end_of(&old)),
            (PrompterPlace::end_of(&new), false)
        );
    }
}
