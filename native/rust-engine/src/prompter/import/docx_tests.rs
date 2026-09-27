//! The `.docx` reader and the zip under it, on documents written in each test
//! (`test_support.rs`).

use std::time::{Duration, Instant};

use super::docx::read_docx;
use super::test_support::{docx, p, run, texts, zip, Docx, Entry, NAMESPACES};
use super::zip::Zip;
use super::*;

fn read(bytes: &[u8]) -> ImportedText {
    read_docx(bytes).expect("the document reads")
}

fn read_body(body: &str) -> ImportedText {
    read(&docx(body))
}

const HEADING_STYLES: &str = r#"
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Rubrik1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Rubrik"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="MinRubrik"><w:name w:val="Min rubrik"/><w:basedOn w:val="Rubrik1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Brodtext"><w:name w:val="Body Text"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
    <w:style w:type="character" w:styleId="Stark"><w:name w:val="Strong"/></w:style>
    <w:style w:type="character" w:styleId="Betoning"><w:name w:val="Emphasis"/></w:style>
"#;

fn styled(style: &str, text: &str) -> String {
    format!(r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#)
}

#[test]
fn paragraphs_come_in_and_empty_ones_are_dropped() {
    let body = format!(
        "{}<w:p/><w:p><w:r><w:t> </w:t></w:r></w:p>{}",
        p("Hello and welcome."),
        p("  Second paragraph. ")
    );
    let imported = read_body(&body);
    assert_eq!(
        texts(&imported.paragraphs),
        ["Hello and welcome.", "Second paragraph."]
    );
    assert_eq!(imported.left_out, LeftOut::default());
    assert!(!imported.tracked_changes_accepted);
    assert_eq!(imported.encoding, None);
}

#[test]
fn stored_and_deflated_parts_read_the_same() {
    let body = p("Stored or deflated.");
    let deflated = read(&Docx::new(&body).build());
    let stored = read(&Docx::new(&body).stored().build());
    assert_eq!(deflated, stored);
    assert_eq!(texts(&stored.paragraphs), ["Stored or deflated."]);
}

#[test]
fn bold_italic_and_underline_are_kept_and_can_be_turned_off() {
    let body = r#"<w:p>
        <w:r><w:t xml:space="preserve">Plain </w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold </w:t></w:r>
        <w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t xml:space="preserve">italic </w:t></w:r>
        <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">under </w:t></w:r>
        <w:r><w:rPr><w:u w:val="none"/><w:b w:val="false"/><w:i w:val="off"/></w:rPr><w:t xml:space="preserve">off </w:t></w:r>
        <w:r><w:rPr><w:b w:val="1"/><w:i w:val="true"/><w:u w:val="double"/></w:rPr><w:t>all</w:t></w:r>
    </w:p>"#;
    let imported = read_body(body);
    assert_eq!(
        imported.paragraphs[0].runs,
        vec![
            run("Plain ", false, false, false),
            run("bold ", true, false, false),
            run("italic ", false, true, false),
            run("under ", false, false, true),
            run("off ", false, false, false),
            run("all", true, true, true),
        ]
    );
}

#[test]
fn strong_and_emphasis_character_styles_are_bold_and_italic() {
    let body = r#"<w:p>
        <w:r><w:rPr><w:rStyle w:val="Stark"/></w:rPr><w:t xml:space="preserve">strong </w:t></w:r>
        <w:r><w:rPr><w:rStyle w:val="Betoning"/></w:rPr><w:t xml:space="preserve">emphasis </w:t></w:r>
        <w:r><w:rPr><w:rStyle w:val="Stark"/><w:b w:val="0"/></w:rPr><w:t>overridden</w:t></w:r>
    </w:p>"#;
    let imported = read(&Docx::new(body).styles(HEADING_STYLES).build());
    assert_eq!(
        imported.paragraphs[0].runs,
        vec![
            run("strong ", true, false, false),
            run("emphasis ", false, true, false),
            run("overridden", false, false, false),
        ]
    );
}

#[test]
fn headings_become_cues_in_english_and_swedish_word() {
    let body = [
        styled("Heading1", "Intro"),
        styled("Rubrik1", "Andra delen"),
        styled("Rubrik", "Kvällens program"),
        styled("MinRubrik", "Based on a heading"),
        styled("Brodtext", "Body text is not a heading."),
        styled("Missing", "An unknown style is not a heading."),
        r#"<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Outline level</w:t></w:r></w:p>"#.to_string(),
        r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Two</w:t><w:br/><w:t>lines [and brackets]</w:t></w:r></w:p>"#.to_string(),
        styled("Heading1", "[Already a cue]"),
        p("Plain text."),
    ]
    .concat();
    let imported = read(&Docx::new(&body).styles(HEADING_STYLES).build());
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "[Intro]",
            "[Andra delen]",
            "[Kvällens program]",
            "[Based on a heading]",
            "Body text is not a heading.",
            "An unknown style is not a heading.",
            "[Outline level]",
            "[Two lines (and brackets)]",
            "[Already a cue]",
            "Plain text.",
        ]
    );
    assert_eq!(cue_targets(&imported.paragraphs).len(), 7);
}

