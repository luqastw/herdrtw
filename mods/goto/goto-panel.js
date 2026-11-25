// The Go to popup: spaces grouped by git repo (worktrees under their repo), the branch in
// front, the folder under it, git state (✓ clean, ✎ changed files, ↑ ahead, ↓ behind) and when
// each was last used. Opens with the previous space selected, so open + Enter goes back.
// Type to fuzzy-filter by repo, branch, ticket number, space name or folder.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, run, theme, settings, props, closeOverlay, home } from "herdr";
import { readVisits } from "./visit-tracker.js";
import { cachedGit, refreshGit } from "./space-git-status.js";
import { fuzzyMatch } from "./fuzzy-match.js";

const HEAD_H = 28;
const ROW_H = 50;
const LIST_MAX = 400;

function tilde(path) {
  const h = home();
  return path && h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path ?? "";
}

function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 172800) return "yesterday";
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d`;
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Where a space is now: its shown tab's first terminal folder, else where it was made.
function whereOf(space, allPanes) {
  const order = [...space.tabs].sort((a, b) => Number(b.active) - Number(a.active));
  for (const tab of order) {
    const p = allPanes.find((x) => x.tab === tab.id && x.terminal && x.cwd);
    if (p) return p.cwd;
  }
  return space.folder || home();
}

export class GotoPanel {
  init(_props, cx) {
    this.query = "";
    this.selected = null; // entry key; null: pick the default on next render
    this.scroll = 0;
    this.input = InputState.new({ placeholder: "Repo, branch, ticket or folder…   e.g. 1234" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value().trim();
      this.selected = null;
      this.scroll = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, _cx) => this.go(this.current));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      const all = panes();
      await refreshGit(spaces().map((s) => ({ machine: s.machine, folder: whereOf(s, all) })));
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(entry) {
    if (!entry) return;
    this.close();
    if (!entry.space.active) run("space.select", { id: entry.space.id });
  }

  entries() {
    const visits = readVisits();
    const all = panes();
    return spaces().map((s) => {
      const where = whereOf(s, all);
      const git = cachedGit(s.machine, where);
      const seen = visits[s.id] ?? null;
      const changed = Math.max(0, ...s.tabs.map((t) => t.changed_at ?? 0)) || null;
      return {
        key: s.id,
        space: s,
        where,
        git, // undefined: not read yet, null: not a repo
        label: git?.branch ?? s.branch ?? s.name,
        repo: git?.repo ?? null,
        group: git ? `${s.machine ?? ""}|${git.common}` : `${s.machine ?? ""}|~other`,
        groupLabel: [git?.repo ?? "Other", s.machine].filter(Boolean).join(" · "),
        last: s.active ? Date.now() : seen ?? changed,
      };
    });
  }

  // Groups of matching entries, best first; the flat pick order follows.
  groups() {
    const q = this.query;
    let list = this.entries();
    if (q) {
      list = list
        .map((e) => {
          const m = fuzzyMatch(q, {
            label: { text: e.label, weight: 3 },
            repo: { text: e.repo, weight: 2 },
            name: { text: e.space.name, weight: 2 },
            where: { text: tilde(e.where), weight: 1 },
          });
          // Ties go to the more recently used space.
          return m && { ...e, hits: m.hits, score: m.score + (e.last ? Math.max(0, 10 - (Date.now() - e.last) / 86400000) : 0) };
        })
        .filter(Boolean);
    } else {
      list = list.map((e) => ({ ...e, hits: {}, score: e.last ?? 0 }));
    }
    const byGroup = new Map();
    for (const e of list) {
      const g = byGroup.get(e.group) ?? { key: e.group, label: e.groupLabel, other: !e.git, items: [] };
      g.items.push(e);
      byGroup.set(e.group, g);
    }
    const groups = [...byGroup.values()];
    for (const g of groups) {
      g.items.sort((a, b) => b.score - a.score);
      g.best = g.items[0].score;
    }
    // "Other" (not a repo) stays last unless searching.
    groups.sort((a, b) => (!q && a.other !== b.other ? Number(a.other) - Number(b.other) : b.best - a.best));
    return groups;
  }

  defaultSelection(picks) {
    if (this.query) return picks[0]?.key ?? null;
    const previous = picks.filter((e) => !e.space.active).sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0];
    return (previous ?? picks[0])?.key ?? null;
  }

  render(cx) {
    const t = theme();
    const groups = this.groups();
    const rows = groups.flatMap((g) => [{ kind: "head", g }, ...g.items.map((e) => ({ kind: "row", e }))]);
    const picks = rows.filter((r) => r.kind === "row").map((r) => r.e);
    const previousKey = this.query ? null : this.defaultSelection(picks);
    if (!picks.some((e) => e.key === this.selected)) this.selected = this.defaultSelection(picks);
    const at = picks.findIndex((e) => e.key === this.selected);
    this.current = picks[at] ?? null;

    // One strip of fixed-height rows; scroll only as far as keeps the selection in view.
    const tops = [];
    let y = 0;
    for (const r of rows) { tops.push(y); y += r.kind === "head" ? HEAD_H : ROW_H; }
    const total = y;
    const height = Math.min(LIST_MAX, this.listHeight ?? LIST_MAX);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    const si = rows.findIndex((r) => r.kind === "row" && r.e.key === this.selected);
    if (si >= 0) {
      // Keep the group header visible with its first row.
      const top = si > 0 && rows[si - 1].kind === "head" ? tops[si - 1] : tops[si];
      if (top < this.scroll) this.scroll = top;
      if (tops[si] + ROW_H > this.scroll + height) this.scroll = tops[si] + ROW_H - height;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const hOf = (r) => (r.kind === "head" ? HEAD_H : ROW_H);
    const place = (el, i) => (fixed ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).h(hOf(rows[i])) : el);
    const visible = (i) => !fixed || (tops[i] + hOf(rows[i]) > this.scroll && tops[i] < this.scroll + height);

    const move = (step, cx) => {
      if (!picks.length) return;
      this.selected = picks[(Math.max(0, at) + step + picks.length) % picks.length].key;
      cx.notify();
    };

    const highlighted = (text, hits, base, strong) => {
      if (!hits?.size) return div().truncate().text_color(base).child(text);
      const parts = [];
      let chunk = null;
      [...text].forEach((ch, i) => {
        const on = hits.has(i);
        if (!chunk || chunk.on !== on) parts.push((chunk = { on, text: "" }));
        chunk.text += ch;
      });
      return h_flex().min_w(0).overflow_hidden().whitespace_nowrap().children(parts.map((p) =>
        div().flex_none().text_color(p.on ? strong : base).when(p.on, (el) => el.font_bold()).child(p.text)));
    };

    const gitBadges = (e) => {
      const g = e.git;
      if (g === undefined) return [div().text_color(t.dim).child("…")];
      if (g === null) return [];
      const out = [];
      out.push(g.changes
        ? div().text_color(t.ansi3).child(`✎ ${g.changes}`)
        : div().text_color(t.ansi2).child("✓"));
      if (g.ahead) out.push(div().text_color(t.ansi4).child(`↑${g.ahead}`));
      if (g.behind) out.push(div().text_color(t.ansi1).child(`↓${g.behind}`));
      if (!g.upstream && g.branch) out.push(div().text_color(t.dim).child("local"));
      return out;
    };

    const tag = (text, color) => div().flex_none().px(5).rounded(4).border_1().border_color(color).text_size(10.5).text_color(color).child(text);

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex().px(12).pt(9).gap(6).items_center().text_size(11).font_semibold().text_color(t.dim)
          .child(div().child(r.g.label.toUpperCase()))
          .child(div().font_medium().child(`${r.g.items.length}`));
      }
      const e = r.e;
      const on = e.key === this.selected;
      const sub = [tilde(e.where), e.space.named && e.space.name !== e.label ? e.space.name : null].filter(Boolean).join("  ·  ");
      return h_flex()
        .id(`goto-${e.key}`)
        .mx(4)
        .px(10)
        .gap(10)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_ev, _cx) => this.go(e))
        .child(div().w(10).flex_none().text_color(e.space.active ? t.accent : t.dim).child(e.space.active ? "●" : e.git?.worktree ? "↳" : "·"))
        .child(
          v_flex().flex_1().min_w(0).gap(2)
            .child(h_flex().min_w(0).gap(8).items_center().text_size(13.5)
              .child(highlighted(e.label, e.hits.label, t.foreground, t.accent))
              .when(e.space.active, (el) => el.child(tag("current", t.accent)))
              .when(e.key === previousKey, (el) => el.child(tag("↩ previous", t.muted))))
            .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)),
        )
        .child(h_flex().flex_none().gap(8).items_center().text_size(12).children(gitBadges(e)))
        .child(h_flex().w(52).flex_none().justify_end().text_size(12).text_color(t.muted).child(e.space.active ? "" : ago(e.last)));
    };

    const empty = !picks.length;
    return v_flex()
      .id("goto")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((ev, cx) => {
        const k = ev.key;
        if (k === "escape") { this.close(); cx.stop_propagation(); return; }
        if (k === "down" || (k === "n" && ev.modifiers.control)) move(1, cx);
        else if (k === "up" || (k === "p" && ev.modifiers.control)) move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(
        h_flex().h(38).flex_none().px(12).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(div().text_color(t.dim).child("⌕"))
          .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)),
      )
      .child(
        empty
          ? div().px(12).py(18).text_color(t.dim).child(`Nothing found for “${this.query}”.`)
          : v_flex()
            .id("goto-list")
            .on_size_change((size, cx) => {
              const h = size.height / settings().zoom;
              if (h !== this.listHeight) { this.listHeight = h; cx.notify(); }
            })
            .h(Math.min(LIST_MAX, total))
            .min_h(0)
            .when(fixed, (el) => el.overflow_hidden().on_scroll_wheel((ev, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - ev.delta.y, maxScroll));
              cx.notify();
            }))
            .children(rows.map((r, i) => (visible(i) ? place(row(r).h(hOf(r)), i) : null)).filter(Boolean)),
      )
      .child(
        h_flex().gap(14).px(4).text_size(11).text_color(t.dim)
          .child("↑↓ move").child("↵ go").child("esc close")
          .child(div().flex_1())
          .child(div().text_color(t.ansi2).child("✓ clean")).child(div().text_color(t.ansi3).child("✎ changed"))
          .child(div().child("↳ worktree")),
      );
  }
}
