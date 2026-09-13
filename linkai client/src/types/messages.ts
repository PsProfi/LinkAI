import { AiEvaluation, PeriodDays, Statistics, Summary } from './statistics';

export type WebviewMessage =
	| { type: 'setLanguage'; language: string }
	| { type: 'setPeriod'; period: PeriodDays }
	| { type: 'requestStatistics' }
	| { type: 'requestCheck' };

export type ExtensionMessage =
	| { type: 'statisticsReady'; payload: Statistics }
	| { type: 'checkStarted' }
	| { type: 'checkCompleted'; payload: AiEvaluation }
	| { type: 'checkFailed'; payload: { message: string; retryable: boolean } };

export interface AiRequest {
	language: string;
	periodDays: PeriodDays;
	current: Summary;
	previous: Summary;
}