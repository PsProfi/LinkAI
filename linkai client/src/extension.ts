import * as vscode from 'vscode';
import { AiClient } from './services/aiClient';
import { collectStatistics, languageForDocument, summarizePeriod } from './services/statistics';
import { ExtensionMessage, WebviewMessage } from './types/messages';
import { ActivityEvent, PeriodDays, supportedLanguages } from './types/statistics';

const eventsKey = 'linkai.activityEvents';
const languageKey = 'linkai.language';
const periodKey = 'linkai.period';

class LinkAiViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private language: string;
	private period: PeriodDays;
	private readonly aiClient: AiClient;

	public constructor(private readonly context: vscode.ExtensionContext, private readonly events: ActivityEvent[]) {
		const configuration = vscode.workspace.getConfiguration('linkai');
		this.language = context.globalState.get<string>(languageKey) ?? configuration.get<string>('defaultLanguage', 'TypeScript');
		this.period = context.globalState.get<PeriodDays>(periodKey) ?? configuration.get<PeriodDays>('defaultPeriod', 30);
		this.aiClient = new AiClient(() => context.secrets.get('linkai.backendToken'));
	}

	public resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = getWebviewHtml(view.webview);
		view.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handleMessage(message));
		this.sendStatistics();
	}

	public refresh(): void {
		this.sendStatistics();
	}

	private send(message: ExtensionMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private sendStatistics(): void {
		this.send({ type: 'statisticsReady', payload: collectStatistics(this.events, this.language, this.period) });
	}

	private async handleMessage(message: WebviewMessage): Promise<void> {
		switch (message.type) {
			case 'setLanguage':
				if (supportedLanguages.includes(message.language as typeof supportedLanguages[number])) {
					this.language = message.language;
					await this.context.globalState.update(languageKey, this.language);
					this.sendStatistics();
				}
				break;
			case 'setPeriod':
				if ([7, 30, 90].includes(message.period)) {
					this.period = message.period;
					await this.context.globalState.update(periodKey, this.period);
					this.sendStatistics();
				}
				break;
			case 'requestStatistics':
				this.sendStatistics();
				break;
			case 'requestCheck':
				await this.check();
				break;
		}
	}

	private async check(): Promise<void> {
		const configuration = vscode.workspace.getConfiguration('linkai');
		if (!configuration.get<boolean>('sendAggregatedStatistics', false)) {
			this.send({ type: 'checkFailed', payload: { message: 'Дозвіл на надсилання агрегованої статистики вимкнено в налаштуваннях.', retryable: false } });
			return;
		}
		this.send({ type: 'checkStarted' });
		try {
			const current = summarizePeriod(this.events, this.language, this.period);
			const previous = summarizePeriod(this.events, this.language, this.period, Date.now(), 1);
			const evaluation = await this.aiClient.evaluate({ language: this.language, periodDays: this.period, current, previous }, configuration.get<string>('backendUrl', ''));
			await this.context.globalState.update('linkai.lastCheck', Date.now());
			this.send({ type: 'checkCompleted', payload: evaluation });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Не вдалося виконати перевірку.';
			this.send({ type: 'checkFailed', payload: { message, retryable: true } });
		}
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const storedEvents = context.workspaceState.get<ActivityEvent[]>(eventsKey, []);
	const events = storedEvents.slice(-5000);
	const provider = new LinkAiViewProvider(context, events);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('linkai.statistics', provider),
		vscode.commands.registerCommand('linkai.openStatistics', () => vscode.commands.executeCommand('workbench.view.extension.linkai')),
		vscode.commands.registerCommand('linkai.setBackendToken', async () => {
			const token = await vscode.window.showInputBox({ prompt: 'Токен AI-бекенду', password: true, ignoreFocusOut: true });
			if (token !== undefined) {
				await context.secrets.store('linkai.backendToken', token);
				vscode.window.showInformationMessage('Токен AI-бекенду збережено у SecretStorage.');
			}
		}),
		vscode.workspace.onDidChangeTextDocument((change) => {
			if (!vscode.workspace.getWorkspaceFolder(change.document.uri) || change.document.uri.scheme !== 'file') {
				return;
			}
			const settings = vscode.workspace.getConfiguration('linkai');
			if (isExcluded(change.document.uri, settings.get<string[]>('excludedPaths', []))) {
				return;
			}
			const language = languageForDocument(change.document.languageId);
			for (const contentChange of change.contentChanges) {
				const addedLines = countAddedLines(contentChange.text, language, settings.get<boolean>('includeComments', false));
				const deletedLines = Math.max(0, contentChange.range.end.line - contentChange.range.start.line);
				if (addedLines === 0 && deletedLines === 0) {
					continue;
				}
				events.push({ timestamp: Date.now(), language, linesAdded: addedLines, linesDeleted: deletedLines });
			}
			while (events.length > 5000) {
				events.shift();
			}
			void context.workspaceState.update(eventsKey, events);
			provider.refresh();
		}),
	);
}

