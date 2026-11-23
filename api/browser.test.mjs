import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(code);

function runApp({ store = new Map(), tokenOk = true, playbackBlocked = false, tokenDeferred = null, mediaDeferred = null } = {}) {
 const nodes = {}, requests = [], events = [], listeners={}, timers=new Map(), stats = { spoken:0, stopped:0, closed:0, mic:0, playback:0 };
 let timerId=0;const schedule=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return {id,unref(){}}};
 const unschedule=timer=>timers.delete(timer?.id||timer);
 const fireTimer=(ms)=>{for(const [id,entry] of [...timers])if(entry.ms===ms){timers.delete(id);entry.fn()}};
 class El {
  constructor(tag) { this.tag=tag;this.children=[];this.listeners={};this.classList={toggle(){}};this.textContent="";this.value=""; }
  set id(value) { this._id=value;nodes[value]=this; }
  get id() { return this._id; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=[...items]; }
  setAttribute(name,value) { this[name]=value; }
  addEventListener(name,cb) { this.listeners[name]=cb; }
  play() { stats.playback++;return playbackBlocked&&stats.playback===1?Promise.reject(new Error('NotAllowed')):Promise.resolve(); }
 }
 class Peer {
  addTrack() {}
  createDataChannel() { this.channel={send:data=>events.push(JSON.parse(data)),close(){}};return this.channel; }
  async createOffer() { return {sdp:"v=0 mock offer"}; }
  async setLocalDescription() {}
  async setRemoteDescription() {
   this.channel.onopen?.();
   this.ontrack?.({streams:[{id:"remote-mock"}]});
  }
  close() { stats.closed++; }
 }
 const track = {enabled:true,stop(){stats.stopped++;}};
 const stream = {getTracks:()=>[track],getAudioTracks:()=>[track]};
 const navigator = {mediaDevices:{getUserMedia:async()=>{stats.mic++;return mediaDeferred?await mediaDeferred.promise:stream;}}};
 const fetchStub = async(url,options) => {
  requests.push({url,...options});
  if(url==="/api/realtime/token"&&tokenDeferred)return tokenDeferred.promise;
  if(url==="/api/realtime/token")return tokenOk
    ? {ok:true,json:async()=>({value:"ek_mock_ephemeral"})}
    : {ok:false,status:401};
  if(url==="https://api.openai.com/v1/realtime/calls")return {ok:true,text:async()=>("v=0 mock answer")};
  throw Error("Unexpected request");
 };
 const document = {
  body:new El("body"),
  createElement:tag=>new El(tag),
  getElementById:id=>(nodes[id]??=new El("div")),
  addEventListener(name,fn){listeners[name]=fn;}
 };
 const window = {
  isSecureContext:true,
  RTCPeerConnection:Peer,
  speechSynthesis:{cancel(){},getVoices(){return []},speak(){stats.spoken++;}},
  addEventListener(){}
 };
 const localStorage = {getItem:k=>store.get(k)||null,setItem:(k,value)=>store.set(k,value)};
 const qa=new Function("window","document","localStorage","navigator","RTCPeerConnection","fetch","setTimeout","clearTimeout",code+"\nreturn window.LinguaPreviewQA;")(
  window,document,localStorage,navigator,Peer,fetchStub,schedule,unschedule
 );
 const findText = (root,text) => {
  if(root?.textContent===text)return root;
  for(const child of root?.children||[]) { const found=findText(child,text);if(found)return found; }
  return null;
 };
 return {qa,nodes,store,stats,requests,events,findText,fireTimer,listeners,document,track};
}

