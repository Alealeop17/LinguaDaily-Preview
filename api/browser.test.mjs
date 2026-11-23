import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(code);

function runApp({ store = new Map(), tokenOk = true } = {}) {
 const nodes = {}, requests = [], events = [], stats = { spoken:0, stopped:0, closed:0, mic:0, playback:0 };
 class El {
  constructor(tag) { this.tag=tag;this.children=[];this.listeners={};this.classList={toggle(){}};this.textContent="";this.value=""; }
  set id(value) { this._id=value;nodes[value]=this; }
  get id() { return this._id; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=[...items]; }
  setAttribute(name,value) { this[name]=value; }
  addEventListener(name,cb) { this.listeners[name]=cb; }
  play() { stats.playback++;return Promise.resolve(); }
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
 const navigator = {mediaDevices:{getUserMedia:async()=>{stats.mic++;return stream;}}};
 const fetchStub = async(url,options) => {
  requests.push({url,...options});
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
  addEventListener(){}
 };
 const window = {
  isSecureContext:true,
  RTCPeerConnection:Peer,
  speechSynthesis:{cancel(){},getVoices(){return []},speak(){stats.spoken++;}},
  addEventListener(){}
 };
 const localStorage = {getItem:k=>store.get(k)||null,setItem:(k,value)=>store.set(k,value)};
 const qa=new Function("window","document","localStorage","navigator","RTCPeerConnection","fetch",code+"\nreturn window.LinguaPreviewQA;")(
  window,document,localStorage,navigator,Peer,fetchStub
 );
 const findText = (root,text) => {
  if(root?.textContent===text)return root;
  for(const child of root?.children||[]) { const found=findText(child,text);if(found)return found; }
  return null;
 };
 return {qa,nodes,store,stats,requests,events,findText};
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
