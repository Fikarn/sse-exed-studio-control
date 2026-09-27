//! The import through its public functions, the `.txt` and plain-paste
//! reader, and the HTML paste reader. The `.docx` reader has
//! `docx_tests.rs`.

use super::test_support::{run, texts};
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

// ---- The public API ----

#[test]
fn a_file_is_read_by_the_end_of_its_name() {
    let imported = import_file("Kvällens manus.TXT", "Hej.\n\nDå.".as_bytes()).expect("imports");
    assert_eq!(texts(&imported.paragraphs), ["Hej.", "Då."]);
    assert_eq!(
        import_sentence("Kvällens manus.TXT", &imported),
        "Imported Kvällens manus.TXT: 2 paragraphs, 2 words, 0 cues. Read as UTF-8."
    );
}

#[test]
fn old_word_files_and_other_kinds_are_refused_by_name() {
    // The bytes are never looked at: a real .docx named .doc is still refused.
    let docx = super::test_support::docx(&super::test_support::p("Text"));
    assert_eq!(
        import_file("Manus.doc", &docx),
        Err(ImportRefusal::OldWordFormat)
    );
    assert_eq!(
        import_file("Manus.pdf", b"%PDF-1.7"),
        Err(ImportRefusal::UnsupportedKind {
            extension: String::from("pdf")
        })
    );
    assert_eq!(
        import_file("Manus.RTF", b"{\\rtf1}"),
        Err(ImportRefusal::UnsupportedKind {
            extension: String::from("RTF")
        })
    );
    assert_eq!(
        import_file("Manus", b"text"),
        Err(ImportRefusal::UnsupportedKind {
            extension: String::new()
        })
    );
    assert_eq!(
        ImportRefusal::UnsupportedKind {
            extension: String::from("pdf")
        }
        .sentence("Manus.pdf"),
        "Studio Control does not open .pdf files. Save the script as .docx or .txt, then open that."
    );
    assert_eq!(
        ImportRefusal::OldWordFormat.sentence("Manus.doc"),
        "Manus.doc is in Word's old format (.doc), which Studio Control does not read. Save it as .docx in Word, then open that."
    );
}

#[test]
fn a_script_over_the_word_limit_is_refused_with_its_count() {
    let words = "word ".repeat(MAX_SCRIPT_WORDS + 1);
    let refusal = import_file("Long.txt", words.as_bytes());
    assert_eq!(
        refusal,
        Err(ImportRefusal::TooLong {
            words: MAX_SCRIPT_WORDS + 1
        })
    );
    assert_eq!(
        refusal.unwrap_err().sentence("Long.txt"),
        "Long.txt has 30,001 words; a script can have up to 30,000. Split it into shorter scripts."
    );
    let exactly = "word ".repeat(MAX_SCRIPT_WORDS);
    assert!(import_paste(None, &exactly).is_ok());
}

#[test]
fn nothing_to_read_is_refused_as_empty() {
    assert_eq!(import_file("Empty.txt", b""), Err(ImportRefusal::Empty));
    assert_eq!(
        import_file("Blank.txt", b" \r\n\t\r\n "),
        Err(ImportRefusal::Empty)
    );
    assert_eq!(import_paste(None, "   \n\n "), Err(ImportRefusal::Empty));
    assert_eq!(
        import_paste(Some("<p>&nbsp;</p><img src=x>"), ""),
        Err(ImportRefusal::Empty)
    );
    assert_eq!(
        ImportRefusal::Empty.sentence("The pasted text"),
        "The pasted text has no text in it."
    );
}

#[test]
fn a_file_or_paste_over_the_size_limit_is_refused_before_it_is_read() {
    let large = vec![b'a'; MAX_IMPORT_BYTES + 1];
    assert_eq!(
        import_file("Large.txt", &large),
        Err(ImportRefusal::TooLarge {
            bytes: MAX_IMPORT_BYTES + 1
        })
    );
    let text = "a".repeat(MAX_IMPORT_BYTES / 2 + 1);
    assert!(matches!(
        import_paste(Some(&text), &text),
        Err(ImportRefusal::TooLarge { .. })
    ));
}