test("typo is green, conjugation is red, queue survives reopening", () => {
 const store=new Map(),a=runApp({store});
 a.qa.setPhase("practice");
 let state=a.qa.state().es[0];
 a.nodes.answer.value=a.qa.curriculum.es[0].tasks[state.active.task][1].replace("beber","bebr");
 a.qa.check();
 assert.equal(state.slots[0].status,"green");
 assert.equal(state.queue.length,0);
 a.qa.next();
 a.nodes.answer.value=a.qa.curriculum.es[0].tasks[state.active.task][1].replace("quieres","quiero");
 a.qa.check();
 assert.equal(state.slots[1].status,"red");
 assert.equal(state.queue.length,1);
 assert.equal(a.stats.spoken,0,"Written exercises must not auto-play audio");
 const reopened=runApp({store}).qa.state().es[0];
 assert.equal(reopened.slots[0].status,"green");
 assert.equal(reopened.slots[1].status,"red");
 assert.equal(reopened.queue.length,1);
});

test("realtime client starts with ephemeral key and closes all media tracks", async () => {
 const a=runApp();
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview-only";
 a.nodes["preview-code"].listeners.input();
 const start=a.findText(a.nodes.app,"Начать разговор");
 assert.ok(start);
 await start.listeners.click();
 assert.equal(a.stats.mic,1);
 assert.equal(a.requests.length,2);
 assert.equal(a.requests[0].url,"/api/realtime/token");
 assert.equal(JSON.parse(a.requests[0].body).mastered,0);
 assert.equal(a.requests[1].url,"https://api.openai.com/v1/realtime/calls");
 assert.equal(a.requests[1].headers.Authorization,"Bearer ek_mock_ephemeral");
 assert.ok(a.events.some(event=>event.type==="response.create"));
 assert.ok(a.findText(a.nodes.app,"Завершить разговор"));
 a.findText(a.nodes.app,"Завершить разговор").listeners.click();
 assert.equal(a.stats.stopped,1);
 assert.equal(a.stats.closed,1);
});

test("failed token request shuts off microphone and displays access error", async () => {
 const a=runApp({tokenOk:false});
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="wrong-code";
 a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 assert.ok(a.findText(a.nodes.app,"Неверный код доступа."));
 assert.equal(a.stats.stopped,1);
 assert.equal(a.stats.closed,0);
 assert.equal(a.requests.length,1);
});

test("user-selected tutor voice and style are safely persisted", async () => {
 const store=new Map(),a=runApp({store});
 a.nodes["mode-speak"].listeners.click();
 a.nodes["tutor-style"].value="demanding";a.nodes["tutor-style"].listeners.change();
 a.nodes["tutor-voice"].value="cedar";a.nodes["tutor-voice"].listeners.change();
 a.nodes["tutor-pace"].value="normal";a.nodes["tutor-pace"].listeners.change();
 a.nodes["preview-code"].value="private";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 const req=JSON.parse(a.requests[0].body);
 assert.equal(req.style,"demanding");
 assert.equal(req.voice,"cedar");
 assert.equal(req.pace,"normal");
 assert.equal([...store.keys()].some(key=>String(store.get(key)).includes("private")),false);
 a.findText(a.nodes.app,"Завершить разговор").listeners.click();
 const reopened=runApp({store});
 reopened.nodes["mode-speak"].listeners.click();
 assert.equal(reopened.nodes["tutor-style"].value,"demanding");
 assert.equal(reopened.nodes["tutor-voice"].value,"cedar");
 assert.equal(reopened.nodes["tutor-pace"].value,"normal");
});

test("browser audio autoplay failure offers an explicit play button", async () => {
 const a=runApp({playbackBlocked:true});
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 assert.ok(a.findText(a.nodes.app,"Включить звук преподавателя"));
 await a.findText(a.nodes.app,"Включить звук преподавателя").listeners.click();
 assert.equal(a.stats.playback,2);
 assert.ok(!a.findText(a.nodes.app,"Включить звук преподавателя"));
 a.findText(a.nodes.app,"Завершить разговор").listeners.click();
});

test("cancel during pending token request switches off microphone immediately", async () => {
 let resolveToken;const tokenDeferred={promise:new Promise(resolve=>resolveToken=resolve)};
 const a=runApp({tokenDeferred});
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 const starting=a.findText(a.nodes.app,"Начать разговор").listeners.click();
 await Promise.resolve();await Promise.resolve();
 assert.ok(a.findText(a.nodes.app,"Отмена"));
 a.findText(a.nodes.app,"Отмена").listeners.click();
 assert.equal(a.stats.stopped,1);
 resolveToken({ok:true,json:async()=>({value:"ek_late"})});
 await starting;
 assert.equal(a.requests.length,1,"Canceled connections must never reach the calls endpoint");
});

