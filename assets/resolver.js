const CONTROL = new Set(['PSU','PSU-E','PSD','PSD-E','DIA','DIA-E','WIA','WIA-E','PSE','PSE-E','PSED','PSED-E','SIA','SEIA','DALI','D9']);
export function norm(s){return String(s||'').toUpperCase().replace(/[–—]/g,'-').replace(/\/UE(?=\d)/g,'/').replace(/[^A-Z0-9/_.-]+/g,' ').replace(/\s+/g,' ').trim()}
export function familyOf(q){const n=norm(q); const m=n.match(/\b(?:BGP|BVP|BDS|BDP|BPP|BBP|BSP|DN|SM|WT|BY|RC|ST|LL|VGP|VSP|VDP|BTP|EDP|JGB|SP)\d+[A-Z]*\b/); return m?m[0]:null}
function tokens(s){return norm(s).split(' ').filter(Boolean)}
function controlOf(s){return tokens(s).find(t=>CONTROL.has(t))||null}
function oppositeWanted(c){if(!c)return null; if(c.startsWith('PSU')||c.startsWith('PSE')) return 'DALI'; return 'ON_OFF'}
function techTokens(s){return tokens(s).filter(t=>!CONTROL.has(t) && !/^\d+[,.]?\d*$/.test(t) && !/^[0-9]+[.,][0-9]+$/.test(t))}
function skuScore(query, desc){const q=techTokens(query), d=new Set(techTokens(desc)); let hit=0, denom=0; for(const t of q){let w=1; if(/^(?:BGP|BVP|BDS|DN|SM|WT|BY|RC|ST|LL)\d/.test(t))w=8; else if(t.includes('/'))w=4; else if(/^(?:L\d+|W\d+|IP\d+|UGR\d+|NB|WB|WR|PCO|PCC|SRT|SRB)$/.test(t))w=3; denom+=w; if(d.has(t))hit+=w;} return denom?hit/denom:0}
export function resolve(query,index){
 const input=norm(query), family=familyOf(input), inputControl=controlOf(input), wanted=oppositeWanted(inputControl);
 if(!family) return {status:'REFERENCE_NOT_RECOGNIZED',input,message:'Não foi possível identificar o código de família.'};
 const rel=index.relationships.find(x=>x.family===family)||null;
 // exact/opposite commercial products from catalog price tables
 const candidates=index.skus.filter(x=>familyOf(x.description)===family).map(x=>({...x,control:controlOf(x.description),score:skuScore(input,x.description)}));
 let filtered=candidates;
 if(wanted==='DALI') filtered=candidates.filter(x=>x.control && !x.control.startsWith('PSU') && !x.control.startsWith('PSE'));
 if(wanted==='ON_OFF') filtered=candidates.filter(x=>x.control && (x.control.startsWith('PSU')||x.control.startsWith('PSE')));
 filtered.sort((a,b)=>b.score-a.score);
 const best=filtered[0];
 if(best && best.score>=0.88){return {status:'CONFIRMED_PRODUCT',input,family,inputControl,wanted,alternative:best.description,eoc:best.eoc,page:best.page,score:best.score,configurator:rel?.configurator||null,relationshipPage:rel?.page||null,evidence:'Catálogo 2026 - tabela de produtos/EOC'}}
 if(rel){return {status:'OFFICIAL_CONFIGURATOR',input,family,inputControl,wanted,configurator:rel.configurator,page:rel.page,evidence:rel.evidence,message:'O catálogo confirma o configurador da família. A combinação completa não é declarada como SKU nesta base, por isso não é inventada.'}}
 return {status:'NO_VERIFIED_ALTERNATIVE',input,family,inputControl,wanted,message:'Família identificada, mas o catálogo indexado não contém relação de configurador nem SKU alternativo suficientemente próximo.'}
}
