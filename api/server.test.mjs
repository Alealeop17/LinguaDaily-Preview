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
  const response=await post(url,{lang:"es",lesson:1,errors:[0,2,999]});
  assert.equal(response.status,200);const output=await response.json();
  assert.equal(output.value,"ek_test_client_only");assert.equal(JSON.stringify(output).includes("test-key"),false);
 },fakeFetch);
 assert.equal(calls[0].url,"https://api.openai.com/v1/realtime/client_secrets");
 const body=JSON.parse(calls[0].opts.body);
 assert.equal(body.session.model,"gpt-realtime-2.1");
 assert.equal(body.expires_after.seconds,60);
 assert.equal(body.session.audio.output.voice,"marin");
 assert.match(body.session.instructions,/poder/i);
 assert.doesNotMatch(body.session.instructions,/Quiero.*absolutely-no-such/i);
 assert.equal(calls[0].opts.headers.Authorization,"Bearer test-key");
});
