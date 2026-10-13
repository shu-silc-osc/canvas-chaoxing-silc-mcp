const test=require('node:test');
const assert=require('node:assert/strict');
const grades=require('../static/grade-calculator.js');
const data={course_id:'7',assignments:[{id:'12',can_predict:true},{id:'13',can_predict:true},{id:'11',can_predict:false}]};
test('all-remaining plan uses a numeric target and no hidden assumptions',()=>{
  assert.deepEqual(grades.buildPlan(data,'80','all',[],{}),{course_id:'7',target_percent:80});
});
test('exam-only plan preserves an explicit zero estimate and rejects blank estimates',()=>{
  assert.deepEqual(grades.buildPlan(data,'80','selected',['13'],{'12':'0'}),{course_id:'7',target_percent:80,solve_ids:['13'],expected_percentages:{'12':0}});
  assert.throws(()=>grades.buildPlan(data,'80','selected',['13'],{'12':''}),/预计/);
});
test('invalid targets and empty exam selections cannot send a request',()=>{
  for(const target of ['',' ','NaN','Infinity','101','-1'])assert.throws(()=>grades.buildPlan(data,target,'all',[],{}));
  assert.throws(()=>grades.buildPlan(data,'80','selected',[],{}),/勾选/);
});

test('switching calculator course discards the previous pending grade response',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),nodes=new Map(),listeners={},calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'7',querySelector:s=>node(s)});return nodes.get(id);};
  const context={console,JSON,Number,String,Object,Error,model:{view:'updates',service:{name:'get_my_course_grades'},data:{courses:[{id:7,code:'Demo',name:'Demo'},{id:8,code:'Other',name:'Other'}]}},esc:s=>String(s??''),document:{querySelector:node,addEventListener:(type,fn)=>listeners[type]=fn},api:(path,options)=>new Promise(resolve=>calls.push({body:JSON.parse(options.body),resolve}))};
  vm.createContext(context);vm.runInContext(fs.readFileSync('static/grade-calculator.js','utf8'),context);
  context.mountGradeCalculator();
  node('#gradeCourse').value='8';listeners.change({target:{id:'gradeCourse'}});
  assert.equal(calls[1].body.course_id,'8');
  const result=current=>({course_id:'8',current_percent:current,canvas_current_percent:current,weighted:true,projection_supported:true,assignments:[],groups:[],warnings:[]});
  calls[1].resolve(result(95));await new Promise(r=>setImmediate(r));
  calls[0].resolve(result(10));await new Promise(r=>setImmediate(r));
  assert.match(node('#gradeBody').innerHTML,/95\.00%/);
  assert.doesNotMatch(node('#gradeBody').innerHTML,/10\.00%/);
});
