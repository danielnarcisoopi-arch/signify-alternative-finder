import {resolve} from './resolver.js';
let index;
const $=s=>document.querySelector(s);
async function load(){index=await fetch('./assets/catalog-index.json').then(r=>r.json()); $('#meta').textContent=`Catálogo ${index.version} · ${index.relationships.length} relações · ${index.skus.length} linhas comerciais indexadas`;}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(r){let badge={CONFIRMED_PRODUCT:'Produto confirmado',OFFICIAL_CONFIGURATOR:'Configurador oficial',NO_VERIFIED_ALTERNATIVE:'Sem alternativa verificada',REFERENCE_NOT_RECOGNIZED:'Referência por rever'}[r.status]||r.status; let h=`<div class="badge ${r.status}">${badge}</div><h2>${esc(r.family||r.input)}</h2>`;
 if(r.status==='CONFIRMED_PRODUCT') h+=`<div class="grid"><div><label>Referência pesquisada</label><p>${esc(r.input)}</p></div><div><label>Alternativa do catálogo</label><p>${esc(r.alternative)}</p><p><b>EOC:</b> ${esc(r.eoc)}</p></div></div><div class="proof">Fonte: Catálogo Signify 2026, pág. ${r.page}. Correspondência técnica ${(r.score*100).toFixed(0)}%.</div>`;
 else if(r.status==='OFFICIAL_CONFIGURATOR') h+=`<div class="grid"><div><label>Referência pesquisada</label><p>${esc(r.input)}</p></div><div><label>Configurador confirmado</label><p class="big">${esc(r.configurator)}</p><p>Família ${esc(r.family)}</p></div></div><div class="proof">Fonte: Catálogo Signify 2026, pág. ${r.page}. ${esc(r.message)}</div>`;
 else h+=`<p>${esc(r.message)}</p>`;
 $('#result').innerHTML=h; $('#result').hidden=false;
}
async function go(){if(!index)await load(); render(resolve($('#q').value,index));}
$('#go').addEventListener('click',go); $('#q').addEventListener('keydown',e=>{if(e.key==='Enter')go()}); load();
