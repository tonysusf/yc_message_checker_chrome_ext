const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const checker = require('../extension/checker.js');
const preview = (slug, outgoing = false, lastRead = '2026-10-01T00:00:00Z', createdAt = '2026-10-26T12:00:00Z') => ({slug, lastRead, latestMessage: {outgoing, createdAt}});
const response = previews => ({data: {currentUser: {slug: 'account'}, conversations: {conversationPreviews: previews}}});

test('incoming unread detection excludes outgoing and already-read messages', () => {
 const data = response([preview('new'), preview('outgoing', true), preview('read', false, '2026-10-27T00:00:00Z'), preview('never-read', false, null)]);
 assert.deepEqual(checker.snapshot(data).unread.map(x=>x.slug), ['new', 'never-read']);
 assert.throws(()=>checker.snapshot({errors:[{message:'unauthorized'}]}));
 assert.throws(()=>checker.snapshot({data:{}}));
 assert.equal(checker.csrfToken('<meta content="a&amp;b" name="csrf-token">'), 'a&b');
});

test('background polling, notification deduplication, intervals, errors and account isolation', async () => {
 let store={}, notifications=[], alarms=[], handler, current = response([preview('new'),preview('own',true)]), fail=false;
 const event = () => ({addListener:()=>{}});
 const chrome = {
  storage:{local:{get:async()=>({...store}),set:async value=>Object.assign(store,value)}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  alarms:{clear:async()=>{},create:async(name,options)=>alarms.push(options.periodInMinutes),onAlarm:event()},
  runtime:{id:'self',onInstalled:event(),onStartup:event(),onMessage:{addListener:cb=>handler=cb}},
  notifications:{create:async(id,options)=>notifications.push(options),onClicked:event()},tabs:{create:async()=>{}}
 };
 const context=vm.createContext({chrome,AbortSignal,console,importScripts:()=>{},YCChecker:checker,fetch:async(url,opts)=>{
  if(fail) throw new Error('Network unavailable');
  if(url.endsWith('/inbox')) return {ok:true,text:async()=>'<meta name="csrf-token" content="token"><script>component: "CFMInbox"</script>'};
  assert.equal(opts.method,'POST');assert.equal(opts.credentials,'include');assert.equal(opts.headers['X-CSRF-Token'],'token');
  assert(!JSON.parse(opts.body).query.includes('mutation'));
  return {ok:true,json:async()=>current};
 }});
 vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);
 const send=message=>new Promise(resolve=>handler(message,{id:'self'},resolve));
 assert.equal((await send({type:'check'})).ok,true);assert.equal(notifications.length,1);assert.equal(store.unread,1);
 await send({type:'check'});assert.equal(notifications.length,1);
 current=response([preview('new',false,null,'2026-10-26T13:00:00Z')]);
 await send({type:'check'});assert.equal(notifications.length,2);
 for(const interval of [1,3,5,10]) assert.equal((await send({type:'settings',interval,enabled:true})).ok,true);
 assert.deepEqual(alarms,[1,3,5,10]);
 assert.equal((await send({type:'settings',interval:2,enabled:true})).ok,false);
 const cached=JSON.stringify(store.previews);
 fail=true; assert.equal((await send({type:'check'})).ok,false);assert.equal(store.error,'Network unavailable');assert.equal(JSON.stringify(store.previews),cached);assert.equal(notifications.length,2);
 fail=false;current=response([preview('other-conversation')]);current.data.currentUser.slug='other-account';await send({type:'check'});assert.equal(notifications.length,3);assert.equal(store.previews.all[0].slug,'other-conversation');assert.equal(store.previews.all.length,1);
 await send({type:'test'});assert.equal(notifications.length,4);
});

