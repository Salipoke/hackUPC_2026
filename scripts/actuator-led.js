/**
 * BioMeshP2P LED Actuator
 *
 * Controls the UNO Q's built-in LED matrix (or external LED) via STM32 RPC.
 * Called by consensus.js when threshold is met.
 *
 * Mode detection:
 *   - Real UNO Q: serial port available → RPC to STM32 → LED matrix
 *   - PC mock: no serial → console banner only
 *
 * Usage: node scripts/actuator-led.js {on|off|flash|pattern}
 *   or import as module: require('./scripts/actuator-led')
 */

const path = (typeof Bare !== 'undefined') ? require('bare-path') : require('path');
const fs = (typeof Bare !== 'undefined') ? require('bare-fs')   : require('fs');

let serialPort = null;
let isPear = typeof Bare !== 'undefined';
let isRealHardware = false;

/**
 * Patterns for LED matrix on UNO Q (8x13).
 * Each pattern is an array of 8 rows (strings of 13 chars: ' ' or '*').
 */
const PATTERNS = {
  alert: [
    '*************',
    '*         *',
    '*  alert  *',
    '*  !!    *',
    '*  alert  *',
    '*         *',
    '*************',
    '*************'
  ],
  ok: [
    '             ',
    '    ***     ',
    '   *   *    ',
    '    ***     ',
    '    *      ',
    '    *      ',
    '   ***     ',
    '            '
  ],
  safe: [
    '             ',
    '    ok      ',
    '   okok     ',
    '    ok      ',
    '    ok      ',
    '   okok     ',
    '    ok      ',
    '            '
  ],
  pulse: [
    '      *      ',
    '     * *     ',
    '    *   *    ',
    '   *     *   ',
    '    *   *    ',
    '     * *    ',
    '      *     ',
    '            '
  ]
};

/**
 * Connect to STM32 via serial (UNO Q).
 * Detects hardware vs PC mock automatically.
 */
async function connect() {
  if (isPear || typeof process === 'undefined') {
    console.log('[led] Pear runtime - console mode');
    return false;
  }

  try {
    const SerialPort = require('serialport');
    serialPort = new SerialPort('/dev/ttyACM0', {
      baudRate: 115200,
      parser: SerialPort.parsers.readline('\n')
    });
    serialPort.on('error', (err) => {
      console.log('[led] serial error:', err.message);
    });
    isRealHardware = true;
    console.log('[led] UNO Q detected - LED matrix enabled');
    return true;
  } catch (e) {
    console.log('[led] PC mock mode - using console alerts');
    return false;
  }
}

/**
 * Send pattern to STM32 to display on LED matrix.
 * @param {string} patternName - 'alert', 'ok', 'safe', 'pulse', or 'off'
 */
async function display(patternName) {
  const pattern = PATTERNS[patternName] || PATTERNS.ok;

  console.log(`[led] display: ${patternName}`);
  for (let i = 0; i < pattern.length; i++) {
    console.log(`[led] ${pattern[i]}`);
  }

  if (serialPort && serialPort.isOpen) {
    return new Promise((resolve, reject) => {
      const cmd = JSON.stringify({ type: 'led', pattern: patternName }) + '\n';
      serialPort.write(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return true;
}

/**
 * Simple LED on (for external LED on breadboard).
 * Uses GPIO on STM32 or just console for PC mocks.
 */
async function on() {
  console.log('[led] ON (RED - HIGH RISK)');
  return display('alert');
}

/**
 * LED off (safe state).
 */
async function off() {
  console.log('[led] OFF (safe)');
  return display('safe');
}

/**
 * Flash pattern (attention getter).
 */
async function flash(count = 3) {
  for (let i = 0; i < count; i++) {
    await display('pulse');
    await sleep(200);
    await display('off');
    await sleep(200);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main: CLI entry point.
 */
async function main() {
  const cmd = process.argv[2] || 'on';

  await connect();

  switch (cmd) {
    case 'on':
      await on();
      break;
    case 'off':
      await off();
      break;
    case 'flash':
      await flash(3);
      break;
    case 'pattern':
      const pattern = process.argv[3] || 'alert';
      await display(pattern);
      break;
    default:
      console.log('Usage: node scripts/actuator-led.js {on|off|flash|pattern}');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('[led] ERROR:', e.message);
    process.exit(1);
  });
}

module.exports = { on, off, flash, display, PATTERNS, connect };