import { useState, useEffect, useCallback, useRef } from "react";
import {
  auth, db, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, setDoc, getDoc, onSnapshot, isFirebaseConfigured
} from "./firebase.js";

const A = {
  bg:"#F2F2F7", card:"#FFFFFF", label:"#000000",
  label2:"rgba(60,60,67,0.6)", label3:"rgba(60,60,67,0.3)", sep:"rgba(60,60,67,0.2)",
  blue:"#007AFF", red:"#FF3B30", green:"#34C759", orange:"#FF9500",
  purple:"#AF52DE", tabBar:"rgba(249,249,249,0.94)", tabBarBorder:"rgba(0,0,0,0.12)",
};
const SF = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`;

let _fbUser = null;
let _syncDisabled = false;

function fbPath(uid, key) {
  return doc(db, "users", uid, "store", key);
}

async function fbSet(key, val) {
  if (!_fbUser || !db || _syncDisabled) return;
  try { await setDoc(fbPath(_fbUser.uid, key), { value: val }); }
  catch (e) { console.warn("Firebase write error:", e); }
}

const store = {
  get(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  set(key, val) {
    let ok = true;
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { ok = false; console.warn("localStorage write error:", e); }
    fbSet(key, val);
    return ok;
  },
};

const pad = n => String(n).padStart(2, "0");
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayKey = () => toKey(new Date());
const parseKey = k => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };

const MONTHS   = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_G = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const DAYS_S   = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const WEEKDAYS = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];

function getCyclePhase(date, cd) {
  if (!cd.startDates?.length) return null;
  const sorted = [...cd.startDates].sort();
  const last = parseKey(sorted[sorted.length - 1]);
  const diff = Math.floor((date - last) / 86400000);
  const len = cd.length || 28;
  const day = ((diff % len) + len) % len + 1;
  if (day <= 5)  return { phase:"menstrual",  day, label:"Менструация",    color: A.red    };
  if (day <= 13) return { phase:"follicular", day, label:"Фолликулярная",  color: A.blue   };
  if (day <= 16) return { phase:"ovulation",  day, label:"Овуляция",       color: A.green  };
  return             { phase:"luteal",      day, label:"Лютеиновая",     color: A.purple };
}

function computeStreak(allD, todayStr) {
  let count = 0, d = new Date(todayStr);
  for (let i = 0; i < 365; i++) {
    const key = toKey(d), data = allD[key];
    if (!data || data.eating == null) {
      if (key === todayStr) { d.setDate(d.getDate()-1); continue; }
      break;
    }
    if (data.eating === false) break;
    count++; d.setDate(d.getDate()-1);
  }
  return count;
}

const emptyDay = () => ({ todos:[], notes:"", eating:null, sport:{done:null,type:""} });

const WIDE_QUERY = "(min-width: 900px)";
function useIsWide() {
  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(WIDE_QUERY);
    const handler = e => setIsWide(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isWide;
}

function getScrollParent(el) {
  let node = el?.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}


const LargeTitle = ({children,style={}}) => <div style={{fontSize:34,fontWeight:700,letterSpacing:0.37,lineHeight:"41px",fontFamily:SF,color:A.label,...style}}>{children}</div>;
const SectionHeader = ({children,style={}}) => <div style={{fontSize:13,fontWeight:400,color:A.label2,letterSpacing:-0.08,fontFamily:SF,padding:"0 16px 6px 20px",textTransform:"uppercase",...style}}>{children}</div>;
const Card = ({children,style={}}) => <div style={{background:A.card,borderRadius:12,overflow:"hidden",...style}}>{children}</div>;

function TagPill({tag, size=11}) {
  if (!tag) return null;
  const isWork = tag === "work";
  return (
    <span style={{display:"inline-block",fontSize:size,fontFamily:SF,fontWeight:500,padding:"2px 7px",borderRadius:10,background:isWork?"#007AFF22":"#AF52DE22",color:isWork?A.blue:A.purple,letterSpacing:0.1,lineHeight:"16px"}}>
      {isWork?"Работа":"Личное"}
    </span>
  );
}

function IOSToggle({value,onChange}) {
  return <div onClick={()=>onChange(!value)} style={{width:51,height:31,borderRadius:16,background:value?A.green:"rgba(120,120,128,0.32)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}>
    <div style={{position:"absolute",top:2,left:value?22:2,width:27,height:27,borderRadius:"50%",background:"#fff",boxShadow:"0 3px 8px rgba(0,0,0,0.15)",transition:"left .2s"}}/>
  </div>;
}

function TaskList({dayData, onSave, currentKey, onMoveTask}) {
  const [newTodo, setNewTodo] = useState("");
  const [newTag, setNewTag] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const todos = dayData.todos || [];
  const cycleTag = t => t === null ? "work" : t === "work" ? "personal" : null;

  const add = () => {
    if (!newTodo.trim()) return;
    const created = {id:Date.now(), text:newTodo.trim(), done:false, tag:newTag, note:"", link:""};
    onSave({...dayData, todos:[...todos, created]});
    setNewTodo(""); setNewTag(null); setExpandedId(created.id);
  };
  const toggle = id => onSave({...dayData, todos:todos.map(t=>t.id===id?{...t,done:!t.done}:t)});
  const del = id => { onSave({...dayData, todos:todos.filter(t=>t.id!==id)}); setExpandedId(null); };
  const updateField = (id, field, val) => onSave({...dayData, todos:todos.map(t=>t.id===id?{...t,[field]:val}:t)});

  const doneCount = todos.filter(t => t.done).length;

  return (
    <>
      <div style={{display:"flex",alignItems:"center",paddingRight:4,marginBottom:6}}>
        <SectionHeader style={{padding:"0 0 0 4px"}}>
          Задачи{todos.length > 0 ? ` · ${doneCount}/${todos.length}` : ""}
        </SectionHeader>
      </div>
      <Card>
        <div style={{display:"flex",alignItems:"center",padding:"0 16px",borderBottom:`1px solid ${A.sep}`,minHeight:46}}>
          <div style={{width:22,height:22,borderRadius:"50%",border:`2px solid ${A.label3}`,marginRight:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:A.blue,fontSize:16,fontWeight:600,lineHeight:1}}>+</span>
          </div>
          <input value={newTodo} onChange={e=>setNewTodo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
            placeholder="Новая задача..."
            style={{flex:1,border:"none",background:"transparent",fontSize:17,fontFamily:SF,color:A.label,padding:"11px 0",outline:"none",letterSpacing:-0.41}}/>
          <button onClick={()=>setNewTag(cycleTag(newTag))} style={{background:"none",border:"none",cursor:"pointer",padding:"0 6px 0 4px",flexShrink:0}}>
            {newTag ? <TagPill tag={newTag} size={12}/> : <span style={{fontSize:12,fontFamily:SF,color:A.label3,padding:"2px 7px",borderRadius:10,border:`1px dashed ${A.label3}`}}>тег</span>}
          </button>
          {newTodo.trim() && <button onClick={add} style={{color:A.blue,background:"none",border:"none",cursor:"pointer",fontSize:15,fontWeight:600,fontFamily:SF,padding:"0 0 0 4px"}}>Добавить</button>}
        </div>

        {todos.length === 0 && <div style={{padding:"14px 16px",textAlign:"center",color:A.label2,fontSize:15,fontFamily:SF}}>Задач нет</div>}

        {todos.map((t, i) => {
          const isOpen = expandedId === t.id;
          return (
            <div key={t.id} style={{borderBottom: i<todos.length-1||isOpen ? `1px solid ${A.sep}` : "none"}}>
              <div style={{display:"flex",alignItems:"flex-start",padding:"11px 16px",minHeight:46}}>
                <button onClick={()=>toggle(t.id)} style={{width:22,height:22,borderRadius:"50%",border:`2px solid ${t.done?A.blue:A.label3}`,background:t.done?A.blue:"transparent",cursor:"pointer",marginRight:12,marginTop:2,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {t.done && <span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                </button>
                <div onClick={()=>setExpandedId(isOpen?null:t.id)} style={{flex:1,cursor:"pointer",minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:17,fontFamily:SF,color:t.done?A.label2:A.label,textDecoration:t.done?"line-through":"none",letterSpacing:-0.41,lineHeight:"22px"}}>{t.text}</span>
                    {t.tag && <TagPill tag={t.tag}/>}
                  </div>
                  {!isOpen && t.note && <div style={{fontSize:13,fontFamily:SF,color:A.label2,marginTop:2,lineHeight:"17px"}}>{t.note}</div>}
                  {!isOpen && t.link && <div style={{fontSize:13,fontFamily:SF,color:A.blue,marginTop:2}}>🔗 {t.link}</div>}
                </div>
                <button onClick={()=>setExpandedId(isOpen?null:t.id)} style={{background:"none",border:"none",cursor:"pointer",padding:"0 0 0 8px",marginTop:2,color:A.label2,fontSize:18,lineHeight:1,transform:isOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>›</button>
              </div>
              {isOpen && (
                <div style={{padding:"0 16px 14px 50px",background:A.bg}}>
                  <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Текст задачи</div>
                  <input value={t.text||""} onChange={e=>updateField(t.id,"text",e.target.value)} placeholder="Название задачи"
                    style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,boxSizing:"border-box",outline:"none",display:"block",marginBottom:10}}/>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Тег</div>
                    <div style={{display:"flex",gap:6}}>
                      {[null,"work","personal"].map(v=>(
                        <button key={String(v)} onClick={()=>updateField(t.id,"tag",v)} style={{padding:"4px 12px",borderRadius:10,border:`1.5px solid ${t.tag===v?(v==="work"?A.blue:v==="personal"?A.purple:A.label3):A.sep}`,background:t.tag===v?(v==="work"?"#007AFF22":v==="personal"?"#AF52DE22":A.card):A.card,cursor:"pointer",fontSize:12,fontFamily:SF,color:t.tag===v?(v==="work"?A.blue:v==="personal"?A.purple:A.label):A.label2,fontWeight:t.tag===v?600:400}}>
                          {v===null?"Без тега":v==="work"?"Работа":"Личное"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Заметка</div>
                  <textarea value={t.note||""} onChange={e=>updateField(t.id,"note",e.target.value)} placeholder="Подробности, контекст, ссылки..." rows={3}
                    style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,resize:"none",boxSizing:"border-box",lineHeight:"20px",outline:"none",display:"block"}}/>
                  <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:10,marginBottom:6}}>Ссылка</div>
                  <div style={{display:"flex",alignItems:"center",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px"}}>
                    <span style={{marginRight:8,fontSize:15}}>🔗</span>
                    <input value={t.link||""} onChange={e=>updateField(t.id,"link",e.target.value)} placeholder="https://..."
                      style={{flex:1,border:"none",background:"transparent",fontSize:15,fontFamily:SF,color:A.blue,outline:"none"}}/>
                  </div>
                  {t.link && <a href={t.link.startsWith("http")?t.link:`https://${t.link}`} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:6,fontSize:13,fontFamily:SF,color:A.blue}}>Открыть ↗</a>}
                  {onMoveTask && (
                    <>
                      <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:10,marginBottom:6}}>Перенести на день</div>
                      <input type="date" value={t._src || currentKey || ""} onChange={e=>{ if(e.target.value) onMoveTask(t.id, t._src || currentKey, e.target.value); }}
                        style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,boxSizing:"border-box",outline:"none",display:"block"}}/>
                    </>
                  )}
                  <button onClick={()=>del(t.id)} style={{marginTop:12,display:"block",color:A.red,background:"none",border:"none",cursor:"pointer",fontSize:15,fontFamily:SF,padding:0}}>Удалить задачу</button>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}