const LISTS: &str = r#"
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
    </w:abstractNum>
    <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1.%2.%3"/></w:lvl>
    </w:abstractNum>
    <w:abstractNum w:abstractNumId="2">
        <w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
    <w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
"#;

fn item(list: u32, level: u32, text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{list}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
    )
}

#[test]
fn bullets_become_a_dash_and_numbers_count_with_nesting_and_reset() {
    let body = [
        item(1, 0, "Bullet"),
        item(1, 1, "Nested bullet"),
        item(2, 0, "First"),
        item(2, 1, "Sub a"),
        item(2, 1, "Sub b"),
        item(2, 2, "Deep"),
        item(2, 0, "Second"),
        item(2, 1, "Sub again"),
        item(2, 0, ""),
        item(2, 0, "Fourth, after an empty item"),
        item(3, 0, "Restarted at seven"),
        item(4, 0, "Roman"),
        item(4, 0, "Roman"),
        item(0, 0, "numId 0 is no list"),
        item(9, 0, "An unknown list has no number"),
    ]
    .concat();
    let imported = read(&Docx::new(&body).numbering(LISTS).build());
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "– Bullet",
            "– Nested bullet",
            "1. First",
            "a) Sub a",
            "b) Sub b",
            // Each level's count in its own format, as Word writes it.
            "1.b.i Deep",
            "2. Second",
            "a) Sub again",
            "4. Fourth, after an empty item",
            "7. Restarted at seven",
            "IV. Roman",
            "V. Roman",
            "numId 0 is no list",
            "An unknown list has no number",
        ]
    );
    // The number is plain text in front of the run's own emphasis.
    let bold_item = r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p>"#;
    let imported = read(&Docx::new(bold_item).numbering(LISTS).build());
    assert_eq!(
        imported.paragraphs[0].runs,
        vec![
            run("1. ", false, false, false),
            run("Bold", true, false, false)
        ]
    );
}

#[test]
fn a_list_style_numbers_its_paragraphs() {
    let styles = r#"
        <w:style w:type="paragraph" w:styleId="Punktlista"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="Rubrik1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
    "#;
    let numbering = format!(
        r#"{LISTS}<w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Rubrik1"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="5"/></w:num>"#
    );
    let body = [
        styled("Punktlista", "From the style"),
        styled("Rubrik1", "Numbered heading"),
        styled("Rubrik1", "Next heading"),
    ]
    .concat();
    let imported = read(
        &Docx::new(&body)
            .styles(styles)
            .numbering(&numbering)
            .build(),
    );
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "– From the style",
            "[1 Numbered heading]",
            "[2 Next heading]"
        ]
    );
}

#[test]
fn a_tables_cells_come_in_row_by_row_one_paragraph_each() {
    let cell =
        |content: &str| format!("<w:tc><w:tcPr><w:tcW w:w=\"2000\"/></w:tcPr>{content}</w:tc>");
    let nested = format!(
        "<w:tbl><w:tblPr/><w:tr>{}{}</w:tr></w:tbl>",
        cell(&p("Inner 1")),
        cell(&p("Inner 2"))
    );
    let body =
        format!(
        "{before}<w:tbl><w:tblPr><w:tblW w:w=\"0\"/></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid>\
         <w:tr>{a}{b}</w:tr><w:tr>{c}{d}</w:tr></w:tbl>{after}",
        before = p("Before the table."),
        a = cell(&format!("{}{}", p("Name"), p("and title"))),
        b = cell("<w:p/>"),
        c = cell(&format!("{}{}{}", p("Outer text"), nested, p("Outer again"))),
        d = cell(&p("Last cell")),
        after = p("After the table."),
    );
    let imported = read_body(&body);
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "Before the table.",
            "Name\nand title",
            "Outer text",
            "Inner 1",
            "Inner 2",
            "Outer again",
            "Last cell",
            "After the table.",
        ]
    );
}

