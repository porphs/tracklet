# Tracklet

A personal, offline task tracker for one person: organizing their own work into boards and seeing it as a board, a timeline and a calendar.

## Language

**Board**:
A named, separate area of work (for example, one project) that owns its own columns and tasks. There can be many boards.
_Avoid_: Project, workspace

**Column**:
An ordered list of tasks on a board, representing a stage of work. Every task is in exactly one column.
_Avoid_: List, lane, status

**Done column**:
A column marked as meaning "finished". A board can have zero or more of them.

**Done**:
A task is done exactly when it sits in a done column. There is no separate done flag.
_Avoid_: Completed, closed

**Task**:
A unit of work on a board. On the board view it is shown as a card.
_Avoid_: Card (except when talking about how it looks), item, ticket

**Label**:
A named, coloured tag that belongs to one board and can be attached to any number of that board's tasks. A task can have many labels. Labels on different boards are separate, even when they share a name.
_Avoid_: Tag, category

**Planned dates**:
A task's optional start date and end date: when the work is intended to happen.
_Avoid_: Due date, schedule

**Deadline**:
The optional date a task (or milestone) must be finished by. It is a commitment, separate from the planned dates.
_Avoid_: Due date, end date

**Deadline status**:
How urgent an open deadline is relative to today: *overdue* (before today), *near* (today up to the near window), or *none*. Done tasks and reached milestones always have status *none*.
_Avoid_: Urgency, priority

**Near window**:
How many days ahead a deadline counts as *near*. It is set by the user and defaults to 3.

**Milestone**:
A named point in time on a board, marking a goal that tasks work toward. It is not a task and never sits in a column. It is either open or reached.
_Avoid_: Goal, epic, flagged task

**Reached**:
The state of a milestone that has been marked as achieved. A reached milestone no longer raises deadline warnings.

**View scope**:
Whether the Timeline or Calendar shows the current board or all boards together. The default is the current board.
_Avoid_: Filter
