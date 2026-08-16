import type { BackgroundMessage, BackgroundReply } from '../shared/protocol';

/** Reloading the extension leaves old content scripts with a dead port. */
const DEAD_PORT = /context invalidated|Receiving end does not exist/i;

/**
 * Never rejects. Menu handlers are fire-and-forget (`() => void action()`), so
 * a rejection here would be swallowed as an unhandled rejection and the click
 * would look like it did nothing at all.
 */
export async function ask(
  message: BackgroundMessage
): Promise<BackgroundReply> {
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundReply;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: DEAD_PORT.test(reason) ? '扩展已更新，请刷新页面后重试' : reason
    };
  }
}
