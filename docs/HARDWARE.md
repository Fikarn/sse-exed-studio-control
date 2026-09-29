# Hardware

The studio's devices, how Studio Control reaches each one, and the rules that keep tests away from them. Operation and recovery: [OPERATIONS.md](OPERATIONS.md).

## The room

- **Workstation.** One PC, Windows 11, for development and for the studio. Smart App Control is off and must stay off: the app is not signed.
- **Display.** The app runs fullscreen on the studio display: 2560×1440 at 100 % Windows scaling. It opens on the display it was last on, found by its place on the desktop, else on that one. `Reset the window layout` in Setup / Support › Workstation puts it back.
- **Keep that display at 100 %.** The primary display is the same size at 125 %, and the scaling tells them apart. Windows' display numbers can change, so the app goes by a display's place, size and scaling before its number. The studio display stands at x 2560: the window is right when it covers x 2560 to 5120, y 0 to 1440.
- **Networks.** `Ethernet 2` is the office network (`172.16.16.0/21`), with the BGH1s. `Ethernet 3` is the lighting network (`10.1.0.0/16`), with the Apollo Bridge. Both have a default route, the office's first: with the office network down, a packet to an unknown address leaves towards the bridge. That is why nothing here may send to an address nobody typed, and why the two shell lanes run in CI only.
- **Beside the app** run TotalMix FX, Bitfocus Companion and vMix.

## Devices

| Device                     | For                   | How the app reaches it                   | Set up in          |
| -------------------------- | --------------------- | ---------------------------------------- | ------------------ |
| RME Fireface UFX III       | Audio console         | OSC over UDP to `127.0.0.1:7001`–`7004`  | TotalMix FX, Setup |
| Litepanels Apollo Bridge   | Lights                | sACN over UDP to `10.1.0.1:5568`         | Setup, the bridge  |
| Stream Deck+               | Keys and dials        | Companion calls `http://127.0.0.1:38201` | Setup, Companion   |
| Blackmagic Pocket 6K Pro   | `CAM 1`, main camera  | Bluetooth                                | Setup              |
| Panasonic LUMIX BGH1 (two) | `CAM 2`, `CAM 3`      | Ethernet, to the address in Setup        | Setup              |
| vMix                       | The cameras' pictures | NDI, from vMix on this PC only           | vMix, Setup        |
| Elgato Prompter XL         | Teleprompter          | A Windows display named `Prompter XL`    | Windows            |

## Audio console

The app talks to the console's mixer, TotalMix FX 2.1 or newer (for Global OSC). Front preamps 9–12 are the live inputs; rear line inputs 1–8 are secondary. The outputs are Main, Phones 1 and Phones 2.

In TotalMix FX, `Options › Settings › OSC`, four remote controllers are `In Use`, each with the address `127.0.0.1`:

- Remote 1: port incoming `7001`, port outgoing `9001`. Hardware inputs.
- Remote 2: `7002`, `9002`. Software playback.
- Remote 3: `7003`, `9003`. Hardware outputs.
- Remote 4: `7004`, `9004`, in `Global OSC` mode. Control and metering.
- Remotes 1 to 3 have `Send Peak Level Data` on. They are the meters' fallback, and remote 1 carries EQ and Low Cut.
- Remote 4 has `Send changes` on, `Follow Submix` off and re-sending off. The engine reads each value back itself.
- In the Channel Layout, keep the channels in use visible, or turn on `Receive on hidden channels`. A hidden channel drops writes silently.

Setup holds the TotalMix address `127.0.0.1`, the send port `7001` and the receive port `9001`. The other ports are these plus 1, 2 and 3.

The engine listens on UDP `9001`–`9004`, bound to `127.0.0.1`, and reads only what comes from the TotalMix address. `netstat -an | findstr 900` shows the four ports.

What the app never does:

