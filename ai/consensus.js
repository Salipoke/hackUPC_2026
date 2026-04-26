/**
 * BioMeshP2P Phase-2 Consensus Module
 *
 * Each emisor publishes its verdict (from ai/decision.js) along with raw metrics.
 * In phase 2, every emisor reads the verdicts of others and decides if a
 * collective action must be triggered.
 *
 * Trigger rule (per FLUJO_DE_EJECUCION.md):
 *   action = (count(verdict.risk == 'high') >= ceil(N / 2))
 * where N = total active emisores.
 *
 * Public API:
 *   shouldTrigger(verdicts: Verdict[], totalPeers?: number) -> { trigger: bool, ratio, threshold, highCount }
 *   triggerEvent(reason): placeholder for the physical action (LED / log / actuator).
 */

/**
 * Decide if collective action must fire.
 *
 * @param {Array<{peerId:string, verdict:{risk:'low'|'high', score:number}, timestamp:number}>} entries
 * @param {number} [totalPeers] - Optional override of N. Defaults to entries.length.
 * @param {object} [opts]
 * @param {number} [opts.windowMs=60000] - Only consider verdicts within this window.
 * @returns {{trigger:boolean, highCount:number, totalPeers:number, threshold:number, ratio:number}}
 */
function shouldTrigger(entries, totalPeers, opts = {}) {
  const windowMs = opts.windowMs || 60_000;
  const now = Date.now();

  // Keep only the most recent verdict per peer within window.
  const latestByPeer = new Map();
  for (const e of entries || []) {
    if (!e || !e.peerId || !e.verdict) continue;
    const ts = e.timestamp || 0;
    if (now - ts > windowMs) continue;
    const prev = latestByPeer.get(e.peerId);
    if (!prev || (prev.timestamp || 0) < ts) latestByPeer.set(e.peerId, e);
  }

  const N = totalPeers || latestByPeer.size;
  if (N === 0) {
    return { trigger: false, highCount: 0, totalPeers: 0, threshold: 0, ratio: 0 };
  }

  const threshold = Math.ceil(N / 2);
  let highCount = 0;
  for (const e of latestByPeer.values()) {
    if (e.verdict.risk === 'high') highCount++;
  }

  return {
    trigger: highCount >= threshold,
    highCount,
    totalPeers: N,
    threshold,
    ratio: parseFloat((highCount / N).toFixed(3))
  };
}

/**
 * Placeholder for physical action. To be replaced with:
 *   - LED on Arduino UNO Q matrix (RPC bridge → STM32)
 *   - Console banner on PC mocks
 *   - Webhook / signal to dashboard
 *
 * @param {object} ctx - {peerId, verdicts, decision}
 */
function triggerEvent(ctx) {
  const banner = '!!! BIOMESH ALERT !!!';
  console.log('\n' + '='.repeat(60));
  console.log(banner);
  console.log(`Peer:        ${ctx.peerId}`);
  console.log(`High count:  ${ctx.decision.highCount} / ${ctx.decision.totalPeers}`);
  console.log(`Threshold:   ${ctx.decision.threshold}`);
  console.log(`Action:      ENVIRONMENTAL MITIGATION (placeholder)`);
  console.log('='.repeat(60) + '\n');
}

module.exports = { shouldTrigger, triggerEvent };