function countAddedLines(text: string, language: string, includeComments: boolean): number {
	return text.split(/\r?\n/).filter((line) => {
		const trimmed = line.trim();
		if (!trimmed || includeComments) {
			return Boolean(trimmed);
		}
		const commentMarkers = language === 'Python' ? ['#'] : ['//', '/*', '*', '#'];
		return !commentMarkers.some((marker) => trimmed.startsWith(marker));
	}).length;
}

function isExcluded(uri: vscode.Uri, excludedPaths: string[]): boolean {
	const normalizedPath = uri.fsPath.replace(/\\/g, '/');
	return ['/node_modules/', '/.git/', '/dist/'].some((part) => normalizedPath.includes(part)) || excludedPaths.some((path) => normalizedPath.includes(path.replace(/\\/g, '/')));
}

function getWebviewHtml(webview: vscode.Webview): string {
	const nonce = getNonce();
	return `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${styles}</style></head><body><main><header><div><span class="eyebrow">PERSONAL PRACTICE</span><h1>LinkAI</h1></div><button id="check" class="primary">Перевірити</button></header><section class="controls"><label>Мова<select id="language">${supportedLanguages.map((language) => `<option>${language}</option>`).join('')}</select></label><label>Період<select id="period"><option value="7">7 днів</option><option value="30">30 днів</option><option value="90">90 днів</option></select></label><span id="status" class="status">Готово до перевірки</span></section><section id="empty" class="empty">Змінюйте код у робочій області, щоб побачити свою динаміку.</section><section id="dashboard" hidden><div id="metrics" class="metrics"></div><div class="grid"><section class="panel chart-panel"><div class="panel-title"><h2>Динаміка</h2><span>рядки додані</span></div><div id="chart" class="chart"></div></section><section class="panel"><div class="panel-title"><h2>Порівняння</h2></div><div id="comparison" class="comparison"></div></section></div><section id="evaluation" class="panel evaluation"><div class="panel-title"><h2>Орієнтовна оцінка прогресу</h2></div><div id="evaluation-content">Натисніть «Перевірити», щоб отримати рекомендації.</div></section></section></main><script nonce="${nonce}">${script}</script></body></html>`;
}

