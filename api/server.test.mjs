import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { makeHandler } from "./server.mjs";

const origin = "https://lingua-daily-iphone-preview.onrender.com";
async function withServer(env, doTest, mockedFetch) {
  const server = createServer(makeHandler({env: () => env, fetch: mockedFetch || fetch}));
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try { await doTest(url) } finally { await new Promise(resolve => server.close(resolve)) }
}
const post=(url,payload,code="demo-passphrase",site=origin) =>
 fetch(url+"/api/realtime/token",{method:"POST",headers:{"content-type":"application/json","origin":site,"x-preview-access":code},body:JSON.stringify(payload)});
const lesson={lang:"es",lesson:0,errors:[]};

test("preview HTML is served from the same origin as its API", async () => {
 await withServer({}, async url=>{
  const response=await fetch(url+"/");
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type"),/text\/html/);
  assert.equal(response.headers.get("cache-control"),"no-store");
  const page=await response.text();
  assert.match(page,/Свободный диалог/);
  assert.doesNotMatch(page,/OPENAI_API_KEY/);
 });
});

test("health returns configuration without secrets", async () => {
 await withServer({}, async url => {
  const r=await fetch(url+"/health");
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,configured:false});
 });
});
test("never issues token without API key", async () => {
 await withServer({}, async url => assert.equal((await post(url,lesson)).status,503));
});
test("blocks unexpected origin, wrong passcode, invalid lesson", async () => {
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  assert.equal((await post(url,lesson,"demo-passphrase","https://attacker.example")).status,403);
  assert.equal((await post(url,lesson,"bad")).status,401);
  assert.equal((await post(url,{lang:"zz",lesson:4})).status,400);
 });
});
test("creates scoped short-lived realtime credential and never returns secret API key", async () => {
 const calls=[];
 const fakeFetch=async (url,opts) => {
  calls.push({url,opts});
  return {ok:true,json:async()=>({value:"ek_test_client_only",expires_at:1730000000})};
 };
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  const response=await post(url,{lang:"es",lesson:1,errors:[0,2,999],mastered:83});
  assert.equal(response.status,200);const output=await response.json();
  assert.equal(output.value,"ek_test_client_only");assert.equal(JSON.stringify(output).includes("test-key"),false);
 },fakeFetch);
 assert.equal(calls[0].url,"https://api.openai.com/v1/realtime/client_secrets");
 const body=JSON.parse(calls[0].opts.body);
 assert.equal(body.session.model,"gpt-realtime-2.1");
 assert.equal(body.expires_after.seconds,60);
 assert.equal(body.session.audio.output.voice,"marin");
 assert.match(body.session.instructions,/poder/i);
 assert.match(body.session.instructions,/83 из 100/);
 assert.match(body.session.instructions,/Используй более сложные ситуации/);
 assert.match(body.session.instructions,/объясни иначе/);
 assert.doesNotMatch(body.session.instructions,/Quiero.*absolutely-no-such/i);
 assert.equal(calls[0].opts.headers.Authorization,"Bearer test-key");
});

test("server protects preview page with browser security headers", async () => {
 await withServer({}, async url=>{
  const r=await fetch(url+"/");
  assert.equal(r.status,200);
  assert.match(r.headers.get("content-security-policy"),/frame-ancestors 'none'/);
  assert.match(r.headers.get("permissions-policy"),/microphone=\(self\)/);
  assert.equal(r.headers.get("x-frame-options"),"DENY");
 });
});
test("invalid JSON and null requests are rejected without upstream API calls", async () => {
 let calls=0;
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  const bad=await fetch(url+"/api/realtime/token",{method:"POST",headers:{"origin":origin,"content-type":"application/json","x-preview-access":"demo-passphrase"},body:"{"});
  assert.equal(bad.status,400);
  assert.equal((await post(url,null)).status,400);
 },async()=>{calls++;throw Error("Unexpected upstream call")});
 assert.equal(calls,0);
});
test("oversized request returns JSON 413 without dropping the connection", async () => {
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  const r=await post(url,{lang:"es",lesson:0,padding:"x".repeat(4000)});
  assert.equal(r.status,413);
  assert.deepEqual(await r.json(),{error:"invalid_body"});
 });
});
test("safe voice, pace and tutor style flow into the ephemeral session", async () => {
 let payload;
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  const r=await post(url,{lang:"es",lesson:0,voice:"cedar",pace:"normal",style:"demanding",mastered:72});
  assert.equal(r.status,200);
 },async(_url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({value:"ek_test"})}});
 assert.equal(payload.session.audio.output.voice,"cedar");
 assert.equal(payload.session.audio.output.speed,1);
 assert.match(payload.session.instructions,/требовательная/);
 assert.match(payload.session.instructions,/72 из 100/);
});
test("unsafe voice, pace, style and mastery values use safe defaults", async () => {
 let payload;
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  const r=await post(url,{lang:"en",lesson:0,voice:"evil",pace:"fast",style:"admin",mastered:1000});
  assert.equal(r.status,200);
 },async(_url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({value:"ek_test"})}});
 assert.equal(payload.session.audio.output.voice,"marin");
 assert.equal(payload.session.audio.output.speed,0.84);
 assert.match(payload.session.instructions,/100 из 100/);
});
test("CORS preflight allows only the configured trusted origin", async () => {
 await withServer({}, async url=>{
  const allowed=await fetch(url+"/api/realtime/token",{method:"OPTIONS",headers:{origin}});
  const blocked=await fetch(url+"/api/realtime/token",{method:"OPTIONS",headers:{origin:"https://evil.example"}});
  assert.equal(allowed.status,204);
  assert.equal(blocked.status,403);
  assert.equal(blocked.headers.get("access-control-allow-origin"),null);
 });
});

test("Realtime token defines a small optional grammar logging function", async () => {
 let payload;
 await withServer({OPENAI_API_KEY:"test-key",PREVIEW_ACCESS_CODE:"demo-passphrase"}, async url=>{
  assert.equal((await post(url,{lang:"es",lesson:0})).status,200);
 },async (_url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({value:"ek_preview_test"})}});
 assert.equal(payload.session.tool_choice,"auto");
 const tool=payload.session.tools.find(t=>t.name==="record_language_error");
 assert.equal(tool.type,"function");
 assert.deepEqual(tool.parameters.required,["incorrect","correct","russian","explanation"]);
 assert.equal(tool.parameters.additionalProperties,false);
});
