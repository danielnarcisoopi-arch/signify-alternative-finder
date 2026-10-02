import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCatalogEngine, catalogStats } from '../src/lib/public-catalog-engine.js';
const cases=[
 ['BGP702 LED90/730 DX10P LGR 7035 SRG10 42','BGP702I'],
 ['BVP656 LED400-4S/730 PSU II A35-MB GR','BVP656I'],
 ['BDS670 LED50/730 MDA BK SRT SRG10 60P','BDS650I'],
 ['BDS670 LED40/730 MDM BK SRT SRG10 60P','BDS650I'],
 ['DN500B 20S/840 PSU-E WR WH PCO','DN500BI'],
 ['DN610B 40S/930UE PSD-E C WH PGO','DN610BI'],
 ['SM350C 50S/840 PSD PCS L1500 WH','SM350CI'],
];
test('catalog index is populated',()=>{assert.ok(catalogStats().entries>=150)});
for(const [query,expected] of cases)test(`V33 catalog resolver ${query}`,async()=>{const r=await publicCatalogEngine(query);assert.equal(r.status,'OFFICIAL_CONFIGURATOR_IDENTIFIED');assert.equal(r.recommended.configuratorId,expected);assert.equal(r.validation.verified,true);});
