import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=f=>fs.readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
const html=read('index.html'),js=read('app.js'),server=read('server.js'),css=read('styles.css'),env=read('.env.example');

test('company intelligence hub contains the complete simple workflow',()=>{
 for(const id of ['companyOneMinute','companyBusinessModel','companyLongTerm','companyMoat','companyRiskRadar','companyProducts','companyCustomers','companySupplyChain','companyGlobalFootprint','companyCompetitors','companyPeerNotes','companyEvents','companySources','companySourceWarnings'])assert.match(html,new RegExp(`id="${id}"`));
 for(const tab of ['overview','snapshot','products','competitors','events','sources'])assert.match(html,new RegExp(`data-tab="${tab}"`));
});

test('profile engine combines official and global sources with provenance',()=>{
 for(const token of ['profileTwOfficial','profileEastmoneySurvey','profileSec','profileFmp','profileFinnhub','profileYahoo','profileWikipedia','mergeCompanyProfiles','fieldSources','profileConfidence'])assert.match(server,new RegExp(token));
 assert.match(server,/美國 SEC EDGAR/);assert.match(server,/臺灣證券交易所 OpenAPI/);assert.match(server,/東方財富公司概況/);
});

test('AI engine provides primary providers and deterministic fallback',()=>{
 for(const token of ['callOpenAiJson','callGeminiJson','ruleAiAnalysis','oneMinuteSummary','riskRadar','longTermView','signalScore'])assert.match(server,new RegExp(token));
 assert.match(env,/AI_PROVIDER_ORDER=openai,gemini/);assert.match(env,/GEMINI_API_KEY=/);assert.match(env,/OPENAI_API_KEY=/);
});

test('live engine uses SSE with heartbeat and reconnect support',()=>{
 assert.match(server,/text\/event-stream/);assert.match(server,/event: quote/);assert.match(server,/heartbeat/);assert.match(js,/new EventSource/);assert.match(js,/stream\.onerror/);
 assert.doesNotMatch(server,/from 'ws'/);
});

test('mobile experience has safe-area bottom navigation and touch targets',()=>{
 assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/position:fixed;left:0;right:0;bottom:0/);assert.match(css,/--touch:44px/);assert.match(css,/@media\(max-width:720px\)/);
});

test('local runtime is self-contained',()=>{
 for(const file of ['lib/mini-express.js','lib/jwt.js','lib/env.js'])assert.ok(fs.existsSync(new URL(`../${file}`,import.meta.url)));
 assert.match(server,/\.\/lib\/mini-express\.js/);assert.match(server,/\.\/lib\/jwt\.js/);
});


test('v15.1 AI evidence mode is structured and source-aware',()=>{for(const token of ['evidence','missingData','upgradeConditions','downgradeConditions','methodology'])assert.match(server,new RegExp(token));assert.match(html,/AI 證據模式/);assert.match(js,/renderAiEvidence/)});
