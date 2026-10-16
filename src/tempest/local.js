// -----------------------------------------------------------------------------
// The local channel: the datagrams the Tempest hub broadcasts on the LAN.
//
// The hub sends every message in UDP broadcast to port 50222, no account and
// no Internet needed. But an integration container sits on a bridge network
// that LAN broadcasts never reach: the Gladys core, on the host network,
// captures them for us ("mediated network discovery", manifest field
// `network_discovery`, `gladys.scanNetwork('udp-broadcast')`).
//
// A capture lasts at most 30 s, so the listener chains them: one capture ends,
// the next one starts. The wind every 3 s, the observation every minute and
// the rain and lightning events all come through.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { decodeMessage } from './protocol.js';

const logger = createLogger({ name: 'local' });

export const TEMPEST_UDP_PORT = 50222;

// Longest capture the core accepts. index.js raises the SDK request timeout
// above it, or the HTTP call would give up first.
export const CAPTURE_SECONDS = 30;

// After a failure, wait before capturing again: longer when the core says it
// will never work (403: an older Gladys, or the capture is not declared).
const RETRY_MS = { rateLimited: 10 * 1000, failed: 30 * 1000, forbidden: 5 * 60 * 1000 };

/** Decode the raw results of an `udp-broadcast` capture into Tempest messages. */
export function decodeCapture(results) {
  const messages = [];
  for (const result of Array.isArray(results) ? results : []) {
    // The core captures the declared port only; whatever else shares it is
    // not a Tempest JSON message and decodes to null.
    const message = decodeMessage(Buffer.from(result?.payload_base64 ?? '', 'base64'));
    if (message) {
      messages.push({ message, ip: result.source_ip });
    }
  }
  return messages;
}

/**
 * One capture now, for a discovery or a connection test.
 * @returns {Promise<Array<{ message: object, ip: string }>>}
 */
export async function captureOnce(gladys, seconds = CAPTURE_SECONDS) {
  return decodeCapture(await gladys.scanNetwork('udp-broadcast', { timeoutSeconds: seconds }));
}

export class LocalListener {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {(message: object) => void | Promise<void>} options.onMessage
   */
  constructor({ gladys, onMessage }) {
    this.gladys = gladys;
    this.onMessage = onMessage;
    this.running = false;
    this.lastError = null;
    this.lastCaptureAt = 0;
    this.hubIp = null;
    this.wake = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    logger.info(`Listening to the Tempest hub on the LAN (UDP ${TEMPEST_UDP_PORT})`);
    this.loop().catch((err) => logger.error('Local listener stopped', err));
  }

  stop() {
    this.running = false;
    this.wake?.();
  }

  // A pause that stop() cuts short.
  pause(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      const self = this;
      function done() {
        clearTimeout(timer);
        self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }

  async loop() {
    while (this.running) {
      let captured;
      try {
        captured = await captureOnce(this.gladys);
        this.lastCaptureAt = Date.now();
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message;
        const wait =
          err.status === 429
            ? RETRY_MS.rateLimited
            : err.status === 403
              ? RETRY_MS.forbidden
              : RETRY_MS.failed;
        if (err.status === 403) {
          logger.error(
            'Gladys refuses the LAN capture: this Gladys is too old for the local channel',
          );
        } else {
          logger.warn(`LAN capture failed: ${err.message}`);
        }
        await this.pause(wait);
        continue;
      }
      if (!this.running) {
        break;
      }
      for (const { message, ip } of captured) {
        this.hubIp = ip ?? this.hubIp;
        try {
          await this.onMessage(message);
        } catch (err) {
          logger.error('Local message handling failed', err);
        }
      }
      if (captured.length === 0) {
        // Nothing on the LAN: no reason to keep the core capturing back to back.
        await this.pause(RETRY_MS.rateLimited);
      }
    }
  }
}
