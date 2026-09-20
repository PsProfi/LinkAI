import * as vscode from 'vscode';
import { AiClient } from './services/aiClient';
import { AnalysisResult } from './types/messages';
import { supportedLanguages } from './types/statistics';

// ─────────────────────────────────────────────
// CONSTANTS & TYPES
// ─────────────────────────────────────────────

const HISTORY_KEY = 'linkai.history';
const TOTAL_WORDS_KEY = 'linkai.totalWordsEver';
const LAST_ANALYSIS_KEY = 'linkai.lastAnalysis';

const PERIOD_DAYS = 30;                       // analysis window (current vs previous)
const HISTORY_KEEP_DAYS = PERIOD_DAYS * 2 + 1;
const MAX_FILES_PER_DAY = 50;
const FLUSH_DELAY_MS = 5_000;

// Anti-cheat (ported from XPRank)
const PASTE_THRESHOLD_CHARS = 200;
const PASTE_MULTIPLIER = 0.1;
const MAX_WORDS_PER_EVENT = 40;
const MAX_LINES_PER_EVENT = 15;

type Settings = {
	backendUrl: string;
	defaultLanguage: string;
	sendAggregatedStatistics: boolean;
};

const DEFAULT_SETTINGS: Settings = {
	backendUrl: 'http://localhost:8000',
	defaultLanguage: 'TypeScript',
	sendAggregatedStatistics: false,
};

interface FileDayStats { words: number; linesAdded: number; linesDeleted: number; }
interface DayStats {
	words: number;
	linesAdded: number;
	linesDeleted: number;
	sessions: number;
	languages: Record<string, number>;     // language name -> counted words
	files: Record<string, FileDayStats>;   // workspace-relative path -> stats (stays on this machine)
}
type History = Record<string, DayStats>;   // key: YYYY-MM-DD (local time)

interface PeriodSummary {
	words: number;
	linesAdded: number;
	linesDeleted: number;
	linesChanged: number;
	activeDays: number;
	sessions: number;
	averageLinesPerActiveDay: number;
}
interface FileActivity { path: string; words: number; linesAdded: number; linesDeleted: number; }
interface LanguageActivity { name: string; words: number; }

interface PanelState {
	settings: Settings;
	session: { words: number; pasted: number; blocked: number; totalWords: number };
	current: PeriodSummary;
	previous: PeriodSummary;
	languages: LanguageActivity[];
	files: FileActivity[];
	lastAnalysis?: AnalysisResult;
}

// webview -> extension
type ViewMessage =
	| { type: 'requestState' }
	| { type: 'saveSettings'; payload: Settings }
	| { type: 'runAnalysis' };

// extension -> webview
type HostMessage =
	| { type: 'state'; payload: PanelState }
	| { type: 'settingsSaved'; payload: Settings }
	| { type: 'analysisStarted' }
	| { type: 'analysisCompleted'; payload: AnalysisResult }
	| { type: 'analysisFailed'; payload: { message: string } };

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

export function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}
	return trimmed.split(/\s+/).filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function fileExtension(filePath: string): string {
	const fileName = filePath.split(/[\\/]/).pop() ?? '';
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? fileName.slice(dot) : '';
}

function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(count: number): Date {
	const date = new Date();
	date.setDate(date.getDate() - count);
	return date;
}

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

function getStoredSettings(context: vscode.ExtensionContext): Settings {
	const configuration = vscode.workspace.getConfiguration('linkai');
	const backendUrl = context.globalState.get<string>('linkai.backendUrl', configuration.get<string>('backendUrl', DEFAULT_SETTINGS.backendUrl) ?? DEFAULT_SETTINGS.backendUrl);
	const defaultLanguage = context.globalState.get<string>('linkai.defaultLanguage', configuration.get<string>('defaultLanguage', DEFAULT_SETTINGS.defaultLanguage) ?? DEFAULT_SETTINGS.defaultLanguage);
	const sendAggregatedStatistics = context.globalState.get<boolean>('linkai.sendAggregatedStatistics', configuration.get<boolean>('sendAggregatedStatistics', DEFAULT_SETTINGS.sendAggregatedStatistics));

	return {
		backendUrl: backendUrl.trim() || DEFAULT_SETTINGS.backendUrl,
		defaultLanguage: supportedLanguages.includes(defaultLanguage as typeof supportedLanguages[number]) ? defaultLanguage : DEFAULT_SETTINGS.defaultLanguage,
		sendAggregatedStatistics: Boolean(sendAggregatedStatistics),
	};
}

async function saveStoredSettings(context: vscode.ExtensionContext, settings: Settings): Promise<void> {
	await Promise.all([
		context.globalState.update('linkai.backendUrl', settings.backendUrl),
		context.globalState.update('linkai.defaultLanguage', settings.defaultLanguage),
		context.globalState.update('linkai.sendAggregatedStatistics', settings.sendAggregatedStatistics),
		vscode.workspace.getConfiguration('linkai').update('backendUrl', settings.backendUrl, vscode.ConfigurationTarget.Global),
		vscode.workspace.getConfiguration('linkai').update('defaultLanguage', settings.defaultLanguage, vscode.ConfigurationTarget.Global),
		vscode.workspace.getConfiguration('linkai').update('sendAggregatedStatistics', settings.sendAggregatedStatistics, vscode.ConfigurationTarget.Global),
	]);
}

// ─────────────────────────────────────────────
// CHANGE TRACKING (ported from XPRank, no XP / achievements)
// ─────────────────────────────────────────────

