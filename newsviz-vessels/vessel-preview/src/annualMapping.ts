import defaults from './annualBehaviors.json' with {type: 'json'};
import {defaultConfig, FOLD_DEFAULTS, scoreParams, validateConfig} from './behaviourConfig.ts';
import type {Failure} from './behaviourConfig.ts';
import {FORM, PRINT} from './config.ts';
import {generateGeometry,twistAt} from './geometry.ts';
import {contactZ,foldFrames,settleFold} from './sagFold.ts';
import {DEFAULT_COHERENCE,registrationFrames,siteStrength,staggeredCourse} from './materialPattern.ts';
import {generateToolpath} from './toolpath.ts';
import type {BeadFrame,Move, Toolpath, XYZ} from './toolpath.ts';

export type AnnualDataset = {country: string; year: number; items: {id: string; score: number}[]};
export type Behavior = 'stable' | keyof typeof defaults;
const baseline = generateToolpath(generateGeometry());

export function readDataset(input: unknown, layerCount: number) {
  const data = input as Partial<AnnualDataset> | null;
  if (typeof data?.country !== 'string' || !data.country.trim() || !Number.isSafeInteger(data.year)) throw new Error('Provide a country and an integer year.');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > layerCount) throw new Error(`Provide 1–${layerCount} items: each needs at least one layer.`);
  const ids = new Set<string>();
  const items = data.items.map(item => {
    if (typeof item?.id !== 'string' || !item.id.trim() || ids.has(item.id.trim())) throw new Error('Each item needs a unique, nonempty id.');
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new Error(`Score for ${item.id} must be a number in [0, 1].`);
    ids.add(item.id.trim());
    return {id: item.id.trim(), score: item.score};
  }).sort((left, right) => left.score - right.score);
  return {country: data.country.trim(), year: data.year!, items};
}

const contours = baseline.geometry.contours;
const templates = contours.map(() => [] as Move[]);
for (const move of baseline.moves) templates[move.layerId - 1].push(move);
const sources = contours.map((contour,index) => {
  const moves = templates[index].filter(move => move.kind === 'deposition'), arc = [0];
  for (const move of moves) arc.push(arc.at(-1)! + move.lengthMm);
  return {moves, arc, perimeter:arc.at(-1)!, points:contour.points};
});
type Event = {start:number; end:number; site:number; cell:number};
type Sample = {at:number; command:XYZ; clay:XYZ; width:number};
type Ring = {supportMoves?:Move[]; samples:Sample[]; moves:Move[]; events:Event[]; cellCount:number; perimeter:number; shiftMm:number; shiftUnverified:boolean; relief:boolean; key:string; printStart:number;
  replacements:({firstMove:number; moveCount:number} & ReturnType<typeof settleFold>)[]};
