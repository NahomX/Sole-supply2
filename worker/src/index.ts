/**
 * index.ts — Worker entrypoint.
 *
 * Runs the agent loop on a timer (every 5 minutes by default).
 * The loop itself checks the kill switch on every iteration — this outer
 * scheduler just controls how often we wake up to check.
 *
 * On Fly.io this runs as a long-lived process (not a cron job) so the
 * interval can be tuned without a redeploy via agent_config.
 */

import { runAgentLoop } from "./agent/loop.js";
import { closeBrowser } from "./agent/browser.js";

const LOOP_INTERVAL_MS = parseInt(
  process.env.LOOP_INTERVAL_MS ?? String(5 * 60 * 1_000),
  10
);

console.log(
  `[worker] Berebaso agent worker starting. ` +
    `Loop interval: ${LOOP_INTERVAL_MS / 1000}s. ` +
    `Phase 3 TEST mode — all checkouts are dry runs.`
);

async function tick(): Promise<void> {
  try {
    const result = await runAgentLoop();
    console.log(
      `[worker] Loop tick done. attempted=${result.itemsAttempted} ` +
        `completed=${result.itemsCompleted} halted=${result.halted}`
    );
  } catch (err) {
    console.error("[worker] Loop tick threw an unhandled error:", err);
    // Do not exit — keep the process alive for the next interval.
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<never> {
  console.log(`[worker] Received ${signal}. Shutting down...`);
  await closeBrowser();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Run immediately on startup, then on interval.
void tick();
const intervalHandle = setInterval(() => void tick(), LOOP_INTERVAL_MS);
// Keep the process alive; cleared only on shutdown.
intervalHandle.unref?.();