function getNonce(): string {
	return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

const styles = `:root{color-scheme:light dark;--accent:#b56cff;--accent-bright:#d8a8ff;--ink:#100b18;--panel:color-mix(in srgb,var(--vscode-editorWidget-background) 92%,#1a0d2b);--border:color-mix(in srgb,var(--accent) 35%,var(--vscode-widget-border));--muted:var(--vscode-descriptionForeground)}*{box-sizing:border-box}body{margin:0;padding:24px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);background:radial-gradient(circle at 90% 0%,#3b1c5d 0,#1b1028 32%,var(--vscode-editor-background) 78%)}main{max-width:920px;margin:auto}header,.controls,.panel-title,.comparison-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{color:var(--accent-bright);font-size:10px;letter-spacing:1.5px}h1{font-size:32px;margin:2px 0 18px}h2{font-size:14px;margin:0}.controls{padding:14px 0 22px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}label{display:grid;gap:5px;font-size:11px;color:var(--muted)}select,button{font:inherit;color:var(--vscode-foreground);background:var(--vscode-input-background);border:1px solid var(--border);padding:7px 10px;border-radius:4px}button{cursor:pointer}.primary{background:var(--accent);border-color:var(--accent);color:var(--ink);font-weight:700;padding:9px 16px}.status{font-size:11px;color:var(--muted);margin-left:auto}.empty{padding:48px 16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:6px;background:color-mix(in srgb,var(--panel) 72%,transparent)}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:20px 0}.metric,.panel{background:var(--panel);border:1px solid var(--border);border-radius:6px}.metric{padding:13px}.metric strong{display:block;font-size:22px;color:var(--accent-bright)}.metric span,.panel-title span{font-size:10px;color:var(--muted)}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:12px}.panel{padding:16px}.chart{height:180px;display:flex;align-items:end;gap:5px;padding-top:28px}.bar{flex:1;min-width:5px;background:var(--accent);opacity:.82;position:relative}.bar span{position:absolute;top:-17px;width:100%;text-align:center;font-size:9px;color:var(--muted)}.comparison{display:grid;gap:14px;margin-top:20px}.comparison-row strong{color:var(--accent-bright)}.evaluation{margin-top:12px;min-height:120px}.score{font-size:42px;color:var(--accent-bright);font-weight:700}.evaluation ul{padding-left:18px}.error{color:var(--vscode-errorForeground)}@media(max-width:650px){body{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.controls{align-items:start;flex-wrap:wrap}.status{width:100%;margin:0}}`;

const script = `const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const metricLabels=[['linesAdded','Додано рядків'],['linesChanged','Змінено рядків'],['activeDays','Активні дні'],['sessions','Сесії'],['averageLinesPerActiveDay','Середнє за день']];function pct(value){return value===null?'—':(value>0?'+':'')+value+'%'}function render(data){const hasActivity=data.summary.linesAdded+data.summary.linesDeleted+data.summary.linesChanged>0;$('empty').hidden=hasActivity;$('dashboard').hidden=!hasActivity;$('language').value=data.language;$('period').value=String(data.period);$('metrics').innerHTML=metricLabels.map(([key,label])=>'<div class="metric"><strong>'+data.summary[key]+'</strong><span>'+label+'</span></div>').join('');const max=Math.max(1,...data.dailyActivity.map(day=>day.linesAdded));$('chart').innerHTML=data.dailyActivity.length?data.dailyActivity.map(day=>'<div class="bar" title="'+day.date+': '+day.linesAdded+' рядків" style="height:'+Math.max(4,day.linesAdded/max*130)+'px"><span>'+day.linesAdded+'</span></div>').join(''):'<span class="status">Даних за період ще немає</span>';$('comparison').innerHTML=[['linesAddedPercent','Додані рядки'],['activeDaysPercent','Активні дні'],['averageLinesPercent','Середнє за день']].map(([key,label])=>'<div class="comparison-row"><span>'+label+'</span><strong>'+pct(data.comparison[key])+'</strong></div>').join('')}window.addEventListener('message',event=>{const message=event.data;if(message.type==='statisticsReady')render(message.payload);if(message.type==='checkStarted'){$('check').disabled=true;$('status').textContent='Перевіряємо агреговані дані...'}if(message.type==='checkCompleted'){$('check').disabled=false;$('status').textContent='Перевірку завершено';const e=message.payload;$('evaluation-content').innerHTML='<div class="score">'+e.score+'/100</div><p>'+e.summary+'</p><strong>Сильні сторони</strong><ul>'+e.strengths.map(item=>'<li>'+item+'</li>').join('')+'</ul><strong>Рекомендації</strong><ul>'+e.recommendations.map(item=>'<li>'+item+'</li>').join('')+'</ul><small>Надійність оцінки: '+e.confidence+'</small>'}if(message.type==='checkFailed'){$('check').disabled=false;$('status').textContent='Помилка';$('evaluation-content').innerHTML='<p class="error">'+message.payload.message+'</p>'}});$('language').addEventListener('change',event=>vscode.postMessage({type:'setLanguage',language:event.target.value}));$('period').addEventListener('change',event=>vscode.postMessage({type:'setPeriod',period:Number(event.target.value)}));$('check').addEventListener('click',()=>vscode.postMessage({type:'requestCheck'}));vscode.postMessage({type:'requestStatistics'});`;

export function deactivate(): void {}