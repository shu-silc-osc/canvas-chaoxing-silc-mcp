const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('launch waits for a click before any Canvas request',async()=>{
  const nodes=new Map(), listeners={}, requests=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){}});return nodes.get(id)};
  const context={console,Date,Intl,Set,JSON,window:{SC_SESSION:'test'},localStorage:{getItem(){return null},setItem(){}},document:{querySelector:node,querySelectorAll(){return[]},addEventListener(type,fn){listeners[type]=fn}},fetch:async path=>{requests.push(path);throw Error('Offline fixture')}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
  assert.equal(requests.length,0,'page loading must not read Canvas');
  assert.match(node('#content').innerHTML,/id="connectCanvas"/);
  listeners.click({target:{id:'connectCanvas',closest(){return null}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2,'connecting reads dashboard and schemas together');
});
