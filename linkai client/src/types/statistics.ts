export const supportedLanguages = [
	'TypeScript',
	'JavaScript',
	'Python',
	'Java',
	'C#',
	'Go',
	'C++',
	'Інша',
] as const;

export type SupportedLanguage = typeof supportedLanguages[number];
export type PeriodDays = 7 | 30 | 90;

export interface Summary {
	linesAdded: number;
	linesDeleted: number;
	linesChanged: number;
	activeDays: number;
	sessions: number;
	averageLinesPerActiveDay: number;
}

export interface DailyActivity {
	date: string;
	linesAdded: number;
	linesChanged: number;
}

export interface PeriodComparison {
	linesAddedPercent: number | null;
	activeDaysPercent: number | null;
	averageLinesPercent: number | null;
}

export interface Statistics {
	language: string;
	period: PeriodDays;
	summary: Summary;
	dailyActivity: DailyActivity[];
	comparison: PeriodComparison;
}

export interface AiEvaluation {
	score: number;
	trend: 'improving' | 'stable' | 'declining';
	summary: string;
	strengths: string[];
	recommendations: string[];
	confidence: 'low' | 'medium' | 'high';
}

export interface ActivityEvent {
	timestamp: number;
	language: string;
	linesAdded: number;
	linesDeleted: number;
}

export function emptySummary(): Summary {
	return {
		linesAdded: 0,
		linesDeleted: 0,
		linesChanged: 0,
		activeDays: 0,
		sessions: 0,
		averageLinesPerActiveDay: 0,
	};
}

export function percentChange(current: number, previous: number): number | null {
	if (previous === 0) {
		return current === 0 ? 0 : null;
	}
	return Math.round(((current - previous) / previous) * 1000) / 10;
}