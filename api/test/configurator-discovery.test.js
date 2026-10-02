import test from 'node:test'; import assert from 'node:assert/strict';
import { createProduct } from '../src/lib/product-api.js';

test('accepts explicit configurable material whose code is not family+I', ()=>{
  const p=createProduct({description:'BDS670 LED40/730 MDM BK SRT SRG10 60P',configurableMaterialName:'BDS650N'});
  assert.equal(p.configuratorId,'BDS650N');
});
