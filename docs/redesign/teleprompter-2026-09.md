# The Teleprompter: what it does (2026-09-26)

Status: the designer's proposal for D20 (open), written in C0 on branch `new-pages/c0-boards` for the operator to review with the Teleprompter boards in `docs/redesign/assets/concepts/` (D19). This text says what the operator can do and see; the boards show where it sits. Where the two differ, the review settles it. No source, token or test was edited. Once approved, this is the scope of Part C's Teleprompter slice (D21 proposes that slice first).

Sources: the ledger `docs/plans/new-pages-2026-09.md`: D4 (the tab order), D9 (the page), D11 (what is armed), D12 (what must never happen), D14 (the PROMPTER deck page), D15 rule 4 (only the live app draws on the Prompter XL), C0's Prompter XL finding, and Appendix B items 13–17 (the walk). The system: `system-a-2026-09.md` (the cluster rule, the arm, the state vocabulary, the copy rules). The operator's interview of 2026-09-24: the operator at the PC runs the main camera's prompter; Studio Control draws the script; Word and text import were assumed but not confirmed.

## 1. What it is for

The presenter reads the script in the glass in front of CAM 1, the Pocket 6K Pro. The operator at the PC, about 3 m away, runs the scroll at the presenter's pace. From the chair, in one look, the operator should see four things: whether the script is on the glass, where the presenter is in it, how long is left at this pace, and how to stop it. Everything else (writing, importing, the look) happens before the take.

Two screens are involved, and only one belongs to the presenter:

- **The Prompter XL** is the presenter's screen: 15.6-inch, 1920×1080, 60 Hz, a DisplayLink screen that Windows treats as a monitor. It flips its picture itself, so Studio Control draws the script unmirrored.
- **Display 3** is Studio Control's screen. The Teleprompter page on it has a live copy of the Prompter XL's screen and the editor.

There is no third screen. Studio Control has no fallback (D12).

## 2. The page, on the cluster rule

| Region              | Teleprompter                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header (56)         | the shell; a `Prompter` lamp showing the page's worst state; while the prompter scrolls, a green latch `Prompter playing · 3:12 left` on every page, which opens this page (the way the `Solo` and `Scene unsaved` latches open theirs) |
| State display (180) | the Prompter XL's state (§8): the word, the sentence, the way out, and the armed row                                                                                                                                                    |
| Take-time keys      | `PLAY` (lit green while scrolling), speed (readout, − / +), time left (the 44 px number), `BACK` · `TOP`, paragraph and cue steps, line steps, text size (− / +, Standard)                                                              |
| Lists               | the scripts; the one on the prompter is marked `ON PROMPTER`                                                                                                                                                                            |
| Standing actions    | New script · Open file… · Paste as a new script · Clear the prompter · press twice                                                                                                                                                      |
| Bay                 | the live copy of the Prompter XL's screen across the bay's full width, 1,688 × 950 (88 % of its pixels); under it the script bar, the cue keys and Go to paragraph                                                                      |
| Plate (416)         | the selected script (name and numbers; Put on the prompter, or Replace / Update · press twice; the editor; earlier versions; Remove), then the look                                                                                     |
| Footer (40)         | `Prompter XL 1920×1080 · 60 Hz` · `Script Interview intro` · `Place ¶ 7 of 18 · 42 %` · `Speed 140 words/min` · `Left 3:12`                                                                                                             |

As on every page, nothing on it shows a key or a key hint (D6).

## 3. Scripts

### 3.1 Where a script comes from: both paste and file, with Word as the main path

- **Open file…** reads a Word document (`.docx`) or a plain text file (`.txt`). Word, because scripts are usually written in it and the interview assumed it (to confirm, §14). Plain text, because every program can save it. Studio Control reads the file itself: Word does not have to be installed, and nothing is sent anywhere. Studio Control keeps its own copy of the text and never changes, locks or watches the file.
- **Paste as a new script** takes the text on the Windows clipboard. When the clipboard holds formatting (copied from Word, a browser or Google Docs), the Word rules below apply; otherwise the text is plain.
- **New script** opens an empty script in the editor, for a short script or a quick fix.