const LANGUAGE_BY_EXT: Record<string, string> = {
	'.ts': 'TypeScript', '.tsx': 'TypeScript',
	'.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
	'.py': 'Python', '.pyw': 'Python',
	'.rs': 'Rust', '.go': 'Go',
	'.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
	'.c': 'C', '.h': 'C',
	'.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.cs': 'C#',
	'.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.scala': 'Scala',
	'.zig': 'Zig', '.lua': 'Lua',
	'.ex': 'Elixir', '.exs': 'Elixir', '.elm': 'Elm',
	'.clj': 'Clojure', '.cljs': 'Clojure',
	'.fs': 'F#', '.fsx': 'F#', '.dart': 'Dart', '.r': 'R', '.jl': 'Julia',
	'.vue': 'Vue', '.svelte': 'Svelte',
	'.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.fish': 'Shell',
	'.sql': 'SQL', '.html': 'HTML',
	'.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
};
const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXT));

function isMeaningfulLine(line: string): boolean {
	const t = line.trim();
	if (t.length < 4) { return false; }
	if (/^[{}\[\]();,\s]+$/.test(t)) { return false; }   // only brackets/punctuation
	if (/^\/\/\s*$/.test(t)) { return false; }            // empty comment
	if (/^#\s*$/.test(t)) { return false; }               // empty python comment
	if (/^(.)\1{5,}$/.test(t)) { return false; }          // "aaaaaaa" / "//////" spam
	if (/^(console\.log|print|puts|echo)\s*\(\s*['"`]\s*['"`]\s*\)/.test(t)) { return false; }
	return true;
}

interface ChangeScore {
	words: number;
	lines: number;
	deletedLines: number;
	isPaste: boolean;
}

/**
 * Scores one text change.
 *  - Typed text: a word is counted when finished (space / Enter after a non-space char),
 *    a line is counted when Enter is pressed after a meaningful line.
 *  - Multi-word insertions (paste, snippet, multi-line completion): meaningful lines and their words.
 *  - Deleted lines = line breaks inside the replaced range.
 */
function scoreChange(
	change: vscode.TextDocumentContentChangeEvent,
	doc: vscode.TextDocument,
	singleChange: boolean,
): ChangeScore {
	const text = change.text;
	const result: ChangeScore = {
		words: 0,
		lines: 0,
		deletedLines: change.range.end.line - change.range.start.line,
		isPaste: false,
	};
	if (!text) { return result; }

	// Typed whitespace: end of a word and/or a new line
	if (/^\s+$/.test(text)) {
		if (!singleChange || change.rangeLength > 0 || change.range.start.character === 0) { return result; }
		const before = doc.lineAt(change.range.start.line).text.slice(0, change.range.start.character);
		if (isMeaningfulLine(before)) {
			if (/\S$/.test(before)) { result.words = 1; }
			if (text.includes('\n')) { result.lines = 1; }
		}
		return result;
	}

	// A single token (typed character, autocomplete of one identifier) is counted at its word boundary instead
	if (!/\s/.test(text.trim())) { return result; }

	const newlines = (text.match(/\n/g) || []).length;
	const meaningfulLines = text.split(/\r?\n/).filter(isMeaningfulLine);
	result.isPaste = text.length > PASTE_THRESHOLD_CHARS && newlines > 1;
	result.words = meaningfulLines.reduce((sum, line) => sum + countWords(line), 0);
	result.lines = newlines > 0 ? meaningfulLines.length : 0;
	return result;
}

function emptyDay(): DayStats {
	return { words: 0, linesAdded: 0, linesDeleted: 0, sessions: 0, languages: {}, files: {} };
}

function loadHistory(context: vscode.ExtensionContext): History {
	const raw = context.globalState.get<History>(HISTORY_KEY, {});
	const history: History = {};
	if (!raw || typeof raw !== 'object') { return history; }
	for (const [key, value] of Object.entries(raw)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') { continue; }
		history[key] = { ...emptyDay(), ...value, languages: value.languages ?? {}, files: value.files ?? {} };
	}
	return history;
}

class WritingTracker implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChange = this.changeEmitter.event;

	private history: History;
	private totalWords: number;
	private sessionWords = 0;
	private pastedWords = 0;
	private blockedWords = 0;
	private sessionDay = '';
	private dirty = false;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly statusBar: vscode.StatusBarItem,
	) {
		this.history = loadHistory(context);
		this.totalWords = context.globalState.get<number>(TOTAL_WORDS_KEY, 0);
		this.updateStatusBar();
	}

	public getHistory(): History {
		return this.history;
	}

	public getSessionStats() {
		return { words: this.sessionWords, pasted: this.pastedWords, blocked: this.blockedWords, totalWords: this.totalWords };
	}

	public handleChange(event: vscode.TextDocumentChangeEvent): void {
		const doc = event.document;
		if (doc.uri.scheme !== 'file') { return; }
		const ext = fileExtension(doc.fileName).toLowerCase();
		if (!CODE_EXTENSIONS.has(ext)) { return; }

		// Undo / Redo are not new writing (TextDocumentChangeReason: Undo = 1, Redo = 2)
		const reason = (event as { reason?: number }).reason;
		if (reason === 1 || reason === 2) { return; }

		const singleChange = event.contentChanges.length === 1;
		let recorded = false;

		for (const change of event.contentChanges) {
			const score = scoreChange(change, doc, singleChange);
			const factor = score.isPaste ? PASTE_MULTIPLIER : 1;
			const words = Math.floor(Math.min(score.words * factor, MAX_WORDS_PER_EVENT));
			const lines = Math.floor(Math.min(score.lines * factor, MAX_LINES_PER_EVENT));
			const blocked = score.words - words;

			if (score.isPaste) { this.pastedWords += score.words; }
			if (blocked > 0) { this.block(blocked, score.isPaste ? 'вставка' : 'ліміт швидкості'); }

			if (words === 0 && lines === 0 && score.deletedLines === 0) { continue; }
			this.record(doc, ext, words, lines, score.deletedLines);
			recorded = true;
		}

		if (recorded) {
			this.dirty = true;
			this.scheduleFlush();
			this.updateStatusBar();
		}
	}

	private record(doc: vscode.TextDocument, ext: string, words: number, linesAdded: number, linesDeleted: number): void {
		const today = dayKey(new Date());
		const day = this.history[today] ?? (this.history[today] = emptyDay());
		if (this.sessionDay !== today) {
			this.sessionDay = today;
			day.sessions += 1;
		}

		day.words += words;
		day.linesAdded += linesAdded;
		day.linesDeleted += linesDeleted;

		const language = LANGUAGE_BY_EXT[ext];
		if (language && words > 0) {
			day.languages[language] = (day.languages[language] ?? 0) + words;
		}

		const path = vscode.workspace.asRelativePath(doc.uri, false);
		const file = day.files[path] ?? (day.files[path] = { words: 0, linesAdded: 0, linesDeleted: 0 });
		file.words += words;
		file.linesAdded += linesAdded;
		file.linesDeleted += linesDeleted;

		this.sessionWords += words;
		this.totalWords += words;
	}

	private block(amount: number, reason: string): void {
		const isFirstBlock = this.blockedWords === 0;
		this.blockedWords += amount;
		if (isFirstBlock) {
			vscode.window.setStatusBarMessage(`⚠️ LinkAI: слова не враховано (${reason}) — пишіть самі!`, 5000);
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer) { return; }
		this.flushTimer = setTimeout(() => { void this.flush(); }, FLUSH_DELAY_MS);
	}

	private trimFiles(day: DayStats): void {
		const entries = Object.entries(day.files);
		if (entries.length <= MAX_FILES_PER_DAY) { return; }
		const weight = (f: FileDayStats) => f.linesAdded + f.linesDeleted + f.words;
		entries.sort((a, b) => weight(b[1]) - weight(a[1]));
		const trimmed: Record<string, FileDayStats> = {};
		for (const [path, stats] of entries.slice(0, MAX_FILES_PER_DAY)) {
			trimmed[path] = stats;
		}
		day.files = trimmed;
	}

	public async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		if (!this.dirty) { return; }
		this.dirty = false;

		const cutoff = dayKey(daysAgo(HISTORY_KEEP_DAYS));
		for (const key of Object.keys(this.history)) {
			if (key < cutoff) { delete this.history[key]; }
		}
		const today = this.history[dayKey(new Date())];
		if (today) { this.trimFiles(today); }

		await Promise.all([
			this.context.globalState.update(HISTORY_KEY, this.history),
			this.context.globalState.update(TOTAL_WORDS_KEY, this.totalWords),
		]);
		this.changeEmitter.fire();
	}

	public updateStatusBar(): void {
		this.statusBar.text = `LinkAI | ✍️ ${this.sessionWords} words`;
		this.statusBar.tooltip = [
			`Написано за сесію: ${this.sessionWords} слів`,
			`Усього: ${this.totalWords.toLocaleString()} слів`,
			this.pastedWords > 0 ? `Вставлено за сесію: ${this.pastedWords} слів` : '',
			this.blockedWords > 0 ? `⚠️ Не враховано за сесію: ${this.blockedWords} слів` : '',
			'Натисніть, щоб відкрити аналіз коду',
		].filter(Boolean).join('\n');
	}

	public dispose(): void {
		void this.flush();
		this.changeEmitter.dispose();
	}
}

// ─────────────────────────────────────────────
// AGGREGATION
// ─────────────────────────────────────────────

/** Summary of PERIOD_DAYS days, ending `offsetDays` days ago (0 = current period, PERIOD_DAYS = previous one). */
function summarizePeriod(history: History, offsetDays: number): PeriodSummary {
	let words = 0;
	let linesAdded = 0;
	let linesDeleted = 0;
	let sessions = 0;
	let activeDays = 0;

	for (let i = offsetDays; i < offsetDays + PERIOD_DAYS; i++) {
		const day = history[dayKey(daysAgo(i))];
		if (!day) { continue; }
		words += day.words;
		linesAdded += day.linesAdded;
		linesDeleted += day.linesDeleted;
		sessions += day.sessions;
		if (day.words > 0 || day.linesAdded > 0 || day.linesDeleted > 0) { activeDays += 1; }
	}

	return {
		words,
		linesAdded,
		linesDeleted,
		linesChanged: linesAdded + linesDeleted,
		activeDays,
		sessions,
		averageLinesPerActiveDay: activeDays > 0 ? Number((linesAdded / activeDays).toFixed(1)) : 0,
	};
}

function topLanguages(history: History): LanguageActivity[] {
	const totals: Record<string, number> = {};
	for (let i = 0; i < PERIOD_DAYS; i++) {
		const day = history[dayKey(daysAgo(i))];
		if (!day) { continue; }
		for (const [name, words] of Object.entries(day.languages)) {
			totals[name] = (totals[name] ?? 0) + words;
		}
	}
	return Object.entries(totals)
		.map(([name, words]) => ({ name, words }))
		.sort((a, b) => b.words - a.words);
}

function topFiles(history: History): FileActivity[] {
	const totals: Record<string, FileActivity> = {};
	for (let i = 0; i < PERIOD_DAYS; i++) {
		const day = history[dayKey(daysAgo(i))];
		if (!day) { continue; }
		for (const [path, stats] of Object.entries(day.files)) {
			const entry = totals[path] ?? (totals[path] = { path, words: 0, linesAdded: 0, linesDeleted: 0 });
			entry.words += stats.words;
			entry.linesAdded += stats.linesAdded;
			entry.linesDeleted += stats.linesDeleted;
		}
	}
	const churn = (f: FileActivity) => f.linesAdded + f.linesDeleted;
	return Object.values(totals).sort((a, b) => churn(b) - churn(a) || b.words - a.words);
}

function pickLanguage(history: History, fallback: string): string {
	const top = topLanguages(history)[0];
	return top && supportedLanguages.includes(top.name as typeof supportedLanguages[number]) ? top.name : fallback;
}

function toAiSummary(period: PeriodSummary) {
	return {
		linesAdded: period.linesAdded,
		linesDeleted: period.linesDeleted,
		linesChanged: period.linesChanged,
		activeDays: period.activeDays,
		sessions: period.sessions,
		averageLinesPerActiveDay: period.averageLinesPerActiveDay,
	};
}

// ─────────────────────────────────────────────
// ANALYSIS (built from tracked data)
// ─────────────────────────────────────────────

function buildLocalAnalysis(current: PeriodSummary, previous: PeriodSummary, files: FileActivity[]): AnalysisResult {
	const noActivity = current.words === 0 && current.linesAdded === 0 && current.linesDeleted === 0;
	if (noActivity) {
		return {
			score: 10,
			summary: `За останні ${PERIOD_DAYS} днів розширення не зафіксувало змін у коді. Пишіть код у відкритих файлах — дані збираються автоматично.`,
			strengths: ['Відстеження активне й чекає на ваші зміни.'],
			recommendations: ['Попрацюйте з кодом кілька днів і повторіть аналіз.'],
			confidence: 'low',
		};
	}

	const avg = current.averageLinesPerActiveDay;
	const ratio = previous.linesAdded > 0 ? current.linesAdded / previous.linesAdded : undefined;
	const deleteRatio = current.linesAdded > 0 ? current.linesDeleted / current.linesAdded : 0;
	const totalChurn = files.reduce((sum, f) => sum + f.linesAdded + f.linesDeleted, 0);
	const topFile = files[0];
	const topShare = topFile && totalChurn > 0 ? (topFile.linesAdded + topFile.linesDeleted) / totalChurn : 0;
	const changePercent = ratio === undefined ? 0 : Math.round(Math.abs(ratio - 1) * 100);

	let score = 30;
	score += Math.round((Math.min(current.activeDays, PERIOD_DAYS) / PERIOD_DAYS) * 25);
	if (avg >= 20) { score += 10; }
	if (avg >= 60) { score += 5; }
	if (ratio !== undefined) {
		if (ratio >= 1.1) { score += 10; }
		else if (ratio < 0.7) { score -= 8; }
	}
	if (deleteRatio >= 0.1 && deleteRatio <= 0.8) { score += 10; }
	if (current.sessions >= 8) { score += 5; }
	score = clamp(score, 5, 100);

	const strengths: string[] = [];
	if (current.activeDays >= 12) {
		strengths.push(`Стабільна практика: ${current.activeDays} активних днів із ${PERIOD_DAYS}.`);
	}
	if (ratio !== undefined && ratio >= 1.1) {
		strengths.push(`Активність зросла на ${changePercent}% порівняно з попередніми ${PERIOD_DAYS} днями.`);
	}
	if (deleteRatio >= 0.1 && deleteRatio <= 0.8) {
		strengths.push(`Ви не лише додаєте, а й прибираєте код (видалено ${current.linesDeleted} рядків) — це ознака рефакторингу.`);
	}
	if (avg >= 20 && avg <= 150) {
		strengths.push(`Помірний обсяг роботи: у середньому ${avg} нових рядків за активний день.`);
	}
	if (strengths.length === 0) {
		strengths.push('Дані накопичуються — відстеження працює, з часом аналіз стане точнішим.');
	}

	const recommendations: string[] = [];
	if (current.activeDays < 8) {
		recommendations.push('Кодьте хоча б кілька днів на тиждень: регулярність важливіша за рідкі довгі сесії.');
	}
	if (ratio !== undefined && ratio < 0.7) {
		recommendations.push(`Активність впала на ${changePercent}% порівняно з попереднім періодом — заплануйте фіксований час для коду.`);
	}
	if (deleteRatio < 0.05 && current.linesAdded > 50) {
		recommendations.push('Ви майже не видаляєте код: виділіть час на рефакторинг — прибирайте дублювання та мертвий код.');
	}
	if (deleteRatio > 0.8) {
		recommendations.push('Ви видаляєте майже стільки ж, скільки пишете: розбивайте роботу на менші кроки й коротко плануйте перед кодуванням.');
	}
	if (topFile && totalChurn >= 50 && topShare > 0.6) {
		recommendations.push(`Понад ${Math.round(topShare * 100)}% змін припадає на ${topFile.path} — розгляньте розбиття на менші модулі.`);
	}
	if (avg > 150) {
		recommendations.push('Дуже великі обсяги за день: робіть менші коміти й частіше перевіряйте код.');
	}
	if (recommendations.length === 0) {
		recommendations.push('Продовжуйте в тому ж темпі й переглядайте власний код перед комітом.');
	}

	const trendText = ratio === undefined
		? 'Попереднього періоду для порівняння поки немає.'
		: ratio >= 1.1 ? `Активність зросла на ${changePercent}%.`
		: ratio < 0.7 ? `Активність знизилася на ${changePercent}%.`
		: 'Активність стабільна.';

	return {
		score,
		summary: `За останні ${PERIOD_DAYS} днів: ${current.activeDays} активних днів, ${current.sessions} сесій, +${current.linesAdded} / −${current.linesDeleted} рядків. ${trendText}`,
		strengths: strengths.slice(0, 3),
		recommendations: recommendations.slice(0, 3),
		confidence: current.activeDays >= 10 ? 'high' : current.activeDays >= 4 ? 'medium' : 'low',
	};
}

async function buildAnalysis(context: vscode.ExtensionContext, tracker: WritingTracker): Promise<AnalysisResult> {
	const settings = getStoredSettings(context);
	const history = tracker.getHistory();
	const current = summarizePeriod(history, 0);
	const previous = summarizePeriod(history, PERIOD_DAYS);
	const local = buildLocalAnalysis(current, previous, topFiles(history));

	const hasActivity = current.words > 0 || current.linesAdded > 0 || current.linesDeleted > 0;
	if (!hasActivity || !settings.sendAggregatedStatistics || !settings.backendUrl.trim()) {
		return local;
	}

	try {
		// Only aggregated numbers and the language name leave the machine — no code, no file names.
		const aiClient = new AiClient(() => context.secrets.get('linkai.backendToken'));
		const remote = await aiClient.evaluate({
			language: pickLanguage(history, settings.defaultLanguage),
			periodDays: PERIOD_DAYS,
			current: toAiSummary(current),
			previous: toAiSummary(previous),
		}, settings.backendUrl);

		return {
			score: remote.score,
			summary: remote.summary || local.summary,
			strengths: remote.strengths.length ? remote.strengths : local.strengths,
			recommendations: remote.recommendations.length ? remote.recommendations : local.recommendations,
			confidence: remote.confidence,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'невідома помилка';
		vscode.window.showWarningMessage(`LinkAI: AI-аналіз не вдався (${reason}) Показано локальний аналіз.`);
		return local;
	}
}

// ─────────────────────────────────────────────
// WEBVIEW CONTROLLER (shared by sidebar and analysis page)
// ─────────────────────────────────────────────

function buildPanelState(context: vscode.ExtensionContext, tracker: WritingTracker): PanelState {
	const history = tracker.getHistory();
	return {
		settings: getStoredSettings(context),
		session: tracker.getSessionStats(),
		current: summarizePeriod(history, 0),
		previous: summarizePeriod(history, PERIOD_DAYS),
		languages: topLanguages(history).slice(0, 5),
		files: topFiles(history).slice(0, 5),
		lastAnalysis: context.globalState.get<AnalysisResult>(LAST_ANALYSIS_KEY),
	};
}

function createController(context: vscode.ExtensionContext, tracker: WritingTracker, webview: vscode.Webview) {
	let analysisRunning = false;
	const send = (message: HostMessage): void => {
		void webview.postMessage(message);
	};
	const sendState = (): void => {
		send({ type: 'state', payload: buildPanelState(context, tracker) });
	};

	const handle = async (message: ViewMessage): Promise<void> => {
		switch (message.type) {
			case 'requestState':
				sendState();
				break;
			case 'saveSettings': {
				const settings: Settings = {
					backendUrl: message.payload.backendUrl.trim() || DEFAULT_SETTINGS.backendUrl,
					defaultLanguage: supportedLanguages.includes(message.payload.defaultLanguage as typeof supportedLanguages[number]) ? message.payload.defaultLanguage : DEFAULT_SETTINGS.defaultLanguage,
					sendAggregatedStatistics: Boolean(message.payload.sendAggregatedStatistics),
				};
				await saveStoredSettings(context, settings);
				send({ type: 'settingsSaved', payload: settings });
				sendState();
				break;
			}
			case 'runAnalysis': {
				if (analysisRunning) { return; }
				analysisRunning = true;
				send({ type: 'analysisStarted' });
				try {
					await tracker.flush();
					const result = await buildAnalysis(context, tracker);
					await context.globalState.update(LAST_ANALYSIS_KEY, result);
					send({ type: 'analysisCompleted', payload: result });
				} catch (error) {
					const text = error instanceof Error ? error.message : 'Не вдалося виконати аналіз.';
					send({ type: 'analysisFailed', payload: { message: text } });
				} finally {
					analysisRunning = false;
				}
				break;
			}
			default:
				break;
		}
	};

	return { handle, sendState };
}

// ─────────────────────────────────────────────
// SIDEBAR: CONFIG ONLY
// ─────────────────────────────────────────────

class LinkAiConfigViewProvider implements vscode.WebviewViewProvider {
	private sendState?: () => void;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly tracker: WritingTracker,
	) {}

	public resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = { enableScripts: true, enableCommandUris: true };
		view.webview.html = getConfigHtml();

		const controller = createController(this.context, this.tracker, view.webview);
		this.sendState = controller.sendState;
		view.webview.onDidReceiveMessage((message: ViewMessage) => void controller.handle(message));
		view.onDidDispose(() => { this.sendState = undefined; });
		controller.sendState();
	}

	public refresh(): void {
		this.sendState?.();
	}
}

