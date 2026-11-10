/** A local calendar date, `YYYY-MM-DD`. No time of day, no timezone. */
export type DateStr = string;

export interface Board {
  id: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isDoneColumn: boolean;
}

export interface Task {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  startDate: DateStr | null;
  endDate: DateStr | null;
  deadline: DateStr | null;
  milestoneId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  boardId: string;
  title: string;
  description: string;
  date: DateStr;
  isReached: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  boardId: string;
  name: string;
  color: string;
}

export type View = "board" | "timeline" | "calendar";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
