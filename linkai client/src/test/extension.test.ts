import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { evaluateAchievements } from '../services/achievements';
import { countWords } from '../extension';
import { AiClient } from '../services/aiClient';
import { collectStatistics, languageForDocument } from '../services/statistics';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('aggregates current and previous periods by language', () => {
		const now = Date.parse('2026-09-13T12:00:00.000Z');
		const day = 24 * 60 * 60 * 1000;
		const events = [
			{ timestamp: now - day, language: 'TypeScript', linesAdded: 10, linesDeleted: 2 },
			{ timestamp: now - 2 * day, language: 'TypeScript', linesAdded: 5, linesDeleted: 1 },
			{ timestamp: now - 8 * day, language: 'TypeScript', linesAdded: 4, linesDeleted: 0 },
			{ timestamp: now - day, language: 'Python', linesAdded: 99, linesDeleted: 0 },
		];
		const result = collectStatistics(events, 'TypeScript', 7, now);

		assert.deepStrictEqual(result.summary, {
			linesAdded: 15,
			linesDeleted: 3,
			linesChanged: 18,
			activeDays: 2,
			sessions: 2,
			averageLinesPerActiveDay: 7.5,
		});
		assert.strictEqual(result.comparison.linesAddedPercent, 275);
		assert.strictEqual(result.dailyActivity.length, 2);
	});

	test('counts words for the status bar and saved analysis state', () => {
		assert.strictEqual(countWords('hello world from linkai'), 4);
		assert.strictEqual(countWords('  hello\n\n world  '), 2);
		assert.strictEqual(countWords(''), 0);
	});

	test('maps editor language identifiers', () => {
		assert.strictEqual(languageForDocument('typescriptreact'), 'TypeScript');
		assert.strictEqual(languageForDocument('unknown'), 'Інша');
	});

	test('evaluates simple achievements independently from the tracker', () => {
		const achievements = evaluateAchievements({ words: 200, linesAdded: 100, linesDeleted: 25, activeDays: 7, sessions: 5 });
		assert.strictEqual(achievements.length, 4);
		assert.ok(achievements.every((achievement) => achievement.earned));
	});

	test('builds the evaluate endpoint from a local backend base URL', async () => {
		const calls: string[] = [];
		const originalFetch = (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
		(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (input: string | URL, init?: RequestInit) => {
			calls.push(String(input));
			return {
				ok: true,
				json: async () => ({
					score: 82,
					trend: 'improving',
					summary: 'Гарний прогрес',
					strengths: ['Стабільність'],
					recommendations: ['Працювати регулярно'],
					confidence: 'medium',
				}),
			} as Response;
		}) as typeof fetch;

		try {
			const client = new AiClient(async () => 'token-123');
			await client.evaluate({
				language: 'TypeScript',
				periodDays: 30,
				current: { linesAdded: 100, linesDeleted: 20, linesChanged: 120, activeDays: 5, sessions: 7, averageLinesPerActiveDay: 20 },
				previous: { linesAdded: 80, linesDeleted: 15, linesChanged: 95, activeDays: 4, sessions: 5, averageLinesPerActiveDay: 20 },
			}, 'http://localhost:8000');
			assert.deepStrictEqual(calls, ['http://localhost:8000/api/v1/ai/evaluate']);
		} finally {
			(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = originalFetch;
		}
	});
});
