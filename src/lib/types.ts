import type {
  BoardColor,
  LabelColor,
  Priority,
} from "@/lib/constants";

export interface BoardSummary {
  id: string;
  name: string;
  description: string | null;
  color: BoardColor;
  position: number;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  doneCount: number;
  columnCount: number;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
}

export interface Label {
  id: string;
  boardId: string;
  name: string;
  color: LabelColor;
  createdAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface TaskDetail extends Task {
  subtasks: Subtask[];
  comments: Comment[];
}

export interface BoardDetail {
  board: BoardSummary;
  columns: BoardColumn[];
  tasks: Task[];
  labels: Label[];
}

export interface SearchResult {
  taskId: string;
  title: string;
  boardId: string;
  boardName: string;
  boardColor: BoardColor;
  columnName: string;
  priority: Priority;
  dueDate: string | null;
}

export interface BoardStats {
  boardId: string;
  name: string;
  color: BoardColor;
  total: number;
  done: number;
  open: number;
  overdue: number;
}

export interface DashboardData {
  totals: {
    tasks: number;
    done: number;
    overdue: number;
    dueSoon: number;
    completedLast7Days: number;
    boards: number;
    open: number;
  };
  priorityCounts: Record<Priority, number>;
  boardStats: BoardStats[];
  upcoming: Array<
    Task & {
      boardName: string;
      boardColor: BoardColor;
      columnName: string;
      columnIsDone: boolean;
    }
  >;
  recent: Array<
    Task & {
      boardName: string;
      boardColor: BoardColor;
      columnName: string;
      columnIsDone: boolean;
    }
  >;
}
