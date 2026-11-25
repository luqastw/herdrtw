// Remembers when each space was last used. Herdr keeps no such history, so a hidden
// floating copy of this mod (props.part = "tracker") watches the shown space and stamps,
// in shared "goto.visits", the moment a space was left and the moment one was entered.
// Shared state is saved to shared.json, so the stamps survive restarts.

import { div } from "gpui-kit";
import { focused, spaces, shared, setShared } from "herdr";

export const VISITS_KEY = "goto.visits";

export function readVisits() {
  return shared(VISITS_KEY) ?? {};
}

export class VisitTracker {
  init() {
    this.current = null;
  }

  stamp() {
    const now = focused()?.space ?? null;
    if (!now || now === this.current) return;
    const alive = new Set(spaces().map((s) => s.id));
    const at = Date.now();
    const next = Object.fromEntries(Object.entries(readVisits()).filter(([id]) => alive.has(id)));
    if (this.current && alive.has(this.current)) next[this.current] = at;
    next[now] = at;
    this.current = now;
    setShared(VISITS_KEY, next);
  }

  render() {
    this.stamp();
    return div();
  }
}
