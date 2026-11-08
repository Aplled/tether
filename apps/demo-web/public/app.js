import { icon } from './icons.js';
import { prepareWithSegments, layoutWithLines } from './vendor/pretext/layout.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const fixture = () => ({
  workspace:{id:'northstar',name:'Northstar Compute'},revision:12,source:'fixture-preview',
  nodes:[
    {id:'distribution',kind:'service',name:'Compute Gateway',x:90,y:110,status:'healthy',criticality:'critical',ownerId:'maya',description:'Routes approved workloads into the compute environment.'},
    {id:'scheduler',kind:'service',name:'GPU Job Scheduler',x:370,y:75,status:'at-risk',criticality:'critical',ownerId:'liam',description:'Schedules accelerated model training jobs.'},
    {id:'queue',kind:'resource',name:'Model Training Queue',x:655,y:115,status:'healthy',criticality:'high',ownerId:'liam',description:'Durable queue for incoming training workloads.'},
    {id:'packing',kind:'procedure',name:'Training Workflow',x:120,y:330,status:'healthy',criticality:'critical',ownerId:'maya',description:'Standard model training and checkpoint procedure.'},
    {id:'roster',kind:'resource',name:'Offline Runbook',x:410,y:340,status:'standby',criticality:'high',ownerId:'nora',description:'Signed local procedure for continuity operations.'},
    {id:'checkin',kind:'task',name:'Verify runbook checksum',x:690,y:325,status:'open',criticality:'high',ownerId:'nora',description:'Confirm the offline runbook matches the approved digest.'},
    {id:'maya-node',kind:'person',name:'Maya Chen',x:115,y:545,status:'available',criticality:'normal',ownerId:'maya',description:'Fictional incident commander and compute operations lead.'},
    {id:'runbook',kind:'procedure',name:'Containment Procedure',x:430,y:550,status:'ready',criticality:'high',ownerId:'liam',description:'Scheduler containment and fallback verification procedure.'},
  ],
  edges:[
    {id:'e1',source:'distribution',target:'scheduler',kind:'depends_on',label:'depends on'},
    {id:'e2',source:'scheduler',target:'queue',kind:'reads from',label:'reads from'},
    {id:'e3',source:'distribution',target:'packing',kind:'enables',label:'enables'},
    {id:'e4',source:'packing',target:'roster',kind:'fallback',label:'fallback to'},
    {id:'e5',source:'roster',target:'checkin',kind:'requires',label:'requires'},
    {id:'e6',source:'maya-node',target:'distribution',kind:'owns',label:'owns'},
    {id:'e7',source:'runbook',target:'scheduler',kind:'responds_to',label:'responds to'},
    {id:'e8',source:'runbook',target:'checkin',kind:'assigns',label:'assigns'},
  ],
  people:[
    {id:'maya',name:'Maya Chen',initials:'MC',role:'Incident commander',canApprove:true},
    {id:'liam',name:'Liam Ortiz',initials:'LO',role:'Platform owner',canApprove:false},
    {id:'nora',name:'Nora Singh',initials:'NS',role:'Continuity verifier',canApprove:false},
    {id:'agent',name:'Response agent',initials:'RA',role:'Proposal author',canApprove:false},
  ],
  incident:null,
  tasks:[
    {id:'t1',title:'Verify offline roster checksum',ownerId:'nora',state:'open'},
    {id:'t2',title:'Notify packing floor lead',ownerId:'maya',state:'open'},
    {id:'t3',title:'Record scheduler observation',ownerId:'liam',state:'complete'},
  ],
  messages:[{id:'m1',text:'Northstar workspace loaded. Monitoring normal operations.',actorId:'agent',createdAt:now(),channel:'incident'}],
  timeline:[{id:'l1',title:'Workspace ready',detail:'Graph loaded from scripted preview data',createdAt:now(),kind:'system'}],
  proposal:null,
  model:{configured:false,model:'none',mode:'scripted'},
  mesh:{status:'preview',label:'Logical relay proof available in backend evidence',proofSummary:'No live mesh session is connected to this browser.'}
});

