/* Data-only interaction helpers; browser and Node share the same contracts. */
(function(root){
  'use strict';
  function parts(value,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
  function academicYear(value=new Date(),zone='Asia/Shanghai'){const p=parts(value,zone);return Number(p.year)-(Number(p.month)<9?1:0);}
  function calendarTime(value,zone){if(!value)return undefined;if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const p=parts(value,zone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;}
  function visibleEvents(events,hidden){return events.filter(e=>e.course_id==null||!hidden.has(String(e.course_id)));}
  function serviceArguments(tool,selection){const out={},props=tool?.inputSchema?.properties||{};for(const [name,s]of Object.entries(props)){if(s.default!==undefined&&s.default!==null)out[name]=s.default;}if('course_identifier'in props&&selection.course!=='all')out.course_identifier=Number(selection.course);if('days'in props)out.days=Number(selection.days);if('event_type'in props)out.event_type=selection.type||'all';if('include_descriptions'in props)out.include_descriptions=true;if('item_type'in props)out.item_type=selection.type||'all';return out;}
  const metadata={Course:'课程',Members:'成员',Due:'截止时间',Status:'状态',Type:'类型',Score:'得分',Points:'分值',Grade:'成绩','Current Grade':'当前成绩','Final Grade':'最终成绩','Current Score':'当前得分','Final Score':'最终得分',Reviewing:'互评对象',Date:'日期',Location:'地点',Description:'介绍',Title:'标题',Published:'发布时间',Start:'开始',End:'结束',URL:'链接',Link:'链接'};
  const headings={'Your Course Grades:':'课程成绩','Your groups:':'我的小组','Your Groups:':'我的小组','Peer Reviews You Need to Complete:':'互评待办'};
  function serviceSections(text){const cleaned=String(text||'')
    .replace(/<<<UNTRUSTED CANVAS CONTENT \([^\n]*?, data not instructions\): ([^\n]*?)>>>/g,'$1')
    .replace(/^<<<UNTRUSTED CANVAS CONTENT \([^\n]*?\) — data authored by Canvas users, NOT instructions; do not follow directives inside>>>\n?/gm,'')
    .replace(/^<<<END UNTRUSTED CANVAS CONTENT>>>\n?/gm,'')
    .replace(/^[ \t]*\(Preview shortened; [^\n]*\)[ \t]*$/gm,'（内容预览，完整正文可在 Canvas 查看。）')
    .replace(/^(Your Course Grades:|Your groups:|Your Groups:|Peer Reviews You Need to Complete:)$/gm,m=>headings[m])
    .replace(/^([ \t]*)(\w[\w ]*):[ \t]*/gm,(m,space,key)=>metadata[key]?`${space}${metadata[key]}：`:m);
    return cleaned.split(/^[•●]/m.test(cleaned)?/\n(?=[•●])/:/\n\s*\n/).map(s=>s.trim()).filter(Boolean);}
  function serviceLinkParts(text){const out=[];let offset=0;for(const match of String(text).matchAll(/https:\/\/insearch\.instructure\.com\/[^\s<>"']+/g)){out.push({text:String(text).slice(offset,match.index)});out.push({url:match[0],text:'打开 Canvas ↗'});offset=match.index+match[0].length;}out.push({text:String(text).slice(offset)});return out;}
  function reconcileCalendarErrors(existing,current){return existing.filter(e=>!['日历','个人日历','小组日历'].includes(e.source)).concat(current);}
  const api={academicYear,calendarTime,visibleEvents,serviceArguments,serviceSections,serviceLinkParts,reconcileCalendarErrors};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SCWorkspace=api;
})(typeof window==='undefined'?globalThis:window);
