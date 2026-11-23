import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const curriculum = JSON.parse(readFileSync(new URL("../curriculum.json", import.meta.url), "utf8"));
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Expected the browser script to exist");

test("inline browser JavaScript compiles", () => {
  assert.doesNotThrow(() => new Script(script, {filename:"index.html:inline.js"}));
});

const gradeStart = script.indexOf("function normalize(v)");
const gradeEnd = script.indexOf("function ensureActive(){", gradeStart);
assert.ok(gradeStart >= 0 && gradeEnd > gradeStart, "Could not find pure grading functions");
const gradingSource = script.slice(gradeStart,gradeEnd) + "\nassess;";
const assess = new Script(gradingSource).runInNewContext({curriculum});

test("accepts exact translation as green", () => {
  assert.equal(assess("Ella quiere aprender español y trabajar.", "Ella quiere aprender español y trabajar.", "es").kind, "correct");
});
test("allows a missing internal letter with green warning", () => {
  const r = assess("Ella quiere aprnder español y trabajar.", "Ella quiere aprender español y trabajar.", "es");
  assert.equal(r.ok,true);
  assert.equal(r.kind,"typo");
  assert.match(r.why,/aprnder.*aprender/);
});
test("rejects wrong conjugation even if it differs by one letter", () => {
  const r = assess("Ella quiero aprender español y trabajar.", "Ella quiere aprender español y trabajar.", "es");
  assert.equal(r.ok,false);
  assert.equal(r.kind,"error");
});
test("rejects multiple mistakes and missing words", () => {
  assert.equal(assess("Ella quiero aprnder español y trabajar.", "Ella quiere aprender español y trabajar.", "es").ok,false);
  assert.equal(assess("Ella quiere español y trabajar.", "Ella quiere aprender español y trabajar.", "es").ok,false);
});
test("does not confuse regular plurals with typos", () => {
  assert.equal(assess("I want books.", "I want book.", "en").ok,false);
});
test("keeps case rules for English I and English", () => {
  assert.equal(assess("i want to learn English.", "I want to learn English.", "en").ok,false);
  assert.equal(assess("I want to learn english.", "I want to learn English.", "en").ok,false);
});
test("keeps existing Spanish gender variants", () => {
  assert.equal(assess("Nosotras queremos leer.", "Nosotros queremos leer.", "es").ok,true);
});
test("only two modes remain and Russian assignment is immediately visible", () => {
  assert.match(html,/id="mode-write">Пишу<\/button>/);
  assert.match(html,/id="mode-speak">Свободный диалог<\/button>/);
  assert.doesNotMatch(html,/id="mode-speak">Говорю/);
  assert.match(html,/card\.append\(el\('div','text-prompt',t\[0\]/);
  assert.doesNotMatch(html,/Слушать на русском/);
});
test("preserves existing local progress key and original queue data shape", () => {
  assert.match(html,/const KEY='lingua-daily-iphone-preview-v10'/);
  assert.match(html,/slots:\[\],queue:\[\],cursor:0,turns:0,errors:0/);
  assert.match(html,/s\.queue\.push\(\{task:act\.task,slot,due:s\.turns\+3\}\)/);
});
test("temporary Realtime credential flow never embeds the long-lived key in frontend", () => {
  assert.match(html,/fetch\('\/api\/realtime\/token'/);
  assert.match(html,/https:\/\/api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(html,/getUserMedia/);
  assert.match(html,/new RTCPeerConnection/);
  assert.match(html,/cleanCall\(dialogueCall\)/);
  assert.doesNotMatch(html,/OPENAI_API_KEY/);
  assert.doesNotMatch(html,/localStorage\.setItem\([^)]*previewPasscode/);
});

test("accepts common internal transposition with warning", () => {
 const r=assess("Ella quiere aprneder español y trabajar.","Ella quiere aprender español y trabajar.","es");
 assert.equal(r.kind,"typo");
});
test("rejects truncated verb ending even when one character away", () => {
 assert.equal(assess("Ella quier aprender español.","Ella quiere aprender español.","es").kind,"error");
 assert.equal(assess("Ella quierex aprender español.","Ella quiere aprender español.","es").kind,"error");
 assert.equal(assess("Ella quieres aprender español.","Ella quiere aprender español.","es").kind,"error");
});
test("does not accept a different tense as an English typo", () => {
 assert.equal(assess("I went to learn English.","I want to learn English.","en").kind,"error");
 assert.equal(assess("She want to learn English.","She wants to learn English.","en").kind,"error");
});
test("preview call has a cap, a user-gesture audio fallback and pending microphone cleanup", () => {
 assert.match(html,/MAX_PREVIEW_CALL_MS=10\*60\*1000/);
 assert.match(html,/pendingDialogueStream=stream/);
 assert.match(html,/if\(pendingDialogueStream&&pendingDialogueStream!==connectedStream\)/);
 assert.match(html,/Включить звук преподавателя/);
});
test("teacher preferences are allowlisted and stored separately from learner progress", () => {
 assert.match(html,/TUTOR_PREF_KEY='lingua-daily-realtime-tutor-pref-v1'/);
 assert.match(html,/tutorChoice\(card,'Стиль преподавателя'/);
 assert.match(html,/tutorChoice\(card,'Голос преподавателя'/);
 assert.match(html,/tutorChoice\(card,'Скорость речи'/);
 assert.match(html,/body:JSON\.stringify\(\{lang,lesson:idx,errors,mastered,\.\.\.tutorPrefs\}\)/);
});

test("red conjugation error explains the exact correct Spanish form", () => {
 const r=assess("Ella quiero aprender español y trabajar.","Ella quiere aprender español y trabajar.","es");
 assert.equal(r.kind,"error");
 assert.match(r.why,/ella.*quiere.*quiero/);
});
test("red conjugation error explains the exact correct English form", () => {
 const r=assess("She want to learn English.","She wants to learn English.","en");
 assert.equal(r.kind,"error");
 assert.match(r.why,/she.*wants.*want/);
});
