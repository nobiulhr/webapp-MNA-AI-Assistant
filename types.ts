import type React from 'react';

export type Priority = 'High' | 'Medium' | 'Low' | 'None';
export type Status = 'Not Started' | 'In Progress' | 'Completed';
export type TaskType = 'Self' | 'Delegated' | 'Team' | 'Personal';

export interface ActionItem {
  id: string;
  task: string;
  deadline: string;
  reminder: string;
  source: string;
  priority: Priority;
  responsible: string;
  status: Status;
  type: TaskType;
}

export interface Message {
  id: string;
  role: 'user' | 'scribe';
  content: string | React.ReactNode;
  isSummary?: boolean;
}

export interface ScribeResponse {
  newItems: Omit<ActionItem, 'id'>[];
  responseText: string;
}

export type ExportFormat = 'markdown' | 'json' | 'csv';