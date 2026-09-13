import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
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

	test('maps editor language identifiers', () => {
		assert.strictEqual(languageForDocument('typescriptreact'), 'TypeScript');
		assert.strictEqual(languageForDocument('unknown'), 'Інша');
	});
});
