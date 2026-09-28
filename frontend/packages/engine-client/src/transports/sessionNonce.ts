/**
 * A nonce for one page's requests, so the ids of one webview session never
 * collide with ids still pending in the shell from an earlier one (a reload
 * restarts the sequence at 1 while the shell process lives on), nor with
 * another window's.
 */
export function createSessionNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
