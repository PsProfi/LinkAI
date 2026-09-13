import { AiRequest } from '../types/messages';
import { AiEvaluation } from '../types/statistics';

export class AiClient {
	public constructor(private readonly getToken: () => Thenable<string | undefined>) {}

	public async evaluate(request: AiRequest, backendUrl: string): Promise<AiEvaluation> {
		const url = backendUrl.trim();
		if (!url) {
			throw new Error('Адресу AI-бекенду не налаштовано.');
		}
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			throw new Error('Адреса AI-бекенду має бути коректним URL.');
		}
		if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
			throw new Error('Для AI-бекенду потрібен HTTPS URL.');
		}

		const token = await this.getToken();
		const response = await fetch(parsedUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			throw new Error(`AI-бекенд повернув помилку ${response.status}.`);
		}
		const payload = await response.json() as Partial<AiEvaluation>;
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