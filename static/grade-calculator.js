/* Course-grade planning; expected scores never write back to Canvas. */
(function(root){
  'use strict';
  function number(value,label){
    if(String(value??'').trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)throw Error(`${label}须为 0–100 的数字。`);
    return Number(value);
  }
  function buildPlan(data,target,mode,selected,estimates){
    const out={course_id:data.course_id,target_percent:number(target,'目标总评')};
    if(mode==='selected'){
      const remaining=data.assignments.filter(a=>a.can_predict);
      if(!selected.length)throw Error('请勾选至少一个要测算的项目。');
      out.solve_ids=selected;out.expected_percentages={};
      for(const a of remaining)if(!selected.includes(a.id))out.expected_percentages[a.id]=number(estimates[a.id],'其他作业的预计得分率');
    }
    return out;
  }
  root.SCGrades={buildPlan};
  if(typeof module==='object'&&module.exports)module.exports=root.SCGrades;
  if(typeof document==='undefined')return;
  const state={version:0,data:null};
  const pct=v=>v==null?'—':`${Number(v).toFixed(2)}%`;
  const points=v=>v==null?'—':Number(v).toFixed(2);
  const statusLabels={graded:'已评分',remaining:'未评分',dropped:'按规则剔除',excluded:'不计入总评',excused:'已豁免'};
  function active(pane,version){return document.querySelector('#gradeCalculator')===pane&&version===state.version&&model.view==='updates'&&model.service?.name==='get_my_course_grades';}
  root.mountGradeCalculator=function(){
    state.version++;state.data=null;
    const host=document.querySelector('#gradeCalculatorHost');if(!host)return;
    host.innerHTML=`<section id="gradeCalculator" class="grade-calculator" aria-labelledby="gradeTitle"><div class="grade-heading"><div><p class="eyebrow">GRADE PLANNER / 01</p><h2 id="gradeTitle">目标分数计算器</h2><p>从现在的成绩，推算接下来需要拿到多少分。</p></div><label>选择课程<select id="gradeCourse" aria-label="计算成绩的课程">${model.data.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label></div><div class="grade-load"><button class="button" id="reloadGrade">重新读取成绩</button><p id="gradeLoadStatus" role="status"></p></div><div id="gradeBody"></div></section>`;
    if(model.data.courses.length)loadCourse();else document.querySelector('#gradeLoadStatus').textContent='没有可选择的课程。';
  };
  async function loadCourse(){
    const pane=document.querySelector('#gradeCalculator');if(!pane)return;
    const version=++state.version;state.data=null;
    pane.querySelector('#gradeBody').innerHTML='';pane.querySelector('#gradeLoadStatus').textContent='正在读取作业得分与权重…';
    const id=pane.querySelector('#gradeCourse').value;
    try{
      const data=await api('/api/grade-calculator',{method:'POST',body:JSON.stringify({course_id:id})});
      if(!active(pane,version))return;
      state.data=data;pane.querySelector('#gradeLoadStatus').textContent='已读取当前可见评分数据。';render(data);
    }catch(err){if(active(pane,version))pane.querySelector('#gradeLoadStatus').textContent=err.message;}
  }
  function render(data){
    const remaining=data.assignments.filter(a=>a.can_predict);
    document.querySelector('#gradeBody').innerHTML=`<div class="grade-summary"><div><span>当前重算成绩 · 已评分项目</span><strong>${pct(data.current_percent)}</strong></div><div><span>Canvas 当前成绩</span><strong>${pct(data.canvas_current_percent)}</strong></div><div><span>计算方式</span><strong class="grade-method">${data.weighted?'作业组加权':'总分比例'}</strong></div></div><details class="grade-breakdown" open><summary>作业得分与当前成绩贡献</summary><p class="hint">贡献以总评百分点表示；当前成绩仅纳入已评分项目，空作业组权重会重新归一化。</p>${data.groups.map(g=>`<section class="grade-group"><h3>${esc(g.name)} <small>${data.weighted?`权重 ${points(g.weight)}%`:'按分值计入'} · 当前 ${pct(g.current_percent)}</small></h3>${g.drop_lowest||g.drop_highest?`<p class="hint">剔除最低 ${g.drop_lowest} 项 / 最高 ${g.drop_highest} 项；指定不剔除项目 ${g.never_drop.length} 项。</p>`:''}<div class="grade-table-scroll"><table class="grade-table"><thead><tr><th>作业</th><th>得分 / 满分</th><th>当前贡献</th><th>状态</th></tr></thead><tbody>${data.assignments.filter(a=>a.group_id===g.id).map(a=>`<tr><td>${esc(a.name)}</td><td>${points(a.score)} / ${points(a.points_possible)}</td><td>${a.current_contribution==null?'—':`${points(a.current_contribution)} 点`}</td><td>${statusLabels[a.status]}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</details><form id="gradePlanForm" class="grade-plan"><div class="grade-plan-heading"><h3>规划接下来的成绩</h3><label>目标总评（%）<input id="gradeTarget" type="number" min="0" max="100" step="0.01" value="80" required aria-label="目标总评百分比"></label></div><fieldset class="grade-modes"><legend>测算范围</legend><label><input type="radio" name="gradeMode" value="all" checked>全部未评分项目</label><label><input type="radio" name="gradeMode" value="selected" ${remaining.length?'':'disabled'}>只反推勾选的 Quiz／考试</label></fieldset><p class="hint" id="gradeModeHint">假设全部未评分项目取得相同得分率，逐项显示所需分值。</p><div id="gradeAssumptions" hidden><p>勾选需要反推的项目；其余项目请填写预计得分率。</p>${remaining.map(a=>{const quiz=a.is_quiz||/quiz|exam|test|考试|测验|期末|期中/i.test(a.name);return `<div class="grade-assumption"><label><input type="checkbox" data-grade-solve="${esc(a.id)}" ${quiz?'checked':''}><span>${esc(a.name)}<small>满分 ${points(a.points_possible)}</small></span></label><label>预计得分（%）<input type="number" min="0" max="100" step="0.01" data-grade-estimate="${esc(a.id)}" aria-label="${esc(a.name)}预计得分率" ${quiz?'disabled':''}></label></div>`;}).join('')}</div><button class="primary" id="calculateGrade" ${data.projection_supported?'':'disabled'}>计算目标分数 <span data-cursor-label="计算" aria-hidden="true">↗</span></button><p id="gradePlanError" class="grade-error" role="alert"></p><div id="gradeProjection" role="status" aria-live="polite"></div></form><div class="grade-notes">${data.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`;
  }
  function showProjection(data){
    const p=data.projection;
    const labels={secured:'目标已覆盖',reachable:p.non_monotone?'找到可行情景':'目标可达到',unreachable:'按当前模型无法达到',indeterminate:'暂无法确定可达性'};
    const count=p.requirements.length;
    const description=p.status==='secured'?'按当前模型与填写的预计分数，勾选项目得 0 分也能达到目标。':p.status==='reachable'?`${p.non_monotone?'一个已核验情景':'统一得分率要求'}：${pct(p.required_percent)}。这是一种分数组合，各项目之间也可互相补偿。`:p.status==='indeterminate'?(p.non_monotone?'剔除规则导致非单调变化，搜索未找到解，不等于证明目标不可达。':'当前没有可计算的计分基数，暂不能判断目标是否可达。'):count?'即使待测算项目全部满分，也未达到目标。':'没有可继续测算的未评分项目，当前成绩低于目标。';
    document.querySelector('#gradeProjection').innerHTML=`<section class="grade-result"><p class="eyebrow">TARGET ${pct(p.target_percent)}</p><h3>${labels[p.status]}</h3><p>${description}</p><div class="grade-result-range"><span>待测算项目全为 0 分：<b>${pct(p.projected_at_zero)}</b></span><span>待测算项目全为满分：<b>${pct(p.projected_at_full)}</b></span></div>${p.required_percent!=null&&count?`<h4>每项参考分数 · 统一 ${pct(p.required_percent)}</h4><ul>${p.requirements.map(a=>`<li><span>${esc(a.name)}</span><strong>约 ${points(a.points)} / ${points(a.points_possible)}</strong></li>`).join('')}</ul>`:''}<p class="hint">以上为统一得分率情景；显示分值取两位小数，实际规划宜留出余量。${Object.keys(p.assumed_percentages).length?'其他作业采用你填写的预计分数。':''}</p></section>`;
  }
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='gradePlanForm')return;e.preventDefault();
    const pane=document.querySelector('#gradeCalculator'),data=state.data;if(!data)return;
    const error=pane.querySelector('#gradePlanError');error.textContent='';pane.querySelector('#gradeProjection').innerHTML='';
    let payload;
    try{
      const mode=pane.querySelector('[name="gradeMode"]:checked').value;
      const selected=[...pane.querySelectorAll('[data-grade-solve]:checked')].map(n=>n.dataset.gradeSolve);
      const estimates=Object.fromEntries([...pane.querySelectorAll('[data-grade-estimate]')].map(n=>[n.dataset.gradeEstimate,n.value]));
      payload=buildPlan(data,pane.querySelector('#gradeTarget').value,mode,selected,estimates);
    }catch(err){error.textContent=err.message;return;}
    const version=++state.version,button=pane.querySelector('#calculateGrade');button.disabled=true;button.textContent='正在计算…';
    try{
      const result=await api('/api/grade-calculator',{method:'POST',body:JSON.stringify(payload)});
      if(!active(pane,version))return;
      // Re-reading may change the actual scores/rules; render the fresh breakdown as well.
      state.data=result;render(result);pane.querySelector('#gradeTarget').value=payload.target_percent;
      if(payload.solve_ids){pane.querySelector('[name="gradeMode"][value="selected"]').checked=true;updateMode();for(const n of pane.querySelectorAll('[data-grade-solve]'))n.checked=payload.solve_ids.includes(n.dataset.gradeSolve);for(const n of pane.querySelectorAll('[data-grade-estimate]')){n.value=payload.expected_percentages[n.dataset.gradeEstimate]??'';n.disabled=payload.solve_ids.includes(n.dataset.gradeEstimate);}}
      showProjection(result);
    }catch(err){if(active(pane,version))error.textContent=err.message;}
    finally{if(active(pane,version)){const b=pane.querySelector('#calculateGrade');b.disabled=!state.data?.projection_supported;b.textContent='计算目标分数 ↗';}}
  });
  function updateMode(){
    const selected=document.querySelector('[name="gradeMode"]:checked')?.value==='selected';
    document.querySelector('#gradeAssumptions').hidden=!selected;
    document.querySelector('#gradeModeHint').textContent=selected?'项目勾选由你确认；名称识别仅用于初始建议。未勾选项目的预计得分必填。':'假设全部未评分项目取得相同得分率，逐项显示所需分值。';
  }
  document.addEventListener('change',e=>{
    if(e.target.id==='gradeCourse'){loadCourse();return;}
    if(e.target.name==='gradeMode')updateMode();
    if(e.target.dataset.gradeSolve){const input=document.querySelector(`[data-grade-estimate="${e.target.dataset.gradeSolve}"]`);if(input)input.disabled=e.target.checked;}
  });
  document.addEventListener('input',e=>{
    if(e.target.closest('#gradePlanForm')){state.version++;const result=document.querySelector('#gradeProjection');if(result)result.innerHTML='';const b=document.querySelector('#calculateGrade');if(b){b.disabled=!state.data?.projection_supported;b.textContent='计算目标分数 ↗';}}
  });
  document.addEventListener('click',e=>{if(e.target.id==='reloadGrade')loadCourse();});
})(typeof window==='undefined'?globalThis:window);
