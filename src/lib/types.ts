import type {
  BoardType,
  LabelColor,
  Priority,
  TaskComplexity,
} from "@/lib/constants";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  boardCount: number;
  kanbanCount: number;
  whiteboardCount: number;
  noteCount: number;
  taskCount: number;
  doneCount: number;
}

/** Optional folder inside a project. Folders may contain other folders. */
export interface FolderSummary {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardSummary {
  id: string;
  projectId: string | null;
  folderId: string | null;
  type: BoardType;
  name: string;
  description: string | null;
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
  complexity: TaskComplexity | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  imageCount: number;
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

/**
 * An image attached to a task. `url` is either a canonical premium image URL
 * (`/api/images/<id>`) or an embedded data URL in the free local workspace.
 */
export interface TaskImage {
  id: string;
  taskId: string;
  url: string;
  name: string | null;
  position: number;
  createdAt: string;
}

export interface TaskDetail extends Task {
  subtasks: Subtask[];
  comments: Comment[];
  images: TaskImage[];
}

export interface BoardDetail {
  board: BoardSummary;
  columns: BoardColumn[];
  tasks: Task[];
  labels: Label[];
}

/** Serialized Excalidraw scene payload for a whiteboard board. */
export interface WhiteboardScene {
  boardId: string;
  /** Opaque Excalidraw scene JSON ({ elements, appState, files }). */
  scene: string;
  updatedAt: string;
}

/** Serialized BlockNote document payload for a note board. */
export interface NoteDocument {
  boardId: string;
  /** Opaque BlockNote document JSON (an array of blocks). */
  document: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  kind: "task" | "whiteboard" | "note";
  title: string;
  detail: string | null;
  boardId: string;
  boardName: string;
  boardType: BoardType;
  projectId: string | null;
  projectName: string | null;
  timestamp: string;
}

export interface SyncConflictView {
  id: string;
  entityType:
    | "project"
    | "folder"
    | "board"
    | "column"
    | "task"
    | "label"
    | "task_label"
    | "subtask"
    | "comment"
    | "whiteboard"
    | "note"
    | "task_image";
  entityId: string;
  incomingDeleted: boolean;
  incomingData: Record<string, unknown>;
  incomingUpdatedAt: string;
  winningDeleted: boolean;
  winningData: Record<string, unknown>;
  winningUpdatedAt: string;
  revision: number;
  createdAt: string;
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
  entityLabel: string | null;
}

export interface ProjectDetail {
  project: ProjectSummary;
  folders: FolderSummary[];
  boards: BoardSummary[];
  totals: {
    boards: number;
    tasks: number;
    done: number;
    open: number;
    overdue: number;
    dueSoon: number;
    totalEffort: number;
  };
  upcoming: DashboardTask[];
  activity: ActivityItem[];
}

export interface CalendarData {
  boards: BoardSummary[];
  columns: BoardColumn[];
  labels: Label[];
  tasks: Task[];
}

export interface SearchResult {
  taskId: string;
  title: string;
  boardId: string;
  boardName: string;
  columnName: string;
  priority: Priority;
  dueDate: string | null;
}

export interface BoardStats {
  boardId: string;
  name: string;
  total: number;
  done: number;
  open: number;
  overdue: number;
}

export interface DashboardTask extends Task {
  boardName: string;
  columnName: string;
  columnIsDone: boolean;
  projectId: string | null;
  projectName: string | null;
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
    projects: number;
    whiteboards: number;
    notes: number;
    totalEffort: number;
    unestimatedTasks: number;
  };
  priorityCounts: Record<Priority, number>;
  sizeCounts: Record<TaskComplexity, number>;
  effortPointsBySize: Record<TaskComplexity, number>;
  boardStats: BoardStats[];
  projects: ProjectSummary[];
  activity: ActivityItem[];
  upcoming: DashboardTask[];
  recent: DashboardTask[];
}
