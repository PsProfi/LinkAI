import { AiRequest } from '../types/messages';
import { AiEvaluation } from '../types/statistics';

const EVALUATE_PATH = '/api/v1/ai/evaluate';
const API_MARKER = '/api/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

export class AiClient {
	public constructor(private readonly getToken: () => Thenable<string | undefined>) {}

	/**
	 * Builds the evaluate URL from whatever the user typed as backend URL:
	 * "http://localhost:8000", ".../api/v1" and ".../api/v1/ai/evaluate" all resolve to the same endpoint.
	 * A reverse-proxy prefix before "/api/v1" is preserved.
	 */
	private buildEvaluateUrl(backendUrl: string): URL {
		const raw = backendUrl.trim();
		if (!raw) {
			throw new Error('Адресу AI-бекенду не налаштовано.');
		}
		let parsed: URL;
		try {
			parsed = new URL(raw);
		} catch {
			throw new Error('Адреса AI-бекенду має бути коректним URL.');
		}
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			throw new Error('Для AI-бекенду потрібен HTTP або HTTPS URL.');
		}
		if (parsed.protocol !== 'https:' && !LOCAL_HOSTS.has(parsed.hostname)) {
			throw new Error('HTTP дозволений лише для localhost або 127.0.0.1. Для інших адрес потрібен HTTPS.');
		}

		const markerIndex = parsed.pathname.indexOf(API_MARKER);
		const prefix = markerIndex > 0 ? parsed.pathname.slice(0, markerIndex).replace(/\/+$/, '') : '';
		return new URL(prefix + EVALUATE_PATH, parsed.origin);
	}

	public async evaluate(request: AiRequest, backendUrl: string): Promise<AiEvaluation> {
		const url = this.buildEvaluateUrl(backendUrl);
		const token = await this.getToken();

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		let payload: Partial<AiEvaluation>;
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(request),
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(`AI-бекенд повернув помилку ${response.status}.`);
			}
			payload = await response.json() as Partial<AiEvaluation>;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('AI-бекенд не відповів вчасно.');
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}

		if (typeof payload.score !== 'number' || payload.score < 0 || payload.score > 100 || !payload.summary || !Array.isArray(payload.recommendations)) {
			throw new Error('AI-бекенд повернув неповну відповідь.');
		}
		return {
			score: Math.round(payload.score),
			trend: payload.trend === 'improving' || payload.trend === 'declining' ? payload.trend : 'stable',
			summary: payload.summary,
			strengths: Array.isArray(payload.strengths) ? payload.strengths.slice(0, 6).map(String) : [],
			recommendations: payload.recommendations.slice(0, 4).map(String),
			confidence: payload.confidence === 'low' || payload.confidence === 'high' ? payload.confidence : 'medium',
		};
	}
}