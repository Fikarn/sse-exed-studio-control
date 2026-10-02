//! What the prompter's tests share: a database of their own, the request
//! path the screen takes, and the layout a view would report.

use crate::prompter::clock::PrompterLayoutLine;
use crate::prompter::model::{paragraph_word_count, PrompterParagraph};
use crate::prompter::{handle_prompter_request, PrompterError, PrompterReply};
use crate::storage::initialize_test_database;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) struct TestPrompter {
    root: PathBuf,
    pub db_path: PathBuf,
}

impl TestPrompter {
    pub(crate) fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "studio-control-prompter-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&root).expect("test dir should be created");
        let db_path = root.join("studio-control.sqlite3");
        initialize_test_database(&db_path).expect("database should initialize");
        let prompter = Self { root, db_path };
        prompter.connect_screen();
        prompter
    }

    /// A test prompter whose saver writes on its own thread, as the live
    /// app's does; it is finished before the folder goes, so Windows lets the
    /// database go.
    pub(crate) fn with_saver(label: &str) -> Self {
        let prompter = Self::new(label);
        assert!(
            crate::prompter::runtime::saver_of(&prompter.db_path).start(),
            "the saver's thread should start"
        );
        prompter
    }

    /// The report the shell sends at its start when Windows sees the
    /// Prompter XL at its own size (Slice 5a): the glass is drawn, so the
    /// text may scroll. Every start forgets it (`runtime::forget`).
    pub(crate) fn connect_screen(&self) -> Value {
        self.report_screen(json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }))
    }

    /// A `prompter.screen.report`, as the shell sends it.
    pub(crate) fn report_screen(&self, params: Value) -> Value {
        self.call("prompter.screen.report", params)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.db_path
    }

    /// A request as the screen sends it; the whole reply.
    pub(crate) fn reply(
        &self,
        method: &str,
        params: Value,
    ) -> Result<PrompterReply, PrompterError> {
        handle_prompter_request(&self.db_path, method, &params)
    }

    /// A request that must succeed; its result.
    pub(crate) fn call(&self, method: &str, params: Value) -> Value {
        self.reply(method, params)
            .unwrap_or_else(|error| panic!("{method} should succeed: {error:?}"))
            .result
    }

    /// A request that must be refused; its code and sentence.
    pub(crate) fn refused(&self, method: &str, params: Value) -> (String, String) {
        match self.reply(method, params) {
            Ok(reply) => panic!("{method} should be refused, answered {}", reply.result),
            Err(PrompterError::Refused(code, sentence)) => (code.to_string(), sentence),
            Err(PrompterError::Invalid(sentence)) => (String::from("INVALID_PARAMS"), sentence),
            Err(PrompterError::Storage(message)) => (String::from("STORAGE_ERROR"), message),
        }
    }

    pub(crate) fn snapshot(&self) -> Value {
        self.call("prompter.snapshot", json!({}))
    }

    /// A new script holding `paragraphs`, as New script and the editor make
    /// one; its id.
    pub(crate) fn script(&self, name: &str, paragraphs: &[&str]) -> String {
        let id = self.call("prompter.script.create", json!({ "name": name }))["scriptId"]
            .as_str()
            .expect("an id")
            .to_string();
        self.edit(&id, paragraphs);
        id
    }

    pub(crate) fn edit(&self, id: &str, paragraphs: &[&str]) {
        let paragraphs: Vec<PrompterParagraph> = paragraphs
            .iter()
            .map(|text| PrompterParagraph::plain(*text))
            .collect();
        self.call(
            "prompter.script.edit",
            json!({ "scriptId": id, "paragraphs": paragraphs }),
        );
    }

    /// Reports the layout a view would: `per_line` words a line of `height`
    /// px, half a line between paragraphs, `END` right under the last line.
    pub(crate) fn lay_out(&self, per_line: u32, height: f64) -> Value {
        let glass = self.call("prompter.glass.snapshot", json!({}));
        let paragraphs: Vec<PrompterParagraph> =
            serde_json::from_value(glass["paragraphs"].clone()).expect("the glass's text");
        let (lines, end_top) = layout_lines(&paragraphs, per_line, height);
        self.call(
            "prompter.layout.report",
            json!({ "layoutKey": glass["layoutKey"], "lines": lines, "endTop": end_top }),
        )
    }
}

impl Drop for TestPrompter {
    fn drop(&mut self) {
        crate::prompter::runtime::saver_of(&self.db_path).finish(std::time::Duration::from_secs(5));
        crate::prompter::runtime::forget(&self.db_path);
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(crate) fn layout_lines(
    paragraphs: &[PrompterParagraph],
    per_line: u32,
    height: f64,
) -> (Vec<PrompterLayoutLine>, f64) {
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
    (lines, top)
}
