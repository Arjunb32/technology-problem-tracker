import snapshot from './demo-state.json' with { type: 'json' };
import type { State } from './state.js';

export const demoProfiles = (snapshot as State).profiles;
export function seedState(): State {
  return structuredClone(snapshot as State);
}
