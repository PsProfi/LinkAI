import { AiEvaluation, PeriodDays, Statistics, Summary } from './statistics';

export interface AnalysisResult {
	score: number;
	summary: string;
	strengths: string[];
	recommendations: string[];
	confidence: 'low' | 'medium' | 'high';
}

export type WebviewMessage =
	| { type: 'requestConfig' }
	| { type: 'saveSettings'; payload: { backendUrl: string; defaultLanguage: string; sendAggregatedStatistics: boolean } }
	| { type: 'saveDraft'; payload: { code: string } }
	| { type: 'runAnalysis'; payload?: { code?: string } }
	| { type: 'setLanguage'; language: string }
	| { type: 'setPeriod'; period: PeriodDays }
	| { type: 'requestStatistics' }
	| { type: 'requestCheck' };

export type ExtensionMessage =
	| { type: 'stateReady'; payload: { draft: string; wordCount: number; backendUrl: string; defaultLanguage: string; sendAggregatedStatistics: boolean; lastAnalysis?: AnalysisResult } }
	| { type: 'settingsSaved'; payload: { backendUrl: string; defaultLanguage: string; sendAggregatedStatistics: boolean } }
	| { type: 'statisticsReady'; payload: Statistics }
	| { type: 'checkStarted' }
	| { type: 'checkCompleted'; payload: AiEvaluation }
	| { type: 'checkFailed'; payload: { message: string; retryable: boolean } }
	| { type: 'analysisStarted' }
	| { type: 'analysisCompleted'; payload: AnalysisResult }
	| { type: 'analysisFailed'; payload: { message: string } };

export interface AiRequest {
	language: string;
	periodDays: PeriodDays;
	current: Summary;
	previous: Summary;
}