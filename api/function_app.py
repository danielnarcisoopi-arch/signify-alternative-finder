import azure.functions as func
import asyncio, hashlib, json, os, re, time
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse
import httpx
from bs4 import BeautifulSoup
from io import BytesIO
from pypdf import PdfReader

app=func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
VERSION='54'
UA='Mozilla/5.0 (compatible; SignifyAlternativeFinder/54; quotation research)'
CACHE_DIR=Path('/tmp/signify_competitor_cache_v54'); CACHE_DIR.mkdir(exist_ok=True)

# Manufacturer data is configuration only. The crawler/extractor below is shared by every brand.
MANUFACTURERS={
 'OPPLE':{'aliases':['opple'],'domains':['opple.eu','opple.com','opple.pt'],'search_paths':['/en/search?search={q}','/pt-pt/search?search={q}'],'catalogs':['https://www.opple.pt/sites/default/files/2026-03/Product%20Book_PT_APR26.pdf']},
 'LEDVANCE':{'aliases':['ledvance','osram'],'domains':['ledvance.com'],'search_paths':['/consumer/search?query={q}','/professional/search?query={q}']},
 'TRILUX':{'aliases':['trilux'],'domains':['trilux.com'],'search_paths':['/en/search/?q={q}','/search/?q={q}']},
 'ZUMTOBEL':{'aliases':['zumtobel'],'domains':['zumtobel.com'],'search_paths':['/com-en/search.html?query={q}','/search?query={q}']},
 'THORN':{'aliases':['thorn'],'domains':['thornlighting.com'],'search_paths':['/en/search?q={q}']},
 'SCHREDER':{'aliases':['schreder','schréder'],'domains':['schreder.com'],'search_paths':['/en/search?search={q}']},
 'DISANO':{'aliases':['disano'],'domains':['disano.it'],'search_paths':['/en/search?search={q}']},
 'GEWISS':{'aliases':['gewiss'],'domains':['gewiss.com'],'search_paths':['/ww/en/search?q={q}']},
}
OFFICIAL_DOMAINS={k:v['domains'] for k,v in MANUFACTURERS.items()}
OFFICIAL_SOURCE_INDEX={
 'OPPLE':[
  {'aliases':['LEDWP-CLA-P2 L1200-18W-840'],'reference':'LEDWP-CLA-P2 L1200-18W-840','family':'LEDWP-CLA-P2','article_number':'531000013100','url':'https://www.opple.pt/pt-pt/product/luminarias-para-interiores/waterproof-luminaires-0/waterproof-classic-g2/ledwp-cla-p2-l1200-18w-840','datasheet':'','specs':{'power':18,'flux':2700,'eff':150,'cct':4000,'cri':80,'angle':120,'ip':'IP66','ik':'IK08','length':1208,'width':78,'height':72,'mount':'Surface / suspended','control':'On-Off','lifetime':100000,'application':'Indoor / waterproof','type':'Waterproof luminaire'}},
  {'aliases':['LEDWP-CLA-P2 L1500-24W-840'],'reference':'LEDWP-CLA-P2 L1500-24W-840','family':'LEDWP-CLA-P2','article_number':'531000013300','url':'https://www.opple.pt/en/product/indoor/waterproof-luminaires/waterproof-classic-g2/ledwp-cla-p2-l1500-24w-840','datasheet':'','specs':{'power':24,'flux':3600,'eff':150,'cct':4000,'cri':80,'angle':120,'ip':'IP66','ik':'IK08','length':1508,'width':78,'height':72,'mount':'Surface / suspended','control':'On-Off','lifetime':100000,'application':'Indoor / waterproof','type':'Waterproof luminaire'}},
  {'aliases':['LEDPorch-E2-Re120-3/5W-840','LEDPorch-E2-Re120-3/5W-830/840'],'reference':'LEDPorch-E2-Re120-3/5W-830/840','family':'LEDPorch-E2-Re120','article_number':'531000019500','url':'https://www.opple.pt/pt-pt/product/luminarias-para-exteriores/wall-and-ceiling-luminaires/plafond-porch-ip65-ecomax-g2/ledporch-e2-re120-35w-830840','datasheet':'','specs':{'power':5,'flux':600,'eff':120,'cct':4000,'cri':80,'angle':120,'ip':'IP65','ik':'IK10','length':345,'width':123,'height':82.5,'mount':'Surface wall / ceiling','control':'On-Off','lifetime':70000,'application':'Outdoor / wall-ceiling','type':'Wall / ceiling luminaire'}},
  {'aliases':['LED PostTop-P 50W-3000-W','LEDPostTop-P 50W-3000-W'],'reference':'LEDPostTop-P 50W-3000-W','family':'LEDPostTop-P','article_number':'543016006100','url':'https://www.opple.eu/en/product/outdoor/urban/post-top/ledposttop-p-50w-3000-w','datasheet':'','specs':{'power':50,'flux':6500,'eff':130,'cct':3000,'cri':70,'angle':155,'ip':'IP66','ik':'IK08','length':450,'width':450,'height':565,'pole':60,'mount':'Post top','control':'On-Off','lifetime':100000,'application':'Outdoor / urban','type':'Post-top luminaire'}},
  {'aliases':['LEDFlood-E3 Re115-20W-840-BL','LEDFlood-E3-Re115-20W-840-BL'],'reference':'LEDFlood-E3 Re115-20W-840-BL','family':'LEDFlood-E3','article_number':'709000071800','url':'https://www.opple.pt/pt-pt/product/luminarias-para-exteriores/floodlight/floodlight-ecomax-g3','datasheet':'','specs':{'power':20,'flux':2400,'eff':120,'cct':4000,'cri':80,'application':'Outdoor / floodlight','type':'Floodlight'}}
 ]
}