const blend = (left:XYZ,right:XYZ,t:number):XYZ => t === 0 ? left : t === 1 ? right : [left[0]+t*(right[0]-left[0]),left[1]+t*(right[1]-left[1]),left[2]+t*(right[2]-left[2])];
const distance = (left:XYZ,right:XYZ) => Math.hypot(left[0]-right[0],left[1]-right[1],left[2]-right[2]);
const tip = (point:XYZ):XYZ => [point[0],point[1],point[2]+PRINT.nozzleAboveBeadCentreMm];
function interval(length:number, at:(index:number)=>number, value:number) {
  let low=0, high=length-1;
  while (high-low>1) {const mid=(high+low)>>>1; if (at(mid)<=value) low=mid; else high=mid;}
  return low;
}
function outward(point:XYZ, offset:number):XYZ {
  const factor = 1 + offset / Math.hypot(point[0],point[1]);
  return [factor*point[0],factor*point[1],point[2]];
}
const smooth=(u:number)=>u*u*(3-2*u);
type Effective = ReturnType<typeof scoreParams> & {score:number};
function buildRing(index:number, params:Effective, phase:number, seed:number, history:Ring[], maxDrop:number, key:string, slack:number, variation:number, coherence:number, edge:number):Ring {
  const {perimeter,arc,points,moves:base}=sources[index], {behavior,eventCount,coverage,amplitude}=params;
  const events:Event[]=[], cuts:number[]=[];
  const active=behavior!=='stable' && eventCount>0 && coverage>0 && amplitude>(behavior==='buldges'?1:0);
  const pitch=active?perimeter/eventCount:0;
  const bond=staggeredCourse(index,params.score,coverage,seed,coherence);
  const strengths:number[]=[];
  const wrap=(value:number)=>((value%perimeter)+perimeter)%perimeter;
  const subdivisions=behavior==='gaps'?1:behavior==='sagging'?32:12;
  const twistVertex=twistAt(sources[bond.firstLayer].points[0][2])/(2*Math.PI)*(points.length-1), left=Math.floor(twistVertex);
  const twistArc=arc[left]+(twistVertex-left)*(arc[left+1]-arc[left]);
  if(active)for(let site=0;site<eventCount;site++){
    const weight=siteStrength(site,eventCount,index,seed,coherence,variation);
    const window=pitch*coverage/100;
    const width=behavior==='gaps' ? Math.min(window,(1.4+1.6*bond.within)*PRINT.beadWidthMm)*amplitude*edge*(0.78+0.22*weight) : window;
    if(width/subdivisions<=1e-8)continue;
    const centre=wrap((site+bond.centre)*pitch+twistArc+((phase+seed-42)%360)/360*perimeter);
    const start=wrap(centre-width/2);
    events.push({start,end:start+width,site:site+1,cell:site*bond.cells+bond.lane+1});
    const emphasis=behavior==='sagging' ? weight**(eventCount>6?2:1.5) : 0.65+0.35*weight;
    strengths.push(edge*emphasis);
    for(let part=0;part<=subdivisions;part++)cuts.push(wrap(start+width*part/subdivisions));
  }
  function eventAt(value:number) {
    return events.findIndex(event=>{
      const along=wrap(value-event.start);
      return along>1e-9 && along<event.end-event.start-1e-9;
    });
  }
  for (const value of arc) {
    if (behavior!=='sagging' || value===0 || value===perimeter || eventAt(value)<0) cuts.push(value);
  }
  cuts.sort((left,right)=>left-right);
  const positions=cuts.filter((value,idx)=>idx===0 || (value-cuts[idx-1]>1e-9 && perimeter-value>1e-9));
  positions.push(perimeter);
  const contour=positions.map(value=>{
    const pos=interval(arc.length,idx=>arc[idx],value), fraction=(value-arc[pos])/(arc[pos+1]-arc[pos]);
    const point=blend(points[pos],points[pos+1],fraction), slot=eventAt(value);
    const u=slot<0?0:wrap(value-events[slot].start)/(events[slot].end-events[slot].start);
    return {pos,fraction,point,slot,u};
  });
  const directions=behavior==='misalignment'?events.map(({start,end,site})=>{
    const centre=wrap((start+end)/2), i=interval(arc.length,j=>arc[j],centre);
    const p=blend(points[i],points[i+1],(centre-arc[i])/(arc[i+1]-arc[i]));
    // Alternate inset and outset ledges. Each cell has a fixed oblique XY registration axis.
    const angle=Math.atan2(p[1],p[0])+0.83+(site%2?0:Math.PI);
    return [Math.cos(angle),Math.sin(angle)];
  }):[];
  // The middle of a cell translates rigidly. Its short shoulders rejoin the nominal perimeter.
  const shifted=(point:XYZ,u:number,amount:number,slot:number):XYZ=>{
    const shoulder=Math.min(1,4*Math.min(u,1-u));
    const step=amount*shoulder;
    return [point[0]+directions[slot][0]*step,point[1]+directions[slot][1]*step,point[2]];
  };
  let shiftUnverified=false;
  const backed=(p:XYZ)=>p[2]-contactZ(p,history,PRINT.beadHeightMm)<=0.22*PRINT.beadHeightMm;
  const releases=bond.releases || edge<1;
  const nextCourse=behavior==='misalignment' && index+1<sources.length?sources.slice(0,index+2):null;
  const shifts=behavior==='misalignment'?events.map((event,slot)=>{
    const span=contour.filter(s=>s.slot===slot);
    // Bound the shoulder slope so even a tangential translation preserves forward winding.
    const wanted=Math.min(amplitude*strengths[slot],0.16*(event.end-event.start));
    const supported=(amount:number)=>span.every(s=>{
      const p=shifted(s.point,s.u,amount,slot);
      if(!backed(p))return false;
      if(!nextCourse)return true;
      // Reserve overlap for the return to nominal. This probe uses the next design contour only.
      const probe:XYZ=[p[0],p[1],p[2]+2*PRINT.beadHeightMm];
      return probe[2]-contactZ(probe,nextCourse,PRINT.beadHeightMm)<=(releases?0.18:0.26)*PRINT.beadHeightMm;
    });
    if(supported(wanted))return wanted;
    // Find a supported rigid offset, even if the previous cell has already moved off the baseline.
    let rejected=wanted;
    for(let step=7;step>=0;step--){
      let accepted=wanted*step/8;
      if(supported(accepted)){
        for(let i=0;i<6;i++){
          const trial=(accepted+rejected)/2;
          if(supported(trial))accepted=trial;else rejected=trial;
        }
        return accepted;
      }
      rejected=accepted;
    }
    shiftUnverified=true;
    return 0;
  }):[];
  const samples=contour.map(({pos,fraction,point,slot,u})=>{
    const sample:Sample={at:pos+fraction,command:point,clay:point,width:PRINT.beadWidthMm};
    if (slot>=0) {
      const event=events[slot];
      const pulse=Math.sin(Math.PI*u)**2*strengths[slot];
      if (behavior==='buldges') {
        sample.width*=1+(amplitude-1)*strengths[slot]*Math.sin(Math.PI*u)**1.5;
        // More of the widened section spreads to the free outer face; the inner edge still grows.
        sample.clay=outward(point,0.37*(sample.width-PRINT.beadWidthMm));
      }
      if(behavior==='misalignment')sample.command=sample.clay=shifted(point,u,shifts[slot],slot);
      if (behavior==='sagging') sample.command=sample.clay=outward(point,Math.min(amplitude,(0.24+0.08*amplitude/6.5)*(event.end-event.start))*pulse);
    }
    if(behavior==='misalignment' && slot<0 && !backed(point))shiftUnverified=true;
    const lower=history[index-1];
    if(lower?.relief && (behavior!=='sagging' || (slot<0 && maxDrop>0 && slack>0))){
      const below=interval(lower.samples.length,i=>lower.samples[i].at,sample.at);
      const previous=lower.moves[below], a=lower.samples[below], b=lower.samples[below+1];
      const t=(sample.at-a.at)/(b.at-a.at);
      const inherited=a.command[2]-a.clay[2]+t*((b.command[2]-b.clay[2])-(a.command[2]-a.clay[2]));
      // A newly extruded roof settles toward earlier clay. Later courses recover as the sides carry load.
      let reach=0.62*inherited;
      if(!previous.extrude){
        const gap=lower.events[previous.eventId!-1];
        const lowerArc=sources[index-1].arc;
        const lowerAt=lowerArc[pos]+fraction*(lowerArc[pos+1]-lowerArc[pos]);
        const fromEntry=(lowerAt-gap.start+lower.perimeter)%lower.perimeter;
        // A short roof is pinned at both ends. A long free span can settle onto a deeper course.
        const freeSpan=Math.max(0,Math.min(fromEntry,gap.end-gap.start-fromEntry));
        reach=Math.max(reach,0.10*freeSpan**2/PRINT.beadWidthMm);
      }
      if(reach>0.025){
        const p=sample.clay, floor=contactZ(p,history,reach);
        if(floor<p[2]) sample.clay=[p[0],p[1],floor];
      }
    }
    return sample;
  });
  function boundary(mm:number) {
    const value=wrap(mm), before=interval(positions.length,idx=>positions[idx],value);
    return (value-positions[before] <= positions[before+1]-value ? before : before+1) % (positions.length-1);
  }
  const count=positions.length-1;
  const frames=new Map<number,readonly [BeadFrame,BeadFrame]>();
  const replacements:Ring['replacements']=[];
  if(behavior==='sagging' || behavior==='misalignment')events.forEach((event,slot)=>{
    const firstMove=boundary(event.start), moveCount=(boundary(event.end)-firstMove+count)%count;
    const indices=Array.from({length:moveCount+1},(_,step)=>(firstMove+step)%count);
    const progress=indices.map((idx,step)=>step===0?0:step===moveCount?1:wrap(positions[idx]-event.start)/(event.end-event.start));
    const vertices=indices.map(idx=>samples[idx]);
    if(behavior==='sagging'){
      const anchored=(point:XYZ)=>point[2]-contactZ(point,history,PRINT.beadHeightMm)<=0.25*PRINT.beadHeightMm;
      const anchors=[anchored(vertices[0].command),anchored(vertices.at(-1)!.command)] as const;
      const material=settleFold(vertices,progress,history,amplitude/6.5*strengths[slot],slack*(0.45+0.55*bond.within),maxDrop,anchors);
      replacements.push({firstMove,moveCount,...material});
    }else if(!shifts[slot])return;
    const path=vertices.map(v=>v.clay);
    const section=behavior==='sagging'?foldFrames(path,progress):registrationFrames(path,PRINT.beadWidthMm);
    indices.slice(0,-1).forEach((idx,step)=>frames.set(idx,[section[step],section[step+1]]));
  });
  if(active || history[index-1]?.relief)samples[count]={...samples[0],at:points.length-1};
  const moves=positions.slice(0,-1).map((value,idx)=>{
    const start=samples[idx],end=samples[idx+1], original=base[Math.min(base.length-1,Math.floor((start.at+end.at)/2))];
    const slot=eventAt((value+positions[idx+1])/2);
    const missing=behavior==='gaps' && slot>=0;
    if (behavior!=='sagging' && slot<0 && start.command===original.beadStart && end.command===original.beadEnd && start.clay===start.command && end.clay===end.command && start.width===PRINT.beadWidthMm && end.width===start.width) return original;
    return {...original,start:tip(start.command),end:tip(end.command),beadStart:start.clay,beadEnd:end.clay,
      lengthMm:distance(start.command,end.command),extrude:!missing,beadWidthMm:missing?0:start.width,beadEndWidthMm:missing?0:end.width,
      ...(behavior==='buldges' && slot>=0?{flowMultiplier:(start.width+end.width)/(2*PRINT.beadWidthMm)}:{}),
      ...(behavior==='sagging' && slot>=0?{flowMultiplier:replacements[slot].budget/replacements[slot].nozzleLength}:{}),
      ...(frames.has(idx)?{beadFrames:frames.get(idx)}:{}),
      sourceType:slot>=0?behavior:'stable',eventId:slot>=0?slot+1:null};
  });
  const wrapped=replacements.find(span=>span.firstMove+span.moveCount>moves.length);
  const printStart=wrapped ? (wrapped.firstMove+moves.length-1)%moves.length : 0;
  const relief=moves.some(move=>!move.extrude || move.end[2]-PRINT.nozzleAboveBeadCentreMm-move.beadEnd[2]>0.025);
  return {samples,moves,events,cellCount:(behavior==='stable'?4:eventCount)*bond.cells,perimeter,key,replacements,printStart,relief,shiftMm:Math.max(0,...shifts),shiftUnverified};
}

