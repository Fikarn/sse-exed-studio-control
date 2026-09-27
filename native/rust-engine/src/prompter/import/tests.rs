use super::*;

#[test]
fn the_import_sentence_counts_what_was_left_out() {
    let imported = ImportedText {
        paragraphs: vec![
            PrompterParagraph::plain("[Intro]"),
            PrompterParagraph::plain("Hello and welcome."),
        ],
        left_out: LeftOut {
            pictures: 2,
            comments: 1,
            ..LeftOut::default()
        },
        tracked_changes_accepted: true,
        encoding: None,
    };
    assert_eq!(
        import_sentence("Interview intro.docx", &imported),
        "Imported Interview intro.docx: 2 paragraphs, 4 words, 1 cue. Left out: 2 pictures, 1 comment. Tracked changes were taken as accepted."
    );
}
