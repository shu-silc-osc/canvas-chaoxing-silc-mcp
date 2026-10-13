'use strict';
function studentServices(){
  $('#content').innerHTML=`<div class="services">${services.map(([tool,icon,name,desc])=>`<article class="service"><button type="button" class="serviceicon" data-tool="${tool}" data-cursor-label="${esc(name)}" aria-label="查询${esc(name)}">${icon}</button><h3>${name}</h3><p>${desc}</p><button class="textbutton" data-tool="${tool}">查看 →</button></article>`).join('')}</div><section id="serviceWorkspace" class="service-workspace" aria-live="polite"></section>`;
  if(model.service)openService(model.service.name,model.service.course);
}
function openService(name,course='all'){
  if(name==='list_calendar_events'){navigate('overview');return;}
  if(model.view!=='updates')navigate('updates');
  const tool=model.tools.find(t=>t.provider==='upstream'&&t.name===name&&t.enabled);
  if(!tool){notice('这项服务当前未加载，请刷新后重试。');return;}
  const service=services.find(s=>s[0]===name),title=service?.[2]||(name==='get_my_assignment_scores'?'本课程成绩与状态':'学生服务');
  const props=tool.inputSchema?.properties||{},hasCourse='course_identifier'in props;
  if(name==='get_my_assignment_scores'&&course==='all')course=String(model.data.courses[0]?.id||'all');
  model.service={name,course:String(course),days:14,type:'all'};
  const pane=$('#serviceWorkspace');
  pane.innerHTML=`<div class="panelhead"><h2>${esc(title)}</h2><button class="textbutton" id="closeService">收起 ×</button></div><div class="service-filters">${hasCourse?`<label>课程<select id="serviceCourse" aria-label="服务课程">${name==='get_my_assignment_scores'?'':'<option value="all">全部课程</option>'}${model.data.courses.map(c=>`<option value="${c.id}" ${String(course)===String(c.id)?'selected':''}>${esc(c.code||c.name)}</option>`).join('')}</select></label>`:''}${'days'in props||name==='list_my_announcements'?`<label>时间范围<select id="serviceDays" aria-label="服务时间范围"><option value="7">7 天</option><option value="14" selected>14 天</option><option value="30">30 天</option></select></label>`:''}${'item_type'in props?'<label>动态类型<select id="serviceType" aria-label="动态类型"><option value="all">全部动态</option><option value="announcements">公告</option><option value="discussions">讨论</option><option value="submissions">提交</option><option value="notifications">通知</option><option value="conversations">消息</option></select></label>':''}<button class="button" id="retryService">重新查询</button></div><div id="serviceResults" role="status"></div>`;
  if(name==='get_my_course_grades'){
    pane.insertAdjacentHTML('beforeend','<div id="gradeCalculatorHost"></div>');
    if(typeof mountGradeCalculator==='function')mountGradeCalculator();
  }
  pane.scrollIntoView({behavior:'auto',block:'start'});runService();
}
async function runService(){
  const selection={...model.service};if(!selection)return;
  const request=++model.serviceRequest,result=$('#serviceResults');if(!result)return;
  const tool=model.tools.find(t=>t.provider==='upstream'&&t.name===selection.name&&t.enabled);
  if(!tool)return;
  const args=SCWorkspace.serviceArguments(tool,selection);
  if(selection.name==='list_my_announcements')args.start_date=new Date(Date.now()-selection.days*86400000).toISOString();
  const required=tool.inputSchema?.required||[];
  if(required.some(p=>args[p]===undefined||args[p]===null)){result.innerHTML='<p class="empty">请选择课程后查询。</p>';return;}
  result.innerHTML='<div class="loading"><span class="spinner"></span><h3>正在查询…</h3></div>';
  try{
    const data=await api('/api/call',{method:'POST',body:JSON.stringify({provider:'upstream',name:selection.name,arguments:args})});
    if(request!==model.serviceRequest||model.view!=='updates')return;
    const text=data.text||'';
    const failed=data.is_error||/^Error[:\s]/i.test(text);
    result.classList.toggle('service-error',failed);
    const sections=SCWorkspace.serviceSections(text);
    result.innerHTML=(failed?'<p class="service-error-message">这次查询未完成，请重新查询。</p>':'')+(sections.length?sections.map((section,i)=>`<article class="service-result-card">${i===0?'<span class="result-index">查询结果</span>':''}<p>${serviceText(section)}</p></article>`).join(''):'<p class="empty">没有返回内容。</p>');
  }catch(err){if(request===model.serviceRequest&&model.view==='updates')result.innerHTML=`<p class="empty service-error-message">查询未完成：${esc(err.message)}</p>`;}
}
function serviceText(text){
  // Canvas output is untrusted text. Only allow links to the configured Canvas host.
  return SCWorkspace.serviceLinkParts(text).map(p=>p.url?`<a href="${esc(p.url)}" target="_blank" rel="noopener">${p.text}</a>`:esc(p.text)).join('');
}
document.addEventListener('change',e=>{
  const key={serviceCourse:'course',serviceDays:'days',serviceType:'type'}[e.target.id];
  if(key&&model.service){model.service[key]=e.target.value;runService();}
});
document.addEventListener('click',e=>{
  if(e.target.id==='retryService')runService();
  if(e.target.id==='closeService'){model.service=null;model.serviceRequest++;$('#serviceWorkspace').innerHTML='';}
});