Why both: paste covers every source (a browser, an e-mail, Google Docs) without a file. A file keeps its name and formatting, and it can be opened again when the script changes.

Not offered:

- the old Word format `.doc`. The refusal says: "Save it as .docx in Word, then open that."
- PDF: its lines are the page's, not the script's, and hyphens and page numbers end up in the text.
- RTF: rarely used, and Word and every editor can save `.docx` or `.txt`.
- anything fetched from the network. For Google Docs, download the script as `.docx`.

### 3.2 What an import keeps

**Kept:**

- the text and its paragraphs. A paragraph is a Word paragraph, or text between empty lines in a `.txt`. A single line break inside a paragraph stays a line break.
- bold, italic and underline, which carry the presenter's emphasis.
- Word headings, which become cues (§4.2).
- bullets and numbering, as a dash or the number.

**Dropped:** fonts, sizes, colours, highlighting, pictures, text boxes, headers and footers, footnotes and comments. A table's cells come in row by row, one paragraph each. Tracked changes come in as if accepted.

The import sentence counts what was left out, for example: "Imported Interview intro.docx: 18 paragraphs, 1,240 words, 3 cues. Left out: 2 pictures, 1 comment. Tracked changes were taken as accepted."

A `.txt` is read as UTF-8 (or UTF-16 with its byte-order mark), otherwise as Windows-1252, and the sentence names which one, so å, ä and ö never arrive broken.

Refused, each with a sentence: a password-protected document, a file that is not what its name says, and a script over 30,000 words (about 3½ hours at 140 words a minute).

A script is named after its file, without the extension. A pasted script is named after the first words of its first line. Either name can be changed in the plate's name field.

### 3.3 How scripts are kept

