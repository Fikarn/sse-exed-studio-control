# The Session page, step 2: the session's folder and the disk

Written 2026-10-17. This note goes with board 3, `docs/design/boards/session-3.html`: board 2 with what the owner asked next. The owner answered the seven questions on 2026-10-18 (section 6): the root is a new `D:\Sessions`, and every other answer is the recommendation. Built in four pull requests (section 5); the decision is D52.

The owner asked for two things in the window that opens when a kind of session is chosen:

- create or choose a **session folder** on the PC, where everything the session needs is kept: vMix's recording, scripts, PowerPoints and the like;
- see the **space left on the disk**.

**To see it:** open `http://127.0.0.1:4190/session-3.html` from the browser pane's `design-boards` entry. The corner panel switches:

- **Window:** Step 2 (this note) or Step 1 (as built, #353);
- **Folder:** New, or An existing one;
- **Disk D::** 2.05 TB free, Low or Nearly full;
- **vMix:** Records here, or Elsewhere (in the running session's window);
- Moment, Kind and Notes, as on board 2.

## 1. What the studio does today

Read on the PC on 2026-10-17.

- **The folders.** Sessions are kept in dated folders named `<name> (YYYY-MM-DD)`.
  - The newest are under `D:\All\`: 9 of its 15 folders are dated. The rest are series or programmes, each holding its parts.
  - Older ones are on the Desktop.
  - Each holds what that session needed: vMix's recording, renders or exports, the Pocket's clips, audio from Audition, slides. Their subfolders differ from session to session.
  - They hold between 4 and 153 GB each.
- **vMix.** vMix 29 records 4K in its own codec, into a path set by hand in its Recording settings for each session. Today's path points into a dated folder's `VMIX Recording`.
  - vMix's API starts and stops a recording, but no function sets where it goes.
  - vMix does report the file it records to, in its state (`<recording filename1="…">`).
- **The Pocket.** CAM 1 records Blackmagic RAW onto its own SSD. That is the Samsung T7 Shield, `E:` `A015` when plugged into the PC, with 308 GB free of 931. Its clips are copied off afterwards.
- **The drives.**

  | Drive            | What it is                        | Free            |
  | ---------------- | --------------------------------- | --------------- |
  | `C:`             | the system                        | 1.59 TB of 3.81 |
  | `D:` `Storage 1` | the sessions                      | 2.05 TB of 3.82 |
  | `E:`             | the Pocket's SSD, when plugged in | —               |
  | `Z:` `Public`    | the network share                 | 3.7 TB of 17.4  |

## 2. The idea

- **Begin makes the folder,** as it begins the session. Choosing makes nothing (session.md §6).
- **The window grows sideways, not taller:** 1680 × 620, so the Room keeps its own size.
  - At the left, the session: its name, and the last session of its kind.
  - At the right, where it goes: the folder, and the disk it is on.
  - Under both, only what needs the operator first; Cancel and Begin at the foot.
- **The later steps** (the preset, Before you roll) would make the window taller, as board 2's Later steps shows.

## 3. The parts

| Part                         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new folder                 | `D:\Sessions\` over the folder's name, `<name> (YYYY-MM-DD)` as the studio names its folders, following the session's name as it is typed. The first Begin makes `D:\Sessions` itself. A character Windows refuses becomes a dash. Without a name the folder takes the kind's (`Podcast Recording (2026-10-17)`). `Change…` puts it inside another folder, a series', through Windows' folder dialog. A folder that already has the name, such as a second session of that name the same day, is used as it is. |
| Its subfolders               | Made with it, one set for each kind and chosen once in Setup / Support. The board's are examples: podcast `Audio`, `Video`, `vMix Recording`, `Exports`; green screen `Video`, `vMix Recording`, `Script`, `Exports`; webinar `Slides`, `vMix Recording`, `Exports`.                                                                                                                                                                                                                                            |
| A folder that exists         | The last session of this kind's folder first, chosen to begin with: a second day of a shoot, a retake. Then the root's newest other folder. `Choose another folder…` opens Windows' folder dialog for anything else, a session in `D:\All` from before among them. Nothing is made.                                                                                                                                                                                                                             |
| The disk                     | The drive the folder is on: its free space of its size, with a bar. Then how long that lasts at the rate of the last session of this kind, which is its folder's size over its length, so no codec or bitrate is guessed. It reads `LOW` (amber) under 200 GB and `NEARLY FULL` (coral) under 50 GB.                                                                                                                                                                                                            |
| The running session's window | Its folder, with `Open the folder` (Explorer, on the other screen). Whether vMix records into it, with `Copy the path` when it does not. The disk, with vMix's write rate while it records.                                                                                                                                                                                                                                                                                                                     |
| The footer                   | `Disk 2.05 TB free on Storage 1`, beside the day's takes, the last sync and the backup, on the Session page and on the Overview.                                                                                                                                                                                                                                                                                                                                                                                |
| The header                   | A `Disk` chip on the system's platter, only while the drive is low or nearly full, as the `Backup` chip appears only when something is wrong. It opens Setup / Support.                                                                                                                                                                                                                                                                                                                                         |
| Setup / Support              | The root (`D:\Sessions`), each kind's subfolders, the two thresholds, and every drive with its space. Not drawn on the board.                                                                                                                                                                                                                                                                                                                                                                                   |

## 4. What the app cannot do, and what it does instead

- **Point vMix at the folder.** vMix's API has no function for its recording path. So the app copies the path for vMix's Recording settings, and checks the file vMix reports against the session's folder.
  - Not taken: writing vMix's settings file. It is unsupported, and vMix keeps its own copy.
  - Not taken: moving the recordings into the folder after a take. That would touch the operator's files; if ever, it is a later step with a review.
- **Fill the folder.** Studio Control makes folders, and never moves or deletes a file in them.
  - Audition's sessions, the slides and the scripts go in by the operator's hand.
  - Copying CAM 1's clips off its SSD into the folder is a later step of its own.

## 5. The hardware link's part

What the note proposed for the plan, below. The plan of 2026-10-19 decided it and more, and four pull requests built it (#354 the folder, #355 the sessions' watch, #356 the shell's folder dialog and `Open the folder`, #357 the page): the decision is D52 in `docs/ROADMAP.md`, and the contract's Session section in `native/protocol/v1.md` says how it works. Beyond the note: the settings stand under `session.`, outside the archive; a development run, a test and the release's trial make their folders beside their own saved data and never read vMix; the drives are read through Windows every 30 s, each with 2 s to answer, and the snapshot never reads a disk; Setup / Support's `Sessions` screen was built without a board (the owner's word, 2026-10-19).

- **Settings:** the root (`D:\Sessions`), each kind's subfolders, the two thresholds (200 and 50 GB).
- **`session.begin` takes the folder:** either "a new one there" or the path of one that exists. The session keeps its folder, and the action log's row names it.
  - The first Begin makes the root when its drive is there.
  - A refusal when the root's drive is missing, or a folder cannot be made.
- **A read of the drives:** each drive's label, free space and size, with the root's drive marked; read every 30 s and at Begin. With it, the root's newest folders.
- **A read of vMix's state** over its API (`http://127.0.0.1:8088/api`, read only), for the file it records to.
- **A development build never makes a folder in the studio's root.** It has a scratch root of its own, as it has saved data of its own.
- **One review:** this writes saved data and makes folders on the studio's disk.

## 6. Questions for the owner

**The owner's answers (2026-10-18), one by one:**

1. The root: **a new `D:\Sessions`**, not the recommendation. The sessions from before stay in `D:\All`, reached through Windows' folder dialog.
2. The name: `<name> (YYYY-MM-DD)`, the kind's name when the session has none (the recommendation).
3. The subfolders: a list for each kind, the board's (the recommendation).
4. An existing folder: the kind's last folder and the newest other, with Windows' folder dialog (the recommendation).
5. The folder is made at Begin (the recommendation).
6. Low under 200 GB, Nearly full under 50 GB (the recommendation).
7. vMix: copy the path and check it (the recommendation).

The questions stay below as the record. Each had a recommendation.

1. **The root.**
   - **Recommended:** `D:\All`, where the sessions go today.
   - **Otherwise:** a new `D:\Sessions`, kept for the app's folders alone.
2. **The folder's name.**
   - **Recommended:** `<name> (YYYY-MM-DD)`, as today; the kind's name when the session has none.
   - **Otherwise:** say which.
3. **The subfolders, kind by kind.**
   - **Recommended:** the board's lists, above.
   - **Otherwise:** your own lists. Today's folders also have `Converted`, `Renders` and `BMPCC 6K Pro`.
4. **An existing folder.**
   - **Recommended:** the last session of the kind's folder and the newest other, with Windows' folder dialog for the rest.
   - **Otherwise:** Windows' dialog alone.
5. **When the folder is made.**
   - **Recommended:** at Begin.
   - **Otherwise:** at a `Create` key in the window, before Begin.
6. **The disk's thresholds.**
   - **Recommended:** Low under 200 GB and Nearly full under 50 GB. At the last podcast's rate that is about 4 hours and 1 hour.
   - **Otherwise:** your numbers.
7. **vMix.**
   - **Recommended:** copy the path for vMix's Recording settings, and check the file vMix records to.
   - **Otherwise:** leave vMix out of step 2.

## 7. Not in step 2

- Copying CAM 1's clips off its SSD into the folder.
- The presets, the rig's scene and TotalMix's snapshot at Begin, and Before you roll (board 2's Later steps).
- Moving a finished session to Public (`Z:`).
