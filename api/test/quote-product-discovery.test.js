import test from 'node:test'; import assert from 'node:assert/strict';
import { QuoteProductDiscoveryClient } from '../src/lib/quote-product-discovery.js';
function response(body){return {ok:true,status:200,json:async()=>body};}
test('discovers exact-family configurable material from Quote without family+I rule',async()=>{
 const calls=[]; const fetchImpl=async u=>{calls.push(String(u));return response({results:[{familyCode:'BDS670',configurableMaterialName:'BDS650N'}]});};
 const c=new QuoteProductDiscoveryClient({fetchImpl}); const r=await c.discover('BDS670'); assert.equal(r.candidates[0].id,'BDS650N'); assert.ok(calls.some(x=>x.includes('query=BDS670'))); assert.ok(calls.some(x=>x.includes('configurable=true')));
});
test('prioritizes exact family configurator when Quote exposes it',async()=>{
 const fetchImpl=async()=>response({results:[{configurableMaterialName:'BGP702I'},{configurableMaterialName:'BGP730I'}]});
 const r=await new QuoteProductDiscoveryClient({fetchImpl}).discover('BGP702'); assert.equal(r.candidates[0].id,'BGP702I');
});