// ─────────────────────────────────────────────
// EDITOR TAB: ANALYSIS PAGE
// ─────────────────────────────────────────────

let analysisPanel: vscode.WebviewPanel | undefined;

function openAnalysisPanel(context: vscode.ExtensionContext, tracker: WritingTracker): void {
	if (analysisPanel) {
		analysisPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'linkai.analysis',
		'LinkAI — Аналіз коду',
		vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true },
	);
	analysisPanel = panel;
	panel.webview.html = getAnalysisHtml();

	const controller = createController(context, tracker, panel.webview);
	const subscriptions: vscode.Disposable[] = [
		panel.webview.onDidReceiveMessage((message: ViewMessage) => void controller.handle(message)),
		panel.onDidChangeViewState((event) => { if (event.webviewPanel.visible) { controller.sendState(); } }),
		tracker.onDidChange(() => { if (panel.visible) { controller.sendState(); } }),
	];
	panel.onDidDispose(() => {
		analysisPanel = undefined;
		subscriptions.forEach((subscription) => subscription.dispose());
	}, null, context.subscriptions);
}

// ─────────────────────────────────────────────
// ACTIVATE
// ─────────────────────────────────────────────

let activeTracker: WritingTracker | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'linkai.openAnalysis';
	const tracker = new WritingTracker(context, statusBar);
	activeTracker = tracker;
	const configProvider = new LinkAiConfigViewProvider(context, tracker);

	// Register the sidebar view first, so it works even if something below fails.
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('linkai.statistics', configProvider),
		statusBar,
		tracker,
	);
	statusBar.show();

	context.subscriptions.push(
		vscode.commands.registerCommand('linkai.openAnalysis', () => {
			openAnalysisPanel(context, tracker);
		}),
		// Kept for backwards compatibility: now opens the config sidebar
		vscode.commands.registerCommand('linkai.openStatistics', () => {
			void vscode.commands.executeCommand('workbench.view.extension.linkai');
			configProvider.refresh();
		}),
		vscode.commands.registerCommand('linkai.setBackendToken', async () => {
			const token = await vscode.window.showInputBox({ prompt: 'Токен AI-бекенду', password: true, ignoreFocusOut: true });
			if (token !== undefined) {
				await context.secrets.store('linkai.backendToken', token);
				vscode.window.showInformationMessage('Токен AI-бекенду збережено у SecretStorage.');
			}
		}),
		vscode.workspace.onDidChangeTextDocument((event) => tracker.handleChange(event)),
	);
}

