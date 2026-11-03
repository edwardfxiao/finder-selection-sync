export type Mode = 'orphans' | 'tags' | 'list';
export type Message = { key: string; params?: Record<string, string | number>; raw?: string };
export type Issue = Message & { message?: string };
export type Config = {
  mode: Mode; base: string; targets: string[]; recursive: boolean; depth: string;
  mixed: boolean; referenceExt: string; matchBy: string;
  tagAction: string; color: string; select: string; scope: string; match: string;
  mergeTags: boolean; includeClear: boolean;
  listSource: string; list: string; listText: string; listMode: string;
  ignoreCase: boolean; includeExt: string; excludeExt: string;
};
export type Row = {
  id: string; file: string; name: string; relative: string; root: string; size: number;
  candidate: boolean; action: 'trash' | 'tags' | 'keep'; reason: Message; matches: string[];
  currentTags?: string[]; nextTags?: string[];
};
export type Plan = {
  id: string; mode: Mode; createdAt: string; roots: string[]; base?: string; rows: Row[];
  conflicts: { key: string; tagSets: { files: string[]; tags: string[] }[] }[];
  warnings: Message[]; total: number; candidates: number; listEntries?: number;
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
export type PreviewState = { plan: Plan | null; error: Issue | null; busy: boolean; pending: boolean };
export type PathKind = 'base' | 'targets' | 'list';
export type ImagePreview = { dataURL: string; width: number; height: number };
export interface FinderAPI {
  version(): Promise<string>;
  locales(): Promise<Catalog>;
  setLocale(code: string): Promise<Catalog>;
  reloadLocales(): Promise<Catalog>;
  openLocaleFolder(): Promise<void>;
  choose(kind: PathKind, replace?: string): Promise<string[]>;
  dropped(files: File[], kind: PathKind): Promise<string[]>;
  preview(config: Config): Promise<Plan>;
  discard(): Promise<void>;
  cancel(): Promise<void>;
  execute(id: string, selectedIds: string[]): Promise<Run | { declined: true }>;
  history(): Promise<Run[]>;
  clearHistory(): Promise<Run[]>;
  image(file: string, kind: 'thumbnail' | 'preview'): Promise<ImagePreview>;
  reveal(file: string, kind?: PathKind): Promise<void>;
  copyPath(file: string): Promise<void>;
  exportResult(id: string): Promise<boolean>;
  onProgress(callback: (progress: ProgressInfo) => void): () => void;
}
declare global { interface Window { finder: FinderAPI } }