- **In the saved data** (schema 9, the ledger's provisional Teleprompter slice): each script's text and name, the name of the file it came from, when it was made and changed, and its own place and speed (§5).
- **Saved as you type.** An edit reaches the saved data within a second, and the editor shows `Saved 14:02`. There is no Save key and nothing to forget.
- **The list is sorted by name**, with numbers in their natural order (`2` before `10`). A running order is therefore a matter of naming: `01 Intro`, `02 Guest`, `03 Outro`. Each row shows the name, the length at the script's own speed, and `ON PROMPTER` on the script the prompter shows.
- **Earlier versions.** Every import, and every time a script's text goes onto the prompter (put on, replaced, updated), keeps that text as a version. Each script keeps its last 20 versions. One press brings a version back as the script's text. If that script is on the prompter, the prompter keeps what it shows until Update (§5.5).
- **Opening a file again.** When a file with the same name was opened before, a dialog offers two choices: update that script from the file (its old text becomes a version), or add the file as a new script.
- **Removing.** Remove moves a script to Removed, a section under the list that shows its count. Restore brings a script back. Only "Delete for good…" in Removed ends a script, and it asks first. The script on the prompter cannot be removed: its Remove key is locked and says why ("clear the prompter first").
- **Backups.** The database backups (daily, shutdown, pre-migration and pre-restore) carry the scripts with everything else. The backup archive (format 6) carries the scripts, their versions, the removed ones, the look, and each script's place and speed, and Verify counts them ("12 scripts"). Restoring an archive adds the scripts it holds and never removes or overwrites one: a script whose text differs comes back as an earlier version of it. A database restore replaces the saved data, as it does today, after writing its pre-restore copy.

## 4. What the prompter shows

### 4.1 The look

The prompter has one look, not one per script: there is one presenter and one glass. All sizes are pixels on the Prompter XL's 1920×1080 screen, where a pixel is 0.18 mm. Every change applies at once with one press, and the words at the reading line stay where they are (§5.2).

| Setting           | Standard                                                     | Range                                                     | Why                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text              | Inter, medium weight, left-aligned, no hyphenation           | —                                                         | Inter is the app's own face and has å, ä and ö. A medium weight survives the glass, which loses light. Ragged-right text reads faster than justified text, and a word broken across two lines stops the eye                                          |
| Text size         | 88 px, which makes capitals about 11.5 mm                    | 48–160 px in 4 px steps                                   | 11.5 mm capitals are about 20 arcminutes at 2 m, above ISO 9241-303's minimum for reading (the measure the system uses for words read during a take). At 3 m the same 20 arcminutes needs about 132 px. The presenter's distance is still open (§14) |
| Line spacing      | 1.4                                                          | 1.1–2.0                                                   | enough space to hold a line while it moves                                                                                                                                                                                                           |
| Paragraph space   | half a line                                                  | fixed                                                     | a new thought is visible before it arrives                                                                                                                                                                                                           |
| Margins           | 12 % each side                                               | 0–30 %                                                    | a narrow column keeps the eyes still: about 32 characters a line at the standard size, so the camera sees little eye movement                                                                                                                        |
| Colours           | white text on black                                          | white or yellow text; the background is always black      | black gives off no light, so the glass shows only the words. A lit background floods the glass and makes the presenter squint                                                                                                                        |
| Cues              | a second colour (light blue), 70 % size, italic, in brackets | fixed                                                     | reads as a direction and is never read aloud                                                                                                                                                                                                         |
| Reading line      | an arrow at the left edge, 35 % from the top                 | 20–60 % from the top; a thin line across (off by default) | the eye returns to the same height, near the lens behind the glass's centre. A line across the text can hide descenders                                                                                                                              |
| Text already read | dimmed to 45 % above the reading line                        | on / off                                                  | after looking away, the presenter finds the place at a glance                                                                                                                                                                                        |
| Paragraph numbers | off on the prompter (always shown on the operator's side)    | on / off                                                  | when they are on, "from paragraph 7" means the same thing to both people                                                                                                                                                                             |

The **standard size** is set in the look. During a take, − / + and the deck's size dial move the size away from it. That size is saved too, so a restart keeps it. Standard, or a push of the size dial, returns to the standard size. The readout shows both, for example `96 px · standard 88`.

### 4.2 Paragraphs, cues and the end

- A **paragraph** is the unit for the place and for jumps. On the operator's side, every paragraph has a number from 1 to n.
- A **cue** is a direction for the presenter or the operator: any text in square brackets (`[PAUSE]`, `[look at CAM 2]`, `[slide 3]`), or a Word heading. A cue on a line of its own is a jump target. A cue inside a sentence is drawn in the cue colour where it stands. The editor's Add cue key puts `[ ]` at the cursor.
- The **end** is marked by `END` in the cue colour, half a screen below the last line.

Studio Control adds nothing else to the glass: no clock, no messages and no logo. The words the presenter reads are the script's own.

## 5. Running it

| Control      | On the page                                                | On the deck (D14)                             | What it does                                                                                                                                                               |
| ------------ | ---------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play / pause | `PLAY`, lit green while scrolling                          | `PLAY`; a push of the speed dial              | starts or stops the scroll where the reading line is. Starting and stopping ease over 0.3 s so the text never jerks                                                        |
| Speed        | − / + (5 words/min each), with the readout                 | speed dial, 5 words/min a detent, no speed-up | changes the pace at once, easing over 0.3 s. While paused, it sets the pace for the next play                                                                              |
| Line steps   | ◂ Line · Line ▸                                            | position dial, one line a detent              | moves the text one line without stopping the scroll                                                                                                                        |
| `BACK`       | `BACK`                                                     | `BACK`                                        | goes to the start of the paragraph at the reading line; from that paragraph's first line, to the start of the paragraph before. It is the "again from the top of that" key |
| `TOP`        | `TOP`                                                      | `TOP`                                         | pauses and puts the first line at the reading line, ready for a new take                                                                                                   |
| Paragraphs   | ◂ Paragraph · Paragraph ▸; the script bar; Go to paragraph | paragraph dial, one paragraph a detent        | goes to the start of that paragraph                                                                                                                                        |
| Cues         | ◂ Cue · Cue ▸; the cue keys                                | (spare keys, §14)                             | goes to that cue                                                                                                                                                           |
| Text size    | − / + (4 px each); Standard                                | size dial; a push returns to the standard     | changes the size and keeps the words at the reading line                                                                                                                   |

Every control in this table is one press (D11). None of them starts the scroll. A jump keeps scrolling if the prompter was scrolling and stays paused if it was paused; only `TOP` pauses. A jump moves the text in 0.2 s: too short to read, long enough to see which way the text went.

### 5.1 Speed, in words a minute

Speed is the presenter's pace in words a minute, from 40 to 300; a new script starts at 140. Studio Control works out the scroll's pixels per second from the pace and the script's average words per line in the current look. A bigger text size or wider margins therefore keep the pace: the text moves faster and the presenter reads at the same speed. Each script keeps its own speed.

At the standard look and 140 words a minute, the text moves about 55 px a second, just under a pixel a frame at 60 Hz.

Why words a minute and not a 1–10 scale: time left means the same whatever the size, and a pace can be written on a script ("this one is 150"). The choice is still open (§14).

### 5.2 The place

The place is where the reading line is in the script: a paragraph and the word at the reading line. It does not depend on the look, so a change of size, margins or spacing, an update of the script and a restart all put the same words back at the reading line. The page shows the place as `¶ 7 of 18 · 42 %`.

The hardware link keeps the place and saves it about once a second while the text scrolls, and at every stop, jump and change.

The mouse wheel does nothing over the live copy, so a stray turn of the wheel cannot move the presenter's text.

### 5.3 Time left

`3:12 left` is the time until `END` reaches the reading line at the current speed. It comes from the layout itself (the height of the rest of the script divided by the scroll speed), so it is exact for this look and pace. It changes as the speed changes. While the prompter is paused, it shows how long a play would take.

Beside it are the whole script's length at this pace (`of 6:40`) and, while the text scrolls, the clock time it will end (`ends 14:32`).

### 5.4 At the end

The scroll stops when `END` reaches the reading line, `PLAY` goes out, and the state sentence says "At the end of Interview intro." The prompter never loops, never goes back to the top by itself, and never moves on to the next script.

### 5.5 Putting a script on, replacing, updating, clearing

- **Put on the prompter** is the plate's primary key and acts on the selected script. It is one press when the prompter is blank. The script comes on paused, at its own place, or at the top if it was left at its end.
- **Replace on the prompter · press twice** is the same key when the prompter shows another script. It is armed (D11).
- **Update the prompter · press twice** appears when the script on the prompter was edited after it went on (§6.3). It is armed.
- **Clear the prompter · press twice** is among the cluster's standing actions. The prompter goes black; the script stays in the list with its place. It is armed.

Each of these is a row in Setup / Support › Recent actions, with Screen as who did it: "Put Outro on the prompter", "Replaced Intro with Outro on the prompter", "Updated Intro on the prompter", "Cleared the prompter". Play, pause, speed and jumps are not rows: a take has hundreds of them, and they would push the lights and camera rows out of the eight rows the list shows.

## 6. The operator's view on the PC

### 6.1 The live copy

The bay shows the Prompter XL's screen as the glass gets it, unmirrored, at 1,688 × 950. That is 88 % of its pixels, so the standard 88 px text shows at 77 px on display 3.

- It is the same layout scaled down, never a second layout: the lines break in the same places, the reading arrow sits at the same height, and the dimming is the same.
- Nothing is drawn on it that the presenter does not see. The operator's own marks (numbers, the place, the time) sit around it.
- It keeps showing the script when the Prompter XL is not connected, and the state display says so. The live copy is part of Studio Control's page on display 3 and never a window of its own; D12 is about the presenter's screen.
- When nothing is on the prompter, the live copy is black, with one line under it: `Nothing on the prompter`.
- For the §10 measures it counts as a picture, like a camera picture: its type is the presenter's, not the page's.

### 6.2 The script bar, the cue keys and Go to paragraph

Under the live copy:

- **The script bar** shows the whole script at one width. Each paragraph is a segment in proportion to its length, cues are ticks, the place is a marker, and the part already read is dimmed. A press on the bar jumps to the start of the paragraph under the press.
- **The cue keys** come one per cue, in order, each showing the cue's words. The first 24 cues get keys; the bar shows every cue.
- **Go to paragraph** is a number field with a Go key.

Nothing here scrolls, and a script of any length fits the bar.

### 6.3 The editor

The plate's editor shows the selected script, which is not necessarily the one on the prompter. The text sits on a black well, with paragraph numbers in a gutter and cues marked as they will look on the glass.

- The editor's bar has Bold · Italic · Underline · Add cue · Undo · Redo · Paste.
- The editor adds no keys of its own (D6). Typing, Enter for a new paragraph and the arrow keys work as in any text field, and nothing on screen advertises a key.
- Under the text: the word count, the length at the script's speed, and `Saved 14:02`.

Editing the script that is on the prompter changes Studio Control's copy, not the presenter's. The prompter keeps what it shows until **Update the prompter · press twice**, because a change above the reading line would otherwise move the text under the presenter's eyes. Until then, the state shows `NOT UPDATED`, and the editor's gutter marks the paragraph at the reading line.

On Update, the same words stay at the reading line. If the paragraph at the reading line was deleted, the place moves to the start of the next paragraph, and the sentence says so.

## 7. The Prompter XL's screen

- **Only the Prompter XL.** Studio Control opens its prompter window only on a screen that Windows names `Prompter XL` (the Part C drift guard). The window is fullscreen and borderless, with no taskbar entry. It never takes the keyboard, it hides the mouse pointer, and it stays above other windows on that screen. The script never appears on any other screen or window: not display 3, not display 2 (D12, D15 rule 4).
- **Plugged in.** The window opens by itself and shows what the prompter held, paused. Studio Control's own window stays on display 3; if Windows moves it while rearranging screens, Studio Control puts it back.
- **Unplugged.** The window closes; it is not moved anywhere. The scroll pauses at the place, and `NOT CONNECTED` says so. `PLAY` locks and shows its reason ("the Prompter XL is not connected"): nothing scrolls where nobody can read it. Jumps, speed, size and the editor keep working on the live copy, and the place they set is where the prompter comes back.
- **Plugged back in.** The script returns at the same place, paused (Appendix B item 14).
- **Duplicated.** If Windows shows a copy of another screen on the Prompter XL, Studio Control draws nothing there and shows `DUPLICATED` with the way to fix it.
- **Resolution.** Studio Control draws at the resolution Windows reports for the screen and shows it in the footer. Below 1920×1080 it shows `LOW RESOLUTION`. Windows' display scaling on that screen changes nothing, because the script is drawn in the screen's own pixels.
- **While nothing plays.** When paused, the script stands still at the place. Nothing moves and nothing is added (no `PAUSED` for the presenter to read). With nothing on the prompter, the screen is black. At start, the prompter shows what the saved data holds, paused.
- **When Studio Control is closed**, the prompter window closes with it, and the Prompter XL shows whatever Windows puts on an extended screen: the desktop background (§14).
- **Brightness** is not Studio Control's to show or set: Windows does not report it.

Setup / Support › Workstation shows the same facts in one line: `Prompter XL · connected · 1920×1080 · 60 Hz`.

## 8. States

| Word             | Tone      | Sentence (proposed)                                                                                                                                        | Way out                                   |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ON SCREEN`      | ok        | "The Prompter XL shows Interview intro." followed by "Playing at 140 words a minute." / "Paused at paragraph 7 of 18." / "At the end."                     | —                                         |
| `READY`          | ok        | "The Prompter XL is connected and blank. Choose a script and put it on the prompter."                                                                      | Put on the prompter (the selected script) |
| `NOT UPDATED`    | attention | "Interview intro was edited after it went on the prompter. The prompter still shows the earlier text."                                                     | Update the prompter · press twice         |
| `LOW RESOLUTION` | attention | "Windows runs the Prompter XL at 1280×720. Set it to 1920×1080 in Windows' display settings for the sharpest text."                                        | —                                         |
| `NOT CONNECTED`  | error     | "Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen." | —                                         |
| `DUPLICATED`     | error     | "Windows shows a copy of another screen on the Prompter XL, so the script is not drawn there. In Windows' display settings, choose Extend these displays." | —                                         |
| `NOT SHOWING`    | error     | "Studio Control could not open its window on the Prompter XL." (the reason in small type under it)                                                         | Try again                                 |

The armed row sits under the word, as it does on the Console: `Replace Intro with Outro on the prompter · press again · 4.5 s`. The header lamp shows the worst of these states: `Prompter ok`, `Prompter · not updated` or `Prompter · not connected`. `PLAY` locks while the Prompter XL is not connected, and every run key locks while nothing is on the prompter. A locked key takes the locked form (a dashed outline at 55 %) and shows its reason within reach.

## 9. The Stream Deck's PROMPTER page (D14)

The Stream Deck + has four dials, a touch strip over them, and eight keys.

| Dial         | Turn                   | Push                 | Touch strip above it                         |
| ------------ | ---------------------- | -------------------- | -------------------------------------------- |
| 1. Speed     | 5 words/min a detent   | play / pause         | `SPEED 140`                                  |
| 2. Position  | one line a detent      | —                    | `¶ 7/18 · 42%`                               |
| 3. Text size | 4 px a detent          | back to the standard | `3:12 LEFT` (after a turn, the size for 2 s) |
| 4. Paragraph | one paragraph a detent | —                    | the script's name                            |

- **Keys:** `PLAY` (lit green while scrolling), `BACK`, `TOP`, and the page key in the chain (D5). The other keys stay dark (§14).
- **Screen-only (D14):** putting a script on, replacing, updating and clearing it; editing; the look.
- **Not connected:** while the Prompter XL is not connected, `PLAY` and the speed dial's push show the deck's locked grey, and the strip says `XL NOT CONNECTED`.
- **Nothing on the prompter:** every prompter control is grey.
- **Following the app:** the deck changes page when the app's page changes, and its page keys move the deck alone. As the deck works today, it can therefore stay on PROMPTER while the screen shows Cameras.

## 10. What is armed (D11)

Only three things are armed, because each changes what the presenter reads: **Replace on the prompter**, **Update the prompter** and **Clear the prompter**. They use the design system's arm: the key gets an amber keyline and counts down 4.5 s, and a second press between 0.35 s and 4.5 s applies it. Esc still cancels and is never shown (D6).

Not armed:

- Put on the prompter: on a blank prompter, nothing is replaced.
- everything in §5.
- changes to the look.
- edits, which change Studio Control's copy (§6.3).
- Remove, which moves a script to Removed.

Delete for good… asks in a dialog, like Delete fixture… on Lighting.

## 11. What must never happen (D12), and how the design prevents it

| Never                                        | How                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| show the script anywhere but the Prompter XL | The window opens only on a screen named `Prompter XL`. Unplugged, the window closes and never moves. There is no fallback, no preview window and no network view. Tests and lanes draw into an ordinary window (D15 rule 4), and a Part C test proves the name check |
| move Studio Control off display 3            | Studio Control holds its window on display 3 by the screen's identity and puts it back if Windows moves it when a screen is plugged in or out                                                                                                                        |
| jump                                         | Only the operator's keys, dials and presses move the place. A file changing on disk, an archive restore and an edit change nothing on the prompter. Update keeps the words at the reading line                                                                       |
| lose its place                               | The place is stored as words, not pixels (§5.2), and saved about once a second while scrolling and at every change. Unplugging pauses at the place. After a crash while scrolling, the text comes back less than a line early                                        |
| scroll by itself                             | The prompter is paused after every start: opening Studio Control, opening the page, plugging the Prompter XL in, a restart, a crash, a restore. Only `PLAY` and the speed dial's push start the scroll. At the end, the scroll stops and stays stopped               |
| lose a script                                | Every edit is saved within a second. Earlier versions, Removed, both kinds of backup, and archive restores that add scripts and never remove them (§3.3) keep every script                                                                                           |

## 12. What it deliberately does not do

- **Follow the presenter's voice.** It would scroll by itself (D12). It would also need a microphone and a speech model on this PC, and it mishears names and pauses. The operator sets the pace (D9).
- **Give the presenter a remote** (foot pedal, hand clicker). The operator runs the prompter (D9). Those remotes are keyboards to Windows, and Studio Control binds no keys (D6).
- **Mirror or flip.** The Prompter XL flips the picture itself; a second flip would make the text read backwards.
- **Show the script on another prompter, screen, preview window, phone or tablet.** D12 forbids it, and the prompter needs no network at all.
- **Edit live on the glass, or reload a changed file by itself.** Either would move the text under the presenter's eyes.
- **Stop at cues, loop, rewind at the end, or start with a recording** (`REC` or vMix). Each would be a scroll or a jump the operator did not make.
- **Keep Word's look.** Fonts and colours are chosen for a page, not for a glass 2 m away. The look is set once, for the presenter.
- **Import PDF, `.doc` or RTF, or anything from the network** (§3.1).
- **Show the presenter a clock, a countdown or messages.** The glass carries the script only; the operator's time left is on the page and the deck.
- **Set the Prompter XL's brightness or other settings.** Windows does not report them, and only reported values are shown.
- **Keep several looks.** There is one presenter and one look (§14).

## 13. What the walk checks (Appendix B)

| Item | Check                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 13   | The script reads right in the glass (not mirrored), shows nowhere else, and Studio Control stays fullscreen on display 3                      |
| 14   | Unplugged, the page says `NOT CONNECTED` and no other screen shows the script. Plugged back in, the script returns at the same place, paused  |
| 15   | A `.docx` and pasted text load, and the import sentence counts what was left out. Replacing the script on the prompter needs the second press |
| 16   | Play, pause, speed, position, size and the jumps work from the page and from the deck, and the scroll is smooth at the speeds used            |
| 17   | After Studio Control is closed and reopened, the script and the place are still there, paused                                                 |

One risk to walk on purpose, under item 16: a full-screen scroll changes every frame, and DisplayLink compresses each changed frame on this PC's processor. The standard look (black background, plain text) is the cheapest picture it can carry, but only the walk can show the scroll is smooth. It should be walked with the Cameras page open and decoding its three pictures.

## 14. Open questions for the operator

1. Where do the scripts come from today: Word, Google Docs, or the home-built program? Does that program hold scripts worth bringing over, and in what format?
2. How far from the glass is the presenter? That distance sets the standard size: 88 px is comfortable to about 2 m, and 3 m needs about 132 px for the same comfort.
3. Should speed be in words a minute (proposed) or on a plain 1–10 scale?
4. Should `BACK` go to the start of the paragraph (proposed) or back a fixed few lines?
5. Should a jump keep the text scrolling (proposed), or always pause it?
6. White or yellow text? Should text already read be dimmed (proposed: on)?
7. The PROMPTER page has spare keys. Should they be `◂ CUE` and `CUE ▸`? And is a `PLAY` key needed on the CAMERAS page, for a take run from the Cameras tab?
8. Is a Blank key wanted (one press hides the text for a moment and keeps the place), or is Clear enough?
9. Is the Prompter XL always plugged in? If it is put away between shows, a red `NOT CONNECTED` stays in the header all day, and amber would fit better.
10. Does Elgato Camera Hub run on this PC (it installs the DisplayLink driver)? If so, its own prompter feature must stay off, or two programs will draw on one screen.
11. When Studio Control is closed, the Prompter XL shows the Windows desktop. Should that screen get a black desktop background?
12. Is a "fit to time" key wanted, which sets the speed so the script ends in a given time (say 3:00)?