function TodayTab({dayData, onSave, cycleData, today, moveTask, isWide}) {
  const now = new Date(), phase = getCyclePhase(now, cycleData);

  const tasksBlock = (
    <div style={isWide ? {} : {padding:"8px 16px 0"}}>
      <TaskList dayData={dayData} onSave={onSave} currentKey={today} onMoveTask={moveTask}/>
    </div>
  );
  const notesBlock = (
    <div style={isWide ? {} : {padding:"20px 16px 0"}}>
      <SectionHeader>Заметки дня</SectionHeader>
      <Card>
        <textarea value={dayData.notes||""} onChange={e=>onSave({...dayData,notes:e.target.value})} placeholder="Мысли, идеи, наблюдения..." rows={isWide?16:4}
          style={{width:"100%",border:"none",background:"transparent",padding:"12px 16px",fontSize:17,fontFamily:SF,color:A.label,resize:"none",boxSizing:"border-box",letterSpacing:-0.41,lineHeight:"22px",outline:"none"}}/>
      </Card>
    </div>
  );

  return (
    <div style={{paddingBottom: isWide ? 40 : 100}}>
      <div style={{padding: isWide ? "20px 0 16px" : "16px 20px 8px"}}>
        <div style={{fontSize:13,fontFamily:SF,color:A.label2,letterSpacing:-0.08}}>{WEEKDAYS[now.getDay()]}, {now.getDate()} {MONTHS_G[now.getMonth()]}</div>
        <LargeTitle style={{marginTop:2}}>Сегодня</LargeTitle>
        {phase && (
          <div style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:8,background:phase.color+"18",borderRadius:20,padding:"4px 12px"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:phase.color}}/>
            <span style={{fontSize:13,fontFamily:SF,fontWeight:500,color:phase.color}}>{phase.label} · день {phase.day}</span>
          </div>
        )}
      </div>
      {isWide ? (
        <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>
          <div style={{flex:"1.3 1 0",minWidth:0}}>{tasksBlock}</div>
          <div style={{flex:"1 1 0",minWidth:0}}>{notesBlock}</div>
        </div>
      ) : (
        <>{tasksBlock}{notesBlock}</>
      )}
    </div>
  );
}

