import test from 'node:test'; import assert from 'node:assert/strict';
import { parseReference } from '../src/lib/normalization.js';

test('outdoor validation inputs parse family deterministically',()=>{
 const cases=[['BGP702 LED90/730 DX10P LGR 7035 SRG10 42','BGP702'],['BVP656 LED400-4S/730 PSU II A35-MB GR','BVP656'],['BDS670 LED50/730 MDA BK SRT SRG10 60P','BDS670'],['BDS670 LED40/730 MDM BK SRT SRG10 60P','BDS670']];
 for(const [q,f] of cases) assert.equal(parseReference(q).family,f);
});
