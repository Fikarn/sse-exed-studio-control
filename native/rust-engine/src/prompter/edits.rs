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
//! several, and then the whole stretch between counts as changed. A place in
//! an unchanged paragraph keeps its word; a place in a changed paragraph keeps
//! its paragraph's position in the stretch and its word, as far as the new
//! paragraph goes; a place in a paragraph the change took away moves to the
//! start of the paragraph after the stretch.

use crate::prompter::clock::PrompterPlace;
use crate::prompter::model::PrompterParagraph;

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
    let offset = paragraph - prefix;
    if prefix + offset < new_changed_end {
        return (at(prefix + offset), false);
    }
    (
        PrompterPlace {
            paragraph: new_changed_end as u32,
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
