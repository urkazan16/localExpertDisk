import { describe, expect, it } from "vitest";
import type { EntryPage, IndexedEntry } from "../api/generated";
import { analyzerReducer, createAnalyzerState } from "./analyzerState";

const root: IndexedEntry = {
  id: "root",
  parent_id: null,
  name: "root",
  path: "/root",
  kind: "directory",
  logical_size: "0",
  aggregate_size: "10",
};
const child: IndexedEntry = {
  ...root,
  id: "child",
  parent_id: root.id,
  name: "child",
  path: "/root/child",
};
const sibling: IndexedEntry = {
  ...child,
  id: "sibling",
  name: "sibling",
  path: "/root/sibling",
};
const page = (items: IndexedEntry[] = []): EntryPage => ({
  items,
  next_cursor: null,
});

function initialized() {
  return analyzerReducer(createAnalyzerState("scan-1"), {
    type: "initial/success",
    root,
    children: page([child, sibling]),
    categories: [],
  });
}

describe("analyzerReducer", () => {
  it("keeps selection separate from directory activation", () => {
    const selected = analyzerReducer(initialized(), {
      type: "selection/toggle",
      entry: child,
    });
    expect(selected.domain.directory).toBe(root);
    expect(selected.ui.navigation).toEqual([root]);
    expect(selected.ui.selected).toEqual([child]);

    const activated = analyzerReducer(selected, {
      type: "directory/activate",
      entry: child,
      page: page(),
      parentIndex: 0,
    });
    expect(activated.domain.directory).toBe(child);
    expect(activated.ui.navigation).toEqual([root, child]);
    expect(activated.ui.selected).toEqual([]);
  });

  it("restores history and drops the forward branch after a new activation", () => {
    const insideChild = analyzerReducer(initialized(), {
      type: "directory/activate",
      entry: child,
      page: page(),
      parentIndex: 0,
    });
    const backAtRoot = analyzerReducer(insideChild, {
      type: "directory/navigate",
      index: 0,
    });
    const newBranch = analyzerReducer(backAtRoot, {
      type: "directory/activate",
      entry: sibling,
      page: page(),
      parentIndex: 0,
    });

    expect(newBranch.domain.directory).toBe(sibling);
    expect(newBranch.ui.navigation).toEqual([root, sibling]);
    expect(newBranch.ui.navigationIndex).toBe(1);
  });

  it("resets domain and incompatible UI state when the scan changes", () => {
    let state = analyzerReducer(initialized(), {
      type: "selection/toggle",
      entry: child,
    });
    state = analyzerReducer(state, { type: "search/text", text: "cache" });
    state = analyzerReducer(state, {
      type: "large/filters",
      minSize: "1000",
      category: "archives",
    });

    const reset = analyzerReducer(state, {
      type: "scan/reset",
      scanId: "scan-2",
    });

    expect(reset).toEqual(createAnalyzerState("scan-2"));
  });

  it("keeps an independent scroll offset for every result mode", () => {
    let state = initialized();
    state = analyzerReducer(state, {
      type: "result/scroll",
      mode: "large",
      scrollTop: 920,
    });
    state = analyzerReducer(state, {
      type: "result/scroll",
      mode: "search",
      scrollTop: 184,
    });
    state = analyzerReducer(state, { type: "result/mode", mode: "search" });
    state = analyzerReducer(state, { type: "result/mode", mode: "large" });

    expect(state.ui.resultScrollOffsets).toEqual({
      large: 920,
      categories: 0,
      search: 184,
    });
  });

  it("resets only the refreshed result mode to the first row", () => {
    let state = initialized();
    for (const mode of ["large", "categories", "search"] as const) {
      state = analyzerReducer(state, {
        type: "result/scroll",
        mode,
        scrollTop: 500,
      });
    }

    state = analyzerReducer(state, {
      type: "search/success",
      query: "report",
      page: page([child]),
    });

    expect(state.ui.resultScrollOffsets).toEqual({
      large: 500,
      categories: 500,
      search: 0,
    });
  });
});
