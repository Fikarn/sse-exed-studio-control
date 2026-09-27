/**
 * A request the hardware link answered with an error: the sentence is the error's
 * message, and `code` is the hardware link's code for it (`INVALID_PARAMS`, a
 * `PROMPTER_*` refusal, …). Both transports throw it — the Tauri transport with the
 * response's `error.code`, the fixture double with the code the hardware link would
 * give — so a page can tell one refusal from another on either (review of 2026-09-27).
 */
export class EngineRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineRequestError";
    this.code = code;
  }
}
