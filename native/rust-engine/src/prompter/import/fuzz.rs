//! Property tests for the import's readers: the bytes of a file and the
//! clipboard's text come from outside the process, so for arbitrary input, for
//! damaged copies of real documents and for documents built from Word's own
//! elements in any order, nothing panics, and what comes out keeps the model's
//! promises: no blank paragraph, no carriage return or control character, no
//! white space at a paragraph's ends, runs already joined.
//!
//! Each property runs 256 cases, so the suite stays fast.

use proptest::prelude::*;

use super::test_support::{p, zip, Docx, Entry, NAMESPACES};
use super::zip::Zip;
use super::*;

/// What every reader promises of what it gives.
fn assert_sound(imported: &ImportedText) -> Result<(), TestCaseError> {
    for paragraph in &imported.paragraphs {
        let text = paragraph.text();
        prop_assert!(!paragraph.is_blank(), "a blank paragraph: {:?}", paragraph);
        prop_assert_eq!(&paragraph.normalized(), paragraph);
        prop_assert_eq!(text.trim(), text.as_str());
        prop_assert!(
            text.chars()
                .all(|character| character == '\n' || !character.is_control()),
            "a control character in {:?}",
            text
        );
        prop_assert!(
            !text.contains('\u{FEFF}'),
            "a byte-order mark in {:?}",
            text
        );
    }
    Ok(())
}

#[derive(Debug, Clone)]
enum Damage {
    Flip(usize, u8),
    Insert(usize, u8),
    Remove(usize),
    Truncate(usize),
}

fn damage() -> impl Strategy<Value = Damage> {
    prop_oneof![
        (any::<usize>(), 1_u8..=255).prop_map(|(at, mask)| Damage::Flip(at, mask)),
        (any::<usize>(), any::<u8>()).prop_map(|(at, byte)| Damage::Insert(at, byte)),
        any::<usize>().prop_map(Damage::Remove),
        any::<usize>().prop_map(Damage::Truncate),
    ]
}

fn damaged(mut bytes: Vec<u8>, changes: &[Damage]) -> Vec<u8> {
    for change in changes {
        if bytes.is_empty() {
            break;
        }
        let length = bytes.len();
        match *change {
            Damage::Flip(at, mask) => bytes[at % length] ^= mask,
            Damage::Insert(at, byte) => bytes.insert(at % (length + 1), byte),
            Damage::Remove(at) => {
                bytes.remove(at % length);
            }
            Damage::Truncate(at) => bytes.truncate(at % length),
        }
    }
    bytes
}

const STYLES: &str = r#"
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:basedOn w:val="Loop"/></w:style>
    <w:style w:type="paragraph" w:styleId="Loop"><w:name w:val="Loop"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="x"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:ilvl w:val="8"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>
"#;

const NUMBERING: &str = r#"
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="8"><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%9%8%1%"/><w:start w:val="-5"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="9223372036854775807"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1.%2"/><w:pStyle w:val="Heading1"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="780"/><w:lvl w:ilvl="1"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%2"/></w:lvl></w:lvlOverride></w:num>
"#;

/// Word's elements, and a few that are not, to build documents from.
const ELEMENTS: [&str; 44] = [
    "w:p",
    "w:r",
    "w:t",
    "w:pPr",
    "w:pStyle",
    "w:outlineLvl",
    "w:numPr",
    "w:ilvl",
    "w:numId",
    "w:rPr",
    "w:b",
    "w:i",
    "w:u",
    "w:rStyle",
    "w:br",
    "w:tab",
    "w:noBreakHyphen",
    "w:tbl",
    "w:tr",
    "w:trPr",
    "w:tc",
    "w:ins",
    "w:del",
    "w:moveFrom",
    "w:moveTo",
    "w:rPrChange",
    "w:fldChar",
    "w:instrText",
    "w:fldSimple",
    "w:hyperlink",
    "w:sdt",
    "w:sdtContent",
    "w:drawing",
    "w:pict",
    "w:object",
    "w:txbxContent",
    "mc:AlternateContent",
    "mc:Choice",
    "mc:Fallback",
    "w:footnoteReference",
    "w:commentReference",
    "w:sectPr",
    "m:oMath",
    "x:unknown",
];