- A snapshot recall never sends 48 V. Each difference is listed, then armed and confirmed per channel.
- `Sync from TotalMix` only reads.
- Nothing is written while the audio probe has not passed or OSC is off in Setup.
- Closing the app recalls and resets nothing.

Talkback is not used, and the app has none: it sends TotalMix no talkback and reads past the desk's report of it.

Measured on the studio's desk (2026-09), for whoever probes by hand or reads a log:

- Channels count from 0, and the right side of a stereo pair is the left plus 1. The outputs are 0/1 Main, 8/9 Phones 1 and 10/11 Phones 2.
- TotalMix never echoes a write to the remote that sent it. It must be asked (`/sendchan/<input|playback|output>/<ch>`, `/sendsubmix/<out> 2` then `/sendstate`, `/sendsettings`), and answers in one burst about 30 ms later.
- A dump gives a fader in dB, never as a position. `/sendsubmix 2` sends nothing for a mix with no send above −65 dB. `/sendall 2` is 3,100 to 3,500 messages.
- `/output/0/volume` in a dump is the level after dim (−20 dB), so the fader is set before dim is switched off.
- TotalMix sends to a remote only while it hears from it. A command marked `(f)` in RME's table ignores a value under 0.5.
- Playback 1/2 is Windows' sound and 3/4 is vMix's. Input 9, `Host`, has 48 V on: compare with the state read before, never with "off".
- The desk's reference state is TotalMix's own snapshot `mix 1`: Main Out at 0 dB, dim off. The owner loads it; the app and the assistant never do.

## Lights

The engine streams to the Litepanels Apollo Bridge as unicast sACN (E1.31) on UDP port `5568`. The bridge drives the fixtures: Litepanels Astra Bi-Color Soft, Aputure Infinimat 2x4 and Aputure Infinibar PB12.

- The bridge is at `10.1.0.1`. Setup's lighting probe connects to it on TCP port `80`.
- Setup holds the bridge address and the universe, `1` unless changed. New saved data has no address, so nothing is sent.
- The bridge must route that universe to its DMX/CRMX output. Each fixture's DMX address, mode and universe must match its patch on the Lighting page.
- The stream has priority `100` and the source name `SSE ExEd Studio Control`.

`Held` means nothing is sent: no frame, no keep-alive. It is not a blackout: the rig keeps its last look. The DMX monitor shows what would be sent, the header's Lighting lamp reads `held`, and so does the Lighting page (`HELD`). A light output that could not open its port reads `no output`, red.

`Armed` means the rig follows the app. Arming sends the current state within 40 ms.

The switch is `Light outputs` in Setup / Support › Workstation. A start with `SSE_SAFE_START=1` holds the outputs before anything is sent. Set for the Windows account (`setx SSE_SAFE_START 1`), it holds every start. A hold is saved, so later starts are held until the switch arms. Saved data that has never been held is armed. Every restore comes back held, a database backup's and an archive's alike: no backup brings its own setting back.

## Stream Deck

Bitfocus Companion, on this PC, drives the Stream Deck+. Its connection `SSE_Studio_Control` calls the engine's bridge at `http://127.0.0.1:38201`.

