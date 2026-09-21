export interface AchievementStats {
	words: number;
	linesAdded: number;
	linesDeleted: number;
	activeDays: number;
	sessions: number;
}

export interface AchievementDefinition {
	id: string;
	title: string;
	description: string;
	check: (stats: AchievementStats) => boolean;
}

export interface Achievement extends Omit<AchievementDefinition, 'check'> {
	earned: boolean;
}

export const achievementDefinitions: AchievementDefinition[] = [
	{
		id: 'first-lines',
		title: 'Перші рядки',
		description: 'Додайте перші 10 рядків коду.',
		check: (stats) => stats.linesAdded >= 10,
	},
	{
		id: 'steady-week',
		title: 'Ритм тижня',
		description: 'Працюйте з кодом упродовж 7 активних днів.',
		check: (stats) => stats.activeDays >= 7,
	},
	{
		id: 'century',
		title: 'Сотня',
		description: 'Додайте 100 рядків коду.',
		check: (stats) => stats.linesAdded >= 100,
	},
	{
		id: 'refactorer',
		title: 'Рефактор',
		description: 'Видаліть 25 рядків під час роботи над кодом.',
		check: (stats) => stats.linesDeleted >= 25,
	},
];

export function evaluateAchievements(stats: AchievementStats): Achievement[] {
	return achievementDefinitions.map(({ check, ...achievement }) => ({
		...achievement,
		earned: check(stats),
	}));
}