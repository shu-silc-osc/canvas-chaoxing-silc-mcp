'use strict';
const calendarState={instance:null,view:'dayGridMonth',date:null,year:null,hidden:new Set(),events:new Map(),loaded:new Set(),pending:new Map(),range:null,selectedDay:null};
const courseColors=['#a42821','#285c80','#4c6548','#80562f','#655180','#3a6468','#565656'];
function courseColor(id){const i=model.data.courses.findIndex(c=>String(c.id)===String(id));return courseColors[i<0?6:i%courseColors.length];}
function initializeCalendarData(data){
  calendarState.events.clear();calendarState.loaded.clear();calendarState.pending.clear();
  calendarState.year=data.academic_year;
  for(const e of data.calendar_events||[])calendarState.events.set(e.id,e);
  if(!data.errors.some(e=>String(e.source).includes('日历')))calendarState.loaded.add(data.academic_year);
}
function destroyCalendar(){if(calendarState.instance){calendarState.date=calendarState.instance.getDate().toISOString().slice(0,10);calendarState.instance.destroy();calendarState.instance=null;}}
function calendarEvents(){return SCWorkspace.visibleEvents([...calendarState.events.values()],calendarState.hidden);}
function calendarHome(){
  destroyCalendar();
  const year=calendarState.year||SCWorkspace.academicYear(new Date(),zone);
  const years=new Set([year-2,year-1,year,year+1,year+2,...model.data.assignments.filter(a=>a.due_at).map(a=>SCWorkspace.academicYear(a.due_at,zone))]);
  $('#content').innerHTML=`<section class="calendar-workspace"><div class="calendar-toolbar"><div class="calendar-navigation"><button class="button square" data-cal-nav="prev" aria-label="上一时段"><span data-cursor-label="上一页" aria-hidden="true">←</span></button><button class="button square" data-cal-nav="next" aria-label="下一时段"><span data-cursor-label="下一页" aria-hidden="true">→</span></button><button class="button" data-cal-nav="today">今天</button><h2 id="calendarTitle"></h2></div><div class="calendar-options"><select id="academicYear" aria-label="选择学年">${[...years].sort().map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}–${y+1} 学年</option>`).join('')}</select><div class="view-switch" role="group" aria-label="日历视图"><button data-cal-view="academicYear" aria-pressed="${calendarState.view==='academicYear'}">学年</button><button data-cal-view="dayGridMonth" aria-pressed="${calendarState.view==='dayGridMonth'}">月</button><button data-cal-view="timeGridWeek" aria-pressed="${calendarState.view==='timeGridWeek'}">周</button></div></div></div><details class="course-visibility" ${window.matchMedia('(min-width:768px)').matches?'open':''}><summary>显示课程 <span id="calendarCount"></span></summary><div class="course-checks">${model.data.courses.map(c=>`<label><input type="checkbox" data-calendar-course="${c.id}" ${calendarState.hidden.has(String(c.id))?'':'checked'}><i style="--course-color:${courseColor(c.id)}"></i><span title="${esc(c.name)}">${esc(c.code||c.name)}</span></label>`).join('')}</div></details><p class="calendar-status" id="calendarStatus" role="status"></p><div class="calendar-scroll"><div id="calendar" class="sc-calendar"></div></div><section class="calendar-agenda"><div class="panelhead"><h2 id="agendaTitle">这段时间</h2><button class="textbutton" id="clearDay" hidden>返回当前时段 →</button></div><div id="calendarAgenda"></div></section><section class="panel calendar-plans"><div class="panelhead"><h2>我的学习计划</h2><button class="textbutton" id="addNote">＋ 添加</button></div>${notes.map((n,i)=>`<div class="todo"><label><input type="checkbox" data-note="${i}" ${n.done?'checked':''}><span class="${n.done?'plan-done':''}">${esc(n.text)}</span></label></div>`).join('')||'<div class="empty">把目标拆成一个小任务。</div>'}</section></section>`;
  const initialDate=calendarState.date||SCWorkspace.calendarTime(new Date().toISOString(),zone).slice(0,10);
  calendarState.instance=new FullCalendar.Calendar($('#calendar'),{
    initialView:calendarState.view,initialDate:calendarState.view==='academicYear'?`${year}-09-01`:initialDate,
    timeZone:'UTC',now:SCWorkspace.calendarTime(new Date().toISOString(),zone),
    locale:{code:'zh-cn',week:{dow:1,doy:4},buttonText:{today:'今天',month:'月',week:'周',day:'日',list:'日程'},allDayText:'全天',moreLinkText:n=>`另 ${n} 项`,noEventsText:'暂无日程'},
    headerToolbar:false,firstDay:1,height:calendarState.view==='academicYear'?'auto':calendarState.view==='timeGridWeek'?640:(window.matchMedia('(max-width:767px)').matches?420:520),editable:false,eventInteractive:true,eventDisplay:'block',
    views:{academicYear:{type:'multiMonth',duration:{months:12},dateAlignment:'month',dateIncrement:{months:12}}},
    multiMonthMaxColumns:3,singleMonthMinWidth:240,fixedWeekCount:false,dayMaxEvents:3,
    allDaySlot:true,slotMinTime:'00:00:00',slotMaxTime:'24:00:00',scrollTime:'08:00:00',
    eventTimeFormat:{hour:'2-digit',minute:'2-digit',hour12:false},dayHeaderFormat:{weekday:'short'},
    eventClass:'sc-event',eventInnerClass:'sc-event-inner',dayCellClass:'sc-day',
    eventContent:info=>{const e=info.event.extendedProps.record;const content=document.createElement('span');content.className='event-label';content.textContent=(info.timeText?info.timeText+' ':'')+(e.name_zh||e.name);return {domNodes:[content]};},
    eventDidMount:info=>{info.el.setAttribute('aria-label',(info.event.extendedProps.record.name_zh||info.event.title)+'，点击查看介绍');info.el.title=info.event.title;},
    eventClick:info=>{info.jsEvent.preventDefault();calendarDetail(info.event.id);},
    dateClick:info=>{calendarState.selectedDay=info.dateStr.slice(0,10);renderCalendarAgenda();},
    datesSet:info=>{
      calendarState.range={start:info.startStr.slice(0,10),end:info.endStr.slice(0,10)};
      calendarState.selectedDay=null;
      const current=info.view.currentStart.toISOString().slice(0,10);
      const academic=SCWorkspace.academicYear(current+'T12:00:00Z','UTC');calendarState.year=academic;
      const shortDate=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'numeric',day:'numeric'}).format(value);
      $('#calendarTitle').textContent=info.view.type==='academicYear'?`${academic}–${academic+1} 学年`:info.view.type==='timeGridWeek'?`${info.view.currentStart.getUTCFullYear()}年 ${shortDate(info.view.currentStart)} – ${shortDate(new Date(info.view.currentEnd.getTime()-1))}`:info.view.title;
      document.querySelector('.calendar-scroll').dataset.view=info.view.type;
      if(![...$('#academicYear').options].some(o=>o.value===String(academic)))$('#academicYear').add(new Option(`${academic}–${academic+1} 学年`,academic));
      $('#academicYear').value=academic;
      renderMiniCalendar(current);renderCalendarAgenda();
      const first=SCWorkspace.academicYear(info.startStr,'UTC');
      const last=SCWorkspace.academicYear(new Date(info.end.getTime()-1).toISOString(),'UTC');
      ensureCalendarYears([...new Set([first,last])]);
    }
  });
  calendarState.instance.render();updateCalendarEvents();
}
function updateCalendarEvents(){
  const calendar=calendarState.instance;if(!calendar)return;
  calendar.batchRendering(()=>{
    for(const source of calendar.getEventSources())source.remove();
    calendar.addEventSource(calendarEvents().map(e=>({id:e.id,title:e.name_zh||e.name,start:SCWorkspace.calendarTime(e.start,zone),end:e.end?SCWorkspace.calendarTime(e.end,zone):undefined,allDay:e.all_day,color:courseColor(e.course_id),contrastColor:'#fff',extendedProps:{record:e}})));
  });
  renderCalendarAgenda();renderMiniCalendar(calendar.getDate().toISOString().slice(0,10));
}
async function ensureCalendarYears(years){
  const required=years.filter(y=>!calendarState.loaded.has(y));if(!required.length)return;
  const status=$('#calendarStatus');if(status)status.textContent='正在同步这一时段的日程…';
  try{
    const results=await Promise.all(required.map(year=>{
      if(!calendarState.pending.has(year))calendarState.pending.set(year,api(`/api/calendar?year=${year}`).finally(()=>calendarState.pending.delete(year)));
      return calendarState.pending.get(year);
    }));
    for(const result of results){for(const e of result.events)calendarState.events.set(e.id,e);if(!result.errors.length)calendarState.loaded.add(result.year);}
    const current=results.find(r=>r.year===model.data?.academic_year);
    if(current){model.data.errors=SCWorkspace.reconcileCalendarErrors(model.data.errors,current.errors);const messages=model.data.errors.map(e=>e.error);if(model.toolError)messages.push(model.toolError);notice(messages.length?'部分数据读取失败：'+messages.join('；'):'');}
    if(model.view!=='overview')return;
    updateCalendarEvents();
    if($('#calendarStatus'))$('#calendarStatus').textContent=results.flatMap(r=>r.errors).map(e=>e.error).join('；');
  }catch(err){if(model.view==='overview'&&$('#calendarStatus'))$('#calendarStatus').textContent='日程同步未完成：'+err.message;}
}
function renderCalendarAgenda(){
  if(!$('#calendarAgenda')||!calendarState.range)return;
  const range=calendarState.range,day=calendarState.selectedDay;
  const entries=calendarEvents().filter(e=>{const date=SCWorkspace.calendarTime(e.start,zone).slice(0,10);return day?date===day:date>=range.start&&date<range.end;}).sort((a,b)=>new Date(a.start)-new Date(b.start));
  $('#calendarCount').textContent=` · 当前时段 ${entries.length} 项`;
  $('#agendaTitle').textContent=day?`${day} 的安排`:'这段时间';$('#clearDay').hidden=!day;
  $('#calendarAgenda').innerHTML=entries.map(e=>`<button class="agenda-event" data-calendar-event="${esc(e.id)}"><span class="agenda-date">${esc(fmt(e.start,{hour:undefined,minute:undefined}))}<small>${e.all_day?'全天':esc(fmt(e.start,{month:undefined,day:undefined}))}</small></span><i style="--course-color:${courseColor(e.course_id)}"></i><span class="agenda-body"><b>${esc(e.name_zh||e.name)}</b><small>${esc(e.code||e.course)} · ${e.kind==='assignment'?'作业截止':'日历事件'}</small></span><span aria-hidden="true">↗</span></button>`).join('')||'<div class="empty">这一时段没有符合筛选条件的事件。</div>';
}
function renderMiniCalendar(date){
  if(!model.data)return;const mini=$('#miniCalendar');mini.hidden=false;
  const [year,month]=date.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)),offset=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const dates=new Set(calendarEvents().map(e=>SCWorkspace.calendarTime(e.start,zone).slice(0,10)));
  const today=SCWorkspace.calendarTime(new Date().toISOString(),zone).slice(0,10);
  mini.innerHTML=`<div class="mini-heading"><b>${year} / ${String(month).padStart(2,'0')}</b><button data-mini-nav="-1" aria-label="快速日历上一月">‹</button><button data-mini-nav="1" aria-label="快速日历下一月">›</button></div><div class="mini-grid">${['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({length:days},(_,i)=>{const day=`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;return `<button class="${day===today?'mini-today ':''}${dates.has(day)?'has-event':''}" data-mini-date="${day}" aria-label="${day}${dates.has(day)?'，有事件':''}" ${day===today?'aria-current="date"':''}>${i+1}</button>`;}).join('')}</div>`;
  mini.dataset.month=`${year}-${String(month).padStart(2,'0')}-01`;
}
function calendarDetail(id){
  const e=calendarState.events.get(id);if(!e)return;
  $('#detailBody').innerHTML=`<p class="eyebrow">${esc(e.code||e.course)} · ${e.kind==='assignment'?'作业截止':'日历事件'}</p><h2 id="detailTitle" class="detailhead">${esc(e.name_zh||e.name)}</h2>${e.name_zh?`<p class="event-original-title">${esc(e.name)}</p>`:''}<div class="detailmeta"><span>${esc(fmt(e.start,{year:'numeric'}))}${e.all_day?' · 全天':''}</span>${e.end?`<span>结束 ${esc(fmt(e.end,{year:'numeric'}))}</span>`:''}${e.location?`<span>${esc(e.location)}</span>`:''}</div><div class="event-introduction"><h3>中文介绍${e.introduction_is_excerpt?' · 介绍段落':''}</h3><p>${esc(e.description_zh||'这条介绍尚待翻译，可先查看原文。')}</p></div>${e.description?`<details class="event-original"><summary>查看完整原文</summary><p>${esc(e.description)}</p></details>`:''}<div class="detailactions">${e.url?`<a class="primary" href="${esc(e.url)}" target="_blank" rel="noopener">打开 Canvas ↗</a>`:''}${e.assignment_key?`<button class="button" data-calendar-assignment="${esc(e.assignment_key)}">查看作业与提交状态</button>`:''}</div>`;
  $('#detail').showModal();
}
document.addEventListener('click',e=>{
  const event=e.target.closest('[data-calendar-event]');if(event){calendarDetail(event.dataset.calendarEvent);return;}
  const assignment=e.target.closest('[data-calendar-assignment]');if(assignment){$('#detail').close();detail(assignment.dataset.calendarAssignment);return;}
  const nav=e.target.closest('[data-cal-nav]');if(nav&&calendarState.instance){calendarState.selectedDay=null;if(nav.dataset.calNav==='today'){calendarState.instance.gotoDate(calendarState.view==='academicYear'?`${SCWorkspace.academicYear(new Date(),zone)}-09-01`:SCWorkspace.calendarTime(new Date().toISOString(),zone).slice(0,10));}else calendarState.instance[nav.dataset.calNav]();return;}
  const view=e.target.closest('[data-cal-view]');if(view&&calendarState.instance){calendarState.view=view.dataset.calView;document.querySelectorAll('[data-cal-view]').forEach(b=>b.setAttribute('aria-pressed',b===view));calendarState.instance.setOption('height',calendarState.view==='academicYear'?'auto':calendarState.view==='timeGridWeek'?640:(window.matchMedia('(max-width:767px)').matches?420:520));calendarState.instance.changeView(calendarState.view,calendarState.view==='academicYear'?`${calendarState.year}-09-01`:calendarState.instance.getDate());return;}
  const date=e.target.closest('[data-mini-date]');if(date){calendarState.date=date.dataset.miniDate;if(model.view!=='overview')navigate('overview');if(calendarState.view==='academicYear'){calendarState.view='dayGridMonth';calendarState.instance.changeView('dayGridMonth',date.dataset.miniDate);document.querySelectorAll('[data-cal-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.calView==='dayGridMonth'));}else calendarState.instance.gotoDate(date.dataset.miniDate);calendarState.selectedDay=date.dataset.miniDate;renderCalendarAgenda();return;}
  const miniNav=e.target.closest('[data-mini-nav]');if(miniNav){const date=new Date($('#miniCalendar').dataset.month+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+Number(miniNav.dataset.miniNav));renderMiniCalendar(date.toISOString().slice(0,10));return;}
  if(e.target.id==='clearDay'){calendarState.selectedDay=null;renderCalendarAgenda();}
});
document.addEventListener('change',e=>{
  if(e.target.dataset.calendarCourse){const id=e.target.dataset.calendarCourse;e.target.checked?calendarState.hidden.delete(id):calendarState.hidden.add(id);updateCalendarEvents();}
  if(e.target.id==='academicYear'&&calendarState.instance){calendarState.year=Number(e.target.value);calendarState.instance.gotoDate(`${calendarState.year}-09-01`);}
});
window.matchMedia('(max-width:767px)').addEventListener('change',e=>{
  const filters=document.querySelector('.course-visibility');if(filters)filters.open=!e.matches;
  if(calendarState.instance&&calendarState.view==='dayGridMonth')calendarState.instance.setOption('height',e.matches?420:520);
});
