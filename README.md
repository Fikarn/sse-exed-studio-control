# Studio Control

A desktop app that runs one studio from one screen: the lights, the audio console, the Stream Deck, the teleprompter and the cameras. It is built for a single workstation (Windows 11, one display at 2560×1440, fullscreen) and for working under time pressure during a live session.

It is developed by one person, working with Claude. Nothing here is packaged for anyone else to install.

## How it is built

- **Engine** (`native/rust-engine`, Rust): state, saved data and every device.
- **Shell** (`native/tauri-shell`, Tauri 2): the window; it starts the engine and watches it.
- **Pages** (`frontend/`, React and TypeScript): what the operator sees.
- **Contract** (`native/protocol`): the requests and events between the engine and the pages.

## Start here

| To                           | Read                                         |
| ---------------------------- | -------------------------------------------- |
| Work in this repository      | [AGENTS.md](AGENTS.md)                       |
| See what is next             | [docs/ROADMAP.md](docs/ROADMAP.md)           |
| Run, test and debug          | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)   |
| Understand the design        | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Set up or check the hardware | [docs/HARDWARE.md](docs/HARDWARE.md)         |
| Operate the studio           | [docs/OPERATIONS.md](docs/OPERATIONS.md)     |
| Verify a build in the studio | [docs/CHECKLIST.md](docs/CHECKLIST.md)       |

## Quick start

```bash
npm install
npm run dev:check
```

`npm run dev:check` runs the code checks and the unit tests in under a minute. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the rest.

## Licence

See [LICENSE](LICENSE).