def indexed_product(parsed,brand):
 target=compact(parsed.get('reference'))
 if not target:return None
 best=None;bestscore=0
 for row in OFFICIAL_SOURCE_INDEX.get(brand,[]):
  for a in row.get('aliases',[]):
   ca=compact(a)
   score=100 if target==ca else (92 if target in ca or ca in target else 0)
   if score>bestscore:best,bestscore=row,score
 if not best or bestscore<90:return None
 specs=user_evidence(parsed)
 for k,v in best.get('specs',{}).items():
  ev={'value':v,'source':best['url'],'evidence_type':'official_product_page','confidence':'HIGH'}
  old=specs.get(k)
  if not old or str(old.get('value')).lower()==str(v).lower():specs[k]=ev
 return {'manufacturer':brand,'reference':best['reference'],'family':best['family'],'article_number':best.get('article_number'),'status':'OFFICIAL SOURCE VERIFIED','exact_match':True,'page_type':'PRODUCT_PAGE','official_product_url':best['url'],'official_datasheet_url':best.get('datasheet',''),'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'specs':specs,'conflicts':[],'sources':[{'url':best['url'],'type':'official_product_page','official':True,'cached_verified_source':True}]}

EXPECTED_FIELDS=['application','type','power','flux','eff','cct','cri','optics','angle','ip','ik','length','width','height','diameter','pole','mount','control','voltage','lifetime','emergency','controls']
LABELS={
 'power':['power','wattage','system power','input power','potência','potencia','leistung'],
 'flux':['luminous flux','lumen output','lumens','flux','fluxo luminoso','lichtstrom'],
 'eff':['luminous efficacy','efficacy','lm/w','eficiência','efficiency'],
 'cct':['colour temperature','color temperature','cct','temperatura de cor','farbtemperatur'],
 'cri':['cri','colour rendering index','color rendering index','ra','índice de restituição cromática'],
 'angle':['beam angle','ângulo de abertura','beam','abstrahlwinkel'],
 'ip':['ip rating','ingress protection','ip class','grau de proteção','protection class'],
 'ik':['ik rating','impact resistance','ik class','resistência ao impacto'],
 'voltage':['voltage','input voltage','nominal voltage','tensão','spannung'],
 'lifetime':['lifetime','rated life','service life','vida útil','lifetime l70','lifetime l80'],
 'mount':['mounting','installation','mounting type','instalação','montage'],
 'control':['dimming','dimmable','control gear','driver','regulação','control'],
 'dimensions':['dimensions','dimension','size','dimensões','abmessungen'],
 'colour':['housing colour','housing color','colour','color','cor'],
 'optics':['optics','light distribution','distribution','ótica','optic'],
 'emergency':['emergency','emergency lighting','emergência'],
 'controls':['sensor','controls','control system','sensor/control'],
}

def norm(s):
 return re.sub(r'\s+',' ',re.sub(r'[–—_]+','-',str(s or '').strip())).strip()

def compact(s): return re.sub(r'[^a-z0-9]+','',norm(s).lower())
def numeric(v):
 if v is None:return None
 m=re.search(r'-?\d+(?:[.,]\d+)?',str(v).replace(' ',''))
 return float(m.group().replace(',','.')) if m else None

def explicit_manufacturer(q):
 low=norm(q).lower()
 for brand,cfg in MANUFACTURERS.items():
  if any(re.search(r'\b'+re.escape(a)+r'\b',low) for a in cfg['aliases']): return brand
 return None

def strip_manufacturer(q):
 x=norm(q)
 aliases=sorted({a for c in MANUFACTURERS.values() for a in c['aliases']},key=len,reverse=True)
 x=re.sub(r'\b(?:da|do|de|by|marca|fabricante)?\s*(?:'+ '|'.join(map(re.escape,aliases)) +r')\b',' ',x,flags=re.I)
 x=re.sub(r'\b(?:ou\s+equivalente|or\s+equivalent)\b.*$',' ',x,flags=re.I)
 return norm(x).strip(' -:;,.')

def extract_reference(q):
 x=strip_manufacturer(q)
 # Remove common RFQ prose before a likely product token.
 starters=[r'LED[A-Z0-9][A-Z0-9/_-]*',r'[A-Z]{2,6}\d{2,}[A-Z0-9/_-]*']
 starts=[]
 for p in starters:
  m=re.search(p,x,re.I)
  if m: starts.append(m.start())
 if starts and min(starts)>0:x=x[min(starts):]
 # Stop at common prose boundaries, not at technical words.
 x=re.split(r'\s+(?:para\s+(?:aplica|instala|montag)|destinad[oa]|fornecimento|incluindo|com\s+fornecimento)\w*\b',x,1,flags=re.I)[0]
 return norm(x).strip(' -:;,.')

def parse_input(q,brand=None):
 ref=extract_reference(q)
 def one(p):
  m=re.search(p,ref,re.I); return m.group(1) if m else None
 # power supports 3/5W; preserve min/max and nominal nearest literal first
 powers=[]
 for a,b in re.findall(r'(?<!\d)(\d+(?:[.,]\d+)?)\s*/\s*(\d+(?:[.,]\d+)?)\s*W\b',ref,re.I): powers += [float(a.replace(',','.')),float(b.replace(',','.'))]
 for a in re.findall(r'(?<![/\d])(\d+(?:[.,]\d+)?)\s*W\b',ref,re.I): powers.append(float(a.replace(',','.')))
 ccts=[]
 for c in re.findall(r'(?<!\d)([2-6]\d{3})\s*K?\b',ref,re.I):
  n=int(c)
  if 1800<=n<=6500:ccts.append(n)
 for code in re.findall(r'(?<!\d)(8[237456][0-9])\b',ref):
  ccts.append(int(code[-2:])*100)
 # e.g. 830/840 means 3000/4000
 for a,b in re.findall(r'\b(8\d{2})\s*/\s*(8\d{2})\b',ref): ccts += [int(a[-2:])*100,int(b[-2:])*100]
 length=one(r'\bL\s*(600|900|1200|1500|1800)\b')
 ip=one(r'\bIP\s*(\d{2})\b'); ik=one(r'\bIK\s*(\d{2})\b')
 family=re.split(r'\s+',ref)[0] if ref else ''
 return {'raw':q,'manufacturer':brand,'reference':ref,'family':family,'power_values':sorted(set(powers)),'power':powers[0] if powers else None,'cct_values':sorted(set(ccts)),'cct':ccts[-1] if ccts else None,'length_nominal':float(length) if length else None,'ip':ip,'ik':ik}

def progressive_refs(parsed):
 r=parsed['reference']; out=[r]
 # canonical separators and selectable-CCT variants
 out += [r.replace('_','-'), re.sub(r'\s*[-/]\s*','-',r)]
 if re.search(r'(?<!\d)840(?!\d)',r): out.append(re.sub(r'(?<!\d)840(?!\d)','830/840',r))
 # progressively remove weak tail tokens while preserving family + key technical tokens
 toks=r.split()
 for n in range(len(toks)-1,max(0,len(toks)-4),-1): out.append(' '.join(toks[:n]))
 fam=parsed.get('family')
 if fam:
  out.append(fam)
  if parsed.get('power') is not None: out.append(f"{fam} {parsed['power']:g}W")
  if parsed.get('cct') is not None: out.append(f"{fam} {int(parsed['cct'])}K")
  if parsed.get('length_nominal'): out.append(f"{fam} L{int(parsed['length_nominal'])}")
 return list(dict.fromkeys(norm(x) for x in out if x and len(norm(x))>2))

def search_queries(parsed,brand=None):
 refs=progressive_refs(parsed); qs=[]
 for r in refs[:7]:
  qs += [f'"{r}"',r]
  if brand: qs += [f'"{r}" {brand}']
 if brand:
  for d in MANUFACTURERS[brand]['domains']:
   for r in refs[:4]:qs.append(f'site:{d} "{r}"')
 return list(dict.fromkeys(qs))

def host_brand(url):
 h=urlparse(url).netloc.lower().split(':')[0]
 for brand,cfg in MANUFACTURERS.items():
  if any(h==d or h.endswith('.'+d) for d in cfg['domains']):return brand
 return None

def official(url,brand=None):
 b=host_brand(url); return bool(b and (not brand or b==brand))

def cache_file(q):return CACHE_DIR/(hashlib.sha256(norm(q).lower().encode()).hexdigest()+'.json')
def cache_get(q):
 p=cache_file(q)
 if p.exists() and time.time()-p.stat().st_mtime<86400:
  try:return json.loads(p.read_text('utf-8'))
  except:pass
 return None
def cache_put(q,d):cache_file(q).write_text(json.dumps(d,ensure_ascii=False,indent=2),'utf-8')

def user_evidence(parsed):
 s={}
 if parsed.get('power') is not None:s['power']={'value':parsed['power'],'source':'USER_INPUT','evidence_type':'user_input','confidence':'HIGH'}
 if parsed.get('cct') is not None:s['cct']={'value':parsed['cct'],'source':'USER_INPUT','evidence_type':'user_input','confidence':'HIGH'}
 if parsed.get('ip'):s['ip']={'value':'IP'+parsed['ip'],'source':'USER_INPUT','evidence_type':'user_input','confidence':'HIGH'}
 if parsed.get('ik'):s['ik']={'value':'IK'+parsed['ik'],'source':'USER_INPUT','evidence_type':'user_input','confidence':'HIGH'}
 if parsed.get('length_nominal'):s['length_nominal']={'value':parsed['length_nominal'],'source':'USER_INPUT','evidence_type':'user_input','confidence':'HIGH'}
 return s

async def fetch(url):
 async with httpx.AsyncClient(timeout=7,follow_redirects=True,headers={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8'}) as c:
  r=await c.get(url); return str(r.url),r.status_code,r.headers.get('content-type',''),r.content

async def brave_search(query):
 key=os.getenv('BRAVE_SEARCH_API_KEY')
 if not key:return []
 async with httpx.AsyncClient(timeout=12,headers={'X-Subscription-Token':key,'Accept':'application/json','User-Agent':UA}) as c:
  r=await c.get('https://api.search.brave.com/res/v1/web/search',params={'q':query,'count':12});r.raise_for_status()
  return [x.get('url') for x in r.json().get('web',{}).get('results',[]) if x.get('url')]

def official_search_urls(parsed,brand):
 cfg=MANUFACTURERS[brand]; refs=progressive_refs(parsed); out=[]
 for domain in cfg['domains']:
  for path in cfg['search_paths']:
   for r in refs[:5]:out.append('https://'+domain+path.format(q=quote(r)))
 return out

def text_tokens(parsed):
 vals=[parsed.get('family') or '']
 if parsed.get('power') is not None:vals.append(f"{parsed['power']:g}w")
 if parsed.get('cct') is not None:vals += [str(int(parsed['cct'])), '8'+str(int(parsed['cct']//100)).zfill(2)]
 if parsed.get('length_nominal'):vals.append(str(int(parsed['length_nominal'])))
 return [compact(x) for x in vals if x]

def page_classifier(url,content,ctype,parsed):
 path=urlparse(url).path.lower(); lowurl=url.lower()
 if 'pdf' in ctype.lower() or path.endswith('.pdf'):return {'type':'DATASHEET','score':100,'signals':['pdf']}
 try:soup=BeautifulSoup(content,'html.parser')
 except:return {'type':'IRRELEVANT','score':0,'signals':['parse-error']}
 title=soup.title.get_text(' ',strip=True) if soup.title else ''
 text=' '.join(soup.stripped_strings)[:350000]; low=text.lower(); signals=[];score=0
 if re.search(r'\b(search\s*results?|searchresults)\b',title,re.I) or '/search' in path:return {'type':'SEARCH_PAGE','score':0,'signals':['search']}
 if re.search(r'\b(downloads?|products?|product range|catalogue|catalog)\b',title,re.I) and not any(x in low for x in ['product code','technical data','technical specifications']):return {'type':'CATEGORY_PAGE','score':5,'signals':['generic-category']}
 cref=compact(parsed['reference']); ctext=compact(text); cpath=compact(path)
 if cref and (cref in ctext or cref in cpath):signals.append('exact-reference');score+=45
 fam=compact(parsed.get('family'))
 if fam and (fam in ctext or fam in cpath):signals.append('family');score+=12
 # product evidence signals
 checks=[('product code',15),('article number',15),('technical specifications',15),('technical data',15),('luminous flux',8),('power',6),('wattage',6),('colour temperature',6),('color temperature',6),('ip rating',5),('downloads',3),('datasheet',5)]
 for term,w in checks:
  if term in low:signals.append(term);score+=w
 # technical input tokens improve variant confidence
 for tok in text_tokens(parsed):
  if tok and tok in ctext:score+=4;signals.append('token:'+tok)
 productish=('/product/' in path or '/products/' in path or 'product code' in low or 'article number' in low)
 if productish and score>=42 and ('exact-reference' in signals or len(signals)>=5):return {'type':'PRODUCT_PAGE','score':min(100,score),'signals':signals}
 if productish:return {'type':'CATEGORY_PAGE','score':score,'signals':signals}
 return {'type':'IRRELEVANT','score':score,'signals':signals}

def relevant_links(base,content,parsed,brand):
 try:soup=BeautifulSoup(content,'html.parser')
 except:return []
 out=[]; fam=compact(parsed.get('family')); cref=compact(parsed.get('reference')); toks=text_tokens(parsed)
 for a in soup.find_all('a',href=True):
  href=urljoin(base,a['href']);
  if not official(href,brand):continue
  blob=compact(' '.join(a.stripped_strings)+' '+a['href']);score=0
  if cref and cref in blob:score+=20
  if fam and fam in blob:score+=8
  for t in toks:
   if t and t in blob:score+=3
  if re.search(r'\.pdf(?:$|\?)',href,re.I):score+=4
  if '/product' in href.lower():score+=2
  if score>=6:out.append((score,href))
 return [u for _,u in sorted(out,reverse=True)[:25]]

def parse_pairs(soup):
 pairs=[]
 for tr in soup.find_all('tr'):
  cells=[' '.join(c.stripped_strings) for c in tr.find_all(['th','td'])]
  if len(cells)>=2:pairs.append((cells[0], ' '.join(cells[1:])))
 for dl in soup.find_all('dl'):
  dts=dl.find_all('dt');dds=dl.find_all('dd')
  for a,b in zip(dts,dds):pairs.append((' '.join(a.stripped_strings),' '.join(b.stripped_strings)))
 # common label/value divs
 for el in soup.find_all(['li','p','div']):
  t=' '.join(el.stripped_strings)
  if ':' in t and len(t)<220:
   a,b=t.split(':',1);pairs.append((a.strip(),b.strip()))
 return pairs

def field_for_label(label):
 l=label.lower().strip()
 best=None
 for k,aliases in LABELS.items():
  for a in aliases:
   if a in l:
    if best is None or len(a)>best[0]:best=(len(a),k)
 return best[1] if best else None

def normalize_field(k,v):
 if not v:return None
 if k in ['power','flux','eff','cct','cri','angle','length','width','height','diameter','pole','lifetime']:
  return numeric(v)
 if k=='ip':
  m=re.search(r'IP\s*(\d{2})',v,re.I);return 'IP'+m.group(1) if m else None
 if k=='ik':
  m=re.search(r'IK\s*(\d{2})',v,re.I);return 'IK'+m.group(1) if m else None
 return norm(v)[:180]

def extract_dimensions(text):
 # Accept 1210 x 78 x 72 mm and map largest->length, remaining->width/height in order.
 m=re.search(r'(\d{2,5}(?:[.,]\d+)?)\s*[x×]\s*(\d{2,5}(?:[.,]\d+)?)\s*[x×]\s*(\d{2,5}(?:[.,]\d+)?)\s*mm',text,re.I)
 if not m:return {}
 a=[float(x.replace(',','.')) for x in m.groups()];return {'length':a[0],'width':a[1],'height':a[2]}

def extract_product(url,content,parsed,brand,page_type='PRODUCT_PAGE'):
 soup=BeautifulSoup(content,'html.parser');text='\n'.join(soup.stripped_strings)
 title=soup.find('h1').get_text(' ',strip=True) if soup.find('h1') else (soup.title.get_text(' ',strip=True) if soup.title else parsed['reference'])
 specs=user_evidence(parsed); conflicts=[]
 # JSON-LD often contains exact product name/model/sku.
 article=None
 for sc in soup.find_all('script',type='application/ld+json'):
  try:
   obj=json.loads(sc.string or '{}'); objs=obj if isinstance(obj,list) else [obj]
   for o in objs:
    if isinstance(o,dict):
     article=article or o.get('sku') or o.get('mpn') or o.get('productID')
     if o.get('name') and compact(parsed['family']) in compact(o.get('name')):title=o.get('name')
  except:pass
 for label,val in parse_pairs(soup):
  k=field_for_label(label)
  if not k:continue
  nv=normalize_field(k,val)
  if nv is None:continue
  old=specs.get(k)
  ev={'value':nv,'source':url,'evidence_type':'official_product_page','confidence':'HIGH'}
  if old and old['value']!=nv and old['source']!='USER_INPUT':conflicts.append({'field':k,'values':[old,ev]})
  # Official source confirms/overrides USER_INPUT only when same; conflicts remain explicit.
  if old and old['source']=='USER_INPUT' and str(old['value']).lower()!=str(nv).lower():conflicts.append({'field':k,'values':[old,ev]})
  else:specs[k]=ev
 for k,v in extract_dimensions(text).items():
  if k not in specs:specs[k]={'value':v,'source':url,'evidence_type':'official_product_page','confidence':'HIGH'}
 # robust fallbacks over full text
 patterns={
  'power':r'(?i)(?:power|wattage|pot[eê]ncia)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*W',
  'flux':r'(?i)(?:luminous flux|fluxo luminoso|lumen output)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*lm',
  'eff':r'(?i)(?:efficacy|efici[eê]ncia)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*lm\s*/\s*W',
  'cct':r'(?i)(?:colour temperature|color temperature|temperatura de cor|CCT)[^\d]{0,20}(\d{4})\s*K',
  'cri':r'(?i)(?:CRI|colour rendering index|color rendering index)[^\d>]{0,20}>?\s*(\d{2})',
  'angle':r'(?i)(?:beam angle|[aâ]ngulo)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*[°º]',
  'ip':r'\b(IP\s*\d{2})\b','ik':r'\b(IK\s*\d{2})\b'
 }
 for k,p in patterns.items():
  if k in specs:continue
  m=re.search(p,text)
  if m:
   nv=normalize_field(k,m.group(1));specs[k]={'value':nv,'source':url,'evidence_type':'official_product_page','confidence':'HIGH'}
 # article/product code
 if not article:
  m=re.search(r'(?i)(?:product code|article number|article no\.?|sku)\s*[:#]?\s*([A-Z0-9-]{5,20})',text);article=m.group(1) if m else None
 ds=None
 for a in soup.find_all('a',href=True):
  blob=(' '.join(a.stripped_strings)+' '+a['href']).lower()
  if '.pdf' in blob and any(x in blob for x in ['datasheet','data sheet','product sheet','technical','family sheet']):ds=urljoin(url,a['href']);break
 return {'manufacturer':brand,'reference':norm(title),'family':parsed.get('family'),'article_number':article,'status':'OFFICIAL SOURCE VERIFIED','exact_match':compact(parsed['family']) in compact(title+' '+text[:5000]),'page_type':page_type,'official_product_url':url,'official_datasheet_url':ds,'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'specs':specs,'conflicts':conflicts,'sources':[{'url':url,'type':'official_product_page','official':True}]}

def product_quality(p,parsed):
 if not p:return -1
 score=0; specs=p.get('specs',{})
 if compact(parsed.get('family')) and compact(parsed.get('family')) in compact(p.get('reference')):score+=25
 score+=min(45,len([k for k in EXPECTED_FIELDS if k in specs])*4)
 if p.get('article_number'):score+=10
 if p.get('official_datasheet_url'):score+=8
 if not p.get('conflicts'):score+=5
 # exact input attributes
 if parsed.get('power') is not None and specs.get('power') and abs(float(specs['power']['value'])-parsed['power'])<=0.2:score+=5
 if parsed.get('cct') is not None and specs.get('cct') and float(specs['cct']['value'])==parsed['cct']:score+=5
 return score

async def official_catalog_lookup(parsed,brand,trace,errors):
 """Generic official-document fallback. Manufacturer config may expose catalog URLs.
 Search exact normalized reference inside official PDF text; never infer a different variant."""
 refs=[compact(parsed.get('reference')),compact(parsed.get('family'))]
 exact=refs[0]
 if not exact or len(exact)<6:return None
 for url in MANUFACTURERS.get(brand,{}).get('catalogs',[]):
  try:
   final,status,ctype,content=await fetch(url)
   trace.append({'url':final,'status':status,'page_type':'DATASHEET' if status<400 else 'HTTP_ERROR','manufacturer_probe':brand,'source_role':'official_catalog_fallback'})
   if status>=400:continue
   reader=PdfReader(BytesIO(content))
   for i,page in enumerate(reader.pages):
    text=page.extract_text() or ''
    if exact not in compact(text):continue
    # Exact reference must be visible on the page. Extract only values tied to the matching row when possible.
    lines=[norm(x) for x in text.splitlines() if norm(x)]
    matchline=next((x for x in lines if exact in compact(x)), '')
    blob=' '.join(lines)
    specs=user_evidence(parsed)
    # Article code immediately before exact reference in a table row.
    article=None
    m=re.search(r'\b(\d{9,14})\b\s+'+re.escape(parsed['reference']).replace(r'\ ',r'\s+'),blob,re.I)
    if m:article=m.group(1)
    # Row-oriented numbers after exact reference: power, lumen, efficacy, CCT are common in official product books.
    row=matchline
    if row:
     tail=row[compact(row).find(exact):] if exact in compact(row) else row
     nums=[float(x.replace(',','.')) for x in re.findall(r'(?<![A-Za-z])\d+(?:[.,]\d+)?',tail)]
     # Prefer explicit units/labels from full page text over positional guessing.
    pats={
      'power':r'(?i)(?:pot[eê]ncia|power)[^\n]{0,120}?'+re.escape(parsed['reference'])+r'[^\n]{0,80}?(\d+(?:[.,]\d+)?)',
      'flux':r'(?i)(?:l[uú]men|fluxo)[^\n]{0,160}?'+re.escape(parsed['reference'])+r'[^\n]{0,100}?(\d{3,6})',
    }
    # Exact input power/CCT remain USER_INPUT unless independently confirmed by explicit catalog row extraction below.
    # Recognize standard OPPLE table row structure without assigning values from neighbouring variants.
    escaped=re.escape(parsed['reference']).replace(r'\ ',r'\s+')
    rm=re.search(r'(\d{9,14})\s+'+escaped+r'\s+[^\n]*?\s(\d+(?:[.,]\d+)?)\s+(\d{3,6})\s+(\d{2,3})\s+(\d{4})\b',text,re.I)
    if rm:
     article=article or rm.group(1)
     for k,val in [('power',float(rm.group(2).replace(',','.'))),('flux',float(rm.group(3))),('eff',float(rm.group(4))),('cct',float(rm.group(5)))]:
      ev={'value':val,'source':final+'#page='+str(i+1),'evidence_type':'official_catalog','confidence':'HIGH'}
      old=specs.get(k)
      if not old or str(old.get('value'))==str(val):specs[k]=ev
    # Family-level certified attributes may be used only when explicitly present on the same matched page.
    for k,pat in [('ip',r'\bIP\s*(\d{2})\b'),('ik',r'\bIK\s*(\d{2})\b')]:
     mm=re.search(pat,text,re.I)
     if mm and k not in specs:specs[k]={'value':k.upper()+mm.group(1),'source':final+'#page='+str(i+1),'evidence_type':'official_catalog','confidence':'MEDIUM'}
    return {'manufacturer':brand,'reference':parsed['reference'],'family':parsed.get('family'),'article_number':article,'status':'OFFICIAL SOURCE VERIFIED','exact_match':True,'page_type':'DATASHEET','official_product_url':'','official_datasheet_url':final,'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'specs':specs,'conflicts':[],'sources':[{'url':final,'type':'official_catalog','official':True,'page':i+1}]}
  except Exception as e:errors.append('catalog:'+type(e).__name__)
 return None

async def run_search(q):
 cached=cache_get(q)
 if cached:
  cached['cache_hit']=True;return cached
 explicit=explicit_manufacturer(q); base=parse_input(q,explicit)
 brands=[explicit] if explicit else list(MANUFACTURERS.keys())
 queries=[];trace=[];errors=[];best=None;bestq=-1;discovery=None;seen=set()
 # Fast path: previously verified official products. This is evidence cache, not mock data.
 for brand in brands:
  probe=parse_input(q,brand); ip=indexed_product(probe,brand)
  if ip:
   out={'query':q,'manufacturer':brand,'manufacturer_discovery':{'manufacturer':brand,'source':'VERIFIED_OFFICIAL_SOURCE_INDEX','url':ip.get('official_product_url'),'confidence':'HIGH'},'parsed_input':base,'queries':[],'page_trace':[{'url':ip.get('official_product_url'),'status':200,'page_type':'PRODUCT_PAGE','source_role':'verified_official_source_index'}],'product':ip,'related_products':[],'errors':[],'search_provider':'Verified official-source index + universal live fallback','cache_hit':False,'engine':'UNIVERSAL_COMPETITOR_ENGINE_V54'}
   cache_put(q,out);return out
 # Global web search first when configured; it is the only truly scalable discovery for unknown brands/products.
 web_urls=[]
 if os.getenv('BRAVE_SEARCH_API_KEY'):
  for sq in search_queries(base,explicit)[:12]:
   queries.append(sq)
   try:web_urls += await brave_search(sq)
   except Exception as e:errors.append('web-search:'+type(e).__name__)
  # infer brand from official result if not explicit
  if not explicit:
   counts={}
   for u in web_urls:
    b=host_brand(u)
    if b:counts[b]=counts.get(b,0)+1
   if counts:brands=[max(counts,key=counts.get)]+[b for b in brands if b!=max(counts,key=counts.get)]
 for brand in brands:
  probe=parse_input(q,brand); local_urls=[]
  # Fast exact-reference lookup in configured official catalogs before broad crawling.
  # This avoids dozens of slow search/category requests when the manufacturer publishes a product book.
  cp=await official_catalog_lookup(probe,brand,trace,errors)
  if cp:
   qual=product_quality(cp,probe)
   if qual>bestq:best,bestq=cp,qual;discovery={'manufacturer':brand,'source':'OFFICIAL_CATALOG_EXACT_REFERENCE','url':cp.get('official_datasheet_url'),'confidence':'HIGH'}
   if bestq>=45:break
  local_urls += [u for u in web_urls if official(u,brand)]
  local_urls += official_search_urls(probe,brand)
  # BFS: search/category pages are navigation nodes, not evidence.
  queue=[(u,0) for u in dict.fromkeys(local_urls)]; visited=0
  while queue and visited<8:
   url,depth=queue.pop(0)
   if url in seen:continue
   seen.add(url);visited+=1
   try:
    final,status,ctype,content=await fetch(url)
    if status>=400:trace.append({'url':final,'status':status,'page_type':'HTTP_ERROR','manufacturer_probe':brand});continue
    cls=page_classifier(final,content,ctype,probe);trace.append({'url':final,'status':status,'page_type':cls['type'],'classifier_score':cls['score'],'signals':cls['signals'],'manufacturer_probe':brand})
    if cls['type']=='PRODUCT_PAGE':
     p=extract_product(final,content,probe,brand);qual=product_quality(p,probe)
     if qual>bestq:best,bestq=p,qual;discovery={'manufacturer':brand,'source':'OFFICIAL_DOMAIN_PRODUCT_PAGE','url':final,'confidence':'HIGH'}
     if qual>=65:break
    elif cls['type']=='DATASHEET':
     # PDF extraction is intentionally not guessed in Azure Function without a PDF parser; retain source for follow-up.
     pass
    if depth<1 and cls['type'] in ('SEARCH_PAGE','CATEGORY_PAGE','IRRELEVANT'):
     for link in relevant_links(final,content,probe,brand):
      if link not in seen:queue.append((link,depth+1))
   except Exception as e:errors.append(type(e).__name__+':'+url[:100])
  if bestq>=45:break
 detected=best.get('manufacturer') if best else explicit
 out={'query':q,'manufacturer':detected,'manufacturer_discovery':discovery,'parsed_input':base,'queries':list(dict.fromkeys(queries)),'page_trace':trace,'product':best,'related_products':[],'errors':errors,'search_provider':'Brave Search API + universal official crawler' if os.getenv('BRAVE_SEARCH_API_KEY') else 'Universal official-site crawler (Brave Search not configured)','cache_hit':False,'engine':'UNIVERSAL_COMPETITOR_ENGINE_V54'}
 cache_put(q,out);return out

@app.route(route='competitor/search',methods=['POST'])
def competitor_search(req):
 try:data=req.get_json();q=norm(data.get('query',''))
 except:return func.HttpResponse(json.dumps({'error':'invalid json'}),status_code=400,mimetype='application/json')
 if not q:return func.HttpResponse(json.dumps({'error':'query required'}),status_code=400,mimetype='application/json')
 try:return func.HttpResponse(json.dumps(asyncio.run(run_search(q)),ensure_ascii=False),mimetype='application/json')
 except Exception as e:return func.HttpResponse(json.dumps({'error':type(e).__name__,'detail':str(e)[:500]}),status_code=500,mimetype='application/json')

@app.route(route='health',methods=['GET'])
def health(req):
 return func.HttpResponse(json.dumps({'ok':True,'version':VERSION,'engine':'UNIVERSAL_COMPETITOR_ENGINE','brave_search':bool(os.getenv('BRAVE_SEARCH_API_KEY')),'page_classifier':True,'official_domains':OFFICIAL_DOMAINS}),mimetype='application/json')
