'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const model={data:null,tools:[],view:'overview',course:'all',search:'',scope:'upcoming',status:'all',tool:null,connecting:false,service:null,serviceRequest:0};
let zone=localStorage.getItem('sc-timezone')||'Asia/Shanghai';
let pins=new Set(JSON.parse(localStorage.getItem('sc-pins')||'[]'));
let notes=JSON.parse(localStorage.getItem('sc-notes')||'[]');
$('#timezone').value=zone;
const labels={todo:'待提交',past_due:'已过截止 · 未提交',missing:'Canvas 标记缺交',submitted:'已提交',graded:'已评分',external:'外部提交 · 需核对',classroom:'课堂/说明 · 需核对',unknown:'状态未报告',excused:'已豁免'};
const categories={student:'学生',shared:'共享',developer:'工具发现',legacy:'原有接口',student_write:'学生写操作'};
const views={overview:['学习日历','学习日历','YOUR STUDY CALENDAR','学年、月份与每周安排，随时切换。'],courses:['我的课程','我的课程','YOUR LEARNING SPACE','课程资源、作业和成绩，按课程整理。'],assignments:['作业与 DDL','作业与 DDL','ASSIGNMENTS & DEADLINES','按课程与截止时间查看作业。'],updates:['学生服务','学生服务','STUDENT SERVICES','点击查询公告、动态、成绩与小组。'],about:['说明','说明','ABOUT THIS WORKSPACE','项目、数据与使用方式。']};
function fmt(value,options={}){return value?new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,...options}).format(new Date(value)):'未设置 DDL'}
const key=a=>`${a.course_id}:${a.id}`;
const completed=a=>['submitted','graded','excused'].includes(a.status);
const upcoming=a=>a.due_at&&new Date(a.due_at)>=new Date();
function badge(a){const type=completed(a)?'':a.status==='external'?'blue':['missing','past_due'].includes(a.status)?'urgent':'gray';return `<span class="tag ${type}">${esc(labels[a.status]||a.status)}</span>`}
function dateblock(a){if(!a.due_at)return '<span class="dateblock">DDL<strong>—</strong></span>';const d=new Intl.DateTimeFormat('en',{timeZone:zone,month:'short',day:'2-digit'}).formatToParts(new Date(a.due_at));return `<span class="dateblock">${esc(d.find(x=>x.type==='month').value.toUpperCase())}<strong>${esc(d.find(x=>x.type==='day').value)}</strong></span>`}
function row(a){return `<button type="button" class="row" data-assignment="${key(a)}">${dateblock(a)}<span class="rowbody"><b>${esc(a.name)}</b><small>${esc(a.code)} · ${esc(fmt(a.due_at))}</small></span>${badge(a)}</button>`}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'X-Student-Center-Session':window.SC_SESSION,'Content-Type':'application/json',...(options.headers||{})}});const body=await r.json();if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);return body}
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message||''}
function navigate(view){
  if(!views[view])return;
  if(typeof destroyCalendar==='function')destroyCalendar();
  model.serviceRequest++;
  model.service=null;
  model.view=view;
  document.querySelectorAll('nav button').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  const v=views[view];$('#crumb').textContent=v[0];$('#pageTitle').textContent=v[1];$('#eyebrow').textContent=v[2];$('#subtitle').textContent=v[3];render();
}
function launch(){
  $('#content').innerHTML=`<section class="launch" id="ui-active"><p class="eyebrow">READY WHEN YOU ARE / 01</p><h2>让今天的学习<br>从这里开始<span class="launch-dot">.</span></h2><p>连接你的 Canvas，把课程、日程和作业汇入同一张日历。</p><button class="primary" id="connectCanvas" ${model.connecting?'disabled':''}>${model.connecting?'正在读取学习空间…':'连接 Canvas · 开始同步'} <span data-cursor-label="连接" aria-hidden="true">↗</span></button><div class="launch-strip"><span>01 / 课程</span><span>02 / 日程</span><span>03 / 学生服务</span></div></section>`;
}
function about(){
  $('#content').innerHTML=`<div class="about-grid"><section><p class="eyebrow">STUDENT CENTER</p><h2>一个入口，整理你的学习。</h2><p>本项目把 Canvas 的课程、截止时间、日历和学生服务组织成可点击的工作台，采用 Swiss 排版、清晰网格与克制的红色强调。</p></section><section><h3>如何使用</h3><p>打开页面后点击“连接 Canvas”。首轮读取课程、作业、提交状态、个人及小组日历，并准备课程与作业标识和工具参数。学生服务点击后自动查询，课程与时间范围通过选择器调整。</p><h3>日历与时间</h3><p>学年按每年 9 月至次年 8 月展示；支持月、周查看。取消课程勾选即可隐藏该课程及关联小组的日程。个人事件独立显示。未设置截止日期的作业仍可在“作业与 DDL”查看。顶部时区控制全部日期显示。</p><h3>中文介绍</h3><p>使用 baoyu-translate 预处理事件介绍，在同步时匹配源文本缓存，点击事件直接打开中文小窗。长评估说明取介绍段落，完整原文可展开。当前没有常驻翻译模型；新内容或修改后的介绍会标为待翻译，保留原文。</p><h3>数据与操作</h3><p>数据来自你的 Canvas 账号。本项目目前提供读取、筛选与查询，提交作业、发送消息等操作在 Canvas 原页面进行。刷新会重新同步数据，服务端缓存有效期为 5 分钟。</p><h3>保存位置</h3><p>关注、学习计划与时区偏好保存于当前浏览器；介绍译文和待翻译队列保存在用户目录的 StudentCenter 文件夹。Canvas Token 仅由服务端使用。</p><h3>设计与组件</h3><p>Taste、Awesome Design、PencilPlaybook 与 Hallmark 仅用于设计操作。日历使用 FullCalendar（MIT），视觉参考 Schedule-X；保留 88px 情境光标，键盘和触屏使用原生交互。</p></section></div>`;
}
function render(){
  if(model.view==='about'){about();return;}
  if(!model.data){launch();return;}
  ({overview:()=>calendarHome(),courses,assignments,updates:()=>studentServices()})[model.view]();
}
async function refresh(force=false){
  if(model.connecting)return;
  model.connecting=true;$('#refresh').disabled=true;notice('');
  $('#connection').textContent='正在同步 Canvas…';
  if(!model.data&&model.view!=='about')launch();
  try{
    const [data,toolData]=await Promise.all([api('/api/dashboard'+(force?'?refresh=1':'')),api('/api/tools')]);
    model.data=data;model.tools=toolData.tools;
    model.toolError=toolData.error;
    if(typeof initializeCalendarData==='function')initializeCalendarData(data);
    $('#connection').textContent=data.courses.length?'Canvas 已连接':'Canvas 未返回课程';
    $('#sync').textContent='上次同步 '+fmt(data.fetched_at,{year:'numeric'});
    const errors=data.errors.map(e=>e.error);if(toolData.error)errors.push(toolData.error);
    if(errors.length)notice('部分数据读取失败：'+errors.join('；'));
    render();
  }catch(err){notice('同步未完成：'+err.message);$('#connection').textContent='连接未完成';}
  finally{model.connecting=false;$('#refresh').disabled=!model.data;if(!model.data&&model.view!=='about')launch();}
}
function courses(){const d=model.data;$('#content').innerHTML=`<div class="coursegrid">${d.courses.map(c=>{const all=d.assignments.filter(a=>a.course_id===c.id);const next=all.filter(a=>upcoming(a)&&!completed(a));return `<article class="coursecard" data-course="${c.id}" tabindex="0" role="button"><span class="coursecode">${esc(c.code)}</span><h3>${esc(c.name)}</h3><small>${esc(c.term)} · ${esc(c.role)}</small><div class="coursefoot"><span>${next.length} 项未来待办 / ${all.length} 项作业</span><span>${c.grade==null?'成绩未报告':esc(c.grade)+'%'}</span></div></article>`}).join('')}</div>`}
function assignments(){const d=model.data;const selected=d.courses.find(c=>String(c.id)===String(model.course));$('#content').innerHTML=`${selected?`<div class="coursebanner"><div><h3>${esc(selected.name)}</h3><p>${esc(selected.code)} · ${esc(selected.term)}</p></div><a class="button" href="${esc(selected.url)}" target="_blank" rel="noopener">打开课程 ↗</a></div>`:''}<div class="filters"><input id="assignmentSearch" placeholder="搜索作业名称…" value="${esc(model.search)}" aria-label="搜索作业"><select id="courseFilter" aria-label="选择课程"><option value="all">全部课程</option>${d.courses.map(c=>`<option value="${c.id}" ${String(model.course)===String(c.id)?'selected':''}>${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select><select id="scopeFilter" aria-label="日期范围"><option value="upcoming" ${model.scope==='upcoming'?'selected':''}>未来 DDL</option><option value="all" ${model.scope==='all'?'selected':''}>全部作业</option><option value="undated" ${model.scope==='undated'?'selected':''}>未设置 DDL</option><option value="past" ${model.scope==='past'?'selected':''}>截止已过</option><option value="pinned" ${model.scope==='pinned'?'selected':''}>我的关注</option></select><select id="statusFilter" aria-label="提交状态"><option value="all">全部状态</option><option value="incomplete" ${model.status==='incomplete'?'selected':''}>未完成 / 待核对</option><option value="complete" ${model.status==='complete'?'selected':''}>已提交 / 已评分</option><option value="missing" ${model.status==='missing'?'selected':''}>Canvas 标记缺交</option></select></div><p class="hint" id="resultCount"></p><section class="panel tablewrap"><table class="assignmenttable"><thead><tr><th>作业 / 课程</th><th>截止时间（${esc(zone)}）</th><th>提交状态</th><th>关注</th></tr></thead><tbody id="assignmentRows"></tbody></table></section>`;renderAssignmentRows()}
function renderAssignmentRows(){let a=model.data.assignments.filter(a=>(model.course==='all'||String(a.course_id)===String(model.course))&&a.name.toLowerCase().includes(model.search.toLowerCase()));a=a.filter(a=>model.scope==='all'||model.scope==='upcoming'&&upcoming(a)||model.scope==='undated'&&!a.due_at||model.scope==='past'&&a.due_at&&!upcoming(a)||model.scope==='pinned'&&pins.has(key(a)));a=a.filter(a=>model.status==='all'||model.status==='complete'&&completed(a)||model.status==='incomplete'&&!completed(a)||model.status==='missing'&&a.status==='missing');a.sort((a,b)=>(a.due_at?new Date(a.due_at):Infinity)-(b.due_at?new Date(b.due_at):Infinity));$('#resultCount').textContent=`显示 ${a.length} 项 · 没有截止时间不代表无需完成，课堂考试请核对教师安排。`;$('#assignmentRows').innerHTML=a.map(a=>`<tr data-assignment="${key(a)}"><td><button type="button" class="assignment-open" data-assignment="${key(a)}">${esc(a.name)}</button><small>${esc(a.code)} · ${esc(a.course)}</small></td><td>${esc(fmt(a.due_at,{year:'numeric'}))}</td><td>${badge(a)}</td><td><button class="pin ${pins.has(key(a))?'selected':''}" data-pin="${key(a)}" data-cursor-label="${pins.has(key(a))?'取消':'关注'}" aria-label="${pins.has(key(a))?'取消关注':'关注作业'}">${pins.has(key(a))?'★':'☆'}</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">此筛选下没有作业。</td></tr>'}
function detail(id){const a=model.data.assignments.find(a=>key(a)===id);if(!a)return;$('#detailBody').innerHTML=`<p class="eyebrow">${esc(a.code)} · ASSIGNMENT</p><h2 class="detailhead" id="detailTitle">${esc(a.name)}</h2><div class="detailmeta"><span>DDL：${esc(fmt(a.due_at,{year:'numeric'}))}</span>${badge(a)}<span>分值 ${esc(a.points??'未报告')}</span>${a.score!=null?`<span>得分 ${esc(a.score)}</span>`:''}</div><div class="detailactions"><a class="primary" href="${esc(a.url)}" target="_blank" rel="noopener">打开 Canvas 作业 ↗</a><button class="button" data-scores="${a.course_id}">查看本课程成绩与状态</button><button class="button" data-pin="${key(a)}">${pins.has(key(a))?'★ 已关注':'☆ 关注'}</button></div><p class="hint">提交方式：${esc(a.submission_types.join(', ')||'未报告')} ${a.submitted_at?' · 提交于 '+esc(fmt(a.submitted_at,{year:'numeric'})):''}</p><div class="description">${esc(a.description||'Canvas 没有提供作业说明。')}</div>`;$('#detail').showModal()}
const services=[['list_my_announcements','◌','课程公告','查看各门课近期发布的通知。'],['get_my_activity_stream','≋','最近动态','公告、讨论、成绩与评论的更新。'],['list_calendar_events','◷','学习日历','课程日程、个人日历与截止日期。'],['get_my_submission_status','✓','提交状态','核对已提交、缺交以及外部提交项目。'],['get_my_course_grades','▤','课程成绩','查看课程成绩，规划目标分数。'],['get_my_peer_reviews_todo','◇','互评待办','检查需要完成的同伴互评。'],['list_my_groups','◎','我的小组','查看你加入的小组及相关课程。'],['list_planner_notes','▧','Canvas 计划笔记','查看个人待办笔记。'],['get_my_upcoming_assignments','↗','跨课程近期作业','按天数查询即将截止的项目。']];
document.addEventListener('click',e=>{
  if(e.target.id==='connectCanvas'||e.target.closest('#connectCanvas')){refresh();return;}
  const nav=e.target.closest('[data-view],[data-nav]');if(nav){navigate(nav.dataset.view||nav.dataset.nav);return;}
  const pin=e.target.closest('[data-pin]');if(pin){e.stopPropagation();pins.has(pin.dataset.pin)?pins.delete(pin.dataset.pin):pins.add(pin.dataset.pin);localStorage.setItem('sc-pins',JSON.stringify([...pins]));if($('#detail').open){$('#detail').close();detail(pin.dataset.pin);}else render();return;}
  const a=e.target.closest('[data-assignment]');if(a){detail(a.dataset.assignment);return;}
  const c=e.target.closest('[data-course]');if(c){model.course=c.dataset.course;model.scope='all';navigate('assignments');return;}
  const tool=e.target.closest('[data-tool]');if(tool){openService(tool.dataset.tool);return;}
  const scores=e.target.closest('[data-scores]');if(scores){$('#detail').close();navigate('updates');openService('get_my_assignment_scores',scores.dataset.scores);return;}
  if(e.target.id==='addNote'){const text=prompt('添加一个学习小任务：');if(text?.trim()){notes.push({text:text.trim(),done:false});localStorage.setItem('sc-notes',JSON.stringify(notes));render();}}
});
document.addEventListener('input',e=>{if(e.target.id==='assignmentSearch'){model.search=e.target.value;renderAssignmentRows();}});
document.addEventListener('change',e=>{
  const name={courseFilter:'course',scopeFilter:'scope',statusFilter:'status'}[e.target.id];if(name){model[name]=e.target.value;renderAssignmentRows();}
  if(e.target.dataset.note!==undefined){notes[Number(e.target.dataset.note)].done=e.target.checked;localStorage.setItem('sc-notes',JSON.stringify(notes));render();}
  if(e.target.id==='timezone'){zone=e.target.value;localStorage.setItem('sc-timezone',zone);renderToday();if(model.data)$('#sync').textContent='上次同步 '+fmt(model.data.fetched_at,{year:'numeric'});render();}
});
document.addEventListener('keydown',e=>{const c=e.target.closest('[data-course]');if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();model.course=c.dataset.course;model.scope='all';navigate('assignments');}});
$('#closeDetail').addEventListener('click',()=>$('#detail').close());
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const rect=$('#detail').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$('#detail').close();}});
$('#refresh').addEventListener('click',()=>refresh(true));
function renderToday(){const now=new Date();$('#today').innerHTML=`<strong>${new Intl.DateTimeFormat('en',{timeZone:zone,month:'short',day:'numeric'}).format(now)}</strong>${new Intl.DateTimeFormat('zh-CN',{timeZone:zone,weekday:'long'}).format(now)}`;}
renderToday();
navigate('overview');
