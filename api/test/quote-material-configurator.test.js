import test from 'node:test'; import assert from 'node:assert/strict';
import { QuoteMaterialConfiguratorClient } from '../src/lib/quote-material-configurator.js';
function payload(assignments=[]){ const sel=new Map(assignments.map(a=>[a.variableName,a.valueName])); const v=(id,vals)=>({fullyQualifiedName:id,required:true,valid:true,valueStates:vals.map(x=>({name:x,text:x,state:sel.get(id)===x?4:2}))}); return {materialBomConfiguration:{root:{configuration:{valid:true,complete:assignments.some(a=>a.variableName==='PLM_TRAFO'),hasConflict:false,variableStates:[v('PLM_PFC',['DN500B','DN510B']),v('PLM_LAMPFAM',['11S','20S','30S']),v('PLM_COLLAMP',['830','840','930']),v('PLM_OPTGRP',['C','WR']),v('PLM_CVR',['N','PCO']),v('PLM_TRAFO',['DIA-E','PSD-E','PSU-E'])]}}},bomStatus:{configurationStatus:{valid:true,complete:assignments.some(a=>a.variableName==='PLM_TRAFO'),hasConflict:false}}}; }
test('validates DN500B attributes then changes only control gear using official model domains', async()=>{ const calls=[]; const fetchImpl=async(_u,o)=>{ const b=JSON.parse(o.body); calls.push(b); return {ok:true,json:async()=>payload(b.rootConfiguration.existingAssignments)};}; const c=new QuoteMaterialConfiguratorClient({fetchImpl}); const r=await c.validate({model:'DN500BI',parsed:{family:'DN500B',package:'20S',packageCanonical:'20S',colorCode:'840',features:['WR','PCO'],driver:'PSU-E'},targetControlClass:'DALI'}); assert.equal(r.validated,true); assert.equal(r.selectedControl,'PSD-E'); assert.deepEqual(r.assignments.map(x=>[x.variableName,x.valueName]),[['PLM_PFC','DN500B'],['PLM_LAMPFAM','20S'],['PLM_COLLAMP','840'],['PLM_OPTGRP','WR'],['PLM_CVR','PCO'],['PLM_TRAFO','PSD-E']]); assert.ok(calls.length>=6); });

test('discovers semantic Configit roles when an outdoor model uses different variable ids', async()=>{
  const selected=new Map();
  const fetchImpl=async(_u,o)=>{
    const b=JSON.parse(o.body); selected.clear(); for(const a of b.rootConfiguration.existingAssignments) selected.set(a.variableName,a.valueName);
    const vv=(id,label,vals)=>({fullyQualifiedName:id,required:true,valid:true,valueStates:vals.map(x=>({name:x,text:x,state:selected.get(id)===x?4:2}))});
    const variableStates=[vv('PFCODE','Product Family Code',['BVP656']),vv('LEDFAM','LED family code',['LED400-4S']),vv('LSCOLOR','Light source color',['730']),vv('OPTTYPE','Optic type',['A35-MB']),vv('DRIVERSEL','Driver',['PSU','DALI'])];
    const variableLinks=[['PFCODE','Product Family Code'],['LEDFAM','LED family code'],['LSCOLOR','Light source color'],['OPTTYPE','Optic type'],['DRIVERSEL','Driver']].map(([reference,displayName])=>({reference,displayName}));
    return {ok:true,json:async()=>({materialBomConfiguration:{root:{configuration:{valid:true,complete:selected.has('DRIVERSEL'),hasConflict:false,variableStates,variableLinks}}},bomStatus:{configurationStatus:{valid:true,complete:selected.has('DRIVERSEL'),hasConflict:false}}})};
  };
  const c=new QuoteMaterialConfiguratorClient({fetchImpl});
  const r=await c.validate({model:'ANY_DYNAMIC_MODEL',parsed:{family:'BVP656',package:'LED400-4S',packageCanonical:'LED400-4S',colorCode:'730',features:['A35-MB'],driver:'PSU'},targetControlClass:'DALI'});
  assert.equal(r.validated,true); assert.equal(r.controlVariable,'DRIVERSEL'); assert.equal(r.selectedControl,'DALI');
  assert.deepEqual(r.assignments.map(x=>[x.variableName,x.valueName]),[['PFCODE','BVP656'],['LEDFAM','LED400-4S'],['LSCOLOR','730'],['OPTTYPE','A35-MB'],['DRIVERSEL','DALI']]);
});

test('proves a differently named outdoor configurator by reproducing BDS670 in the model', async()=>{
  const fetchImpl=async(_u,o)=>{
    const b=JSON.parse(o.body); const selected=new Map(b.rootConfiguration.existingAssignments.map(a=>[a.variableName,a.valueName]));
    const vv=(id,label,vals)=>({fullyQualifiedName:id,required:true,valid:true,valueStates:vals.map(([name,text=name])=>({name,text,state:selected.get(id)===name?4:2}))});
    const variableStates=[
      vv('FAM','Product Family Code',[['BDS670','BDS670 City family']]),
      vv('LEDS','LED family code',[['LED40','LED40']]),
      vv('CCT','Light source color',[['730','730']]),
      vv('OPT','Optic type',[['MDM','MDM optic']]),
      vv('BODY','Housing colour',[['BK','BK black']]),
      vv('MOUNT','Mounting',[['SRT','SRT mounting']]),
      vv('SOCKET','Socket',[['SRG10','SRG10 socket']]),
      vv('POLE','Pole interface',[['60P','60P interface']]),
      vv('GEAR','Driver',[['PSU','Fixed output'],['PSD','DALI driver']]),
    ];
    const variableLinks=variableStates.map(v=>({reference:v.fullyQualifiedName,displayName:{FAM:'Product Family Code',LEDS:'LED family code',CCT:'Light source color',OPT:'Optic type',BODY:'Housing colour',MOUNT:'Mounting',SOCKET:'Socket',POLE:'Pole interface',GEAR:'Driver'}[v.fullyQualifiedName]}));
    return {ok:true,json:async()=>({materialBomConfiguration:{root:{configuration:{valid:true,complete:selected.has('GEAR'),hasConflict:false,variableStates,variableLinks}}},bomStatus:{configurationStatus:{valid:true,complete:selected.has('GEAR'),hasConflict:false}}})};
  };
  const c=new QuoteMaterialConfiguratorClient({fetchImpl});
  const r=await c.validate({model:'BDS650N',parsed:{family:'BDS670',package:'LED40',packageCanonical:'40',colorCode:'730',features:['MDM','BK','SRT','SRG10','60P'],driver:''},targetControlClass:'DALI'});
  assert.equal(r.validated,true); assert.equal(r.familyProven,true); assert.equal(r.selectedControl,'PSD'); assert.equal(r.unresolved.length,0);
  assert.ok(r.assignments.some(a=>a.variableName==='FAM'&&a.valueName==='BDS670'));
});
