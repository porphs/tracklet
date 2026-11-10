/** What the right-hand panel is showing. One panel at a time, shared by all views. */
export type PanelState =
  | { kind: "task"; id: string }
  | { kind: "milestone"; id: string }
  | { kind: "milestones" }
  | { kind: "labels" }
  | { kind: "settings" }
  | null;