const VALUES: [&str; 14] = [
    "0", "1", "2", "8", "9", "99", "-1", "begin", "separate", "end", "none", "Heading1", "x",
    "Strong",
];

fn element() -> impl Strategy<Value = (&'static str, String)> {
    (
        prop::sample::select(ELEMENTS.to_vec()),
        prop::option::of((
            prop::sample::select(vec!["w:val", "w:fldCharType"]),
            prop::sample::select(VALUES.to_vec()),
        )),
    )
        .prop_map(|(name, attribute)| {
            let attribute = attribute
                .map(|(key, value)| format!(r#" {key}="{value}""#))
                .unwrap_or_default();
            (name, attribute)
        })
}

fn word_text() -> impl Strategy<Value = String> {
    prop_oneof![
        "[a-zåäö \\[\\]\t]{0,8}",
        Just(String::from("&amp;&#229;&#xE4;&#0;&#x110000;&lt;")),
        Just(String::from("\u{FEFF}\u{2028}\u{85}\r\n")),
    ]
}

/// XML made of Word's elements in any order and nesting, well formed so the
/// walk gets past the parser.
fn word_xml() -> impl Strategy<Value = String> {
    let leaf = prop_oneof![
        word_text(),
        element().prop_map(|(name, attribute)| format!("<{name}{attribute}/>")),
    ];
    leaf.prop_recursive(6, 96, 6, |inner| {
        (element(), prop::collection::vec(inner, 0..6)).prop_map(|((name, attribute), children)| {
            format!("<{name}{attribute}>{}</{name}>", children.concat())
        })
    })
}

fn document_of(body: &str) -> Vec<u8> {
    let document = format!(
        r#"<?xml version="1.0"?><w:document {NAMESPACES}><w:body>{body}</w:body></w:document>"#
    );
    let styles = format!(r#"<w:styles {NAMESPACES}>{STYLES}</w:styles>"#);
    let numbering = format!(r#"<w:numbering {NAMESPACES}>{NUMBERING}</w:numbering>"#);
    zip(&[
        Entry::deflated("word/document.xml", document.as_bytes()),
        Entry::stored("word/styles.xml", styles.as_bytes()),
        Entry::deflated("word/numbering.xml", numbering.as_bytes()),
        Entry::stored("word/header1.xml", document.as_bytes()),
    ])
}

fn a_real_document() -> Vec<u8> {
    let body = format!(
        r#"{}<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p><w:tbl><w:tr><w:tc>{}</w:tc></w:tr></w:tbl>"#,
        p("Hello and welcome."),
        p("Cell")
    );
    Docx::new(&body)
        .styles(STYLES)
        .numbering(NUMBERING)
        .part(
            "word/footer1.xml",
            "<w:ftr><w:p><w:r><w:t>Page</w:t></w:r></w:p></w:ftr>",
        )
        .build()
}

fn html_token() -> impl Strategy<Value = &'static str> {
    prop::sample::select(
        [
            "<p>",
            "</p>",
            "<div>",
            "</div>",
            "<b>",
            "</b>",
            "<i>",
            "</i>",
            "<u>",
            "</u>",
            "<li>",
            "</li>",
            "<ul>",
            "</ul>",
            "<ol start=\"-9223372036854775808\">",
            "<ol>",
            "</ol>",
            "<li value=\"9223372036854775807\">",
            "<table>",
            "<tr>",
            "<td>",
            "</td>",
            "<th>",
            "</tr>",
            "</table>",
            "<h1>",
            "</h1>",
            "<br>",
            "<br/>",
            "<img src=x>",
            "<hr>",
            "<!--",
            "-->",
            "<![if !supportLists]>",
            "<![endif]>",
            "<![CDATA[",
            "]]>",
            "<span style='mso-list:Ignore'>",
            "<p style='mso-list:l0 level1 lfo1'>",
            "<span style=\"font-weight:700;font-style:italic\">",
            "<b style=\"font-weight:normal\">",
            "</span>",
            "<pre>",
            "</pre>",
            "<script>",
            "</script>",
            "<style>",
            "</style>",
            "<head>",
            "</head>",
            "<body>",
            "<svg>",
            "</svg>",
            "<title>",
            "&amp;",
            "&#",
            "&#x",
            "&#150;",
            "&#xD800;",
            "&nbsp;",
            "&shy;",
            ";",
            "text",
            " ",
            "\n",
            "\r",
            "\t",
            "å",
            "[",
            "]",
            "<",
            ">",
            "\"",
            "'",
            "=",
            "/",
            "<!",
            "<?",
            "</",
            "Version:0.9 StartHTML:",
        ]
        .to_vec(),
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Arbitrary bytes and damaged real zips: opening and reading every entry
    /// never panics, and nothing read is larger than the limit asked for.
    #[test]
    fn the_zip_reader_never_panics(
        bytes in prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..1024),
            proptest::collection::vec(damage(), 0..6)
                .prop_map(|changes| damaged(a_real_document(), &changes)),
        ],
        limit in 0_usize..4096,
    ) {
        if let Ok(opened) = Zip::open(&bytes) {
            let names: Vec<String> = opened.names().map(str::to_string).collect();
            for name in names {
                if let Ok(Some(data)) = opened.read(&name, limit) {
                    prop_assert!(data.len() <= limit);
                }
            }
        }
    }

    /// Arbitrary bytes behind a zip's signature, and damaged real documents:
    /// the `.docx` reader gives an answer and never panics.
    #[test]
    fn the_docx_reader_never_panics_on_damaged_files(
        bytes in prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..1024).prop_map(|mut bytes| {
                bytes.splice(0..0, *b"PK\x03\x04");
                bytes
            }),
            proptest::collection::vec(damage(), 0..6)
                .prop_map(|changes| damaged(a_real_document(), &changes)),
        ],
    ) {
        if let Ok(imported) = docx::read_docx(&bytes) {
            assert_sound(&imported)?;
        }
    }

    /// Documents made of Word's elements in any order: every one is read
    /// (the XML is well formed) and what comes out is sound.
    #[test]
    fn the_docx_reader_walks_any_arrangement_of_words_elements(
        body in proptest::collection::vec(word_xml(), 0..8),
    ) {
        let imported = docx::read_docx(&document_of(&body.concat()));
        prop_assert!(imported.is_ok(), "{:?}", imported);
        if let Ok(imported) = imported {
            assert_sound(&imported)?;
        }
    }

    /// Arbitrary bytes, with and without a byte-order mark: a `.txt` reads or
    /// is refused, and never panics.
    #[test]
    fn the_txt_reader_never_panics(
        mark in prop::sample::select(vec![&b""[..], &b"\xEF\xBB\xBF"[..], &b"\xFF\xFE"[..], &b"\xFE\xFF"[..]]),
        bytes in prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..512),
            "\\PC{0,64}".prop_map(String::into_bytes),
        ],
    ) {
        let mut file = mark.to_vec();
        file.extend_from_slice(&bytes);
        if let Ok(imported) = txt::read_txt(&file) {
            assert_sound(&imported)?;
            prop_assert!(imported.encoding.is_some());
        }
    }

    /// Arbitrary text and HTML made of the tags the reader treats specially,
    /// in any order: the HTML reader never panics and what it gives is sound.
    #[test]
    fn the_html_reader_never_panics(
        markup in prop_oneof![
            any::<String>(),
            proptest::collection::vec(html_token(), 0..64).prop_map(|tokens| tokens.concat()),
        ],
    ) {
        assert_sound(&html::read_html(&markup))?;
        let _ = import_paste(Some(&markup), &markup);
    }
}
