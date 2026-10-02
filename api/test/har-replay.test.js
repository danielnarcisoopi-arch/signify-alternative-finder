import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QuoteProductDiscoveryClient } from '../src/lib/quote-product-discovery.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/quote-har-replay.json',import.meta.url),'utf8'));
function replayFetch(){
  return async (url)=>{
    const body=fixture[String(url)];
    if(!body) return {ok:false,status:599,json:async()=>({})};
    return {ok:true,status:200,json:async()=>body};
  };
}

test('HAR replay: BGP702 exact family discovers BGP702I', async()=>{
  const c=new QuoteProductDiscoveryClient({fetchImpl:replayFetch()});
  const r=await c.discover('BGP702');
  assert.equal(r.mode,'EXACT_FAMILY');
  assert.equal(r.candidates[0].id,'BGP702I');
});

test('HAR replay: BDS670 progressive prefix discovers BDS650N at BDS6', async()=>{
  const c=new QuoteProductDiscoveryClient({fetchImpl:replayFetch()});
  const r=await c.discover('BDS670');
  assert.equal(r.mode,'PROGRESSIVE_PREFIX');
  assert.ok(r.candidates.some(x=>x.id==='BDS650N'));
  assert.equal(r.candidates.find(x=>x.id==='BDS650N').query,'BDS6');
});