#[test]
fn a_paste_prefers_its_html_and_falls_back_to_its_text() {
    let imported = import_paste(Some("<p><b>Bold</b> start</p>"), "Bold start").expect("imports");
    assert_eq!(
        imported.paragraphs[0].runs,
        vec![
            run("Bold", true, false, false),
            run(" start", false, false, false)
        ]
    );
    assert_eq!(imported.encoding, None);

    // HTML with no word in it (an image alone) gives way to the plain text.
    let imported = import_paste(Some("<img src=x>"), "Plain text").expect("imports");
    assert_eq!(texts(&imported.paragraphs), ["Plain text"]);
    let imported = import_paste(Some("   "), "Only text").expect("imports");
    assert_eq!(texts(&imported.paragraphs), ["Only text"]);
    assert_eq!(
        import_sentence("the pasted text", &imported),
        "Imported the pasted text: 1 paragraph, 2 words, 0 cues."
    );
}

// ---- .txt and a plain paste ----

fn read_txt(bytes: &[u8]) -> ImportedText {
    txt::read_txt(bytes).expect("the text reads")
}

#[test]
fn utf8_is_read_with_and_without_its_byte_order_mark() {
    let text = "Välkommen till studion.\n\nÅ, ä och ö.";
    let plain = read_txt(text.as_bytes());
    let mut with_bom = vec![0xEF, 0xBB, 0xBF];
    with_bom.extend_from_slice(text.as_bytes());
    let marked = read_txt(&with_bom);
    assert_eq!(plain, marked);
    assert_eq!(
        texts(&plain.paragraphs),
        ["Välkommen till studion.", "Å, ä och ö."]
    );
    assert_eq!(plain.encoding, Some(TextEncoding::Utf8));
}

#[test]
fn utf16_is_read_with_its_byte_order_mark_either_way_round() {
    let text = "Hej på dig.\r\n\r\n“Citat” – €";
    let mut little = vec![0xFF, 0xFE];
    little.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
    let mut big = vec![0xFE, 0xFF];
    big.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
    for bytes in [little, big] {
        let imported = read_txt(&bytes);
        assert_eq!(texts(&imported.paragraphs), ["Hej på dig.", "“Citat” – €"]);
        assert_eq!(imported.encoding, Some(TextEncoding::Utf16));
    }

    let not_text = Err(ImportRefusal::NotWhatItsNameSays { expected: ".txt" });
    // An odd number of bytes, and a lone surrogate.
    assert_eq!(txt::read_txt(&[0xFF, 0xFE, 0x41, 0x00, 0x42]), not_text);
    assert_eq!(
        txt::read_txt(&[0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00]),
        not_text
    );
}

#[test]
fn text_that_is_not_utf8_is_windows_1252() {
    // "Så här: “citat” – 5 € … ™" as Notepad's ANSI writes it, with an
    // undefined byte (0x81) that stands for nothing.
    let bytes = b"S\xE5 h\xE4r: \x93citat\x94 \x96 5 \x80 \x85 \x99\x81 \xF6\xC5\xC4\xD6";
    let imported = read_txt(bytes);
    assert_eq!(
        texts(&imported.paragraphs),
        ["Så här: “citat” – 5 € … ™ öÅÄÖ"]
    );
    assert_eq!(imported.encoding, Some(TextEncoding::Windows1252));
    assert_eq!(
        import_sentence("Manus.txt", &imported),
        "Imported Manus.txt: 1 paragraph, 9 words, 0 cues. Read as Windows-1252."
    );
}

#[test]
fn a_binary_file_named_txt_is_refused() {
    let not_text = Err(ImportRefusal::NotWhatItsNameSays { expected: ".txt" });
    assert_eq!(txt::read_txt(b"Text\0with a NUL"), not_text);
    assert_eq!(txt::read_txt(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"), not_text);
    let docx = super::test_support::docx(&super::test_support::p("Text"));
    assert_eq!(txt::read_txt(&docx), not_text);
}

#[test]
fn blank_lines_split_paragraphs_and_single_breaks_stay_inside_them() {
    let text = "  First line\r\nsecond line  \r\n \t \r\nNext paragraph\n\n\n\n[PAUSE]\rLast\u{2028}line\n";
    let imported = txt::read_plain(text);
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "First line\nsecond line",
            "Next paragraph",
            "[PAUSE]\nLast\nline"
        ]
    );
    assert_eq!(imported.encoding, None);
    assert!(imported
        .paragraphs
        .iter()
        .all(|paragraph| paragraph.runs.iter().all(|run| !run.bold)));
    assert_eq!(cue_targets(&imported.paragraphs).len(), 1);
}

// ---- HTML ----

fn html(markup: &str) -> ImportedText {
    html::read_html(markup)
}

