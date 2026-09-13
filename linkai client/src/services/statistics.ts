import { ActivityEvent, DailyActivity, PeriodComparison, PeriodDays, Statistics, Summary, emptySummary, percentChange } from '../types/statistics';

function startOfDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function aggregate(events: ActivityEvent[], from: number, to: number, language: string): { summary: Summary; dailyActivity: DailyActivity[] } {
	const filtered = events.filter((event) => event.language === language && event.timestamp >= from && event.timestamp < to);
	if (filtered.length === 0) {
		return { summary: emptySummary(), dailyActivity: [] };
	}

	const byDay = new Map<string, DailyActivity>();
	for (const event of filtered) {
		const date = startOfDay(event.timestamp);
		const day = byDay.get(date) ?? { date, linesAdded: 0, linesChanged: 0 };
		day.linesAdded += event.linesAdded;
		day.linesChanged += event.linesAdded + event.linesDeleted;
		byDay.set(date, day);
	}

	const dailyActivity = [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
	const linesAdded = filtered.reduce((total, event) => total + event.linesAdded, 0);
	const linesDeleted = filtered.reduce((total, event) => total + event.linesDeleted, 0);
	const activeDays = dailyActivity.length;
	const sessionEvents = [...filtered].sort((left, right) => left.timestamp - right.timestamp);
	const sessions = sessionEvents.reduce((total, event, index) => index === 0 || event.timestamp - sessionEvents[index - 1].timestamp > 30 * 60 * 1000 ? total + 1 : total, 0);
	return {
		summary: {
			linesAdded,
			linesDeleted,
			linesChanged: linesAdded + linesDeleted,
			activeDays,
			sessions,
			averageLinesPerActiveDay: activeDays === 0 ? 0 : Math.round((linesAdded / activeDays) * 10) / 10,
		},
		dailyActivity,
	};
}

export function collectStatistics(events: ActivityEvent[], language: string, period: PeriodDays, now = Date.now()): Statistics {
	const currentStart = now - period * 24 * 60 * 60 * 1000;
	const previousStart = currentStart - period * 24 * 60 * 60 * 1000;
	const current = aggregate(events, currentStart, now, language);
	const previous = aggregate(events, previousStart, currentStart, language);
	const comparison: PeriodComparison = {
		linesAddedPercent: percentChange(current.summary.linesAdded, previous.summary.linesAdded),
		activeDaysPercent: percentChange(current.summary.activeDays, previous.summary.activeDays),
		averageLinesPercent: percentChange(current.summary.averageLinesPerActiveDay, previous.summary.averageLinesPerActiveDay),
	};
	return { language, period, summary: current.summary, dailyActivity: current.dailyActivity, comparison };
}

export function languageForDocument(languageId: string): string {
	const languages: Record<string, string> = {
		typescript: 'TypeScript',
		typescriptreact: 'TypeScript',
		javascript: 'JavaScript',
		javascriptreact: 'JavaScript',
		python: 'Python',
		java: 'Java',
		csharp: 'C#',
		go: 'Go',
		cpp: 'C++',
		c: 'C++',
	};
	return languages[languageId] ?? 'Інша';
}

export function summarizePeriod(events: ActivityEvent[], language: string, period: PeriodDays, now = Date.now(), offset = 0): Summary {
	const periodMilliseconds = period * 24 * 60 * 60 * 1000;
	const to = now - offset * periodMilliseconds;
	return aggregate(events, to - periodMilliseconds, to, language).summary;
}