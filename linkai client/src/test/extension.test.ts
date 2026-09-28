import * as assert from 'assert';
import * as vscode from 'vscode';
import { evaluateAchievements, achievementDefinitions } from '../services/achievements';
import { countWords } from '../extension';
import { AiClient } from '../services/aiClient';
import { collectStatistics, languageForDocument, summarizePeriod } from '../services/statistics';
import { emptySummary, percentChange, supportedLanguages } from '../types/statistics';

suite('Extension Test Suite & LinkAI Unit Tests', () => {
	vscode.window.showInformationMessage('Start all tests.');

	suite('Statistics & Aggregation Service', () => {
		test('emptySummary returns all zeroed metrics', () => {
			const empty = emptySummary();
			assert.strictEqual(empty.linesAdded, 0);
			assert.strictEqual(empty.linesDeleted, 0);
			assert.strictEqual(empty.linesChanged, 0);
			assert.strictEqual(empty.activeDays, 0);
			assert.strictEqual(empty.sessions, 0);
			assert.strictEqual(empty.averageLinesPerActiveDay, 0);
		});

		test('percentChange computes valid percentages and edge cases', () => {
			assert.strictEqual(percentChange(120, 100), 20);
			assert.strictEqual(percentChange(80, 100), -20);
			assert.strictEqual(percentChange(100, 100), 0);
			assert.strictEqual(percentChange(0, 100), -100);
			assert.strictEqual(percentChange(0, 0), 0);
			assert.strictEqual(percentChange(50, 0), null);
		});

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

		test('handles empty activity gracefully', () => {
			const result = collectStatistics([], 'TypeScript', 30);
			assert.deepStrictEqual(result.summary, emptySummary());
			assert.deepStrictEqual(result.dailyActivity, []);
			assert.strictEqual(result.comparison.linesAddedPercent, 0);
		});

		test('groups sessions separated by > 30 minutes correctly', () => {
			const now = Date.parse('2026-09-13T12:00:00.000Z');
			const minute = 60 * 1000;
			const events = [
				{ timestamp: now - 10 * minute, language: 'Python', linesAdded: 5, linesDeleted: 0 },
				{ timestamp: now - 5 * minute, language: 'Python', linesAdded: 5, linesDeleted: 0 }, // same session
				{ timestamp: now - 45 * minute, language: 'Python', linesAdded: 5, linesDeleted: 0 }, // previous session
			];
			const result = collectStatistics(events, 'Python', 7, now);
			assert.strictEqual(result.summary.sessions, 2);
			assert.strictEqual(result.summary.linesAdded, 15);
		});

		test('summarizePeriod retrieves custom offset periods', () => {
			const now = Date.parse('2026-09-13T12:00:00.000Z');
			const day = 24 * 60 * 60 * 1000;
			const events = [
				{ timestamp: now - 2 * day, language: 'Go', linesAdded: 20, linesDeleted: 5 },
				{ timestamp: now - 10 * day, language: 'Go', linesAdded: 50, linesDeleted: 10 },
			];
			const currentSummary = summarizePeriod(events, 'Go', 7, now, 0);
			const prevSummary = summarizePeriod(events, 'Go', 7, now, 1);

			assert.strictEqual(currentSummary.linesAdded, 20);
			assert.strictEqual(prevSummary.linesAdded, 50);
		});
	});

	suite('Language Mapping', () => {
		test('maps editor language identifiers accurately', () => {
			assert.strictEqual(languageForDocument('typescript'), 'TypeScript');
			assert.strictEqual(languageForDocument('typescriptreact'), 'TypeScript');
			assert.strictEqual(languageForDocument('javascript'), 'JavaScript');
			assert.strictEqual(languageForDocument('javascriptreact'), 'JavaScript');
			assert.strictEqual(languageForDocument('python'), 'Python');
			assert.strictEqual(languageForDocument('java'), 'Java');
			assert.strictEqual(languageForDocument('csharp'), 'C#');
			assert.strictEqual(languageForDocument('go'), 'Go');
			assert.strictEqual(languageForDocument('cpp'), 'C++');
			assert.strictEqual(languageForDocument('c'), 'C++');
			assert.strictEqual(languageForDocument('unknown_lang'), 'Інша');
		});

		test('all supported languages are defined', () => {
			assert.ok(supportedLanguages.includes('TypeScript'));
			assert.ok(supportedLanguages.includes('JavaScript'));
			assert.ok(supportedLanguages.includes('Python'));
			assert.ok(supportedLanguages.includes('Java'));
			assert.ok(supportedLanguages.includes('C#'));
			assert.ok(supportedLanguages.includes('Go'));
			assert.ok(supportedLanguages.includes('C++'));
			assert.ok(supportedLanguages.includes('Інша'));
		});
	});

	suite('Achievements Service', () => {
		test('evaluates locked and earned achievements', () => {
			assert.strictEqual(achievementDefinitions.length, 4);

			const emptyStats = { words: 0, linesAdded: 0, linesDeleted: 0, activeDays: 0, sessions: 0 };
			const unearned = evaluateAchievements(emptyStats);
			assert.ok(unearned.every((a) => !a.earned));

			const partialStats = { words: 50, linesAdded: 15, linesDeleted: 0, activeDays: 2, sessions: 2 };
			const partial = evaluateAchievements(partialStats);
			const firstLines = partial.find((a) => a.id === 'first-lines');
			const century = partial.find((a) => a.id === 'century');
			assert.strictEqual(firstLines?.earned, true);
			assert.strictEqual(century?.earned, false);
		});
	});

	suite('Word Counter Helper', () => {
		test('counts words for various strings and edge cases', () => {
			assert.strictEqual(countWords('hello world from linkai'), 4);
			assert.strictEqual(countWords('  hello\n\n world  '), 2);
			assert.strictEqual(countWords(''), 0);
			assert.strictEqual(countWords('   \t\n   '), 0);
			assert.strictEqual(countWords('word'), 1);
		});
	});

	suite('AiClient Service', () => {
		test('validates backend URL protocols and security restrictions', async () => {
			const client = new AiClient(async () => 'token');
			const sampleReq = {
				language: 'TypeScript',
				periodDays: 30 as const,
				current: emptySummary(),
				previous: emptySummary(),
			};

			// Empty URL
			await assert.rejects(async () => {
				await client.evaluate(sampleReq, '');
			}, /Адресу AI-бекенду не налаштовано/);

			// Invalid URL format
			await assert.rejects(async () => {
				await client.evaluate(sampleReq, 'not-a-valid-url');
			}, /Адреса AI-бекенду має бути коректним URL/);

			// Insecure HTTP on non-local host
			await assert.rejects(async () => {
				await client.evaluate(sampleReq, 'http://api.linkai.com');
			}, /HTTP дозволений лише для localhost/);
		});

		test('successfully calls evaluate endpoint and parses structured AI evaluation', async () => {
			const calls: string[] = [];
			const originalFetch = (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
			(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (input: string | URL, init?: RequestInit) => {
				calls.push(String(input));
				return {
					ok: true,
					json: async () => ({
						score: 82.4,
						trend: 'improving',
						summary: 'Гарний прогрес',
						strengths: ['Стабільність', 'Корисні рефакторинги'],
						recommendations: ['Працювати регулярно'],
						confidence: 'medium',
					}),
				} as Response;
			}) as typeof fetch;

			try {
				const client = new AiClient(async () => 'token-123');
				const response = await client.evaluate({
					language: 'TypeScript',
					periodDays: 30,
					current: { linesAdded: 100, linesDeleted: 20, linesChanged: 120, activeDays: 5, sessions: 7, averageLinesPerActiveDay: 20 },
					previous: { linesAdded: 80, linesDeleted: 15, linesChanged: 95, activeDays: 4, sessions: 5, averageLinesPerActiveDay: 20 },
				}, 'http://localhost:8000');

				assert.deepStrictEqual(calls, ['http://localhost:8000/api/v1/ai/evaluate']);
				assert.strictEqual(response.score, 82);
				assert.strictEqual(response.trend, 'improving');
				assert.strictEqual(response.confidence, 'medium');
				assert.strictEqual(response.strengths.length, 2);
			} finally {
				(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = originalFetch;
			}
		});
	});
});

