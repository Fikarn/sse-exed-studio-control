# The new pages' boards (C0, D19 and D20) — 2026-09-26

Six Concept A boards for the two new pages, three each, drawn at 2560×1440 for the operator to choose from (D19), and the Teleprompter's functionality written out (D20, [teleprompter-2026-09.md](./teleprompter-2026-09.md)). They are design mocks: nothing in the app changes until a board is chosen and Part C's slices are written. Each board was drawn by one designer, critiqued against Concept A (`system-a-2026-09.md`), the decisions D10–D14 and D17, and revised; each fits 2560×1440 in every state and theme (measured).

**To look at one:** open the file in a browser at 2560×1440. `?theme=studio|graphite|bone` picks the theme, `?state=<name>` the state; each board has a small state switcher of its own (not part of the app).

## Cameras

| Board                                                  | The idea                                                                                                                                                                                                                                                                                                                                   | States |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [A-cameras-1.html](./assets/concepts/A-cameras-1.html) | **Three monitors.** The three pictures side by side, the same size (552 × 311), each with the values its camera reports under it; below them the selected camera up close — a 1:1 loupe for focus beside a waveform for exposure. REC for the main camera and the camera keys in the cluster; the selected camera's settings in the plate. | 14     |
| [A-cameras-2.html](./assets/concepts/A-cameras-2.html) | **Hero and two.** The camera being looked at fills the bay (1680 × 945, or 1:1 pixel for pixel); the other two small. Looking and setting are separate: pressing a small picture only looks, the camera keys (the deck's CAM 1–3) choose what the dials set. Picture aids proposed: focus peaking, zebras, false colour, framing guides.   | 17     |
| [A-cameras-3.html](./assets/concepts/A-cameras-3.html) | **Camera console.** Each camera is a strip like the Console's: picture on top, then exposure, colour and focus as desk controls, then its format and who holds it; a 1:1 focus check in the plate. `?plate=0` shows larger pictures without the plate.                                                                                     | 11     |

## Teleprompter

| Board                                                            | The idea                                                                                                                                                                                                                    | States |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [A-teleprompter-1.html](./assets/concepts/A-teleprompter-1.html) | **Live mirror.** Most of the bay is a copy of what the Prompter XL shows (unmirrored), with the place and the time left above it and the whole script as one bar below; the cluster runs the take; the editor in the plate. | 11     |
| [A-teleprompter-2.html](./assets/concepts/A-teleprompter-2.html) | **Editor first.** The bay splits into the script editor and a smaller live copy (40 %): built for preparing and adjusting between takes; the running keys in the cluster.                                                   | 14     |
| [A-teleprompter-3.html](./assets/concepts/A-teleprompter-3.html) | **Rundown.** The scripts as a rundown in order, each jump showing how far away it is at this speed ("in 2:26"); the live copy beside it; large running keys for a take.                                                     | 13     |

## Decisions the boards raise

The operator's choices, beyond picking one board per page (D19):

1. **Recording's colour.** The boards differ: lit green (the system's "live", as a held talkback is drawn) or a red lamp and the word REC (the camera's own tally, drawn like the 48 V warning — a red lamp and word, never a red fill).
2. **Release.** One press, or press twice? It hands a camera back to the iPad or LUMIX Tether, and for the main camera while it records it takes the page's STOP away. D18's open question (does a BGH1 return to LUMIX Tether without a settings reset?) decides what Release can promise.
3. **The picture aids.** Focus peaking, zebras, false colour, a 1:1 loupe and a waveform are proposals (computed on this PC from vMix's picture, never sent to a camera or to vMix). Wanted, and which?
4. **Looking and setting.** Does pressing a picture choose the camera the dials set (boards 1, 3), or only show it (board 2)?
5. **The Teleprompter's copy on this screen.** Every board shows the operator a copy of what the glass shows. D12 says the script is shown "nowhere but the Prompter XL", and Appendix B items 13–14 check it. Is the operator's own copy on display 3 allowed — and while the Prompter XL is unplugged, does the copy stay (dimmed) or go dark?
6. **Updating the prompter.** Editing the script that is on the glass changes only Studio Control's copy until "Update the prompter". Is Update armed (press twice, as drawn — D11 arms replacing the script on the glass) or one press?
7. **At the end of a script.** PLAY locks until TOP (as drawn), or TOP and play?
8. **The header.** Cameras and Teleprompter bring two more status lamps to the header on every page (five in all): keep all five, or fold some together? This moves every board of the app.
9. **A switched-off camera** reads UNREACHABLE (the system's word) on the boards, while Appendix B item 12 says "not connected": the ledger's wording would follow the board.
10. **D20's own questions** ([teleprompter-2026-09.md](./teleprompter-2026-09.md), the end): where the scripts come from today; how far the presenter stands from the glass (it sets the standard text size, 88 px to about 2 m, about 132 px for 3 m); words a minute or a 1–10 scale; whether a jump keeps the scroll going; white or yellow text; whether a Blank key is needed; whether Elgato Camera Hub runs on this PC.

## For C0's research (D18)

Facts the boards assumed, to confirm with the LUMIX SDK and the Pocket 6K Pro's Bluetooth service before Part C: which values the SDK **reports back** from a BGH1 rather than only accepts (exposure and white-balance modes, the frame rates and resolutions it lists, a focus position); whether the Pocket's service carries timecode and reports focus as a lens position; whether the Pocket's display LUT reaches its HDMI output (and so the picture vMix sends); which vMix input carries which camera, at what NDI resolution.
