// Go to: jump between spaces (projects and their git worktrees) knowing where you land.
// Two parts of one mod:
// - the popup (no props, opened with `mod.open:goto`): see goto-panel.js;
// - props { part: "tracker" }: an invisible floating copy that records when each space
//   was last used, which Herdr doesn't keep (see visit-tracker.js).

import { View } from "gpui-kit";
import { props } from "herdr";
import { GotoPanel } from "./goto-panel.js";
import { VisitTracker } from "./visit-tracker.js";

export default class Goto extends View {
  init(_props, cx) {
    this.part = props()?.part === "tracker" ? new VisitTracker() : new GotoPanel();
    this.part.init(props() ?? {}, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