#[test]
fn a_word_paste_keeps_its_paragraphs_emphasis_and_list() {
    let markup = r#"Version:0.9
StartHTML:0000000105
<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><title>Manus</title>
<style><!-- p.MsoNormal {margin:0cm; font-family:"Calibri"} --></style></head>
<body lang=SV style='tab-interval:65.2pt'><!--StartFragment-->
<h1>Intro</h1>
<p class=MsoNormal>Hej och <b>välkommen</b> till <i>studion</i>,<o:p></o:p></p>
<p class=MsoNormal><span style='mso-spacerun:yes'>&nbsp;</span>vi börjar <u>nu</u>.<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Första punkten<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Andra, numrerad<o:p></o:p></p>
<p class=MsoNormal><span style='mso-list:Ignore'>Hidden bullet</span>Stray ignore span</p>
<p class=MsoNormal><!--[if gte vml 1]><v:shape><v:imagedata src="image001.png"/></v:shape><![endif]--><![if !vml]><img width=100 height=50 src="image001.png"><![endif]>Efter bilden</p>
<!--EndFragment--></body></html>"#;
    let imported = html(markup);
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "[Intro]",
            "Hej och välkommen till studion,",
            // Word's no-break space at the start of a line goes with the
            // line's other white space.
            "vi börjar nu.",
            "– Första punkten",
            "2. Andra, numrerad",
            "Stray ignore span",
            "Efter bilden",
        ]
    );
    assert_eq!(
        imported.paragraphs[1].runs,
        vec![
            run("Hej och ", false, false, false),
            run("välkommen", true, false, false),
            run(" till ", false, false, false),
            run("studion", false, true, false),
            run(",", false, false, false),
        ]
    );
    assert_eq!(
        imported.paragraphs[2].runs[1],
        run("nu", false, false, true)
    );
    assert_eq!(imported.left_out.pictures, 1);
}

#[test]
fn a_google_docs_paste_reads_its_emphasis_from_each_spans_style() {
    let markup = r#"<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr" style="line-height:1.38;margin-top:0pt;"><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">Plain and </span><span style="font-weight:700;">bold</span><span style="font-style:italic;"> and italic</span><span style="text-decoration:underline;"> and underlined</span></p><br><h2 dir="ltr"><span style="font-size:16pt;">Del två</span></h2><ul style="margin-top:0;"><li dir="ltr" style="list-style-type:disc;"><p dir="ltr"><span>First item</span></p></li><li dir="ltr"><p dir="ltr"><span style="font-weight:bold">Second</span></p></li></ul></b>"#;
    let imported = html(markup);
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "Plain and bold and italic and underlined",
            "[Del två]",
            "– First item",
            "– Second"
        ]
    );
    assert_eq!(
        imported.paragraphs[0].runs,
        vec![
            run("Plain and ", false, false, false),
            run("bold", true, false, false),
            run(" and italic", false, true, false),
            run(" and underlined", false, false, true),
        ]
    );
    assert_eq!(
        imported.paragraphs[3].runs,
        vec![
            run("– ", false, false, false),
            run("Second", true, false, false)
        ]
    );
}

#[test]
fn lists_get_a_dash_or_their_number_and_nested_lists_count_separately() {
    let markup = "<ul><li>Apples</li><li>Pears<ol start=\"3\"><li>Three</li><li>Four<ol><li>One</li></ol></li><li value=\"9\">Nine</li><li>Ten</li></ol></li></ul><ol><li>First<li>Second</ol>";
    assert_eq!(
        texts(&html(markup).paragraphs),
        [
            "– Apples",
            "– Pears",
            "3. Three",
            "4. Four",
            "1. One",
            "9. Nine",
            "10. Ten",
            "1. First",
            "2. Second"
        ]
    );
}

#[test]
fn a_tables_cells_come_in_row_by_row() {
    let markup = "<table><tr><th>Name</th><th>Role</th></tr><tr><td><p>Anna</p><p>Svensson</p></td><td></td></tr><tr><td>Last</td></tr></table>";
    assert_eq!(
        texts(&html(markup).paragraphs),
        ["Name", "Role", "Anna\nSvensson", "Last"]
    );
}