- The bridge listens on `127.0.0.1` only and has no fallback port. `SSE_CONTROL_SURFACE_PORT` names another port.
- Every request must carry the bridge token. The app makes it once, as `control-surface.token` in the app-data folder, and writes it into the exported profile. Do not share that file.
- `401` in Companion's log means the profile's token is missing or wrong: export and import again.
- The profile asks for every display once a second, a connection each: 43 of them. A few thousand sockets in `TIME_WAIT` on port `38201` are normal.
- A display never reads a camera by itself. The hardware link reads the cameras once for all the displays of a poll, as the open Cameras page does once a second, and once for a key, whose own read answers its displays.
- `REC` on the deck starts a take with one press and stops it with two, and with nothing else: a press that arrives twice is one press, an armed stop stops the take it was made for and no other, and a press starts no take while the key can still read `STOP?`.
- `All Off` and `Del Scene` ask as `REC`'s stop does: `OFF?` or `DEL?` for 3 s, and the second press acts only on the rig the first asked about. `PLAY`, `DIM`, a mute and `Toggle` drop a second press within 350 ms. The hardware link keeps the arm and the moments in memory: a new build with an old profile arms the two keys without showing it, so the build and the profile go together.
- Companion's generic-http connection tries a refused `GET` again, twice, and a `POST` never: a display recovers, a refused key press is lost.
- It stores a reply only in a custom variable that exists already, so the profile brings its own.
- The bridge writes one refusal line a minute at most for each status, and counts the rest in it. A key a page refuses (`REC` while CAM 1 is released) is a `WARN` line of its own in `engine.log`, with the key and the reason: one a second at most for each key, counting the rest.
- Companion can press a key without hands (`POST http://127.0.0.1:8000/api/location/<page>/<row>/<column>/press`). With the studio's app running, that drives the real devices.

To put the profile on the deck:

1. Start Companion. The export asks it for the deck, at `http://127.0.0.1:8000`.
2. In Setup step 1, export the Companion profile. It lands in the app-data `exports` folder.
3. In Companion's Import / Export page, import it with `Full Reset & Import`, never `Import Preserving Unselected`.
4. In Setup's Verify step, press each control: its cell pulses.

The pages are `LIGHTS`, `AUDIO`, `CAMERAS` and `PROMPTER`, in the order of the app's tabs. The deck follows the app's page, and each page has one page key, to the page after it; `PROMPTER`'s goes round to `LIGHTS`. When the pages change, export and import again: the deck has the two new pages only after the next import.

## Cameras

