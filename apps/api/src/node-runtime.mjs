import { readFileSync } from 'node:fs';
import { initSync } from '../generated/tracker_core.js';
initSync({ module: readFileSync(new URL('../generated/tracker_core_bg.wasm', import.meta.url)) });
import { initSync as initContracts } from '../../../packages/contracts/generated/tracker_contracts.js';
initContracts({
  module: readFileSync(
    new URL('../../../packages/contracts/generated/tracker_contracts_bg.wasm', import.meta.url),
  ),
});
