import wasm from '../generated/tracker_core_bg.wasm';
import { initSync } from '../generated/tracker_core.js';
import worker from './worker.js';
initSync({ module: wasm });
import contractModule from '../../../packages/contracts/generated/tracker_contracts_bg.wasm';
import { initSync as initContracts } from '../../../packages/contracts/generated/tracker_contracts.js';
initContracts({ module: contractModule });
export default worker;