#[test]
fn tracked_changes_come_in_as_if_accepted() {
    let body = r#"
        <w:p>
            <w:r><w:t xml:space="preserve">Kept </w:t></w:r>
            <w:ins w:id="1" w:author="Edvin"><w:r><w:t xml:space="preserve">inserted </w:t></w:r></w:ins>
            <w:del w:id="2" w:author="Edvin"><w:r><w:delText xml:space="preserve">deleted </w:delText></w:r></w:del>
            <w:moveFrom w:id="3"><w:r><w:t xml:space="preserve">moved away </w:t></w:r></w:moveFrom>
            <w:moveTo w:id="4"><w:r><w:t>moved here</w:t></w:r></w:moveTo>
            <w:r><w:rPr><w:b/><w:rPrChange w:id="5"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t xml:space="preserve"> now bold</w:t></w:r>
        </w:p>
        <w:tbl><w:tr><w:trPr><w:del w:id="6" w:author="Edvin"/></w:trPr><w:tc><w:p><w:r><w:t>Deleted row</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>Kept row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    "#;
    let imported = read_body(body);
    assert_eq!(
        texts(&imported.paragraphs),
        ["Kept inserted moved here now bold", "Kept row"]
    );
    assert_eq!(
        imported.paragraphs[0].runs.last(),
        Some(&run(" now bold", true, false, false))
    );
    assert!(imported.tracked_changes_accepted);
    assert!(!read_body(&p("No changes.")).tracked_changes_accepted);
}

#[test]
fn a_fields_code_is_dropped_and_its_result_kept() {
    let body = r#"<w:p>
        <w:r><w:t xml:space="preserve">Page </w:t></w:r>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
        <w:r><w:t>CODE TEXT</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r>
        <w:r><w:t>3</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
        <w:r><w:t xml:space="preserve"> of </w:t></w:r>
        <w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple>
    </w:p>"#;
    assert_eq!(texts(&read_body(body).paragraphs), ["Page 3 of 9"]);
}

#[test]
fn a_hyperlink_content_control_and_smart_tag_are_read_into() {
    let body = r#"<w:p>
        <w:r><w:t xml:space="preserve">See </w:t></w:r>
        <w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:u w:val="single"/></w:rPr><w:t>the site</w:t></w:r></w:hyperlink>
        <w:sdt><w:sdtPr><w:alias w:val="Name"/><w:rPr><w:b/></w:rPr></w:sdtPr><w:sdtContent><w:r><w:t xml:space="preserve"> and Anna</w:t></w:r></w:sdtContent></w:sdt>
        <w:smartTag w:uri="x" w:element="place"><w:r><w:t xml:space="preserve"> in Umeå</w:t></w:r></w:smartTag>
    </w:p>
    <w:sdt><w:sdtContent>
        <w:p><w:r><w:t>A block content control</w:t></w:r></w:p>
    </w:sdtContent></w:sdt>"#;
    let imported = read_body(body);
    assert_eq!(
        texts(&imported.paragraphs),
        ["See the site and Anna in Umeå", "A block content control"]
    );
    assert_eq!(
        imported.paragraphs[0].runs[1],
        run("the site", false, false, true)
    );
}

#[test]
fn line_breaks_tabs_and_hyphens_become_text() {
    let body = r#"<w:p><w:r>
        <w:t>One</w:t><w:br/><w:t>two</w:t><w:cr/><w:t>three</w:t><w:tab/><w:t>tab</w:t>
        <w:noBreakHyphen/><w:t>hyphen</w:t><w:softHyphen/><w:t>ated</w:t><w:sym w:font="Wingdings" w:char="F04A"/>
        <w:br w:type="page"/>
    </w:r></w:p>"#;
    assert_eq!(
        texts(&read_body(body).paragraphs),
        ["One\ntwo\nthree tab-hyphenated"]
    );
}