test('preview sorting, truncation, names and independent unread limit', () => {
 const items = Array.from({length: 45}, (_, i) => ({...preview(String(i), i >= 22, null, new Date(Date.UTC(2026, 9, 1, i)).toISOString()),
  profile: {user: {name: i === 0 ? '' : `Founder ${i}`}}, latestMessage: {
   outgoing: i >= 22, createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), message: '<script>example</script>' + 'x'.repeat(400)
  }}));
 const result = checker.snapshot(response(items));
 assert.equal(result.previews.all.length,20);
 assert.equal(result.previews.all[0].slug,'44');
 assert.equal(result.previews.unread.length,20);
 assert.equal(result.previews.unread[0].slug,'21');
 assert.equal(result.previews.all[0].snippet.length,300);
 assert(result.previews.all[0].snippet.startsWith('<script>'));
 assert.equal(checker.snapshot(response([items[0]])).previews.all[0].name,'Unknown founder');
 assert.deepEqual(checker.snapshot(response([])).previews,{all:[],unread:[]});
});

test('popup filters, safe text, outgoing prefix, cache warnings and conversation links', async () => {
 class Element {
  constructor(){this.children=[];this.attrs={};this.listeners={};this.classList={toggle:()=>{}};}
  focus(){this.focused=true;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,fn){this.listeners[name]=fn;}
 }
 const elements = new Map();
 const documentEvents = {};
 const sent = [];
 const document={addEventListener:(name,cb)=>{documentEvents[name]=cb;},getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
 const incoming={slug:'a&b',name:'<img onerror=alert(1)>',snippet:'<script>not executable</script>',createdAt:'2026-10-28T12:00:00Z',unread:true,outgoing:false};
 const outgoing={...incoming,slug:'own',name:'Founder',outgoing:true,unread:false};
 let state={previews:{all:[outgoing,incoming],unread:[incoming]},lastChecked:Date.now(),unread:1};
 const context=vm.createContext({document,URL,chrome:{runtime:{sendMessage:async message=>{sent.push(message);return {ok:true};}},storage:{local:{get:async()=>state},onChanged:{addListener:()=>{}}}}});
 vm.runInContext(fs.readFileSync(require.resolve('../extension/popup.js'),'utf8'),context);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
 elements.get('settingsPanel').hidden=true;
 elements.get('settingsToggle').listeners.click();
 assert.equal(elements.get('settingsPanel').hidden,false);
 assert.equal(elements.get('messagesPanel').hidden,true);
 assert.equal(elements.get('settingsToggle').attrs['aria-expanded'],'true');
 assert.equal(elements.get('enabled').focused,true);
 documentEvents.keydown({key:'Escape',preventDefault:()=>{}});
 assert.equal(elements.get('settingsPanel').hidden,true);
 assert.equal(elements.get('messagesPanel').hidden,false);
 assert.equal(elements.get('settingsToggle').focused,true);
 elements.get('settingsToggle').listeners.click();
 elements.get('settingsClose').listeners.click();
 assert.equal(elements.get('settingsPanel').hidden,true);
 await elements.get('refresh').listeners.click();
 await elements.get('check').listeners.click();
 assert.equal(JSON.stringify(sent),JSON.stringify([{type:'check'},{type:'check'}]));
 assert.equal(elements.get('refresh').disabled,false);
 const list=elements.get('previews');
 assert.equal(list.children.length,2);
 assert.equal(list.children[0].children[0].children.at(-1).textContent,'You: <script>not executable</script>');
 const link=list.children[1].children[0];
 assert.equal(link.children[0].textContent,incoming.name);
 assert.equal(new URL(link.href).searchParams.get('conversation'),'a&b');
 assert.equal(link.target,'_blank');
 elements.get('unread').listeners.click();await flush();
 assert.equal(list.children.length,1);assert.equal(elements.get('unread').attrs['aria-pressed'],'true');
 state.error='Offline';await vm.runInContext('render()',context);
 assert.match(elements.get('cacheNote').textContent,/Cached/);
 state.previews={all:[],unread:[]};await vm.runInContext('render()',context);
 assert.equal(list.children[0].textContent,'No unread conversations.');
 state.previews=null;await vm.runInContext('render()',context);
 assert.match(list.children[0].textContent,/Refresh/);
});