test("preview call ends itself after ten minutes", async () => {
 const a=runApp();
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 a.fireTimer(10*60*1000);
 assert.equal(a.stats.stopped,1);
 assert.equal(a.stats.closed,1);
 assert.ok(a.findText(a.nodes.app,"Пробные десять минут закончились. Можно начать следующий разговор."));
});

test("minimizing the application ends a connected call", async () => {
 const a=runApp();
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 a.document.hidden=true;a.listeners.visibilitychange();
 assert.equal(a.stats.stopped,1);
 assert.equal(a.stats.closed,1);
 assert.ok(a.findText(a.nodes.app,"Разговор завершён при сворачивании приложения."));
});

test("muting microphone changes track state without closing the call", async () => {
 const a=runApp();
 a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 a.findText(a.nodes.app,"Выключить микрофон").listeners.click();
 assert.equal(a.track.enabled,false);
 assert.ok(a.findText(a.nodes.app,"Включить микрофон"));
 a.findText(a.nodes.app,"Включить микрофон").listeners.click();
 assert.equal(a.track.enabled,true);
 a.findText(a.nodes.app,"Завершить разговор").listeners.click();
});

test("a wrong answer gets reviewed and all one hundred slots eventually become green", () => {
 const a=runApp(),s=(()=>{a.qa.setPhase("practice");return a.qa.state().es[0]})();
 let steps=0;
 while((s.slots.length<100||s.queue.length)&&steps<160){
  if(!s.active)a.qa.ensureActive();
  const model=a.qa.curriculum.es[0].tasks[s.active.task][1];
  a.nodes.answer.value=steps===0?"bad answer":model;
  a.qa.check();
  if(steps===0)assert.equal(s.slots[0].status,"red");
  a.qa.next();
  steps++;
 }
 assert.ok(steps<=160,"Review scheduling should terminate");
 assert.equal(s.slots.length,100);
 assert.equal(s.slots.filter(slot=>slot.status==="green").length,100);
 assert.equal(s.queue.length,0);
 assert.equal(s.errors,1);
 assert.ok(a.findText(a.nodes.app,"Все сто зелёные!"));
});
test("Spanish and English progress remain separate across lesson switches", () => {
 const a=runApp(),state=a.qa.state();
 a.qa.setPhase("practice");
 a.nodes.answer.value=a.qa.curriculum.es[0].tasks[state.es[0].active.task][1];
 a.qa.check();
 a.qa.switchLesson(1);a.qa.setPhase("practice");
 a.nodes.answer.value="obviously wrong";a.qa.check();
 a.nodes["pick-lang"].value="en";a.nodes["pick-lang"].listeners.change();
 a.qa.switchLesson(0);a.qa.setPhase("practice");
 a.nodes.answer.value=a.qa.curriculum.en[0].tasks[state.en[0].active.task][1];
 a.qa.check();
 assert.equal(state.es[0].slots[0].status,"green");
 assert.equal(state.es[1].slots[0].status,"red");
 assert.equal(state.en[0].slots[0].status,"green");
 assert.equal(state.en[1].slots.length,0);
});
test("tapping the active dialogue tab does not end a connected session", async () => {
 const a=runApp();a.nodes["mode-speak"].listeners.click();
 a.nodes["preview-code"].value="preview";a.nodes["preview-code"].listeners.input();
 await a.findText(a.nodes.app,"Начать разговор").listeners.click();
 a.nodes["mode-speak"].listeners.click();
 assert.equal(a.stats.stopped,0);
 assert.ok(a.findText(a.nodes.app,"Завершить разговор"));
 a.findText(a.nodes.app,"Завершить разговор").listeners.click();
 assert.equal(a.stats.stopped,1);
});
