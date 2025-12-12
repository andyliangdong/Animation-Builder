export interface SketchStep {
  title: string;
  description: string;
  code: string; // The Javascript code to execute for rough.js
}

export interface SketchResponse {
  steps: SketchStep[];
}

export interface HistoryItem {
  id: string;
  query: string;
  steps: SketchStep[];
  timestamp: number;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