let state = fixture();
let apiAvailable = false;
let activeView = 'canvas';
let selectedId = 'scheduler';
let focusMode = false;
let connectFrom = null;
let transform = {x:40,y:25,k:.88};
let pointer = null;
let agentOpen = true;

const navItems = [
  ['canvas','canvas','Canvas'],['people','people','People'],['activity','activity','Activity']
];

function person(id) { return state.people.find(p => p.id === id); }
function node(id) { return state.nodes.find(n => n.id === id); }
function affectedSet() {
  const affected = new Set(state.incident?.affectedNodeIds || []);
  if (!state.incident) return affected;
  let changed = true;
  while (changed) {
    changed = false;
    state.edges.filter(e => ['dependency','fallback','depends_on'].includes(e.kind)).forEach(e => {
      if (affected.has(e.source) && !affected.has(e.target)) { affected.add(e.target); changed = true; }
      if (e.kind === 'fallback' && affected.has(e.target) && !affected.has(e.source)) { affected.add(e.source); changed = true; }
    });
  }
  return affected;
}
function isLiveModel() { return state.model?.mode === 'live' && state.model?.configured === true; }
function sourceLive() { return state.source === 'live-backend'; }

async function api(path = '/api/state', options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

async function refreshState() {
  try {
    const result = await api('/api/state', {headers:{Accept:'application/json'}});
    state = result.state || result;
    apiAvailable = true;
  } catch {
    state = fixture();
    apiAvailable = false;
  }
  renderAll(); requestAnimationFrame(fitGraph);
}

async function action(type, payload = {}) {
  if (!apiAvailable) return localAction(type, payload);
  const token = $('meta[name="demo-token"]')?.content || '';
  try {
    const result = await api('/api/actions', {
      method:'POST',headers:{'Content-Type':'application/json','X-Demo-Token':token},
      body:JSON.stringify({type,payload})
    });
    if (result.state) state = result.state;
    else await refreshState();
    renderAll(); if(type==='reset')requestAnimationFrame(fitGraph);
    return result;
  } catch (error) {
    toast(error.message, true); throw error;
  }
}

function localAction(type, payload) {
  if (type === 'reset') { state = fixture(); selectedId = 'scheduler'; focusMode = false; }
  if (type === 'report_incident') {
    state.incident={id:'inc-preview',title:payload.title || 'Suspicious scheduler behavior',status:'open',summary:payload.description || 'Unexpected scheduler activity needs review.',affectedNodeIds:[payload.nodeId || 'scheduler','distribution','packing']};
    const target=node(payload.nodeId || 'scheduler'); if(target) target.status='at-risk';
    addTimeline('Incident loaded','Scripted preview only; no infrastructure was observed.','incident');
  }
  if (type === 'analyze') {
    state.proposal={id:'proposal-preview',title:'Contain scheduler and activate roster',summary:'A scripted plan based on the visible fixture graph.',steps:['Review the scheduler target and action digest','Ask the incident commander for exact-action approval','Activate and verify the offline roster'],mode:'scripted',requiresApproval:true,actionDigest:'preview:unverified:stop-demo-scheduler'};
    addTimeline('Scripted analysis completed','No model or backend process ran.','agent');
  }
  if (type === 'approve') { state.incident && (state.incident.status='contained'); addTimeline('Preview approval recorded','Local UI simulation; no action was dispatched.','approval'); }
  if (type === 'activate_fallback') { state.incident && (state.incident.status='running_on_fallback'); node('roster').status='active'; addTimeline('Fallback preview activated','Scripted UI state only.','fallback'); }
  if (type === 'complete_task') { const t=state.tasks.find(x=>x.id===payload.id); if(t)t.state='complete'; }
  if (type === 'send_message') state.messages.push({id:id('m'),text:payload.text,actorId:payload.actorId,channel:payload.channel,createdAt:now()});
  if (type === 'add_node') { state.nodes.push({id:id('node'),status:'healthy',criticality:'normal',...payload}); }
  if (type === 'update_node') { const n=node(payload.id); if(n) Object.assign(n,payload); }
  if (type === 'add_edge') state.edges.push({id:id('edge'),label:payload.kind.replaceAll('_',' '),...payload});
  state.revision += 1; renderAll(); if(type==='reset')requestAnimationFrame(fitGraph); return Promise.resolve({state});
}

function addTimeline(title, detail, kind) { state.timeline.unshift({id:id('l'),title,detail,kind,createdAt:now()}); }
function toast(message, error=false) {
  const el=document.createElement('div'); el.className=`toast${error?' error':''}`; el.textContent=message; $('#toastRegion').append(el); setTimeout(()=>el.remove(),3300);
}

function renderNav() {
  $('#nav').innerHTML=navItems.map(([view,ic,label])=>`<button class="rail-button ${activeView===view?'active':''}" data-view="${view}">${icon(ic)}<small>${label}</small></button>`).join('');
  $('#mobileMenu').innerHTML=icon('menu');
  $('#resetDemo').innerHTML=icon('reset');
  $$('#nav [data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
}

function switchView(view) {
  activeView=view; $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${view}View`)); renderNav();
  if(view==='people') renderPeople(); if(view==='activity') renderActivity();
}

function renderHeader() {
  $('#workspaceName').textContent=state.workspace?.name || 'Northstar Compute';
  $('#revisionLabel').textContent=`revision ${state.revision ?? '—'}`;
  const pill=$('#sourcePill'); pill.textContent=sourceLive()?'Live backend':'Offline preview'; pill.className=`source-pill ${sourceLive()?'':'offline'}`;
}

function renderToolbar() {
  $('#canvasToolbar').innerHTML=`
    <button class="tool-button" data-tool="zin" title="Zoom in">${icon('zoomIn')}</button>
    <button class="tool-button" data-tool="zout" title="Zoom out">${icon('zoomOut')}</button>
    <button class="tool-button" data-tool="fit" title="Fit graph">${icon('fit')}</button>
    <button class="tool-button wide" data-tool="add">${icon('plus')} Add node</button>
    <button class="tool-button wide" data-tool="connect">${icon('link')} ${connectFrom?'Pick target':'Connect'}</button>`;
  $('[data-tool="zin"]').onclick=()=>zoomAt(1.18);
  $('[data-tool="zout"]').onclick=()=>zoomAt(.84);
  $('[data-tool="fit"]').onclick=fitGraph;
  $('[data-tool="add"]').onclick=()=>showNodeModal();
  $('[data-tool="connect"]').onclick=()=>{ if(!selectedId)return toast('Select a source node first',true); connectFrom=selectedId; renderToolbar(); toast('Now choose a target node'); };
}

const iconPaths={
  service:'M4 5h16v5H4z M4 14h16v5H4z M8 8h.01 M8 17h.01',
  person:'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M5 21c0-5 2.5-8 7-8s7 3 7 8',
  task:'M6 4h12v17H6z m3 7 2 2 4-5 M9 17h6',
  procedure:'M6 3h9l4 4v14H6z M15 3v5h4 M9 13h6 M9 17h6',
  resource:'m12 3 8 4-8 4-8-4z M4 12l8 4 8-4 M4 17l8 4 8-4'
};

function nodeMarkup(n) {
  const p=person(n.ownerId); const affected=affectedSet().has(n.id); const dim=focusMode&&state.incident&&!affected;
  const statusClass=['at-risk','degraded'].includes(n.status)?'risk':['down','unavailable'].includes(n.status)?'down':'';
  return `<g class="node-card ${selectedId===n.id?'selected':''} ${affected?'affected':''} ${dim?'dim':''}" data-node="${esc(n.id)}" transform="translate(${n.x} ${n.y})">
    <rect class="node-bg" width="214" height="86" rx="17"/>
    <rect class="node-icon-bg" x="13" y="15" width="40" height="40" rx="13"/>
    <path class="node-icon-stroke" d="${iconPaths[n.kind]||iconPaths.resource}" transform="translate(21 23) scale(.78)"/>
    <text class="node-kind" x="65" y="22">${esc(n.kind)}</text><text class="node-title" x="65" y="42">${wrappedTitle(n.name)}</text>
    <text class="node-owner" x="15" y="72">${esc(p?.name || 'Unassigned')}</text><circle class="node-status ${statusClass}" cx="196" cy="68" r="5"/>
  </g>`;
}

function edgeMarkup(e) {
  const a=node(e.source),b=node(e.target); if(!a||!b)return '';
  const x1=a.x+107,y1=a.y+43,x2=b.x+107,y2=b.y+43,dx=Math.max(45,Math.abs(x2-x1)*.42);
  const path=`M ${x1} ${y1} C ${x1+(x2>x1?dx:-dx)} ${y1}, ${x2-(x2>x1?dx:-dx)} ${y2}, ${x2} ${y2}`;
  const affected=affectedSet(); const hit=affected.has(a.id)&&affected.has(b.id);
  return `<path class="edge-line ${hit?'affected':''}" d="${path}"/><text class="edge-label"><textPath href="#ep-${esc(e.id)}" startOffset="50%" text-anchor="middle">${esc(e.label||e.kind)}</textPath></text><path id="ep-${esc(e.id)}" d="${path}" fill="none" stroke="none"/>`;
}

const titleLayoutCache = new Map();
function wrappedTitle(text) {
  let lines = titleLayoutCache.get(text);
  if (!lines) {
    try {
      const prepared = prepareWithSegments(text, '800 13px "Avenir Next"', {wordBreak:'normal'});
      lines = layoutWithLines(prepared, 132, 15).lines.map(line => line.text).slice(0, 2);
    } catch { lines = [text.slice(0, 23)]; }
    titleLayoutCache.set(text, lines);
  }
  return lines.map((line, i) => `<tspan x="65" dy="${i ? 15 : 0}">${esc(line)}</tspan>`).join('');
}

function renderGraph() {
  $('#edges').innerHTML=state.edges.map(edgeMarkup).join(''); $('#nodes').innerHTML=state.nodes.map(nodeMarkup).join('');
  $('#world').setAttribute('transform',`translate(${transform.x} ${transform.y}) scale(${transform.k})`);
  $$('.node-card').forEach(g=>g.addEventListener('pointerdown',nodePointerDown));
  renderMiniMap(); renderFocus();
}

function renderMiniMap() {
  if(!state.nodes.length)return; const xs=state.nodes.map(n=>n.x),ys=state.nodes.map(n=>n.y),minX=Math.min(...xs)-30,minY=Math.min(...ys)-20,w=Math.max(...xs)-minX+240,h=Math.max(...ys)-minY+110;
  $('#miniMap').innerHTML=state.edges.map(e=>{const a=node(e.source),b=node(e.target);return a&&b?`<line x1="${(a.x-minX)/w*190}" y1="${(a.y-minY)/h*100}" x2="${(b.x-minX)/w*190}" y2="${(b.y-minY)/h*100}" stroke="#9dabb9"/>`:''}).join('')+state.nodes.map(n=>`<rect x="${(n.x-minX)/w*190}" y="${(n.y-minY)/h*100}" width="13" height="8" rx="2" fill="${affectedSet().has(n.id)?'#f37632':'#135ee8'}"/>`).join('');
}

function renderFocus() {
  const bar=$('#focusBar');
  if(!state.incident){bar.classList.add('hidden');return} bar.classList.remove('hidden');
  bar.innerHTML=`${icon('warning',16)} <b>${esc(state.incident.title)}</b><span>${affectedSet().size} on presented path</span><button id="focusToggle">${focusMode?'Show all nodes':'Focus affected path'}</button>`;
  $('#focusToggle').onclick=()=>{focusMode=!focusMode;renderGraph()};
}

function nodePointerDown(ev) {
  ev.stopPropagation(); const nid=ev.currentTarget.dataset.node;
  if(connectFrom&&connectFrom!==nid){action('add_edge',{source:connectFrom,target:nid,kind:'depends_on'});connectFrom=null;renderToolbar();return}
  selectedId=nid; pointer={type:'node',id:nid,sx:ev.clientX,sy:ev.clientY,ox:node(nid).x,oy:node(nid).y,moved:false}; ev.currentTarget.setPointerCapture(ev.pointerId); renderInspector(); renderGraph();
}

function stagePointerDown(ev) { if(ev.target.closest('.node-card'))return; pointer={type:'pan',sx:ev.clientX,sy:ev.clientY,ox:transform.x,oy:transform.y}; }
function pointerMove(ev) { if(!pointer)return; if(pointer.type==='pan'){transform.x=pointer.ox+ev.clientX-pointer.sx;transform.y=pointer.oy+ev.clientY-pointer.sy}else{const n=node(pointer.id);n.x=pointer.ox+(ev.clientX-pointer.sx)/transform.k;n.y=pointer.oy+(ev.clientY-pointer.sy)/transform.k;pointer.moved=true} renderGraph(); }
function pointerUp() { if(pointer?.type==='node'&&pointer.moved&&apiAvailable){const n=node(pointer.id);action('update_node',{id:n.id,x:Math.round(n.x),y:Math.round(n.y)});} pointer=null; }
function zoomAt(factor) { transform.k=Math.min(1.8,Math.max(.35,transform.k*factor));renderGraph(); }
function fitGraph(){if(!state.nodes.length)return;const stage=$('#canvasStage'),maxX=Math.max(...state.nodes.map(n=>n.x+214)),maxY=Math.max(...state.nodes.map(n=>n.y+86)),minX=Math.min(...state.nodes.map(n=>n.x)),minY=Math.min(...state.nodes.map(n=>n.y)),top=96,bottom=32;transform.k=Math.min(1.05,(stage.clientWidth-80)/(maxX-minX),(stage.clientHeight-top-bottom)/(maxY-minY));transform.x=40-minX*transform.k;transform.y=top-minY*transform.k;renderGraph()}

function renderInspector() {
  const n=node(selectedId); const panel=$('#inspector');
  if(!n){panel.innerHTML='<div class="empty-state">Select a node to inspect its operational context.</div>';return}
  const p=person(n.ownerId); const incoming=state.edges.filter(e=>e.target===n.id).length,outgoing=state.edges.filter(e=>e.source===n.id).length;
  panel.innerHTML=`<div class="panel-kicker">Node inspector</div><h2>${esc(n.name)}</h2><span class="kind-chip">${icon(n.kind,15)} ${esc(n.kind)}</span>
    <p>${esc(n.description||'No description recorded.')}</p><div class="meta-grid"><div class="meta"><span>Status</span><b>${esc(n.status)}</b></div><div class="meta"><span>Criticality</span><b>${esc(n.criticality)}</b></div><div class="meta"><span>Owner</span><b>${esc(p?.name||'Unassigned')}</b></div><div class="meta"><span>Connections</span><b>${incoming} in · ${outgoing} out</b></div></div>
    <div class="inspector-actions"><button class="button secondary" id="editNode">Edit node</button><button class="button danger" id="reportNode">Report incident</button></div>
    <div class="authority-note"><b>Authority stays separate.</b><br>Ownership and assignments shown here do not grant approval rights.</div>`;
  $('#editNode').onclick=()=>showNodeModal(n); $('#reportNode').onclick=()=>showIncidentModal(n);
}

function renderAgent() {
  const modelLive=isLiveModel(); const proposal=state.proposal; const steps=state.timeline.slice(0,3);
  const proposalSteps=proposal?.steps||[];
  const scopeCopy=modelLive?'Nemotron plan using the fixed scheduler demo. Canvas edits do not change the executable target.':'Scripted plan using the fixed scheduler demo. Canvas edits do not change the executable target.';
  const fallbackActive=state.incident?.status==='running_on_fallback';
  const fallbackReady=state.incident?.status==='contained-verified';
  $('#agentPanel').innerHTML=`<div class="agent-head"><div class="agent-symbol">${icon('agent')}</div><div><div class="panel-kicker">Response workspace</div><h2>Agent run</h2></div><span class="model-pill ${modelLive?'live':''}">${modelLive?'Nemotron live':'Scripted demo'}</span></div>
    <div class="truth-strip ${sourceLive()?'live':''}">${sourceLive()?'State is reported by the local backend. Verify the proposal details before approval.':'Offline preview / scripted data. No model, broker, or infrastructure action is verified.'}</div>
    <div class="prompt-box"><textarea id="agentPrompt" aria-label="Agent prompt">Analyze the affected path and prepare the safest continuity response.</textarea><div class="prompt-actions"><small>${state.incident?'incident context attached':'load an incident first'}</small><button class="button primary" id="analyzeButton" ${state.incident?'':'disabled title="Load an incident first"'}>${icon('spark',15)} Analyze</button></div></div>
    ${steps.length?`<div><div class="panel-kicker">Run timeline</div><div class="run-timeline">${steps.map((s,i)=>`<div class="timeline-step ${i?'done':'active'}"><div class="step-dot">${i?'✓':i+1}</div><div><b>${esc(s.title)}</b><span>${esc(s.detail)}</span></div></div>`).join('')}</div></div>`:''}
    ${proposal?`<div class="proposal-card"><div class="panel-kicker">Proposed response</div><h3>${esc(proposal.title)}</h3><p class="proposal-short">${scopeCopy}</p><div class="proposal-actions"><button class="button orange" id="approveProposal" ${proposal.requiresApproval===false?'disabled title="This proposal no longer requires approval"':''}>${icon('shield',14)} ${proposal.requiresApproval===false?'Approved':'Review & approve'}</button><button class="button secondary" id="activateFallback" ${fallbackReady?'':`disabled title="${fallbackActive?'Fallback is active':'Verified containment is required first'}"`}>${icon('fallback',14)} ${fallbackActive?'Fallback active':'Verify & activate fallback'}</button></div><div class="step-summary">${proposalSteps.map(s=>`<span>${esc(typeof s==='string'?s:(s.tool||'bounded step').replaceAll('_',' '))} · ${esc(typeof s==='string'?'planned':s.status||'reported')}</span>`).join('')}</div><details class="evidence-details"><summary>Evidence and ${proposalSteps.length} bounded tool steps</summary><p>${esc(proposal.summary)}</p><ol>${proposalSteps.map(s=>typeof s==='string'?`<li>${esc(s)}</li>`:`<li><b>${esc(s.tool||'bounded step')}</b> · ${esc(s.status||'reported')}<br>${esc(s.detail||'')}</li>`).join('')}</ol></details></div>`:`<div class="empty-state">${icon('spark',24)}<br><br>Analyze an incident to produce a bounded proposal.</div>`}
    ${state.model?.lastError?`<div class="truth-strip"><b>Model unavailable</b> · ${esc(state.model.lastError)}</div>`:''}
    <div class="truth-strip"><b>Mesh</b> · ${esc(state.mesh?.label||'Unavailable')}<br>${esc(state.mesh?.proofSummary||'No proof summary reported.')}</div>`;
  $('#analyzeButton')?.addEventListener('click',runAnalysis); $('#approveProposal')?.addEventListener('click',showApproval); $('#activateFallback')?.addEventListener('click',activateFallback);
}

function renderPeople() {
  $('#peopleView').innerHTML=`<div class="view-header"><div><h1>People & authority</h1><p>Responsibilities are visible. Approval rights come from the trusted authority.</p></div></div><div class="people-grid">${state.people.map(p=>`<article class="person-card"><div class="person-top"><div class="avatar">${esc(p.initials)}</div><div><h3>${esc(p.name)}</h3><p>${esc(p.role)}</p></div></div><div class="rights-row"><span>Can approve exact action</span><strong class="${p.canApprove?'yes':'no'}">${p.canApprove?'Eligible':'No'}</strong></div></article>`).join('')}</div><div class="authority-note"><b>Changing an owner, dragging a person onto a service, or assigning a task never changes approval rights.</b> The server resolves the authenticated actor and current role at execution time.</div>`;
}

function renderActivity() {
  $('#activityView').innerHTML=`<div class="view-header"><div><h1>Activity & handoffs</h1><p>Incident events, work checks, and local coordination.</p></div></div><div class="activity-layout"><div class="activity-list"><div class="panel-kicker">Response log</div>${state.timeline.map(t=>`<div class="activity-item"><div class="activity-icon">${icon(t.kind==='approval'?'shield':t.kind==='fallback'?'fallback':'activity',15)}</div><div><h4>${esc(t.title)}</h4><p>${esc(t.detail)}</p></div><time>${new Date(t.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join('')}</div><div><div class="task-list"><div class="panel-kicker">Task checks</div>${state.tasks.map(t=>{const verified=['complete','completed','verified'].includes(t.state);return `<div class="task-item"><button class="task-check ${verified?'done':''}" data-task="${esc(t.id)}" aria-label="${verified?`Confirm verification: ${esc(t.title)}`:`Pending verification: ${esc(t.title)}`}" ${verified?'':'disabled title="Verified during fallback activation"'}>${verified?icon('check',14):''}</button><div><b>${esc(t.title)}</b><br><span>${esc(person(t.ownerId)?.name||'Unassigned')}</span></div><span>${esc(t.state)}</span></div>`}).join('')}</div><div class="message-box"><div class="panel-kicker">Incident channel</div><div class="messages">${state.messages.map(m=>`<div class="message"><b>${esc(person(m.actorId)?.name||m.actorId)}</b><br>${esc(m.text)}</div>`).join('')}</div><form class="composer" id="messageForm"><input name="message" required placeholder="Write a local update"><button class="button primary" aria-label="Send update">${icon('send',14)}</button></form></div></div></div>`;
  $$('[data-task]').forEach(b=>b.onclick=()=>{const task=state.tasks.find(t=>t.id===b.dataset.task);action('complete_task',{id:b.dataset.task,actorId:task?.ownerId||state.people[0]?.id})});
  $('#messageForm').onsubmit=e=>{e.preventDefault();const input=e.currentTarget.message;if(!input.value.trim())return;action('send_message',{text:input.value.trim(),actorId:state.people.find(p=>p.canApprove)?.id||state.people[0]?.id,channel:'incident'});input.value=''};
}

function renderAll() { renderHeader();renderNav();renderToolbar();renderGraph();renderInspector();renderAgent();if(activeView==='people')renderPeople();if(activeView==='activity')renderActivity(); }

function showModal(content) { $('#modalContent').innerHTML=content; $('#modal').showModal(); $$('.close-modal').forEach(b=>b.onclick=()=>$('#modal').close()); }
function showNodeModal(existing=null) {
  showModal(`<form class="modal-inner" id="nodeForm"><div class="modal-head"><div class="modal-symbol">${icon(existing?'task':'plus')}</div><div><h2>${existing?'Edit node':'Add to canvas'}</h2><p>Graph metadata does not modify authority.</p></div><button type="button" class="close-x close-modal">${icon('close')}</button></div><label class="field"><span>Name</span><input name="name" required value="${esc(existing?.name||'')}"></label><label class="field"><span>Kind</span><select name="kind">${['service','person','task','procedure','resource'].map(k=>`<option ${existing?.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><label class="field"><span>Owner</span><select name="ownerId">${state.people.filter(p=>p.id!=='agent').map(p=>`<option value="${p.id}" ${existing?.ownerId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="button secondary close-modal">Cancel</button><button class="button primary">${existing?'Save node':'Add node'}</button></div></form>`);
  $('#nodeForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget),values=Object.fromEntries(fd);if(existing)action('update_node',{id:existing.id,...values});else action('add_node',{...values,x:250-transform.x/transform.k,y:180-transform.y/transform.k});$('#modal').close()};
}

function showIncidentModal(target=node(selectedId)) {
  showModal(`<form class="modal-inner" id="incidentForm"><div class="modal-head"><div class="modal-symbol">${icon('warning')}</div><div><h2>Report an incident</h2><p>Recorded as an unverified signal until trusted evidence is added.</p></div><button type="button" class="close-x close-modal">${icon('close')}</button></div><label class="field"><span>Target node</span><select name="nodeId">${state.nodes.map(n=>`<option value="${esc(n.id)}" ${n.id===target?.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label><label class="field"><span>Incident title</span><input name="title" required value="Suspicious scheduler behavior"></label><label class="field"><span>What was observed</span><textarea name="description" required>Unexpected job activity may affect compute operations.</textarea></label><div class="modal-actions"><button type="button" class="button secondary close-modal">Cancel</button><button class="button danger">Report signal</button></div></form>`);
  $('#incidentForm').onsubmit=async e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(e.currentTarget));await action('report_incident',payload);focusMode=true;$('#modal').close();renderAll();toast('Unverified incident signal recorded')};
}

function loadIncident(nodeId='scheduler') { return action('report_incident',{title:'Suspicious scheduler behavior',description:'Unexpected job activity may affect order distribution.',nodeId}).then(()=>{focusMode=true;renderAll();toast('Incident context loaded')}); }
async function runAnalysis() { const b=$('#analyzeButton');const message=$('#agentPrompt').value;b.disabled=true;b.innerHTML=`<span class="pixel-loader"><i></i><i></i><i></i><i></i></span> Running`;try{await action('analyze',{message});toast(isLiveModel()?'Analysis returned by configured model':'Scripted proposal prepared')}finally{const next=$('#analyzeButton');if(next){next.disabled=false;next.innerHTML=`${icon('spark',15)} Analyze`}} }
function showApproval() {
  const p=state.proposal,approver=state.people.find(x=>x.canApprove);
  showModal(`<div class="modal-inner"><div class="modal-head"><div class="modal-symbol">${icon('shield')}</div><div><h2>Confirm exact action</h2><p>Review the authority-bound target before dispatch.</p></div><button class="close-x close-modal">${icon('close')}</button></div><div class="verify-box"><div class="verify-row"><span>Proposal</span><b>${esc(p?.title||'Unavailable')}</b></div><div class="verify-row"><span>Target</span><code>pantry-demo-scheduler</code></div><div class="verify-row"><span>Action digest</span><code>${esc(p?.actionDigest||'not reported')}</code></div><div class="verify-row"><span>Approver</span><b>${esc(approver?.name||'No eligible approver')}</b></div><div class="verify-row"><span>Evidence source</span><b>${sourceLive()?'Live backend report':'Offline scripted preview'}</b></div></div><p>${sourceLive()?'Northstar presents the canonical disposable demo target retained under its pantry-demo identifier. The server will recheck identity, role, target generation, scope, and freshness.':'This preview cannot execute infrastructure. Confirming changes only local scripted UI state.'}</p><div class="modal-actions"><button class="button secondary close-modal">Cancel</button><button class="button orange" id="confirmApproval" ${approver&&p?.actionDigest?'':'disabled title="An exact action digest is required"'}>Confirm exact action</button></div></div>`);
  $('#confirmApproval').onclick=async()=>{await action('approve',{actorId:approver.id,actionDigest:p.actionDigest});$('#modal').close();toast(sourceLive()?'Approval request returned by backend':'Preview approval recorded; nothing executed')};
}
function activateFallback(){const approver=state.people.find(x=>x.canApprove);action('activate_fallback',{actorId:approver?.id,actionDigest:state.proposal?.actionDigest}).then(()=>toast(sourceLive()?'Backend returned current fallback state':'Preview fallback activated locally'))}

function bindStatic() {
  $('#graph').addEventListener('pointerdown',stagePointerDown); window.addEventListener('pointermove',pointerMove);window.addEventListener('pointerup',pointerUp);
  $('#graph').addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.deltaY<0?1.08:.92)},{passive:false});
  $('#loadIncident').onclick=()=>loadIncident(); $('#runResponse').onclick=()=>state.incident?runAnalysis():loadIncident().then?.(runAnalysis); $('#resetDemo').onclick=()=>action('reset');
  $('#helpButton').onclick=()=>showModal(`<div class="modal-inner"><div class="modal-head"><div class="modal-symbol">?</div><div><h2>Workspace controls</h2><p>Keyboard and canvas shortcuts.</p></div><button class="close-x close-modal">${icon('close')}</button></div><div class="verify-box"><div class="verify-row"><span>Canvas</span><b>Drag to pan · scroll to zoom</b></div><div class="verify-row"><span>Nodes</span><b>Drag to move · click to inspect</b></div><div class="verify-row"><span>Escape</span><b>Close dialogs or cancel connect</b></div></div></div>`);
  $('#mobileMenu').onclick=()=>document.body.classList.toggle('nav-open');
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#modal').open)$('#modal').close();connectFrom=null;renderToolbar()}if((e.metaKey||e.ctrlKey)&&e.key==='0'){e.preventDefault();fitGraph()}});
}

bindStatic(); refreshState();