- **`CAM 1`** is the Blackmagic Pocket Cinema Camera 6K Pro, the only camera that records. Its link is Bluetooth, with Blackmagic's published protocol (service `291D567A-6D75-11E6-8B77-86F30CA893D3`). It is paired once, in Setup: the camera shows a 6-digit PIN.
- **`CAM 2` and `CAM 3`** are Panasonic LUMIX BGH1s on the office network, powered over Ethernet (`172.16.16.85` and `172.16.16.30` when last read). Their link is Panasonic's LUMIX SDK. The SDK takes no address: it finds cameras by an SSDP search from every network adapter, and the app connects only to a found camera whose address is typed into Setup (D29). A LAN connection has a password, which a reset of the camera's network settings clears. The SDK's licence is read first.
- `Release` hands `CAM 1` to the iPad (Bluetooth+), and lets a BGH1 go. `Connect` takes it back. After LUMIX Tether has held a BGH1, the SDK cannot connect to it until its network settings are reset in its menu (Panasonic's note).
- **Pictures.** Each camera's HDMI goes to vMix: `CAM 1` into the DeckLink 8K Pro, one BGH1 through an SDI converter into the DeckLink, the other into a Cam Link 4K. The app gets pictures only as NDI from vMix on this PC. vMix's NDI option for cameras (`Settings › Outputs`) must be on, and Setup holds each camera's vMix input. There is no OBS path.
- **Not built yet:** the links and the pictures. Until a camera's link is built, the Cameras page reads it `NOT SET UP`, and Setup takes its vMix input and neither its pairing nor its address. The page's pictures are test pictures.

What limits the design:

- A DeckLink input belongs to one program at a time, so the app never opens one.
- A BGH1's own network stream switches off its recording, its menus and LUMIX Tether's live view, so it is not used.
- A write to the Pocket's status characteristic can switch the camera off.
- The app never changes a camera or a recording by itself. A start, a reconnect, a restore, a close and a crash send nothing. The camera wins a disagreement.

## Teleprompter

- The Elgato Prompter XL is a 1920×1080 screen on one USB-C cable that carries picture and power (15 W). Windows treats it as one more display, named `Prompter XL`.
- Studio Control knows it by that name and by nothing else. `shell.log`, in the logs folder, names every screen as Windows does, at the start and whenever a screen comes or goes: `The screens: … Prompter XL 1920×1080 at 5120,0. The Prompter XL is connected, 1920×1080 at 60 Hz.` A Prompter XL that Windows calls otherwise reads there under the name it has.
- Plugging it in or out leaves Studio Control on the studio display: if Windows moves the window, it is put back a second or two after the screens have stopped changing.
- The studio display switched off, or asleep, is away from Windows' desktop, and Windows moves the window to another screen. Studio Control remembers its display, by the screen's own name, and goes back to it when it returns. **Studio fullscreen** in Setup / Support makes the display the window is sent to its own.
- The app finds it by that name and draws the script there and on no other screen, in a window of its own that fills the screen. The window is put there only once it stands on the Prompter XL's part of the desktop, and it is hidden at once when Windows moves it: Windows moves the windows of a screen that goes.
- The window's page tells the app once a second that it draws. The hardware link hears that the Prompter XL is connected only while it does, so `PLAY` unlocks only with the script on the glass. A page that stops is `NOT SHOWING`, and its window is opened again.
- `shell.log` says each step: `The prompter's window opened on the Prompter XL: 1920×1080 at 5120,0.`, `The prompter's page draws.`, `The hardware link has the Prompter XL as CONNECTED.`
- The taskbar: a window that takes no keyboard cannot ask Windows to hide a taskbar under it. If a taskbar shows on the Prompter XL, switch it off for that screen in Windows' taskbar settings (taskbar behaviours, show my taskbar on all displays).
- The Prompter XL flips what it shows, so the app draws the script unmirrored.
- In Windows' display settings it extends the desktop at 1920×1080. Otherwise the page reads `DUPLICATED` or `LOW RESOLUTION`.
- Set by hand: a black desktop background on the Prompter XL, and Elgato Camera Hub's own prompter off, if Camera Hub is installed.

## Safety rules

The studio build is a build `npm run release` made, which the owner starts on the real saved data. Every other build is a development build.

Always:

- Never let a test write to TotalMix's ports `7001`–`7010` or to the sACN bridge.
- Give every test and development run its own data folder (`SSE_APP_DATA_DIR`), the simulated console (`SSE_AUDIO_SIMULATED_INPUT_MODE=1`), the simulated cameras (`SSE_CAMERAS_SIMULATED=1`), the simulated lights (`SSE_LIGHTS_SIMULATED=1`), a safe start (`SSE_SAFE_START=1`) and a bridge port other than `38201` (`SSE_CONTROL_SURFACE_PORT`). `npm run app` and the test lanes set them all, and a development build takes the safe value of any that is not set.
- Open the real saved data, `%APPDATA%\ExEd Studio Control Native`, only with the studio build. A development build refuses it.
- Do not close TotalMix FX, Companion or vMix. They are the owner's to start and stop.
- Never write the Pocket's status characteristic.
- Never scan the network. Talk only to the addresses typed into Setup.

Cameras and the prompter, the six rules the code's comments cite as D15:

1. Use a camera address only once the owner has typed it into Setup. Test builds refuse any address that is not on this PC.
2. Use Bluetooth only in the studio build. Pair once, in Setup, with the owner present.
3. Never open the DeckLink, the Cam Link or a camera stream from a test. Tests get a still test picture.
4. Draw on the Prompter XL only from the studio build. Anything else draws into an ordinary window: a development build's prompter is a window with a frame, wherever the Prompter XL is, and the hardware link is told of a screen of 1920×1080 so that the prompter can be tried.
5. Check against the real cameras only with the owner present and nothing recording. Put back every setting touched.
6. Learn the BGH1's protocol by listening only, and only with the owner's go-ahead at the time.

## Hardware tests

Tests that need a real device are opt-in: `npm run native:test:hardware`. Run them only when the owner asks and is present. Today's one test reads the console and changes nothing. It needs the app closed, because it binds `127.0.0.1:9004`, and `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`.
