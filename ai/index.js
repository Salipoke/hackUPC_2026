/**
 * BioMeshP2P AI public API.
 *
 *   const { evaluate, shouldTrigger, triggerEvent } = require('./ai');
 */
const { evaluate, THRESHOLDS, MODEL_ID, MODEL_VERSION } = require('./decision');
const { shouldTrigger, triggerEvent } = require('./consensus');

module.exports = {
  evaluate,
  THRESHOLDS,
  MODEL_ID,
  MODEL_VERSION,
  shouldTrigger,
  triggerEvent
};