export function saggingTrace(ring:Ring, layerId:number, eventIndex:number) {
  const {firstMove,moveCount}=ring.replacements[eventIndex], event=ring.events[eventIndex];
  const moves=Array.from({length:moveCount},(_,step)=>ring.moves[(firstMove+step)%ring.moves.length]);
  const command=[moves[0].start,...moves.map(move=>move.end)];
  const deposited=[moves[0].beadStart,...moves.map(move=>move.beadEnd)];
  const {arc,points,perimeter}=sources[layerId-1];
  const inside=arc.slice(0,-1).map((mm,idx)=>({along:(mm-event.start+perimeter)%perimeter,point:points[idx]}))
    .filter(({along})=>along>1e-9 && along<event.end-event.start-1e-9).sort((left,right)=>left.along-right.along);
  const baselinePoint=(mm:number)=>{
    const value=mm%perimeter, pos=interval(arc.length,idx=>arc[idx],value);
    return blend(points[pos],points[pos+1],(value-arc[pos])/(arc[pos+1]-arc[pos]));
  };
  const base=[baselinePoint(event.start),...inside.map(vertex=>vertex.point),baselinePoint(event.end)];
  return {base,command,deposited};
}

export function isolatedSagMoves(ring:Ring, eventIndex:number) {
  const {firstMove,moveCount}=ring.replacements[eventIndex], count=ring.moves.length;
  const at=(offset:number)=>ring.moves[(firstMove+offset+count)%count];
  const span=Array.from({length:moveCount},(_,step)=>at(step));
  for(let step=1;step<=2 && at(-step).sourceType==='stable';step++) span.unshift(at(-step));
  for(let step=0;step<2 && at(moveCount+step).sourceType==='stable';step++) span.push(at(moveCount+step));
  return span;
}
type Previous = {rings:Ring[]; layers:{renderMoves:Move[]}[]};
const initialConfig=defaultConfig();
export function mapAnnualVase(input:unknown, tuning:unknown=initialConfig, manual?:Failure, previous?:Previous) {
  const wallLayers=contours.length-FORM.bottomLayers;
  const data=readDataset(input,wallLayers);
  const config=tuning && typeof tuning==='object' && 'schemaVersion' in tuning ? validateConfig(tuning) : defaultConfig(tuning as typeof defaults);
  const bands=data.items.map((item,index)=>{
    const params=scoreParams(item.score,config,manual);
    return {...item,...params,first:FORM.bottomLayers+1+Math.floor(index*wallLayers/data.items.length),last:FORM.bottomLayers+Math.floor((index+1)*wallLayers/data.items.length)};
  });
  const baseBand={id:'Solid base',score:0,...scoreParams(0,config),first:1,last:FORM.bottomLayers};
  const coherence=config.simulationSettings.coherenceLayers??DEFAULT_COHERENCE;
  // Equal effective settings share a course, even when the data assigns it to two items.
  const settings=bands.map(b=>[b.behavior,b.eventCount,b.coverage,b.amplitude,b.score].join('/'));
  const changes=bands.slice(1).flatMap((b,i)=>b.behavior!==bands[i].behavior || b.eventCount!==bands[i].eventCount?[b.first-0.5]:[]);
  const rings:Ring[]=[], moves:Move[]=[], layerEndTimes:number[]=[];
  let time=0,lengthMm=0,depositedLengthMm=0,bandIndex=0,dirtyBelow=false,boundaryIndex=0;
  const layers=contours.map(({layerId},index)=>{
    if (layerId>bands[bandIndex].last) bandIndex++;
    const isBase=layerId<=FORM.bottomLayers;
    const band=isBase?baseBand:bands[bandIndex], phase=band.behavior==='stable'?0:config.patternSettings[band.behavior].phase;
    const {slack=FOLD_DEFAULTS.slack,variation=FOLD_DEFAULTS.variation}=config.patternSettings.sagging;
    if(layerId>(changes[boundaryIndex]??Infinity))boundaryIndex++;
    const proximity=Math.min(layerId-(changes[boundaryIndex-1]??-Infinity),(changes[boundaryIndex]??Infinity)-layerId);
    const edge=smooth(Math.min(1,proximity/3));
    const key=band.behavior==='stable'?'stable/'+band.score:[settings[bandIndex],phase,config.seed,coherence,edge,band.behavior==='sagging'?[config.simulationSettings.maxDropMm,slack,variation].join(':'):0].join('/');
    const old=previous?.rings[index], lower=rings.at(-1);
    const supportChanged=dirtyBelow && (band.behavior==='sagging' || band.behavior==='misalignment' || lower?.relief || previous?.rings[index-1]?.relief);
    const ring=old?.key===key && !supportChanged ? old : buildRing(index,band,phase,config.seed,rings,config.simulationSettings.maxDropMm,key,slack,band.behavior==='sagging'?variation:0.75,coherence,edge);
    if(isBase)ring.supportMoves=templates[index];
    rings.push(ring);
    let renderMoves=previous?.layers[index].renderMoves;
    if(isBase)renderMoves=templates[index];
    else if (!renderMoves || ring!==old || lower!==previous?.rings[index-1]) {
      const first=ring.samples[ring.printStart], last=ring.printStart ? first : ring.samples.at(-1)!;
      const connect=(source:Move,start:XYZ,end:XYZ,clayStart:XYZ,clayEnd:XYZ):Move=>
        distance(start,source.start)<1e-12 && distance(end,source.end)<1e-12 && distance(clayStart,source.beadStart)<1e-12 && distance(clayEnd,source.beadEnd)<1e-12 ? source :
          {...source,start,end,beadStart:clayStart,beadEnd:clayEnd,lengthMm:distance(start,end)};
      const entry=templates[index][0], prev=lower?.samples[lower.printStart || lower.samples.length-1];
      const join=connect(entry,prev?tip(prev.command):entry.start,tip(first.command),prev?.clay??entry.beadStart,first.clay);
      const seamInterrupted=lower && (!ring.moves[0].extrude || !ring.moves.at(-1)!.extrude || !lower.moves.at(-1)!.extrude || !lower.moves[0].extrude);
      const settledSeam=prev && (prev.clay[2]!==prev.command[2] || first.clay[2]!==first.command[2]);
      const relocate=lower && (seamInterrupted || settledSeam || ring.printStart!==0 || lower.printStart!==0);
      const ordered=ring.printStart ? [...ring.moves.slice(ring.printStart),...ring.moves.slice(0,ring.printStart)] : ring.moves;
      renderMoves=[relocate ? {...join,kind:'travel',extrude:false,feedrateMmMin:PRINT.travelFeedrateMmMin} : join,...ordered];
      if(index===contours.length-1) {
        const lift=templates[index].at(-1)!;
        renderMoves.push(connect(lift,tip(last.command),lift.end,last.clay,lift.beadEnd));
      }
    }
    for(const move of renderMoves) {
      const endTimeS=time+move.lengthMm*60/move.feedrateMmMin;
      moves.push(move.startTimeS===time && move.endTimeS===endTimeS ? move : {...move,startTimeS:time,endTimeS});
      time=endTimeS; lengthMm+=move.lengthMm; if(move.extrude) depositedLengthMm+=move.lengthMm;
    }
    layerEndTimes.push(moves[ moves.length-(index===contours.length-1?2:1)].endTimeS);
    dirtyBelow ||= ring!==old;
    return {layerId,band,bandIndex:isBase?-1:bandIndex,events:ring.events,perimeter:ring.perimeter,renderMoves};
  });
  const path:Toolpath={...baseline,moves,lengthMm,depositedLengthMm,durationS:time,layerEndTimes};
  return {data,bands,layers,rings,path};
}