function MonthGrid({year, month, allDaily, cycleData, todayKey, selKey, onSelect, isWide}) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  const startDow = (firstDay.getDay()+6) % 7;
  const days = [];
  for (let i=0; i<startDow; i++) days.push(null);
  for (let i=1; i<=lastDay.getDate(); i++) days.push(new Date(year, month, i));
  const cellMinHeight = isWide ? 132 : 96;
  const shownLimit = isWide ? 5 : 3;

  return (
    <div style={{marginBottom:22}}>
      <div style={{padding: isWide ? "0 0 8px" : "0 20px 8px", fontSize:20,fontWeight:700,fontFamily:SF,color:A.label,letterSpacing:-0.4}}>
        {MONTHS[month]} <span style={{color:A.label2}}>{year}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",margin: isWide ? 0 : "0 10px",borderTop:`1px solid ${A.sep}`,borderLeft:`1px solid ${A.sep}`,borderRadius:4,overflow:"hidden"}}>
        {days.map((day,i)=>{
          const cellBorder={borderRight:`1px solid ${A.sep}`,borderBottom:`1px solid ${A.sep}`};
          if (!day) return <div key={`e${i}`} style={{minHeight:cellMinHeight,background:"rgba(120,120,128,0.05)",...cellBorder}}/>;
          const key=toKey(day), isToday=key===todayKey, isSel=key===selKey;
          const dd=allDaily[key], phase=getCyclePhase(day,cycleData);
          const todos=dd?.todos||[];
          const shown=todos.slice(0,shownLimit), extra=todos.length-shown.length;
          return (
            <button key={key} data-daykey={key} onClick={()=>onSelect(day)} style={{minHeight:cellMinHeight,textAlign:"left",display:"flex",flexDirection:"column",gap:3,padding:"3px 3px 5px",background:isSel?A.blue+"12":"transparent",border:"none",...cellBorder,boxShadow:isSel?`inset 0 0 0 1.5px ${A.blue}`:"none",cursor:"pointer",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:3,minHeight:20}}>
                {phase&&<div title={phase.label} style={{width:5,height:5,borderRadius:"50%",background:phase.color,flexShrink:0}}/>}
                {dd?.eating===true&&<div style={{width:5,height:5,borderRadius:"50%",background:A.green,flexShrink:0}}/>}
                {dd?.eating===false&&<div style={{width:5,height:5,borderRadius:"50%",background:A.red,flexShrink:0}}/>}
                {dd?.sport?.done&&<div style={{width:5,height:5,borderRadius:"50%",background:A.blue,flexShrink:0}}/>}
                <div style={{marginLeft:"auto",width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:isToday?A.red:"transparent",flexShrink:0}}>
                  <span style={{fontSize:12,fontFamily:SF,fontWeight:isToday?700:500,letterSpacing:-0.2,color:isToday?"#fff":A.label}}>{day.getDate()}</span>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
                {shown.map(t=>{
                  const tc=t.tag==="work"?A.blue:t.tag==="personal"?A.purple:A.label2;
                  return (
                    <div key={t.id} style={{fontSize:10,lineHeight:"13px",fontFamily:SF,color:t.done?A.label3:A.label,textDecoration:t.done?"line-through":"none",background:A.card,border:`1px solid ${A.sep}`,borderLeft:`2.5px solid ${t.done?A.label3:tc}`,borderRadius:4,padding:"1px 4px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.text}</div>
                  );
                })}
                {extra>0&&<div style={{fontSize:9.5,fontFamily:SF,color:A.label2,paddingLeft:4}}>+{extra} ещё</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CAL_MONTH_CAP = 240; // ~20 years each direction — effectively unlimited for personal use
const CAL_MONTH_STEP = 6;

function CalendarTab({allDaily, cycleData, saveDayData, saveDayView, moveTask, isWide}) {
  const todayD = new Date();
  const baseY = todayD.getFullYear(), baseM = todayD.getMonth();
  const todayKey = toKey(todayD);

  const [range, setRange] = useState({start:-3, end:3});
  const [selectedDay, setSelectedDay] = useState(todayD);
  const [jumpTick, setJumpTick] = useState(0);
  const rootRef = useRef(null);
  const topSentinelRef = useRef(null);
  const bottomSentinelRef = useRef(null);

  useEffect(() => {
    const scrollEl = getScrollParent(rootRef.current);
    const topEl = topSentinelRef.current, bottomEl = bottomSentinelRef.current;
    if (!scrollEl || !topEl || !bottomEl) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (entry.target === topEl) {
          setRange(r => r.start <= -CAL_MONTH_CAP ? r : {...r, start: Math.max(r.start - CAL_MONTH_STEP, -CAL_MONTH_CAP)});
        } else if (entry.target === bottomEl) {
          setRange(r => r.end >= CAL_MONTH_CAP ? r : {...r, end: Math.min(r.end + CAL_MONTH_STEP, CAL_MONTH_CAP)});
        }
      });
    }, {root: scrollEl, rootMargin: "600px 0px 600px 0px"});
    observer.observe(topEl);
    observer.observe(bottomEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (jumpTick === 0) return;
    const el = rootRef.current?.querySelector(`[data-daykey="${todayKey}"]`);
    if (el) el.scrollIntoView({block:"center"});
  }, [jumpTick]);

  const goToToday = () => {
    setRange({start:-3, end:3});
    setSelectedDay(new Date());
    setJumpTick(t => t+1);
  };

  const months = [];
  for (let off = range.start; off <= range.end; off++) {
    const d = new Date(baseY, baseM+off, 1);
    months.push({y: d.getFullYear(), m: d.getMonth(), key: `${d.getFullYear()}-${d.getMonth()}`});
  }

  const selKey = selectedDay ? toKey(selectedDay) : null;
  const selPhase = selectedDay ? getCyclePhase(selectedDay, cycleData) : null;
  const isSelToday = selKey === todayKey;

  // Вычисляем carryover для выбранного дня (аналог todayData в App)
  const realSel = (selKey && allDaily[selKey]) || emptyDay();
  let selData;
  if (selKey && selKey <= todayKey) {
    const carried = [];
    const carriedIds = new Set();
    Object.entries(allDaily).forEach(([key, day]) => {
      if (key >= selKey) return;
      (day.todos || []).forEach(t => {
        if (!t.done && !carriedIds.has(t.id)) {
          carried.push({...t, _src: key});
          carriedIds.add(t.id);
        }
      });
    });
    const ownAll = (realSel.todos || []).filter(t => !carriedIds.has(t.id));
    selData = {...realSel, todos: [...carried, ...ownAll]};
  } else {
    selData = realSel;
  }

  const weekdayHeader = (
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding: isWide ? "0 0 6px" : "12px 10px 6px",position:"sticky",top:0,background:A.bg,zIndex:1}}>
      {DAYS_S.map(d=><div key={d} style={{textAlign:"center",fontSize:12,fontFamily:SF,fontWeight:600,color:A.label2}}>{d}</div>)}
    </div>
  );

  const monthList = (
    <>
      {weekdayHeader}
      <div ref={topSentinelRef} style={{height:1}}/>
      {months.map(mo => (
        <MonthGrid key={mo.key} year={mo.y} month={mo.m} allDaily={allDaily} cycleData={cycleData} todayKey={todayKey} selKey={selKey} onSelect={setSelectedDay} isWide={isWide}/>
      ))}
      <div ref={bottomSentinelRef} style={{height:1}}/>
    </>
  );

  const detailPanel = selectedDay && (
    <div style={isWide ? {} : {marginTop:8}}>
      <div style={{padding: isWide ? "0 0 4px" : "12px 20px 4px",display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
        <div style={{fontSize:22,fontWeight:700,fontFamily:SF,color:A.label,letterSpacing:-0.4}}>{isSelToday?"Сегодня":`${selectedDay.getDate()} ${MONTHS_G[selectedDay.getMonth()]} ${selectedDay.getFullYear()}`}</div>
        {selPhase&&<span style={{fontSize:13,fontFamily:SF,fontWeight:500,color:selPhase.color}}>{selPhase.label} · день {selPhase.day}</span>}
      </div>
      <div style={{padding: isWide ? "8px 0 0" : "8px 16px 0"}}><TaskList dayData={selData} onSave={selKey<=todayKey ? d=>saveDayView(selKey,d) : d=>saveDayData(selKey,d)} currentKey={selKey} onMoveTask={moveTask}/></div>
    </div>
  );

  return (
    <div ref={rootRef} style={{paddingBottom: isWide ? 40 : 100}}>
      <div style={{padding: isWide ? "20px 0 0" : "16px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <LargeTitle>Календарь</LargeTitle>
        <button onClick={goToToday} style={{height:32,padding:"0 14px",borderRadius:16,background:A.bg,border:"none",cursor:"pointer",fontSize:13,fontFamily:SF,fontWeight:600,color:A.blue}}>Сегодня</button>
      </div>

      {isWide ? (
        <div style={{display:"flex",gap:28,alignItems:"flex-start",marginTop:16}}>
          <div style={{flex:1,minWidth:0}}>{monthList}</div>
          <div style={{width:380,flexShrink:0,position:"sticky",top:0,maxHeight:"calc(100dvh - 24px)",overflowY:"auto"}}>{detailPanel}</div>
        </div>
      ) : (
        <>{monthList}{detailPanel}</>
      )}
    </div>
  );
}

function buildReportHTML(daysInRange, allDaily, cycleData, from, to, fmt, goodN, sportN, taskN) {
  const rows = daysInRange.map(k => {
    const v = allDaily[k], phase = getCyclePhase(parseKey(k), cycleData);
    const work = (v.todos||[]).filter(x=>x.tag==="work");
    const pers = (v.todos||[]).filter(x=>x.tag==="personal");
    const untagged = (v.todos||[]).filter(x=>!x.tag);
    return `
      <div style="margin-bottom:18px;page-break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:8px;">
          <b style="font-size:15px;">${fmt(k)}</b>
          <span style="color:#555;font-size:13px;">${phase?`${phase.label} · день ${phase.day}`:""}</span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:6px;">
          Питание: ${v.eating===true?"в порядке ✓":v.eating===false?"трудный день":"—"}
          &nbsp;·&nbsp;
          Спорт: ${v.sport?.done?(v.sport.type||"да"):"нет"}
        </div>
        ${work.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Работа</div>${work.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}${x.link?` <a href="${x.link}">${x.link}</a>`:""}</div>`).join("")}</div>`:""}
        ${pers.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Личное</div>${pers.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}${x.link?` <a href="${x.link}">${x.link}</a>`:""}</div>`).join("")}</div>`:""}
        ${untagged.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Другое</div>${untagged.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}${x.link?` <a href="${x.link}">${x.link}</a>`:""}</div>`).join("")}</div>`:""}
        ${v.notes?`<div style="font-size:13px;color:#333;margin-top:4px;font-style:italic;">Заметка: ${v.notes}</div>`:""}
      </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Дневник ${from} — ${to}</title>
    <style>body{font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#000;}@page{margin:1.4cm;}</style>
    </head><body>
    <h1 style="font-size:22px;margin:0 0 4px;">Дневник</h1>
    <div style="color:#555;margin-bottom:16px;">Период: ${fmt(from)} — ${fmt(to)}</div>
    <div style="display:flex;gap:24px;padding:12px 0;border-top:2px solid #000;border-bottom:1px solid #ccc;margin-bottom:20px;">
      <div><b style="font-size:20px;">${daysInRange.length}</b> дней</div>
      <div><b style="font-size:20px;">${goodN}</b> в балансе</div>
      <div><b style="font-size:20px;">${sportN}</b> тренировок</div>
      <div><b style="font-size:20px;">${taskN}</b> задач выполнено</div>
    </div>
    ${rows || "<div>Нет данных за выбранный период.</div>"}
    </body></html>`;
}

function SettingsTab({cycleData, saveCycle, allDaily, streak}) {
  const [localLen, setLocalLen] = useState(String(cycleData.length||28));
  const today = todayKey(), phase = getCyclePhase(new Date(), cycleData);
  const addStart = () => { if(cycleData.startDates?.includes(today))return; saveCycle({...cycleData,startDates:[...(cycleData.startDates||[]),today]}); };
  const removeStart = d => saveCycle({...cycleData, startDates:cycleData.startDates.filter(x=>x!==d)});
  const saveLen = () => { const n=parseInt(localLen); if(n>0&&n<60) saveCycle({...cycleData,length:n}); };
  const last30 = Object.keys(allDaily).filter(k=>{const d=new Date(k),ref=new Date();ref.setDate(ref.getDate()-30);return d>=ref;});
  const goodDays=last30.filter(k=>allDaily[k]?.eating===true).length;
  const sportDays=last30.filter(k=>allDaily[k]?.sport?.done).length;

  const rNow = new Date(), rAgo = new Date();
  rAgo.setDate(rAgo.getDate()-29);
  const [rFrom, setRFrom] = useState(toKey(rAgo));
  const [rTo, setRTo] = useState(toKey(rNow));
  const setPreset = days => { const f=new Date(); f.setDate(f.getDate()-(days-1)); setRFrom(toKey(f)); setRTo(toKey(new Date())); };
  const setThisMonth = () => { const n=new Date(); setRFrom(toKey(new Date(n.getFullYear(),n.getMonth(),1))); setRTo(toKey(n)); };

  const daysInRange = (() => {
    const out=[]; const f=parseKey(rFrom), t=parseKey(rTo);
    if(f>t) return out;
    let d=new Date(f);
    while(d<=t){ const k=toKey(d); if(allDaily[k]) out.push(k); d.setDate(d.getDate()+1); }
    return out;
  })();
  const rGoodN  = daysInRange.filter(k=>allDaily[k]?.eating===true).length;
  const rSportN = daysInRange.filter(k=>allDaily[k]?.sport?.done).length;
  const rTaskN  = daysInRange.reduce((a,k)=>a+(allDaily[k]?.todos||[]).filter(t=>t.done).length, 0);
  const fmt = k => { const dt=parseKey(k); return `${dt.getDate()} ${MONTHS_G[dt.getMonth()]} ${dt.getFullYear()}, ${WEEKDAYS[dt.getDay()]}`; };

  const generateUnified = () => {
    const win = window.open("","_blank");
    if (!win) { window.print(); return; }
    const html = buildUnifiedReportHTML(daysInRange, allDaily, cycleData, rFrom, rTo, fmt, rGoodN, rSportN, rTaskN);
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(()=>win.print(), 400);
  };

  return (
    <div style={{paddingBottom:100}}>
      <div style={{padding:"16px 20px 8px"}}><LargeTitle>Настройки</LargeTitle></div>
      {phase && (
        <div style={{padding:"8px 16px 0"}}>
          <SectionHeader>Сейчас</SectionHeader>
          <Card><div style={{padding:"14px 16px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:44,height:44,borderRadius:12,background:phase.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
              {phase.phase==="menstrual"?"🌙":phase.phase==="follicular"?"🌱":phase.phase==="ovulation"?"✨":"🍂"}
            </div>
            <div>
              <div style={{fontSize:17,fontWeight:600,fontFamily:SF,color:A.label,letterSpacing:-0.41}}>{phase.label}</div>
              <div style={{fontSize:13,fontFamily:SF,color:A.label2}}>День {phase.day} из {cycleData.length||28}</div>
            </div>
          </div></Card>
        </div>
      )}
      <div style={{padding:"20px 16px 0"}}>
        <SectionHeader>За 30 дней</SectionHeader>
        <Card>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",textAlign:"center"}}>
            {[[streak,"Стрик",A.orange],[goodDays,"В балансе",A.green],[sportDays,"Спорт",A.blue]].map(([n,l,c],i)=>(
              <div key={l} style={{padding:"16px 8px",borderRight:i<2?`1px solid ${A.sep}`:"none"}}>
                <div style={{fontSize:30,fontWeight:700,fontFamily:SF,color:c,letterSpacing:-0.5}}>{n}</div>
                <div style={{fontSize:12,fontFamily:SF,color:A.label2,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{padding:"20px 16px 0"}}>
        <SectionHeader>Данные</SectionHeader>
        <Card>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${A.sep}`,display:"flex",alignItems:"center",cursor:"pointer"}} onClick={()=>{
            const keys=["all-daily","cycle-data","fixed-expenses","wishlist"];
            const data={};
            keys.forEach(k=>{const v=store.get(k);if(v)data[k]=v;});
            Object.keys(localStorage).filter(k=>k.startsWith("finances-")).forEach(k=>{try{data[k]=JSON.parse(localStorage.getItem(k));}catch{}});
            const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
            const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="calendar-backup.json";a.click();
          }}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.blue,letterSpacing:-0.41}}>Экспортировать данные</span>
            <span style={{fontSize:13,fontFamily:SF,color:A.label2}}>↓ JSON</span>
          </div>
          <div style={{padding:"12px 16px",display:"flex",alignItems:"center",cursor:"pointer"}} onClick={()=>{
            const input=document.createElement("input");input.type="file";input.accept=".json";
            input.onchange=e=>{
              const file=e.target.files[0];if(!file)return;
              const reader=new FileReader();
              reader.onload=ev=>{
                try{
                  const data=JSON.parse(ev.target.result);
                  Object.entries(data).forEach(([k,v])=>localStorage.setItem(k,JSON.stringify(v)));
                  window.location.reload();
                }catch{alert("Ошибка: неверный формат файла");}
              };
              reader.readAsText(file);
            };
            input.click();
          }}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.blue,letterSpacing:-0.41}}>Импортировать данные</span>
            <span style={{fontSize:13,fontFamily:SF,color:A.label2}}>↑ JSON</span>
          </div>
        </Card>
      </div>
      <div style={{padding:"20px 16px 0"}}>
        <SectionHeader>Отчёт</SectionHeader>
        <Card>
          <div style={{display:"flex",alignItems:"center",padding:"12px 16px",borderBottom:`1px solid ${A.sep}`}}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.label}}>С</span>
            <input type="date" value={rFrom} onChange={e=>setRFrom(e.target.value)} style={{border:"none",background:A.bg,borderRadius:8,padding:"6px 10px",fontSize:16,fontFamily:SF,color:A.blue}}/>
          </div>
          <div style={{display:"flex",alignItems:"center",padding:"12px 16px"}}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.label}}>По</span>
            <input type="date" value={rTo} onChange={e=>setRTo(e.target.value)} style={{border:"none",background:A.bg,borderRadius:8,padding:"6px 10px",fontSize:16,fontFamily:SF,color:A.blue}}/>
          </div>
        </Card>
        <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
          {[["7 дней",()=>setPreset(7)],["30 дней",()=>setPreset(30)],["Этот месяц",setThisMonth]].map(([l,fn])=>(
            <button key={l} onClick={fn} style={{padding:"7px 14px",borderRadius:16,border:"none",background:A.card,cursor:"pointer",fontSize:14,fontFamily:SF,color:A.blue,fontWeight:500}}>{l}</button>
          ))}
        </div>
        {daysInRange.length > 0 && (
          <Card style={{marginTop:10}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",textAlign:"center"}}>
              {[[daysInRange.length,"дней",A.label],[rGoodN,"в балансе",A.green],[rSportN,"трениров.",A.blue]].map(([n,l,c],i)=>(
                <div key={l} style={{padding:"14px 8px",borderRight:i<2?`1px solid ${A.sep}`:"none"}}>
                  <div style={{fontSize:26,fontWeight:700,fontFamily:SF,color:c,letterSpacing:-0.5}}>{n}</div>
                  <div style={{fontSize:11,fontFamily:SF,color:A.label2,marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"8px 16px",borderTop:`1px solid ${A.sep}`,fontSize:13,fontFamily:SF,color:A.label2}}>Задач выполнено: {rTaskN}</div>
          </Card>
        )}
        <button onClick={generateUnified} disabled={!daysInRange.length} style={{marginTop:12,width:"100%",padding:"15px",borderRadius:14,border:"none",background:daysInRange.length?A.blue:A.label3,color:"#fff",fontSize:17,fontWeight:600,fontFamily:SF,cursor:daysInRange.length?"pointer":"default"}}>
          Создать общий отчёт (PDF)
        </button>
        {!daysInRange.length && <div style={{fontSize:13,fontFamily:SF,color:A.label2,textAlign:"center",marginTop:8}}>Нет данных за выбранный период</div>}
      </div>

      <div style={{padding:"20px 16px 0"}}>
        <SectionHeader>Цикл</SectionHeader>
        <Card>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${A.sep}`,display:"flex",alignItems:"center"}}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.label,letterSpacing:-0.41}}>Длина цикла</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="number" value={localLen} onChange={e=>setLocalLen(e.target.value)} style={{width:48,border:"none",background:A.bg,borderRadius:8,padding:"4px 8px",fontSize:17,fontFamily:SF,color:A.blue,textAlign:"center",fontWeight:600}}/>
              <span style={{fontSize:15,fontFamily:SF,color:A.label2}}>дн.</span>
              <button onClick={saveLen} style={{color:A.blue,background:"none",border:"none",cursor:"pointer",fontSize:15,fontFamily:SF,fontWeight:600}}>OK</button>
            </div>
          </div>
          <div onClick={addStart} style={{padding:"12px 16px",borderBottom:(cycleData.startDates||[]).length?`1px solid ${A.sep}`:"none",display:"flex",alignItems:"center",cursor:"pointer"}}>
            <div style={{width:28,height:28,borderRadius:6,background:A.red+"18",border:`1.5px solid ${A.red}30`,display:"flex",alignItems:"center",justifyContent:"center",marginRight:12,fontSize:16}}>🌙</div>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.red,letterSpacing:-0.41}}>Начало цикла — сегодня</span>
          </div>
          {(cycleData.startDates||[]).length > 0 && [...cycleData.startDates].sort().reverse().slice(0,4).map((d,i,arr)=>(
            <div key={d} style={{padding:"11px 16px 11px 56px",display:"flex",alignItems:"center",borderBottom:i<arr.length-1?`1px solid ${A.sep}`:"none"}}>
              <span style={{flex:1,fontSize:15,fontFamily:SF,color:A.label2}}>{d}</span>
              <button onClick={()=>removeStart(d)} style={{color:A.red,background:"none",border:"none",cursor:"pointer",fontSize:15,fontFamily:SF}}>Удалить</button>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function AddRow({onAdd, placeholderName="Название", placeholderAmt="Сумма ₽", hasBorder}) {
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), amt.trim());
    setName(""); setAmt("");
  };
  return (
    <div style={{borderTop:hasBorder?`1px solid ${A.sep}`:"none"}}>
      <div style={{display:"flex",padding:"10px 16px 0",gap:8}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder={placeholderName}
          style={{flex:2,border:`1px solid ${A.sep}`,background:A.card,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,outline:"none",boxSizing:"border-box"}}/>
        <input value={amt} onChange={e=>setAmt(e.target.value)} placeholder={placeholderAmt} inputMode="decimal"
          style={{flex:1,border:`1px solid ${A.sep}`,background:A.card,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{padding:"8px 16px 10px"}}>
        <button onClick={add} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:name.trim()?A.blue:A.label3,color:"#fff",fontSize:15,fontFamily:SF,fontWeight:600,cursor:name.trim()?"pointer":"default"}}>
          Добавить
        </button>
      </div>
    </div>
  );
}

function FinanceTab({isWide}) {
  const now = new Date();
  const [month, setMonth] = useState({y:now.getFullYear(), m:now.getMonth()});
  const monthKey = `finances-${month.y}-${pad(month.m+1)}`;

  const [fixedExpenses, setFixedExpenses] = useState(() => store.get("fixed-expenses") || []);
  const [monthData, setMonthData] = useState(() => store.get(monthKey) || {income:"", expenses:[]});
  const [fixedOpen, setFixedOpen] = useState(false);

  useEffect(() => {
    setMonthData(store.get(monthKey) || {income:"", expenses:[]});
  }, [monthKey]);

  const saveFixed = fe => { setFixedExpenses(fe); store.set("fixed-expenses", fe); };
  const saveMD = md => { setMonthData(md); store.set(monthKey, md); };

  const prevMonth = () => setMonth(({y,m}) => m===0 ? {y:y-1,m:11} : {y,m:m-1});
  const nextMonth = () => setMonth(({y,m}) => m===11 ? {y:y+1,m:0} : {y,m:m+1});

  const addFixed = (name, amt) => {
    const amount = parseFloat(amt.replace(",",".")) || 0;
    saveFixed([...fixedExpenses, {id:Date.now(), name, amount}]);
  };
  const delFixed = id => saveFixed(fixedExpenses.filter(e=>e.id!==id));

  const addExp = (name, amt) => {
    const amount = parseFloat(amt.replace(",",".")) || 0;
    const exp = {id:Date.now(), name, amount, date:toKey(new Date())};
    saveMD({...monthData, expenses:[...(monthData.expenses||[]), exp]});
  };
  const delExp = id => saveMD({...monthData, expenses:(monthData.expenses||[]).filter(e=>e.id!==id)});

  const income = parseFloat(String(monthData.income).replace(",",".")) || 0;
  const fixedTotal = fixedExpenses.reduce((a,e)=>a+(e.amount||0), 0);
  const varTotal = (monthData.expenses||[]).reduce((a,e)=>a+(e.amount||0), 0);
  const totalSpent = fixedTotal + varTotal;
  const balance = income - totalSpent;

  const fmtMoney = n => Number(n||0).toLocaleString("ru-RU");

  const rowStyle = {display:"flex",alignItems:"center",padding:"12px 16px",borderBottom:`1px solid ${A.sep}`,minHeight:46};
  const sidePad = isWide ? 0 : 16;

  const incomeBlock = (
    <div style={{padding:`0 ${sidePad}px 0`}}>
      <SectionHeader>Доходы за месяц</SectionHeader>
      <Card>
        <div style={{display:"flex",alignItems:"center",padding:"12px 16px",gap:12}}>
          <input value={monthData.income||""} onChange={e=>saveMD({...monthData,income:e.target.value})}
            placeholder="0" inputMode="decimal"
            style={{flex:1,border:`1px solid ${A.sep}`,background:A.bg,borderRadius:10,padding:"10px 12px",fontSize:20,fontFamily:SF,fontWeight:600,color:A.label,outline:"none",letterSpacing:-0.5}}/>
          <span style={{fontSize:15,fontFamily:SF,color:A.label2,whiteSpace:"nowrap"}}>₽</span>
        </div>
      </Card>
    </div>
  );

  const fixedBlock = (
    <div style={{padding:`20px ${sidePad}px 0`}}>
      <div style={{display:"flex",alignItems:"center",padding:"0 4px 6px 20px",cursor:"pointer"}} onClick={()=>setFixedOpen(o=>!o)}>
        <span style={{flex:1,fontSize:13,fontWeight:400,color:A.label2,letterSpacing:-0.08,textTransform:"uppercase"}}>Постоянные расходы · {fmtMoney(fixedTotal)} ₽</span>
        <span style={{fontSize:18,color:A.label2,transform:fixedOpen?"rotate(90deg)":"none",transition:"transform .15s",marginRight:4}}>›</span>
      </div>
      {fixedOpen && <Card>
        {fixedExpenses.length === 0 && <div style={{padding:"14px 16px",color:A.label2,fontSize:15,fontFamily:SF,textAlign:"center"}}>Нет постоянных расходов</div>}
        {fixedExpenses.map((e,i)=>(
          <div key={e.id} style={{...rowStyle,borderBottom:i<fixedExpenses.length-1?`1px solid ${A.sep}`:"none"}}>
            <span style={{flex:1,fontSize:17,fontFamily:SF,color:A.label}}>{e.name}</span>
            <span style={{fontSize:15,fontFamily:SF,color:A.label2,marginRight:16}}>{fmtMoney(e.amount)} ₽</span>
            <button onClick={()=>delFixed(e.id)} style={{width:28,height:28,borderRadius:"50%",background:A.red+"20",border:"none",cursor:"pointer",color:A.red,fontSize:16,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        ))}
        <AddRow onAdd={addFixed} placeholderName="Аренда, свет, байк..." placeholderAmt="Сумма ₽" hasBorder={fixedExpenses.length>0}/>
      </Card>}
    </div>
  );

  const varBlock = (
    <div style={{padding:`20px ${sidePad}px 0`}}>
      <SectionHeader>Расходы · {MONTHS_G[month.m]}</SectionHeader>
      <Card>
        {(monthData.expenses||[]).length === 0 && <div style={{padding:"14px 16px",color:A.label2,fontSize:15,fontFamily:SF,textAlign:"center"}}>Расходов нет</div>}
        {(monthData.expenses||[]).map((e,i,arr)=>(
          <div key={e.id} style={{...rowStyle,borderBottom:i<arr.length-1?`1px solid ${A.sep}`:"none"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontFamily:SF,color:A.label}}>{e.name}</div>
              {e.date && <div style={{fontSize:12,fontFamily:SF,color:A.label2,marginTop:2}}>{e.date}</div>}
            </div>
            <span style={{fontSize:15,fontFamily:SF,color:A.label2,marginRight:16}}>{fmtMoney(e.amount)} ₽</span>
            <button onClick={()=>delExp(e.id)} style={{width:28,height:28,borderRadius:"50%",background:A.red+"20",border:"none",cursor:"pointer",color:A.red,fontSize:16,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        ))}
        <AddRow onAdd={addExp} placeholderName="Продукты, кафе, такси..." placeholderAmt="Сумма ₽" hasBorder={(monthData.expenses||[]).length>0}/>
      </Card>
    </div>
  );

  const totalsBlock = (
    <div style={{padding:`20px ${sidePad}px 0`}}>
      <SectionHeader>Итого</SectionHeader>
      <Card>
        {[
          ["Доходы", fmtMoney(income)+" ₽", A.green],
          ["Постоянные расходы", fmtMoney(fixedTotal)+" ₽", A.label],
          ["Переменные расходы", fmtMoney(varTotal)+" ₽", A.label],
          ["Всего потрачено", fmtMoney(totalSpent)+" ₽", A.red],
        ].map(([label,val,color],i)=>(
          <div key={label} style={{display:"flex",alignItems:"center",padding:"11px 16px",borderBottom:`1px solid ${A.sep}`}}>
            <span style={{flex:1,fontSize:15,fontFamily:SF,color:A.label}}>{label}</span>
            <span style={{fontSize:15,fontFamily:SF,color}}>{val}</span>
          </div>
        ))}
        <div style={{display:"flex",alignItems:"center",padding:"14px 16px"}}>
          <span style={{flex:1,fontSize:17,fontFamily:SF,fontWeight:600,color:A.label}}>Остаток</span>
          <span style={{fontSize:20,fontFamily:SF,fontWeight:700,color:balance>=0?A.green:A.red}}>{balance>=0?"+":""}{fmtMoney(balance)} ₽</span>
        </div>
      </Card>
    </div>
  );

  return (
    <div style={{paddingBottom: isWide ? 40 : 100}}>
      <div style={{padding: isWide ? "20px 0 8px" : "16px 20px 8px"}}><LargeTitle>Финансы</LargeTitle></div>

      <div style={{display:"flex",alignItems:"center",gap:8,padding: isWide ? "0 0 12px" : "0 20px 12px"}}>
        <button onClick={prevMonth} style={{width:36,height:36,borderRadius:"50%",background:A.bg,border:"none",cursor:"pointer",fontSize:18,color:A.blue,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
        <span style={{flex:1,textAlign:"center",fontSize:17,fontFamily:SF,fontWeight:600,color:A.label}}>{MONTHS[month.m]} {month.y}</span>
        <button onClick={nextMonth} style={{width:36,height:36,borderRadius:"50%",background:A.bg,border:"none",cursor:"pointer",fontSize:18,color:A.blue,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
      </div>

      {isWide ? (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,alignItems:"start"}}>
          <div>{incomeBlock}{totalsBlock}</div>
          <div>{fixedBlock}{varBlock}</div>
        </div>
      ) : (
        <>{incomeBlock}{fixedBlock}{varBlock}{totalsBlock}</>
      )}
    </div>
  );
}

function buildFinanceReportHTML(month, monthData, fixedExpenses, fmtMoney) {
  const title = `Финансы · ${MONTHS[month.m]} ${month.y}`;
  const fixedTotal = fixedExpenses.reduce((a,e)=>a+e.amount,0);
  const varTotal = (monthData.expenses||[]).reduce((a,e)=>a+e.amount,0);
  const totalSpent = fixedTotal + varTotal;
  const balance = (monthData.income||0) - totalSpent;
  const balColor = balance >= 0 ? "#34C759" : "#FF3B30";

  const fixedRows = fixedExpenses.map(e=>`<tr><td>${e.name}</td><td style="text-align:right;">${fmtMoney(e.amount)} ₽</td></tr>`).join("") || `<tr><td colspan="2" style="color:#888;">Нет данных</td></tr>`;
  const varRows = (monthData.expenses||[]).map(e=>`<tr><td>${e.name}</td><td style="text-align:right;">${fmtMoney(e.amount)} ₽</td><td style="color:#888;font-size:12px;">${e.date||""}</td></tr>`).join("") || `<tr><td colspan="3" style="color:#888;">Нет данных</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
    <style>body{font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#000;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}th{text-align:left;font-size:12px;color:#888;text-transform:uppercase;padding:4px 0;border-bottom:1px solid #ccc;}td{padding:6px 0;border-bottom:1px solid #eee;font-size:14px;}@page{margin:1.4cm;}</style>
    </head><body>
    <h1 style="font-size:22px;margin:0 0 16px;">${title}</h1>
    <div style="margin-bottom:16px;font-size:16px;">Доходы: <b style="color:#34C759;">${fmtMoney(monthData.income||0)} ₽</b></div>
    <h2 style="font-size:16px;margin:0 0 8px;">Постоянные расходы</h2>
    <table><thead><tr><th>Название</th><th style="text-align:right;">Сумма</th></tr></thead><tbody>${fixedRows}</tbody>
    <tfoot><tr><td><b>Итого</b></td><td style="text-align:right;"><b>${fmtMoney(fixedTotal)} ₽</b></td></tr></tfoot></table>
    <h2 style="font-size:16px;margin:0 0 8px;">Переменные расходы</h2>
    <table><thead><tr><th>Название</th><th style="text-align:right;">Сумма</th><th>Дата</th></tr></thead><tbody>${varRows}</tbody>
    <tfoot><tr><td><b>Итого</b></td><td style="text-align:right;"><b>${fmtMoney(varTotal)} ₽</b></td><td></td></tr></tfoot></table>
    <div style="font-size:16px;margin-bottom:6px;">Всего потрачено: <b>${fmtMoney(totalSpent)} ₽</b></div>
    <div style="font-size:18px;margin-bottom:20px;">Остаток: <b style="color:${balColor};">${fmtMoney(balance)} ₽</b></div>
    </body></html>`;
}

function buildUnifiedReportHTML(daysInRange, allDaily, cycleData, from, to, fmt, goodN, sportN, taskN) {
  const fmtMoney = n => Number(n||0).toLocaleString("ru-RU");

  const diaryRows = daysInRange.map(k => {
    const v = allDaily[k], phase = getCyclePhase(parseKey(k), cycleData);
    const work = (v.todos||[]).filter(x=>x.tag==="work");
    const pers = (v.todos||[]).filter(x=>x.tag==="personal");
    const untagged = (v.todos||[]).filter(x=>!x.tag);
    return `
      <div style="margin-bottom:18px;page-break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:8px;">
          <b style="font-size:15px;">${fmt(k)}</b>
          <span style="color:#555;font-size:13px;">${phase?`${phase.label} · день ${phase.day}`:""}</span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:6px;">
          Питание: ${v.eating===true?"в порядке ✓":v.eating===false?"трудный день":"—"}
          &nbsp;·&nbsp;
          Спорт: ${v.sport?.done?(v.sport.type||"да"):"нет"}
        </div>
        ${work.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Работа</div>${work.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}</div>`).join("")}</div>`:""}
        ${pers.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Личное</div>${pers.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}</div>`).join("")}</div>`:""}
        ${untagged.length?`<div style="margin-bottom:4px;"><div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:2px;">Другое</div>${untagged.map(x=>`<div style="font-size:14px;margin-left:8px;">${x.done?"☑":"☐"} ${x.text}${x.note?` — <i>${x.note}</i>`:""}</div>`).join("")}</div>`:""}
        ${v.notes?`<div style="font-size:13px;color:#333;margin-top:4px;font-style:italic;">Заметка: ${v.notes}</div>`:""}
      </div>`;
  }).join("");

  const fromDate = parseKey(from), toDate = parseKey(to);
  const monthsInRange = new Set();
  let d = new Date(fromDate);
  while (d <= toDate) { monthsInRange.add(`${d.getFullYear()}-${pad(d.getMonth()+1)}`); d.setMonth(d.getMonth()+1); }

  let financeHTML = "";
  for (const mk of [...monthsInRange].sort()) {
    try {
      const md = JSON.parse(localStorage.getItem(`finances-${mk}`));
      const fe = JSON.parse(localStorage.getItem("fixed-expenses")) || [];
      if (!md && !fe?.length) continue;
      const [fy,fm] = mk.split("-").map(Number);
      const income = parseFloat(String((md?.income)||0).replace(",",".")) || 0;
      const fixedTotal = (fe||[]).reduce((a,e)=>a+(e.amount||0),0);
      const varTotal = (md?.expenses||[]).reduce((a,e)=>a+(e.amount||0),0);
      const balance = income - fixedTotal - varTotal;
      financeHTML += `
        <div style="margin-bottom:20px;page-break-inside:avoid;">
          <h3 style="font-size:16px;margin:0 0 8px;">${MONTHS[fm-1]} ${fy}</h3>
          <div style="font-size:14px;margin-bottom:4px;">Доходы: <b style="color:#34C759;">${fmtMoney(income)} ₽</b></div>
          <div style="font-size:14px;margin-bottom:4px;">Постоянные расходы: ${fmtMoney(fixedTotal)} ₽</div>
          <div style="font-size:14px;margin-bottom:4px;">Переменные расходы: ${fmtMoney(varTotal)} ₽</div>
          <div style="font-size:14px;">Остаток: <b style="color:${balance>=0?"#34C759":"#FF3B30"};">${balance>=0?"+":""}${fmtMoney(balance)} ₽</b></div>
          ${(md?.expenses||[]).length?`<div style="margin-top:8px;font-size:12px;color:#888;text-transform:uppercase;margin-bottom:4px;">Расходы</div>${(md.expenses).map(e=>`<div style="font-size:13px;padding:3px 0;border-bottom:1px solid #eee;">${e.name} — ${fmtMoney(e.amount)} ₽${e.date?` <span style="color:#aaa">${e.date}</span>`:""}</div>`).join("")}`:""}
        </div>`;
    } catch {}
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Отчёт ${from} — ${to}</title>
    <style>body{font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#000;}h2{font-size:18px;margin:24px 0 12px;padding-top:12px;border-top:2px solid #000;}@page{margin:1.4cm;}</style>
    </head><body>
    <h1 style="font-size:24px;margin:0 0 4px;">Отчёт</h1>
    <div style="color:#555;margin-bottom:20px;">Период: ${fmt(from)} — ${fmt(to)}</div>
    <div style="display:flex;gap:24px;padding:12px 0;border-top:2px solid #000;border-bottom:1px solid #ccc;margin-bottom:24px;">
      <div><b style="font-size:20px;">${daysInRange.length}</b> дней</div>
      <div><b style="font-size:20px;">${goodN}</b> в балансе</div>
      <div><b style="font-size:20px;">${sportN}</b> тренировок</div>
      <div><b style="font-size:20px;">${taskN}</b> задач выполнено</div>
    </div>
    <h2>Дневник состояния и задачи</h2>
    ${diaryRows || "<div style='color:#888;'>Нет данных за выбранный период.</div>"}
    ${financeHTML ? `<h2>Финансы</h2>${financeHTML}` : ""}
    </body></html>`;
}

function compressImage(file, maxDim = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
    img.src = url;
  });
}

function WishItemContent({w, isOpen, onToggleOpen, updateWish, delWish, pickPhoto, uploadingId}) {
  return (
    <>
      <div style={{display:"flex",alignItems:"center",padding:"11px 16px",minHeight:52}}>
        {w.photo
          ? <img src={w.photo} alt="" style={{width:48,height:48,borderRadius:10,objectFit:"cover",marginRight:12,flexShrink:0}}/>
          : <div style={{width:48,height:48,borderRadius:10,background:A.bg,marginRight:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:18,color:A.label3}}>✦</span>
            </div>
        }
        <div style={{flex:1,minWidth:0}} onClick={onToggleOpen}>
          <div style={{fontSize:17,fontFamily:SF,color:w.bought?A.label2:A.label,textDecoration:w.bought?"line-through":"none",letterSpacing:-0.41,lineHeight:"22px",cursor:"pointer"}}>{w.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
            {w.price && <span style={{fontSize:13,fontFamily:SF,color:A.label2}}>{w.price} ₽</span>}
            {w.bought && <span style={{fontSize:11,fontFamily:SF,fontWeight:600,color:A.green,background:A.green+"18",padding:"2px 7px",borderRadius:10}}>✓ Куплено</span>}
          </div>
        </div>
        <button onClick={onToggleOpen} style={{background:"none",border:"none",cursor:"pointer",padding:"0 0 0 8px",color:A.label2,fontSize:18,lineHeight:1,transform:isOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>›</button>
      </div>
      {isOpen && (
        <div style={{padding:"0 16px 14px 56px",background:A.bg}}>
          <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Название</div>
          <input value={w.name} onChange={e=>updateWish(w.id,"name",e.target.value)}
            style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,boxSizing:"border-box",outline:"none",display:"block",marginBottom:10}}/>
          <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Фото</div>
          {w.photo && <img src={w.photo} alt="" style={{width:"100%",maxHeight:200,borderRadius:10,objectFit:"cover",marginBottom:8,display:"block"}}/>}
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <button onClick={()=>pickPhoto(w.id)} disabled={uploadingId===w.id} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${A.blue}`,background:A.blue+"11",color:A.blue,fontSize:15,fontFamily:SF,fontWeight:500,cursor:uploadingId===w.id?"default":"pointer",opacity:uploadingId===w.id?0.6:1}}>
              {uploadingId===w.id ? "Загрузка..." : "📷 Загрузить с устройства"}
            </button>
            {w.photo && <button onClick={()=>updateWish(w.id,"photo","")} style={{padding:"10px 12px",borderRadius:10,border:`1px solid ${A.sep}`,background:A.card,color:A.red,fontSize:13,fontFamily:SF,cursor:"pointer"}}>Удалить фото</button>}
          </div>
          <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Сумма, ₽</div>
          <input type="number" value={w.price} onChange={e=>updateWish(w.id,"price",e.target.value)} placeholder="0"
            style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,boxSizing:"border-box",outline:"none",display:"block",marginBottom:10}}/>
          <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Ссылка на товар</div>
          <input value={w.link} onChange={e=>updateWish(w.id,"link",e.target.value)} placeholder="https://..."
            style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.blue,boxSizing:"border-box",outline:"none",display:"block",marginBottom:w.link?4:10}}/>
          {w.link && <a href={w.link.startsWith("http")?w.link:`https://${w.link}`} target="_blank" rel="noreferrer" style={{display:"inline-block",marginBottom:10,fontSize:13,fontFamily:SF,color:A.blue}}>Открыть ↗</a>}
          <div style={{fontSize:12,color:A.label2,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Планирую купить</div>
          <input type="date" value={w.plannedDate} onChange={e=>updateWish(w.id,"plannedDate",e.target.value)}
            style={{width:"100%",background:A.card,border:`1px solid ${A.sep}`,borderRadius:10,padding:"10px 12px",fontSize:15,fontFamily:SF,color:A.label,boxSizing:"border-box",outline:"none",display:"block",marginBottom:14}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <span style={{fontSize:17,fontFamily:SF,color:A.label,letterSpacing:-0.41}}>Куплено</span>
            <IOSToggle value={!!w.bought} onChange={v=>updateWish(w.id,"bought",v)}/>
          </div>
          <button onClick={()=>delWish(w.id)} style={{color:A.red,background:"none",border:"none",cursor:"pointer",fontSize:15,fontFamily:SF,padding:0}}>Удалить</button>
        </div>
      )}
    </>
  );
}

function WishlistTab({isWide}) {
  const [wishlist, setWishlist] = useState(() => store.get("wishlist") || []);
  const [newWishName, setNewWishName] = useState("");
  const [expandedWish, setExpandedWish] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);

  const saveWish = wl => {
    setWishlist(wl);
    const ok = store.set("wishlist", wl);
    if (!ok) alert("Не удалось сохранить: недостаточно места в хранилище браузера. Попробуйте выбрать фото меньшего размера.");
  };

  const addWish = () => {
    if (!newWishName.trim()) return;
    const w = {id:Date.now(), name:newWishName.trim(), price:"", link:"", photo:"", plannedDate:"", bought:false};
    saveWish([w, ...wishlist]);
    setNewWishName(""); setExpandedWish(w.id);
  };
  const delWish = id => { saveWish(wishlist.filter(w=>w.id!==id)); setExpandedWish(null); };
  const updateWish = (id, field, val) => saveWish(wishlist.map(w=>w.id===id?{...w,[field]:val}:w));
  const pickPhoto = id => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      setUploadingId(id);
      compressImage(file)
        .then(dataUrl => updateWish(id, "photo", dataUrl))
        .catch(() => alert("Не удалось обработать фото. Попробуйте другое изображение."))
        .finally(() => setUploadingId(null));
    };
    input.click();
  };

  const sidePad = isWide ? 0 : 16;

  return (
    <div style={{paddingBottom: isWide ? 40 : 100}}>
      <div style={{padding: isWide ? "20px 0 4px" : "16px 20px 4px"}}>
        <LargeTitle>Вишлист</LargeTitle>
        <div style={{fontSize:13,fontFamily:SF,color:A.label2,marginTop:4}}>Всё, что хочется купить</div>
      </div>

      <div style={{padding:`16px ${sidePad}px 0`}}>
        <Card>
          <div style={{display:"flex",alignItems:"center",padding:"10px 16px",gap:8}}>
            <input value={newWishName} onChange={e=>setNewWishName(e.target.value)} placeholder="Что хочу купить..." onKeyDown={e=>e.key==="Enter"&&addWish()}
              style={{flex:1,border:"none",background:"transparent",fontSize:17,fontFamily:SF,color:A.label,outline:"none",letterSpacing:-0.41}}/>
            <button onClick={addWish} style={{color:A.blue,background:"none",border:"none",cursor:"pointer",fontSize:15,fontFamily:SF,fontWeight:600,whiteSpace:"nowrap"}}>Добавить</button>
          </div>
        </Card>
      </div>

      <div style={{padding:`16px ${sidePad}px 0`}}>
        {wishlist.length === 0 && (
          <div style={{textAlign:"center",color:A.label2,fontSize:15,fontFamily:SF,padding:"32px 0"}}>Список пуст</div>
        )}
        {wishlist.length > 0 && (
          isWide ? (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
              {wishlist.map(w => (
                <Card key={w.id}>
                  <WishItemContent w={w} isOpen={expandedWish===w.id} onToggleOpen={()=>setExpandedWish(expandedWish===w.id?null:w.id)} updateWish={updateWish} delWish={delWish} pickPhoto={pickPhoto} uploadingId={uploadingId}/>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              {wishlist.map((w, i) => (
                <div key={w.id} style={{borderBottom:i<wishlist.length-1||expandedWish===w.id?`1px solid ${A.sep}`:"none"}}>
                  <WishItemContent w={w} isOpen={expandedWish===w.id} onToggleOpen={()=>setExpandedWish(expandedWish===w.id?null:w.id)} updateWish={updateWish} delWish={delWish} pickPhoto={pickPhoto} uploadingId={uploadingId}/>
                </div>
              ))}
            </Card>
          )
        )}
      </div>
    </div>
  );
}

const SYNC_KEYS = ["all-daily", "cycle-data", "fixed-expenses", "wishlist"];
const FIREBASE_CONFIGURED = isFirebaseConfigured();

async function loadAllFromFirebase(uid) {
  if (!db) return {};
  const results = {};
  await Promise.all(SYNC_KEYS.map(async key => {
    try {
      const snap = await getDoc(doc(db, "users", uid, "store", key));
      if (snap.exists()) results[key] = snap.data().value;
    } catch {}
  }));
  // also load finances keys from localStorage pattern
  const finKeys = Object.keys(localStorage).filter(k => k.startsWith("finances-"));
  await Promise.all(finKeys.map(async key => {
    try {
      const snap = await getDoc(doc(db, "users", uid, "store", key));
      if (snap.exists()) results[key] = snap.data().value;
    } catch {}
  }));
  return results;
}

function mergeAndApply(fbData) {
  // Firebase data wins (it's the latest from any device)
  Object.entries(fbData).forEach(([k, v]) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  });
}

function Sidebar({tabs, tab, setTab, syncBar}) {
  return (
    <div style={{width:240,flexShrink:0,background:A.card,borderRight:`1px solid ${A.sep}`,display:"flex",flexDirection:"column",height:"100dvh"}}>
      <div style={{padding:"22px 22px 18px"}}>
        <div style={{fontSize:19,fontWeight:700,fontFamily:SF,color:A.label,letterSpacing:-0.4}}>Мой календарь</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 12px"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"11px 12px",borderRadius:10,border:"none",background:tab===t.id?A.blue+"14":"transparent",cursor:"pointer",marginBottom:2,textAlign:"left"}}>
            <span style={{fontSize:18,lineHeight:1,color:tab===t.id?A.blue:A.label2,width:22,textAlign:"center",flexShrink:0}}>{t.icon}</span>
            <span style={{fontSize:15,fontFamily:SF,fontWeight:tab===t.id?600:400,color:tab===t.id?A.blue:A.label}}>{t.label}</span>
          </button>
        ))}
      </div>
      {syncBar && <div style={{borderTop:`1px solid ${A.sep}`}}>{syncBar}</div>}
    </div>
  );
}

const WIDE_MAXW = {today:1100, calendar:null, finance:1100, wishlist:1200, settings:640};

export default function App() {
  const [tab, setTab] = useState("today");
  const [allDaily, setAllDaily] = useState({});
  const [cycleData, setCycleData] = useState({startDates:[], length:28});
  const [streak, setStreak] = useState(0);
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [authLoading, setAuthLoading] = useState(FIREBASE_CONFIGURED);
  const unsubSnapshotsRef = useRef([]);
  const today = todayKey();
  const isWide = useIsWide();

  const loadLocal = useCallback(() => {
    const ad = store.get("all-daily") || {};
    const cd = store.get("cycle-data") || {startDates:[], length:28};
    setAllDaily(ad); setCycleData(cd); setStreak(computeStreak(ad, today));
  }, [today]);

  // Subscribe to Firestore real-time updates for sync
  const subscribeFirestore = useCallback((uid) => {
    unsubSnapshotsRef.current.forEach(u => u());
    unsubSnapshotsRef.current = [];
    if (!db) return;

    const keysToWatch = [...SYNC_KEYS];
    keysToWatch.forEach(key => {
      const unsub = onSnapshot(doc(db, "users", uid, "store", key), (snap) => {
        if (!snap.exists()) return;
        const val = snap.data().value;
        let localVal;
        try { localVal = JSON.parse(localStorage.getItem(key)); } catch {}
        if (JSON.stringify(val) === JSON.stringify(localVal)) return;
        // Remote changed — update localStorage and React state
        _syncDisabled = true;
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
        _syncDisabled = false;
        if (key === "all-daily") {
          const tk = todayKey();
          setAllDaily(val || {});
          setStreak(computeStreak(val || {}, todayKey()));
        } else if (key === "cycle-data") {
          setCycleData(val || {startDates:[], length:28});
        }
        setSyncStatus("synced");
      }, () => { setSyncStatus("error"); });
      unsubSnapshotsRef.current.push(unsub);
    });
  }, []);

  useEffect(() => {
    loadLocal();
    if (!FIREBASE_CONFIGURED || !auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        _fbUser = u;
        setSyncStatus("syncing");
        try {
          const fbData = await loadAllFromFirebase(u.uid);
          if (Object.keys(fbData).length > 0) {
            mergeAndApply(fbData);
            loadLocal();
          }
          // Push local data to Firebase (in case local has newer data)
          SYNC_KEYS.forEach(key => {
            const local = store.get(key);
            if (local) fbSet(key, local);
          });
          setSyncStatus("synced");
          subscribeFirestore(u.uid);
        } catch { setSyncStatus("error"); }
      } else {
        _fbUser = null;
        unsubSnapshotsRef.current.forEach(u => u());
        unsubSnapshotsRef.current = [];
      }
    });
    return () => { unsub(); unsubSnapshotsRef.current.forEach(u => u()); };
  }, [loadLocal, subscribeFirestore]);

  const handleSignIn = async () => {
    if (!auth) return;
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { console.error(e); }
  };
  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
    setSyncStatus("idle");
  };

  useEffect(() => {
    if (syncStatus === "synced") {
      const t = setTimeout(() => setSyncStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [syncStatus]);

  const saveDayData = useCallback((key, data) => {
    setAllDaily(prev => {
      const na = {...prev, [key]:data};
      store.set("all-daily", na);
      setStreak(computeStreak(na, today));
      return na;
    });
  }, [today]);

  const saveCycle = useCallback(c => { setCycleData(c); store.set("cycle-data", c); }, []);

  // Перенос: только показываем невыполненные задачи прошлых дней — НИЧЕГО не двигаем в хранилище.
  // _src = ключ дня, где задача реально хранится.
  const realToday = allDaily[today] || emptyDay();
  const carriedOpen = [];
  const carriedIds = new Set();
  Object.entries(allDaily).forEach(([key, day]) => {
    if (key >= today) return;
    (day.todos || []).forEach(t => {
      if (!t.done && !carriedIds.has(t.id)) {
        carriedOpen.push({...t, _src: key});
        carriedIds.add(t.id);
      }
    });
  });
  // Показываем: перенесённые открытые из прошлого + задачи самого сегодняшнего дня
  // (и открытые, и закрытые — закрытые видны зачёркнутыми в своём дне).
  const todayOwn = (realToday.todos || []).filter(t => !carriedIds.has(t.id));
  const todayData = {...realToday, todos: [...carriedOpen, ...todayOwn]};

  // При любом изменении на вкладке "Сегодня":
  // - задачи без _src (родные) → пишем в allDaily[today]
  // - задачи с _src (перенесённые) → пишем обратно в их родной день
  const saveToday = useCallback((data) => {
    setAllDaily(prev => {
      const na = {...prev};
      const incoming = data.todos || [];
      const native = incoming.filter(t => !t._src);
      na[today] = {...(prev[today] || emptyDay()), notes: data.notes, eating: data.eating, sport: data.sport, todos: native};
      const bySrc = {};
      incoming.filter(t => t._src).forEach(t => { (bySrc[t._src] = bySrc[t._src] || []).push(t); });
      Object.keys(prev).forEach(key => {
        if (key >= today) return;
        const prevOpen = (prev[key].todos || []).filter(t => !t.done);
        if (prevOpen.length === 0 && !bySrc[key]) return;
        const keptDone = (prev[key].todos || []).filter(t => t.done);
        const edited = (bySrc[key] || []).map(({_src, ...t}) => t);
        na[key] = {...prev[key], todos: [...keptDone, ...edited]};
      });
      store.set("all-daily", na);
      setStreak(computeStreak(na, today));
      return na;
    });
  }, [today]);

  // Аналог saveToday, но для произвольного дня selKey (вкладка Календарь).
  const saveDayView = useCallback((selKey, data) => {
    setAllDaily(prev => {
      const na = {...prev};
      const incoming = data.todos || [];
      const native = incoming.filter(t => !t._src);
      na[selKey] = {...(prev[selKey] || emptyDay()), notes: data.notes, eating: data.eating, sport: data.sport, todos: native};
      const bySrc = {};
      incoming.filter(t => t._src).forEach(t => { (bySrc[t._src] = bySrc[t._src] || []).push(t); });
      Object.keys(prev).forEach(key => {
        if (key >= selKey) return;
        const prevOpen = (prev[key].todos || []).filter(t => !t.done);
        if (prevOpen.length === 0 && !bySrc[key]) return;
        const keptDone = (prev[key].todos || []).filter(t => t.done);
        const edited = (bySrc[key] || []).map(({_src, ...t}) => t);
        na[key] = {...prev[key], todos: [...keptDone, ...edited]};
      });
      store.set("all-daily", na);
      setStreak(computeStreak(na, today));
      return na;
    });
  }, [today]);

  // Перенос задачи на другой день: убираем из дня-источника, кладём в целевой.
  const moveTask = useCallback((taskId, fromKey, toKey) => {
    if (!toKey || fromKey === toKey) return;
    setAllDaily(prev => {
      const fromDay = prev[fromKey] || emptyDay();
      const task = (fromDay.todos || []).find(t => t.id === taskId);
      if (!task) return prev;
      const {_src, ...clean} = task;
      const na = {...prev};
      na[fromKey] = {...fromDay, todos: (fromDay.todos || []).filter(t => t.id !== taskId)};
      const toDay = na[toKey] || emptyDay();
      na[toKey] = {...toDay, todos: [...(toDay.todos || []), clean]};
      store.set("all-daily", na);
      setStreak(computeStreak(na, today));
      return na;
    });
  }, [today]);

  const tabs = [
    {id:"today",    icon:"◉", label:"Сегодня"},
    {id:"calendar", icon:"▦", label:"Календарь"},
    {id:"finance",  icon:"◈", label:"Финансы"},
    {id:"wishlist", icon:"♡", label:"Вишлист"},
    {id:"settings", icon:"⚙", label:"Настройки"},
  ];

  const syncBar = FIREBASE_CONFIGURED ? (
    <div style={{background:user ? "#007AFF11" : "#F2F2F7", borderBottom:`1px solid ${A.sep}`, padding:"6px 16px", display:"flex", alignItems:"center", gap:8, minHeight:36}}>
      {authLoading ? (
        <span style={{fontSize:12, fontFamily:SF, color:A.label2}}>Загрузка...</span>
      ) : user ? (
        <>
          <div style={{width:6,height:6,borderRadius:"50%",background:syncStatus==="error"?A.red:syncStatus==="syncing"?"#FF9500":syncStatus==="synced"?A.green:A.blue,flexShrink:0}}/>
          <span style={{flex:1,fontSize:12,fontFamily:SF,color:A.label2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {syncStatus==="syncing"?"Синхронизация...":syncStatus==="synced"?"Синхронизировано ✓":syncStatus==="error"?"Ошибка синхронизации":user.displayName||user.email}
          </span>
          <button onClick={handleSignOut} style={{fontSize:11,fontFamily:SF,color:A.label2,background:"none",border:"none",cursor:"pointer",padding:"2px 6px",borderRadius:6,flexShrink:0}}>Выйти</button>
        </>
      ) : (
        <>
          <span style={{flex:1,fontSize:12,fontFamily:SF,color:A.label2}}>Войдите для синхронизации между устройствами</span>
          <button onClick={handleSignIn} style={{fontSize:12,fontFamily:SF,color:"#fff",background:A.blue,border:"none",cursor:"pointer",padding:"4px 12px",borderRadius:8,fontWeight:600,flexShrink:0}}>Google →</button>
        </>
      )}
    </div>
  ) : null;

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#F2F2F7;-webkit-font-smoothing:antialiased;height:100%;}
        #root{height:100%;}
        input,textarea,button{font-family:${SF};}
        textarea{resize:none;}
        ::-webkit-scrollbar{display:none;}
        button{-webkit-tap-highlight-color:transparent;}
      `}</style>

      {isWide ? (
        <div style={{display:"flex",height:"100dvh",background:A.bg,fontFamily:SF}}>
          <Sidebar tabs={tabs} tab={tab} setTab={setTab} syncBar={syncBar}/>
          <div style={{flex:1,overflowY:"auto"}}>
            <div style={{maxWidth:WIDE_MAXW[tab]||undefined,margin:WIDE_MAXW[tab]?"0 auto":0,padding:"0 36px 40px"}}>
              {tab==="today"    && <TodayTab    dayData={todayData} onSave={saveToday} cycleData={cycleData} today={today} moveTask={moveTask} isWide/>}
              {tab==="calendar" && <CalendarTab allDaily={allDaily} cycleData={cycleData} saveDayData={saveDayData} saveDayView={saveDayView} moveTask={moveTask} isWide/>}
              {tab==="settings" && <SettingsTab cycleData={cycleData} saveCycle={saveCycle} allDaily={allDaily} streak={streak}/>}
              {tab==="finance"  && <FinanceTab isWide/>}
              {tab==="wishlist" && <WishlistTab isWide/>}
            </div>
          </div>
        </div>
      ) : (
        <div style={{background:A.bg,height:"100dvh",maxWidth:430,margin:"0 auto",fontFamily:SF,display:"flex",flexDirection:"column"}}>
          {syncBar}
          <div style={{flex:1,overflowY:"auto",paddingBottom:84}}>
            {tab==="today"    && <TodayTab    dayData={todayData} onSave={saveToday} cycleData={cycleData} today={today} moveTask={moveTask}/>}
            {tab==="calendar" && <CalendarTab allDaily={allDaily} cycleData={cycleData} saveDayData={saveDayData} saveDayView={saveDayView} moveTask={moveTask}/>}
            {tab==="settings" && <SettingsTab cycleData={cycleData} saveCycle={saveCycle} allDaily={allDaily} streak={streak}/>}
            {tab==="finance"  && <FinanceTab/>}
            {tab==="wishlist" && <WishlistTab/>}
          </div>
          <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:A.tabBar,borderTop:`1px solid ${A.tabBarBorder}`,display:"flex",paddingBottom:"env(safe-area-inset-bottom,8px)",backdropFilter:"blur(20px)"}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"10px 4px 4px",background:"none",border:"none",cursor:"pointer",color:tab===t.id?A.blue:A.label2}}>
                <span style={{fontSize:22,lineHeight:1}}>{t.icon}</span>
                <span style={{fontSize:10,fontFamily:SF,fontWeight:tab===t.id?600:400}}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
