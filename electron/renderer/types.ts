export type Mode = 'orphans' | 'tags' | 'list' | 'filter' | 'compare';
export type Theme = 'light' | 'dark' | 'system';
export type Message = { key: string; params?: Record<string, string | number>; raw?: string };
export type Issue = Message & { message?: string };
export type Config = {
  mode: Mode; base: string; targets: string[]; recursive: boolean; depth: string;
  mixed: boolean; referenceExt: string; matchBy: string;
  tagAction: string; colors: string[]; select: string; scope: string; match: string;
  mergeTags: boolean; includeClear: boolean;
  listSource: string; list: string; listText: string; listMode: string;
  ignoreCase: boolean; includeExt: string; excludeExt: string;
  nameContains: string; nameExcludes: string; nameRegex: string; invertFilter: boolean;
  sizeMin: string; sizeMax: string; sizeUnit: string; modifiedFrom: string; modifiedTo: string;
  filterAction: 'trash' | 'tags';
  listAction: 'trash' | 'tags'; compareAction: 'review' | 'tags'; compareSelection: 'common' | 'unique' | 'onlyA' | 'onlyB';
};
export type Row = {
  id: string; file: string; name: string; relative: string; root: string; size: number;
  candidate: boolean; action: 'trash' | 'tags' | 'keep'; reason: Message; matches: string[];
  currentTags?: string[]; nextTags?: string[];
  modifiedMs?: number;
  matched?: boolean;
  side?: 'a' | 'b'; group?: 'common' | 'onlyA' | 'onlyB';
};
export type Plan = {
  id: string; mode: Mode; createdAt: string; roots: string[]; base?: string; rows: Row[];
  conflicts: { key: string; tagSets: { files: string[]; tags: string[] }[] }[];
  warnings: Message[]; total: number; candidates: number; listEntries?: number;
  action?: 'trash' | 'tags' | 'review'; matched?: number;
  requiresTags?: boolean;
};
export type RecordItem = {
  file: string; name: string; action: string; status: 'completed' | 'failed' | 'pending';
  error?: Issue; beforeTags?: string[]; afterTags?: string[];
};
export type Run = {
  id: string; mode: Mode; action: string; startedAt: string; finishedAt: string;
  completed: number; failed: number; unattempted: number; cancelled: boolean;
  error: Issue | null; records: RecordItem[];
};
export type Locale = { code: string; label: string; direction: 'ltr' | 'rtl'; messages: Record<string, string>; custom?: boolean };
export type Catalog = { current: string; bundles: Locale[]; warnings: { file: string; detail: string }[] };
export type ProgressInfo = { phase: string; detail: Message; completed: number; total: number };
export type PreviewState = { plan: Plan | null; error: Issue | null; busy: boolean; pending: boolean; restoring?: boolean };
export type PathKind = 'base' | 'targets' | 'list' | 'compareA' | 'compareB';
export type ImagePreview = { dataURL: string; width: number; height: number };
export type SelectionTags = { colors: string[]; mergeTags: boolean; clearTags?: boolean };
export interface FinderAPI {
  version(): Promise<string>;
  locales(): Promise<Catalog>;
  setLocale(code: string): Promise<Catalog>;
  setTheme(theme: Theme): Promise<void>;
  reloadLocales(): Promise<Catalog>;
  openLocaleFolder(): Promise<void>;
  choose(kind: PathKind, replace?: string): Promise<string[]>;
  dropped(files: File[], kind: PathKind): Promise<string[]>;
  preview(config: Config): Promise<Plan>;
  activate(id: string): Promise<Plan | null>;
  discard(mode?: Mode): Promise<void>;
  discardAll(): Promise<void>;
  cancel(): Promise<void>;
  execute(id: string, selectedIds: string[]): Promise<Run | { declined: true }>;
  selectedTags(id: string, selectedIds: string[]): Promise<Row[]>;
  tagSelected(id: string, selectedIds: string[], options: SelectionTags): Promise<Run | { declined: true } | { unchanged: true }>;
  history(): Promise<Run[]>;
  clearHistory(): Promise<Run[]>;
  image(file: string, kind: 'thumbnail' | 'preview'): Promise<ImagePreview>;
  reveal(file: string, kind?: PathKind): Promise<void>;
  copyPath(file: string): Promise<void>;
  exportResult(id: string): Promise<boolean>;
  onProgress(callback: (progress: ProgressInfo) => void): () => void;
}
declare global { interface Window { finder: FinderAPI } }