#[test]
fn pictures_and_text_boxes_are_left_out_and_counted_once_each() {
    let picture = r#"<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:t>not text</a:t></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#;
    let text_box = r#"<w:r><mc:AlternateContent>
        <mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>
        <mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>
    </mc:AlternateContent></w:r>"#;
    let fallback_only = r#"<w:r><mc:AlternateContent><mc:Fallback><w:pict><v:shape/></w:pict></mc:Fallback></mc:AlternateContent></w:r>"#;
    let body = format!(
        r#"<w:p><w:r><w:t xml:space="preserve">Text </w:t></w:r>{picture}{text_box}<w:r><w:object><v:shape/></w:object></w:r>{fallback_only}<w:r><w:t>after</w:t></w:r></w:p>"#
    );
    let imported = read_body(&body);
    assert_eq!(texts(&imported.paragraphs), ["Text after"]);
    assert_eq!(
        imported.left_out,
        LeftOut {
            pictures: 3,
            text_boxes: 1,
            ..LeftOut::default()
        }
    );
}

#[test]
fn footnotes_and_comments_are_left_out_and_counted() {
    let body = r#"<w:p>
        <w:commentRangeStart w:id="0"/>
        <w:r><w:t>Claim</w:t></w:r>
        <w:commentRangeEnd w:id="0"/>
        <w:r><w:commentReference w:id="0"/></w:r>
        <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>
        <w:r><w:endnoteReference w:id="2"/></w:r>
        <w:r><w:t>.</w:t></w:r>
    </w:p>"#;
    let imported = read_body(body);
    assert_eq!(texts(&imported.paragraphs), ["Claim."]);
    assert_eq!(
        imported.left_out,
        LeftOut {
            comments: 1,
            footnotes: 2,
            ..LeftOut::default()
        }
    );
}

#[test]
fn headers_and_footers_with_text_are_counted() {
    let header = |text: &str| {
        format!(
            r#"<?xml version="1.0"?><w:hdr {NAMESPACES}><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:hdr>"#
        )
    };
    let bytes = Docx::new(&p("Body."))
        .part("word/header1.xml", &header("Studio Control &amp; friends"))
        .part("word/header2.xml", &header("   "))
        .part("word/footer1.xml", &header("Page 1"))
        .part("word/_rels/header1.xml.rels", "<Relationships/>")
        .build();
    let imported = read(&bytes);
    assert_eq!(texts(&imported.paragraphs), ["Body."]);
    assert_eq!(imported.left_out.headers_and_footers, 2);
}

#[test]
fn swedish_letters_arrive_whole_as_text_and_as_references() {
    let body = format!(
        "{}{}",
        p("Hej på dig, åäö ÅÄÖ"),
        p("&#229;&#xE4;&#246; &amp; &lt;tag&gt; &quot;citat&quot; &apos;")
    );
    assert_eq!(
        texts(&read_body(&body).paragraphs),
        ["Hej på dig, åäö ÅÄÖ", "å\u{e4}ö & <tag> \"citat\" '"]
    );
}

#[test]
fn another_main_part_named_by_the_content_types_is_read() {
    let document = Docx::new(&p("From document2.")).document_xml();
    let content_types = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let bytes = zip(&[
        Entry::deflated("[Content_Types].xml", content_types.as_bytes()),
        Entry::deflated("word/document2.xml", document.as_bytes()),
    ]);
    assert_eq!(texts(&read(&bytes).paragraphs), ["From document2."]);
}

#[test]
fn a_password_protected_document_is_refused() {
    let mut encrypted = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    encrypted.resize(512, 0);
    encrypted.extend("EncryptedPackage".encode_utf16().flat_map(u16::to_le_bytes));
    encrypted.extend("WordDocument".encode_utf16().flat_map(u16::to_le_bytes));
    assert_eq!(read_docx(&encrypted), Err(ImportRefusal::PasswordProtected));

    // A `.doc` with a `.docx` name is the old format.
    let mut old = encrypted[..512].to_vec();
    old.extend("WordDocument".encode_utf16().flat_map(u16::to_le_bytes));
    assert_eq!(read_docx(&old), Err(ImportRefusal::OldWordFormat));
}