export function deactivate(): Thenable<void> | undefined {
	return activeTracker?.flush();
}

// ─────────────────────────────────────────────
// WEBVIEW HTML
// ─────────────────────────────────────────────

function getNonce(): string {
	return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function baseStyles(): string {
	return `
		:root {
			--bg: #0b1020;
			--border: rgba(123, 92, 255, 0.38);
			--primary: #8b5cf6;
			--primary-soft: #c4b5fd;
			--accent: #7dd3fc;
			--text: #e5e7eb;
			--muted: #a1a9ba;
			--shadow: 0 18px 34px rgba(15, 23, 42, 0.45);
		}
		* { box-sizing: border-box; }
		[hidden] { display: none !important; }
		body {
			margin: 0;
			padding: 18px;
			background: radial-gradient(circle at top right, rgba(139, 92, 246, 0.18), transparent 25%), var(--bg);
			color: var(--text);
			font-family: var(--vscode-font-family);
		}
		main { max-width: 960px; margin: 0 auto; }
		header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			padding-bottom: 16px;
			margin-bottom: 16px;
			border-bottom: 1px solid var(--border);
		}
		h1 { margin: 0; font-size: 28px; letter-spacing: -0.04em; }
		h2 { margin: 0 0 12px; font-size: 16px; }
		.eyebrow {
			font-size: 10px;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: var(--primary-soft);
		}
		button, select, input { font: inherit; }
		button, a.button {
			display: inline-block;
			padding: 9px 14px;
			border-radius: 8px;
			border: 1px solid var(--border);
			background: rgba(15, 23, 42, 0.85);
			color: var(--text);
			cursor: pointer;
			text-decoration: none;
			text-align: center;
		}
		button:focus-visible, a.button:focus-visible, input:focus-visible, select:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}
		button:disabled { opacity: 0.55; cursor: default; }
		button.primary {
			background: linear-gradient(135deg, var(--primary), #a78bfa);
			border-color: transparent;
			color: #111827;
			font-weight: 700;
			box-shadow: 0 12px 24px rgba(139, 92, 246, 0.3);
		}
		.panel {
			background: linear-gradient(180deg, rgba(17, 24, 39, 0.98), rgba(15, 23, 42, 0.9));
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 18px;
			margin-bottom: 16px;
			box-shadow: var(--shadow);
		}
		.settings { display: grid; gap: 14px; }
		.input { display: grid; gap: 7px; }
		label {
			font-size: 11px;
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--muted);
		}
		label.checkbox { text-transform: none; letter-spacing: normal; font-size: 13px; }
		input, select {
			width: 100%;
			border-radius: 8px;
			border: 1px solid var(--border);
			background: rgba(15, 23, 42, 0.85);
			color: var(--text);
			padding: 10px 12px;
		}
		.row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
		.checkbox { display: flex; align-items: center; gap: 10px; color: var(--text); }
		.checkbox input { width: auto; accent-color: var(--primary); }
		.note { font-size: 12px; color: var(--muted); line-height: 1.5; }
		.actions { display: grid; gap: 10px; }

		.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
		.stat {
			padding: 12px 14px;
			border-radius: 10px;
			border: 1px solid var(--border);
			background: rgba(15, 23, 42, 0.6);
		}
		.stat-label { font-size: 12px; color: var(--muted); }
		.stat-value { font-size: 24px; font-weight: 700; margin: 4px 0 2px; color: var(--primary-soft); }
		.stat-sub { font-size: 11px; color: var(--muted); }
		.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
		.list { list-style: none; margin: 0; padding: 0; }
		.list li {
			display: flex;
			justify-content: space-between;
			gap: 12px;
			padding: 6px 0;
			border-bottom: 1px solid rgba(123, 92, 255, 0.15);
			font-size: 13px;
		}
		.list li.empty { color: var(--muted); border-bottom: none; }
		.list .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
		.list span:last-child { color: var(--muted); white-space: nowrap; }

		#result { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
		#result:empty { display: none; }
		.score {
			display: inline-flex;
			padding: 8px 12px;
			border-radius: 999px;
			background: rgba(139, 92, 246, 0.18);
			border: 1px solid rgba(125, 211, 252, 0.3);
			color: var(--primary-soft);
			font-weight: 700;
			margin-right: 10px;
			margin-bottom: 10px;
		}
		.confidence { font-size: 12px; color: var(--muted); }
		#result p { margin: 0 0 12px; line-height: 1.6; }
		#result strong {
			display: block;
			margin-top: 14px;
			margin-bottom: 8px;
			font-size: 11px;
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--muted);
		}
		#result ul { margin: 0; padding-left: 18px; line-height: 1.7; }
	`;
}

/** Sidebar page: plugin config only. */
function getConfigHtml(): string {
	const nonce = getNonce();
	const script = `
		const vscode = acquireVsCodeApi();
		const backendUrl = document.getElementById('backendUrl');
		const defaultLanguage = document.getElementById('defaultLanguage');
		const sendAggregatedStatistics = document.getElementById('sendAggregatedStatistics');
		const status = document.getElementById('status');

		window.addEventListener('message', function (event) {
			const message = event.data;
			if (!message) return;
			if (message.type === 'state') {
				const settings = (message.payload && message.payload.settings) || {};
				backendUrl.value = settings.backendUrl || 'http://localhost:8000';
				defaultLanguage.value = settings.defaultLanguage || 'TypeScript';
				sendAggregatedStatistics.checked = Boolean(settings.sendAggregatedStatistics);
			}
			if (message.type === 'settingsSaved') {
				status.textContent = 'Конфігурацію збережено';
			}
		});

		document.getElementById('saveConfig').addEventListener('click', function () {
			vscode.postMessage({ type: 'saveSettings', payload: {
				backendUrl: backendUrl.value,
				defaultLanguage: defaultLanguage.value,
				sendAggregatedStatistics: sendAggregatedStatistics.checked,
			} });
		});

		vscode.postMessage({ type: 'requestState' });
	`;

	return `<!DOCTYPE html>
<html lang="uk">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
	<title>LinkAI Config</title>
	<style>${baseStyles()}
		body { padding: 12px; }
		h1 { font-size: 22px; }
		.panel { padding: 14px; }
	</style>
</head>
<body>
	<main>
		<header>
			<div>
				<div class="eyebrow">Налаштування</div>
				<h1>LinkAI</h1>
			</div>
		</header>

		<section class="panel settings">
			<div class="input">
				<label for="backendUrl">Backend URL</label>
				<input id="backendUrl" type="text" value="http://localhost:8000" />
			</div>
			<div class="input">
				<label for="defaultLanguage">Мова за замовчуванням</label>
				<select id="defaultLanguage">
					${supportedLanguages.map((language) => `<option value="${language}">${language}</option>`).join('')}
				</select>
			</div>
			<label class="checkbox"><input id="sendAggregatedStatistics" type="checkbox" /> Дозволити надсилання агрегованої статистики</label>
			<div class="note">Надсилаються лише числа (рядки, дні, сесії) та мова. Код і назви файлів залишаються на вашому комп'ютері. Вимкнено — аналіз виконується локально.</div>
			<button id="saveConfig" class="primary" type="button">Зберегти конфіг</button>
			<div class="note" id="status"></div>
		</section>

		<section class="panel actions">
			<a class="button" href="command:linkai.openAnalysis">Відкрити аналіз коду</a>
			<a class="button" href="command:linkai.setBackendToken">Задати токен бекенду</a>
		</section>
	</main>

	<script nonce="${nonce}">
		${script}
	</script>
</body>
</html>`;
}

/** Editor-tab page: tracked data + "Зробити аналіз коду". */
function getAnalysisHtml(): string {
	const nonce = getNonce();
	// NOTE: this string lives inside a TS template literal, so it must avoid backslashes (\s would become "s").
	const script = `
		const vscode = acquireVsCodeApi();
		const result = document.getElementById('result');
		const status = document.getElementById('status');
		const runButton = document.getElementById('runAnalysis');
		const confidenceLabels = { high: 'висока', medium: 'середня', low: 'низька' };
		let firstState = true;

		function esc(value) {
			return String(value == null ? '' : value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		}
		function fmt(value) { return Number(value || 0).toLocaleString(); }
		function setText(id, text) { document.getElementById(id).textContent = text; }
		function renderList(id, items, format) {
			const el = document.getElementById(id);
			if (!items || !items.length) {
				el.innerHTML = '<li class="empty">Ще немає даних</li>';
				return;
			}
			el.innerHTML = items.map(function (item) { return '<li>' + format(item) + '</li>'; }).join('');
		}
		function renderAnalysis(payload) {
			if (!payload) return;
			const strengths = (payload.strengths || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('');
			const recommendations = (payload.recommendations || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('');
			const confidence = confidenceLabels[payload.confidence] || '';
			result.innerHTML =
				'<span class="score">' + esc(payload.score || 0) + '/100</span>' +
				(confidence ? '<span class="confidence">Впевненість: ' + esc(confidence) + '</span>' : '') +
				'<p>' + esc(payload.summary) + '</p>' +
				'<strong>Сильні сторони</strong><ul>' + strengths + '</ul>' +
				'<strong>Поради</strong><ul>' + recommendations + '</ul>';
		}
		function renderState(state) {
			const c = state.current;
			const p = state.previous;
			const s = state.session;
			setText('sessionWords', fmt(s.words));
			setText('sessionWordsSub', 'усього: ' + fmt(s.totalWords));
			setText('linesAdded', fmt(c.linesAdded));
			setText('linesAddedSub', 'попередні 30 днів: ' + fmt(p.linesAdded));
			setText('linesDeleted', fmt(c.linesDeleted));
			setText('linesDeletedSub', 'попередні 30 днів: ' + fmt(p.linesDeleted));
			setText('activeDays', fmt(c.activeDays) + ' / 30');
			setText('activeDaysSub', 'сесій: ' + fmt(c.sessions));
			renderList('languages', state.languages, function (l) {
				return '<span>' + esc(l.name) + '</span><span>' + fmt(l.words) + ' слів</span>';
			});
			renderList('files', state.files, function (f) {
				return '<span class="path" title="' + esc(f.path) + '">' + esc(f.path) + '</span><span>+' + fmt(f.linesAdded) + ' / −' + fmt(f.linesDeleted) + '</span>';
			});
			document.getElementById('emptyHint').hidden = (c.words > 0 || c.linesAdded > 0 || c.linesDeleted > 0);
			if (firstState) {
				firstState = false;
				if (state.lastAnalysis) renderAnalysis(state.lastAnalysis);
			}
		}

		window.addEventListener('message', function (event) {
			const message = event.data;
			if (!message) return;
			if (message.type === 'state') renderState(message.payload);
			if (message.type === 'analysisStarted') {
				runButton.disabled = true;
				status.textContent = 'Аналізую відстежені дані...';
			}
			if (message.type === 'analysisCompleted') {
				runButton.disabled = false;
				status.textContent = 'Аналіз готовий';
				renderAnalysis(message.payload);
			}
			if (message.type === 'analysisFailed') {
				runButton.disabled = false;
				status.textContent = 'Помилка аналізу';
				result.innerHTML = '<p>' + esc(message.payload && message.payload.message ? message.payload.message : 'Не вдалося виконати аналіз.') + '</p>';
			}
		});

		runButton.addEventListener('click', function () {
			vscode.postMessage({ type: 'runAnalysis' });
		});

		vscode.postMessage({ type: 'requestState' });
	`;

	return `<!DOCTYPE html>
<html lang="uk">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
	<title>LinkAI — Аналіз коду</title>
	<style>${baseStyles()}</style>
</head>
<body>
	<main>
		<header>
			<div>
				<div class="eyebrow">Local AI</div>
				<h1>Аналіз коду</h1>
			</div>
		</header>

		<section class="panel">
			<h2>Відстежені зміни</h2>
			<div class="stats">
				<div class="stat"><div class="stat-label">Слів за сесію</div><div class="stat-value" id="sessionWords">0</div><div class="stat-sub" id="sessionWordsSub"></div></div>
				<div class="stat"><div class="stat-label">Додано рядків, 30 днів</div><div class="stat-value" id="linesAdded">0</div><div class="stat-sub" id="linesAddedSub"></div></div>
				<div class="stat"><div class="stat-label">Видалено рядків, 30 днів</div><div class="stat-value" id="linesDeleted">0</div><div class="stat-sub" id="linesDeletedSub"></div></div>
				<div class="stat"><div class="stat-label">Активних днів</div><div class="stat-value" id="activeDays">0 / 30</div><div class="stat-sub" id="activeDaysSub"></div></div>
			</div>
			<div class="columns">
				<div>
					<h2>Мови</h2>
					<ul class="list" id="languages"></ul>
				</div>
				<div>
					<h2>Найактивніші файли</h2>
					<ul class="list" id="files"></ul>
				</div>
			</div>
			<p class="note" id="emptyHint" hidden>Змін ще не зафіксовано. Пишіть код у відкритих файлах — розширення відстежує їх автоматично, дані з'являться тут за кілька секунд.</p>
		</section>

		<section class="panel">
			<div class="row" style="margin-top:0">
				<button id="runAnalysis" class="primary" type="button">Зробити аналіз коду</button>
			</div>
			<div class="note" id="status" style="margin-top:10px">Аналіз спирається на дані, зібрані за останні 30 днів.</div>
			<div id="result"></div>
		</section>
	</main>

	<script nonce="${nonce}">
		${script}
	</script>
</body>
</html>`;
}