#[test]
fn line_breaks_white_space_and_entities() {
    let markup = "<p>  One\n   line,<br>then   the\tnext &amp; &lt;more&gt; &#229;&#xE4;&ouml; &hellip; &#150; &unknown; &ndash;&nbsp;x &shy;</p>\
                  <pre>  keep   its\n  spaces</pre><div>a<div>b</div>c</div>";
    assert_eq!(
        texts(&html(markup).paragraphs),
        [
            "One line,\nthen the next & <more> åäö … – &unknown; –\u{a0}x",
            "keep   its\nspaces",
            "a",
            "b",
            "c"
        ]
    );
}

#[test]
fn head_style_script_and_comments_are_not_text() {
    let markup = "<!DOCTYPE html><html><head><title>Title</title><style>p { color: red; } </p></style></head>\
                  <body><script>if (a < b) { document.write('<p>no</p>') }</script><!-- a comment <p>no</p> -->\
                  <p>Only <svg><text>no</text></svg>this<noscript>no</noscript>.</p><template><p>no</p></template>\
                  <![CDATA[ no ]]><?xml no?></body></html>";
    assert_eq!(texts(&html(markup).paragraphs), ["Only this."]);
}

#[test]
fn a_style_attribute_overrides_the_elements_own_emphasis() {
    let markup = r#"<p><b>bold <span style="font-weight: normal !important">normal</span></b> <span style="FONT-WEIGHT:600">six</span> <span style="font-weight:lighter">light</span> <i style="font-style:normal">upright</i> <u style="text-decoration-line:none">plain</u> <strong>strong</strong> <em>em</em> <cite>cite</cite> <ins>ins</ins></p>"#;
    assert_eq!(
        html(markup).paragraphs[0].runs,
        vec![
            run("bold ", true, false, false),
            run("normal ", false, false, false),
            run("six", true, false, false),
            run(" light upright plain ", false, false, false),
            run("strong", true, false, false),
            run(" ", false, false, false),
            run("em", false, true, false),
            run(" ", false, false, false),
            run("cite", false, true, false),
            run(" ", false, false, false),
            run("ins", false, false, true),
        ]
    );
}

#[test]
fn broken_html_still_reads() {
    let markup = "<p>Unclosed <b>bold<p>Next</i></span></div> para<  not a tag <3 </ 5> & more</b>";
    assert_eq!(
        texts(&html(markup).paragraphs),
        // An end tag with no start still ends a paragraph, as in a browser.
        ["Unclosed bold", "Next", "para< not a tag <3 & more"]
    );
    assert_eq!(texts(&html("<").paragraphs), ["<"]);
    assert!(html("<p><b><i>").paragraphs.is_empty());
    assert_eq!(
        texts(&html("<p>Text <!-- open comment").paragraphs),
        ["Text"]
    );
}

/// Pastes built to be slow: each would take time in proportion to its length
/// squared if a step searched again or rescanned what it had, and each reads
/// in one pass.
#[test]
fn hostile_pastes_read_in_one_pass() {
    let breaks = format!("<p>a{}b</p>", "<br>".repeat(200_000));
    let imported = html(&breaks);
    // The first blank line ends the paragraph; the breaks after it hold no
    // word, so they start nothing (and are never scanned again).
    assert_eq!(texts(&imported.paragraphs), ["a", "b"]);

    let markers = format!(
        "<p style='mso-list:l0'>{}Item</p>",
        "<![if !supportLists]>".repeat(100_000)
    );
    assert_eq!(texts(&html(&markers).paragraphs), ["– Item"]);

    let deep = format!(
        "{}Deep{}{}",
        "<div><b>".repeat(50_000),
        "</span>".repeat(50_000),
        "</b></div>".repeat(50_000)
    );
    assert_eq!(texts(&html(&deep).paragraphs), ["Deep"]);
}

// §3.2: in a paste, a blank line (`<br><br>`, as e-mail and web pages part
// their paragraphs) ends a paragraph, as an empty line does in a `.txt`; a
// single `<br>` stays a line break, and a table cell keeps its lines.
#[test]
fn a_blank_line_in_pasted_html_ends_a_paragraph() {
    let imported = import_paste(
        Some("<div>First line<br>second line<br><br>Next paragraph<br> <br>Third</div><table><tr><td>a<br><br>b</td></tr></table>"),
        "",
    )
    .expect("the paste reads");
    let texts: Vec<String> = imported
        .paragraphs
        .iter()
        .map(PrompterParagraph::text)
        .collect();
    assert_eq!(
        texts,
        [
            "First line\nsecond line",
            "Next paragraph",
            "Third",
            "a\n\nb"
        ]
    );
}