#[test]
fn a_file_that_is_not_a_word_document_is_refused_as_not_what_its_name_says() {
    let not_a_docx = Err(ImportRefusal::NotWhatItsNameSays { expected: ".docx" });
    assert_eq!(read_docx(b"Just some text saved as .docx"), not_a_docx);
    assert_eq!(read_docx(b""), not_a_docx);
    assert_eq!(read_docx(b"%PDF-1.7\n"), not_a_docx);
    // A zip without Word's document in it: a workbook, say.
    let workbook = zip(&[Entry::deflated("xl/workbook.xml", b"<workbook/>")]);
    assert_eq!(read_docx(&workbook), not_a_docx);
}

#[test]
fn a_damaged_document_is_unreadable_with_the_reason() {
    let whole = docx(&p("Whole."));
    let truncated = &whole[..whole.len() / 2];
    assert_eq!(
        read_docx(truncated),
        Err(ImportRefusal::Unreadable(String::from(
            "the file is damaged"
        )))
    );

    let damaged_xml = zip(&[Entry::deflated(
        "word/document.xml",
        b"<w:document><w:body><w:p></w:body></w:document>",
    )]);
    assert_eq!(
        read_docx(&damaged_xml),
        Err(ImportRefusal::Unreadable(String::from(
            "its text is damaged"
        )))
    );

    let not_utf8 = zip(&[Entry::stored(
        "word/document.xml",
        b"<w:document>\xFF\xFE\xFD</w:document>",
    )]);
    assert_eq!(
        read_docx(&not_utf8),
        Err(ImportRefusal::Unreadable(String::from(
            "its text is damaged"
        )))
    );

    let mut locked = Entry::stored("word/document.xml", b"<w:document/>");
    locked.encrypted = true;
    assert_eq!(
        read_docx(&zip(&[locked])),
        Err(ImportRefusal::Unreadable(String::from(
            "it is locked with a password"
        )))
    );

    // Compression method 12 (bzip2) where 8 (deflate) is written.
    let mut other_method = zip(&[Entry::deflated("word/document.xml", b"<w:document/>")]);
    let central = find(&other_method, &0x0201_4b50_u32.to_le_bytes()).expect("a central entry");
    other_method[central + 10] = 12;
    assert_eq!(
        read_docx(&other_method),
        Err(ImportRefusal::Unreadable(String::from(
            "it is packed in a way Studio Control does not read"
        )))
    );

    let sentence =
        ImportRefusal::Unreadable(String::from("the file is damaged")).sentence("Intro.docx");
    assert_eq!(
        sentence,
        "Intro.docx could not be read: the file is damaged."
    );
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[test]
fn the_zip_reader_finds_entries_by_name_and_caps_what_it_inflates() {
    let big = vec![b'a'; 100_000];
    let bytes = zip(&[
        Entry::deflated("word/document.xml", &big),
        Entry::stored("Word/Styles.xml", b"styles"),
    ]);
    let opened = Zip::open(&bytes).expect("the zip opens");
    assert_eq!(
        opened.names().collect::<Vec<_>>(),
        ["word/document.xml", "Word/Styles.xml"]
    );
    assert_eq!(
        opened.read("word/styles.xml", 100),
        Ok(Some(b"styles".to_vec()))
    );
    assert_eq!(opened.read("word/missing.xml", 100), Ok(None));
    assert_eq!(
        opened
            .read("word/document.xml", 200_000)
            .map(|data| data.map(|data| data.len())),
        Ok(Some(100_000))
    );
    let too_large = Err(String::from("it is too large once unpacked"));
    assert_eq!(opened.read("word/document.xml", 99_999), too_large);
    assert_eq!(opened.read("word/styles.xml", 5), too_large);

    // A comment after the end record is allowed.
    let mut commented = bytes.clone();
    let comment_length = commented.len() - 2;
    commented[comment_length..].copy_from_slice(&7_u16.to_le_bytes());
    commented.extend_from_slice(b"comment");
    assert!(Zip::open(&commented).is_ok());

    // A Zip64 archive says so with all ones in the end record.
    let mut zip64 = bytes.clone();
    let end = zip64.len() - 22;
    zip64[end + 16..end + 20].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(
        Zip::open(&zip64).err(),
        Some(String::from(
            "it is packed in a way Studio Control does not read"
        ))
    );
}

#[test]
fn a_docx_through_the_public_api_names_its_parts_in_the_sentence() {
    let body = format!(
        "{}{}<w:p><w:r><w:t>With a picture</w:t></w:r><w:r><w:drawing/></w:r></w:p>",
        styled("Heading1", "Intro"),
        p("Hello and welcome to the studio."),
    );
    let bytes = Docx::new(&body).styles(HEADING_STYLES).build();
    let imported = import_file("Interview intro.DOCX", &bytes).expect("the file imports");
    assert_eq!(
        import_sentence("Interview intro.DOCX", &imported),
        "Imported Interview intro.DOCX: 3 paragraphs, 10 words, 1 cue. Left out: 1 picture."
    );
}

#[test]
fn a_zip_of_more_entries_than_a_document_holds_is_damaged() {
    let names: Vec<String> = (0..=10_000)
        .map(|index| format!("word/media/image{index}.png"))
        .collect();
    let entries: Vec<Entry<'_>> = names.iter().map(|name| Entry::stored(name, b"")).collect();
    let bytes = zip(&entries);
    assert_eq!(
        Zip::open(&bytes).err(),
        Some(String::from("the file is damaged"))
    );
    assert_eq!(
        read_docx(&bytes),
        Err(ImportRefusal::Unreadable(String::from(
            "the file is damaged"
        )))
    );
}

#[test]
fn header_parts_by_the_thousand_are_counted_in_one_pass() {
    // Each part is found by its name at once, and no more than 64 are read:
    // a file of thousands cannot keep the import busy.
    let header = format!(r#"<w:hdr {NAMESPACES}><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>"#);
    let document = Docx::new(&p("Body.")).document_xml();
    let names: Vec<String> = (0..9_999)
        .map(|index| format!("word/header{index}.xml"))
        .collect();
    let mut entries = vec![Entry::stored("word/document.xml", document.as_bytes())];
    entries.extend(
        names
            .iter()
            .map(|name| Entry::stored(name, header.as_bytes())),
    );
    let bytes = zip(&entries);
    let started = Instant::now();
    let imported = read(&bytes);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "took {:?}",
        started.elapsed()
    );
    assert_eq!(texts(&imported.paragraphs), ["Body."]);
    assert_eq!(imported.left_out.headers_and_footers, 64);
}

#[test]
fn lists_of_one_definition_count_on_together_until_one_restarts() {
    // Lists 2 and 5 share a definition, so Word counts on from one to the
    // other; list 3 restarts it at seven the first time it is used.
    let numbering = format!(r#"{LISTS}<w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>"#);
    let body = [
        item(2, 0, "One"),
        item(5, 0, "Two, in another list of the same definition"),
        item(2, 1, "Sub a"),
        item(3, 0, "Seven, restarted"),
        item(2, 0, "Eight"),
        item(3, 0, "Nine"),
        item(4, 0, "Another definition counts alone"),
    ]
    .concat();
    let imported = read(&Docx::new(&body).numbering(&numbering).build());
    assert_eq!(
        texts(&imported.paragraphs),
        [
            "1. One",
            "2. Two, in another list of the same definition",
            "a) Sub a",
            "7. Seven, restarted",
            "8. Eight",
            "9. Nine",
            "IV. Another definition counts alone",
        ]
    );
}

#[test]
fn a_styles_bold_italic_and_underline_are_kept() {
    let styles = r#"
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="Talare"><w:name w:val="Speaker"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
        <w:style w:type="paragraph" w:styleId="TalareKursiv"><w:name w:val="Speaker italic"/><w:basedOn w:val="Talare"/><w:rPr><w:i/></w:rPr></w:style>
        <w:style w:type="paragraph" w:styleId="Andrad"><w:name w:val="Changed"/><w:rPr><w:i/><w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr></w:style>
        <w:style w:type="character" w:styleId="Understruken"><w:name w:val="Underlined"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
        <w:style w:type="character" w:styleId="InteFet"><w:name w:val="Not bold"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>
    "#;
    let text_run = |properties: &str, text: &str| {
        format!(r#"<w:r><w:rPr>{properties}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>"#)
    };
    let body = [
        styled("Talare", "ANNA:"),
        format!(
            r#"<w:p><w:pPr><w:pStyle w:val="TalareKursiv"/></w:pPr>{}{}{}{}</w:p>"#,
            text_run("", "Bold and italic"),
            text_run(r#"<w:rStyle w:val="InteFet"/>"#, " not bold"),
            text_run(r#"<w:rStyle w:val="InteFet"/><w:b/>"#, " direct wins"),
            text_run(r#"<w:i w:val="0"/>"#, " upright"),
        ),
        format!(
            "<w:p>{}</w:p>",
            text_run(
                r#"<w:rStyle w:val="Understruken"/>"#,
                "Underlined by its style"
            )
        ),
        styled("Andrad", "Italic, not the bold it had"),
        // The paragraph mark's own formatting is not the text's.
        r#"<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Plain</w:t></w:r></w:p>"#.to_string(),
    ]
    .concat();
    let imported = read(&Docx::new(&body).styles(styles).build());
    let runs: Vec<Vec<PrompterRun>> = imported
        .paragraphs
        .iter()
        .map(|paragraph| paragraph.runs.clone())
        .collect();
    assert_eq!(
        runs,
        vec![
            vec![run("ANNA:", true, false, false)],
            vec![
                run("Bold and italic", true, true, false),
                run(" not bold", false, true, false),
                run(" direct wins", true, true, false),
                run(" upright", true, false, false),
            ],
            vec![run("Underlined by its style", false, false, true)],
            vec![run("Italic, not the bold it had", false, true, false)],
            vec![run("Plain", false, false, false)],
        ]
    );
}

#[test]
fn hidden_text_is_left_out() {
    let body = r#"<w:p>
        <w:r><w:t xml:space="preserve">Shown </w:t></w:r>
        <w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve">hidden </w:t><w:tab/><w:br/></w:r>
        <w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t xml:space="preserve">unhidden </w:t></w:r>
        <w:r><w:rPr><w:webHidden/></w:rPr><w:t>web hidden</w:t></w:r>
    </w:p>
    <w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>All hidden</w:t></w:r></w:p>"#;
    assert_eq!(
        texts(&read_body(body).paragraphs),
        ["Shown unhidden web hidden"]
    );
}

#[test]
fn a_compound_file_holding_neither_words_stream_is_not_a_docx() {
    // A workbook or a deck in Office's old format, renamed `.docx`.
    let mut workbook = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    workbook.resize(512, 0);
    workbook.extend("Workbook".encode_utf16().flat_map(u16::to_le_bytes));
    let not_a_docx = Err(ImportRefusal::NotWhatItsNameSays { expected: ".docx" });
    assert_eq!(read_docx(&workbook), not_a_docx);
    // A bare compound file header, too short to say more.
    assert_eq!(read_docx(&workbook[..8]), not_a_docx);
}

#[test]
fn an_embedded_document_is_left_out_and_counted() {
    let body = format!(
        r#"{}<w:altChunk r:id="rId9"/><w:altChunk r:id="rId10"><w:altChunkPr><w:matchSrc/></w:altChunkPr></w:altChunk>{}"#,
        p("Before."),
        p("After.")
    );
    let bytes = docx(&body);
    let imported = read(&bytes);
    assert_eq!(texts(&imported.paragraphs), ["Before.", "After."]);
    assert_eq!(
        imported.left_out,
        LeftOut {
            embedded_documents: 2,
            ..LeftOut::default()
        }
    );
    let imported = import_file("Merged.docx", &bytes).expect("the file imports");
    assert_eq!(
        import_sentence("Merged.docx", &imported),
        "Imported Merged.docx: 2 paragraphs, 2 words, 0 cues. Left out: 2 embedded documents."
    );
    let one = LeftOut {
        pictures: 1,
        embedded_documents: 1,
        ..LeftOut::default()
    };
    assert_eq!(one.phrases(), ["1 picture", "1 embedded document"]);
}

#[test]
fn tables_nested_deeper_than_any_stack_read_without_recursion() {
    let depth = 50_000;
    let body = format!(
        "{}{}{}",
        "<w:tbl><w:tr><w:tc>".repeat(depth),
        p("Deep inside"),
        "</w:tc></w:tr></w:tbl>".repeat(depth)
    );
    assert_eq!(texts(&read_body(&body).paragraphs), ["Deep inside"]);
}
