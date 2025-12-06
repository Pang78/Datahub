
export enum ChartType {
  BAR = 'bar',
  LINE = 'line',
  PIE = 'pie',
  AREA = 'area',
  SCATTER = 'scatter',
  COMPOSED = 'composed'
}

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface DataColumnProfile {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  sampleValues: any[];
  min?: number;
  max?: number;
  distinctCount: number;
}

export interface Sheet {
  sheetName: string;
  rawData: any[];
  columns: DataColumnProfile[];
  rowCount: number;
}

export interface Dataset {
  fileName: string;
  sheets: Sheet[];
  totalRows: number;
}

export interface ChartConfiguration {
  id: string;
  title: string;
  description: string;
  chartType: ChartType;
  sheetName: string; // Which sheet this chart belongs to
  xAxisKey: string;
  dataKeys: string[]; 
  aggregation: AggregationType;
  groupByKey?: string; // For stacked/grouped views
  colors: string[];
}

export interface AnalysisResult {
  summary: string;
  crossSheetInsights: string[]; // Insights derived from looking at multiple sheets
  inferences: string[]; // Educated guesses/hypotheses
  charts: ChartConfiguration[];
}

export interface ProcessingState {
  status: 'idle' | 'parsing' | 'analyzing' | 'complete' | 'error';
  message?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
