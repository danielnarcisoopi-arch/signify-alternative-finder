import os,re,json,hashlib,time,asyncio
from pathlib import Path
from urllib.parse import quote,urljoin,urlparse
import azure.functions as func
import httpx
from bs4 import BeautifulSoup

VERSION='48'
CACHE_DIR=Path(os.getenv('TMPDIR','/tmp'))/'signify-alt-cache-v48'; CACHE_DIR.mkdir(parents=True,exist_ok=True)
CACHE_TTL=int(os.getenv('CACHE_TTL_SECONDS','86400'))
UA='Mozilla/5.0 (compatible; SignifyAlternativeFinder/48; quotation research)'
OFFICIAL_DOMAINS={'OPPLE':['opple.eu','opple.com','opple.pt'],'LEDVANCE':['ledvance.com'],'TRILUX':['trilux.com'],'ZUMTOBEL':['zumtobel.com']}
app=func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

def norm(s): return re.sub(r'\s+',' ',re.sub(r'[_–—]+','-',str(s).strip())).strip()
def manufacturer(q):
 u=q.upper()
 for m in OFFICIAL_DOMAINS:
  if m in u:return m
 return 'UNKNOWN'
def cache_file(q): return CACHE_DIR/(hashlib.sha256(norm(q).lower().encode()).hexdigest()+'.json')
def cache_get(q):
 p=cache_file(q)
 if p.exists() and time.time()-p.stat().st_mtime<CACHE_TTL:
  try:return json.loads(p.read_text('utf-8'))
  except Exception:pass
def cache_put(q,d): cache_file(q).write_text(json.dumps(d,ensure_ascii=False,indent=2),'utf-8')
def ev(value,source,kind='official_product_page',confidence='HIGH'): return {'value':value,'source':source,'evidence_type':kind,'confidence':confidence,'conflict':False,'alternatives':[]}

def parse_input(q,m):
 raw=norm(q); x=re.sub(r'\b'+re.escape(m)+r'\b','',raw,flags=re.I).strip(' -') if m!='UNKNOWN' else raw
 # Remove common RFQ prose before extracting the technical reference, but retain the full raw input for audit.
 ref=x
 fam=None; product_type=None; application=None; mounting=None
 patterns=[
  (r'(LED\s*Post\s*Top\s*-?\s*P)', 'LEDPostTop-P','Post-top luminaire','Outdoor / urban','Post top'),
  (r'(LEDWP\s*-?\s*CLA\s*-?\s*P2)', 'LEDWP-CLA-P2','Waterproof luminaire','Indoor / waterproof','Surface / suspended'),
  (r'(LEDPorch\s*-?\s*E2\s*-?\s*Re120)', 'LEDPorch-E2-Re120','Wall / ceiling luminaire','Outdoor / wall-ceiling','Surface')]
 for pat,f,t,a,mt in patterns:
  mm=re.search(pat,x,re.I)
  if mm: fam,product_type,application,mounting=f,t,a,mt; ref=x[mm.start():].strip(' -:;,.'); break
 # Capture explicit W including selectable ranges such as 3/5W. Use max system power as comparison value, preserve range separately.
 powers=[]
 for mm in re.finditer(r'(?<!\d)(\d+(?:[.,]\d+)?)(?:\s*/\s*(\d+(?:[.,]\d+)?))?\s*W\b',ref,re.I):
  vals=[float(mm.group(1).replace(',','.'))]
  if mm.group(2): vals.append(float(mm.group(2).replace(',','.')))
  powers.extend(vals)
 power=max(powers) if powers else None; power_range=powers[:2] if len(powers)>=2 else None
 # Explicit Kelvin or Philips-style colour code 830/840/865 in the reference.
 cct=None; cct_values=[]
 for mm in re.finditer(r'(?<!\d)([2-6]\d{3})\s*K?\b',ref,re.I): cct_values.append(int(mm.group(1)))
 if not cct_values:
  for mm in re.finditer(r'(?<!\d)(8|9)(27|30|40|65)(?!\d)',ref): cct_values.append(int(mm.group(2))*100)
 if cct_values: cct=cct_values[-1]
 mv=re.search(r'(?:^|[-\s])(W|AS)(?:$|[-\s])',ref,re.I); variant=mv.group(1).upper() if mv else None
 length=None; ml=re.search(r'\bL\s*(600|900|1200|1500|1800)\b',ref,re.I); length=float(ml.group(1)) if ml else None
 reference=norm(ref)
 specs={}
 if power is not None: specs['power_w']=ev(power,'USER_INPUT','user_input')
 if cct is not None: specs['cct_k']=ev(cct,'USER_INPUT','user_input')
 if length is not None: specs['length_mm']=ev(length,'USER_INPUT','user_input')
 if product_type: specs['product_type']=ev(product_type,'USER_INPUT','user_input')
 if application: specs['application']=ev(application,'USER_INPUT','user_input')
 if mounting: specs['mounting']=ev(mounting,'USER_INPUT','user_input')
 return {'manufacturer':m,'raw':raw,'reference':reference,'family':fam,'power_w':power,'power_range_w':power_range,'cct_k':cct,'cct_values':cct_values,'length_mm':length,'variant':variant,'specs':specs}

def progressive_refs(parsed):
 ref=parsed['reference']; fam=parsed.get('family'); out=[ref]
 # Progressively relax only technical suffixes, never replace them with guessed values.
 if fam:
  out.append(fam)
  if parsed.get('length_mm'): out.append(f'{fam} L{int(parsed["length_mm"])}')
  if parsed.get('power_w'): out.append(f'{fam} {parsed["power_w"]:g}W')
  if parsed.get('cct_k'): out.append(f'{fam} {parsed["cct_k"]}')
 # OPPLE 840 can be one position of a selectable 830/840 product.
 if re.search(r'(?<!\d)840(?!\d)',ref): out.append(re.sub(r'(?<!\d)840(?!\d)','830/840',ref))
 # Strip final option groups one at a time.
 parts=re.split(r'[-\s]+',ref)
 for cut in range(len(parts)-1,max(1,len(parts)-4),-1): out.append('-'.join(parts[:cut]))
 return list(dict.fromkeys(norm(x) for x in out if x and len(x)>3))

def search_queries(parsed):
 m=parsed['manufacturer']; refs=progressive_refs(parsed); qs=[]
 for r in refs[:6]: qs += [f'"{r}"',f'"{r}" {m}']
 for d in OFFICIAL_DOMAINS.get(m,[]):
  for r in refs[:4]: qs.append(f'site:{d} "{r}"')
 return list(dict.fromkeys(qs))

def opple_slug(parsed):
 fam=(parsed.get('family') or '').lower(); p=parsed.get('power_w'); c=parsed.get('cct_k'); v=parsed.get('variant')
 if fam=='ledposttop-p' and p and c and v:return f'ledposttop-p-{p:g}w-{c}-{v.lower()}'
 s=parsed['reference'].lower().replace('_','-').replace(' ','-'); return re.sub(r'-+','-',re.sub(r'[^a-z0-9-]+','-',s)).strip('-')
def candidate_urls(parsed):
 if parsed['manufacturer']!='OPPLE':return []
 refs=progressive_refs(parsed); slugs=[]
 for r in refs:
  sl=re.sub(r'-+','-',re.sub(r'[^a-z0-9-]+','-',r.lower().replace('_','-').replace(' ','-'))).strip('-')
  if sl: slugs.append(sl)
 # Normalize slash variants the same way OPPLE URLs do (3/5W -> 35w; 830/840 -> 830840).
 rawslug=re.sub(r'[^a-z0-9-]+','',parsed['reference'].lower().replace('_','-').replace(' ','-').replace('/',''))
 if rawslug:
  rawslug=re.sub(r'^led-posttop','ledposttop',rawslug)
  slugs.insert(0,re.sub(r'-+','-',rawslug))
 urls=[]; fam=(parsed.get('family') or '').lower()
 paths=[]
 if 'posttop' in fam: paths=['en/product/outdoor/urban/post-top','pt-pt/product/luminarias-para-exteriores/urban/post-top']
 elif 'ledwp-cla-p2' in fam: paths=['en/product/indoor/waterproof-luminaires/waterproof-classic-g2','pt-pt/product/luminarias-para-interiores/waterproof-luminaires-0/waterproof-classic-g2']
 elif 'ledporch' in fam: paths=['en/product/outdoor/wall-and-ceiling-luminaires/porchlight-ecomax-g2','pt-pt/product/luminarias-para-exteriores/wall-and-ceiling-luminaires/plafond-porch-ip65-ecomax-g2']
 for host in ['www.opple.pt','www.opple.eu']:
  for path in paths:
   for slug in slugs[:10]: urls.append(f'https://{host}/{path}/{slug}')
 # Search pages remain discovery nodes only and can never be technical evidence.
 for host in ['www.opple.pt','www.opple.eu']:
  for r in refs[:4]: urls.append(f'https://{host}/en/search?search={quote(r)}')
 return list(dict.fromkeys(urls))

async def fetch(url):
 async with httpx.AsyncClient(headers={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/pdf'},follow_redirects=True,timeout=25) as c:
  r=await c.get(url); return str(r.url),r.content,r.status_code,r.headers.get('content-type','')

def page_classifier(url,content,ctype,parsed):
 if 'pdf' in ctype.lower() or url.lower().split('?')[0].endswith('.pdf'): return {'type':'DATASHEET','score':100,'signals':['pdf']}
 html=content.decode('utf-8','ignore'); soup=BeautifulSoup(html,'html.parser'); title=' '.join((soup.title.get_text(' ',strip=True) if soup.title else '').split()); text=' '.join(soup.stripped_strings); low=(title+' '+text[:8000]).lower()
 if re.search(r'\b(search\s*results?|searchresults)\b',title,re.I) or '/search' in urlparse(url).path.lower(): return {'type':'SEARCH_PAGE','score':0,'signals':['search-title-or-url']}
 if title.strip().lower() in {'products','downloads','product','download'}: return {'type':'CATEGORY_PAGE','score':0,'signals':['generic-title']}
 ref=parsed['reference'].lower().replace(' ',''); fam=(parsed.get('family') or '').lower(); signals=[]; score=0
 if ref and ref in low.replace(' ',''): signals.append('reference');score+=30
 if fam and fam.replace('-','') in low.replace('-','').replace(' ',''):signals.append('family');score+=15
 checks=[('technical specifications',15),('product code',15),('max. system power',8),('lumen',8),('colour temperature',8),('degree of protection',6),('downloads',5)]
 for s,w in checks:
  if s in low:signals.append(s);score+=w
 if score>=55 and len(signals)>=4:return {'type':'PRODUCT_PAGE','score':min(100,score),'signals':signals}
 if '/product/' in urlparse(url).path.lower() and score>=35:return {'type':'PRODUCT_PAGE','score':score,'signals':signals}
 if any(x in low for x in ['products','product range','category']):return {'type':'CATEGORY_PAGE','score':score,'signals':signals}
 return {'type':'IRRELEVANT','score':score,'signals':signals}

def relevant_links(base,content,parsed):
 soup=BeautifulSoup(content.decode('utf-8','ignore'),'html.parser'); fam=(parsed.get('family') or '').lower().replace('-',''); p=parsed.get('power_w'); c=parsed.get('cct_k'); L=parsed.get('length_mm'); out=[]
 for a in soup.find_all('a',href=True):
  label=' '.join(a.stripped_strings); href=urljoin(base,a['href']); blob=(label+' '+href).lower().replace('-','').replace(' ','')
  score=0
  if fam and fam in blob:score+=4
  if p and f'{p:g}w'.replace('.0','') in blob:score+=2
  if c and (str(c) in blob or (c==4000 and '840' in blob)):score+=2
  if L and str(int(L)) in blob:score+=2
  if score>=4:out.append((score,href))
 return [u for _,u in sorted(out,reverse=True)[:12]]

def text_value(soup,label):
 node=soup.find(string=re.compile(r'^\s*'+re.escape(label)+r'\s*$',re.I))
 if node:
  for anc in [node.parent,node.parent.parent if node.parent else None,node.parent.parent.parent if node.parent and node.parent.parent else None]:
   if anc:
    txt=' '.join(anc.stripped_strings); txt=re.sub(r'^\s*'+re.escape(label)+r'\s*','',txt,flags=re.I).strip(' :|')
    if txt and len(txt)<180:return txt
 txt='\n'.join(soup.stripped_strings); mm=re.search(re.escape(label)+r'\s*[|:]?\s*([^\n]{1,100})',txt,re.I); return mm.group(1).strip() if mm else None
def num(v):
 if not v:return None
 mm=re.search(r'-?\d+(?:[.,]\d+)?',str(v).replace(' ','')); return float(mm.group().replace(',','.')) if mm else None
def code(v,prefix):
 if not v:return None
 mm=re.search(prefix+r'\s*([0-9]{2})',str(v),re.I); return prefix.upper()+mm.group(1) if mm else None

def merge_spec(specs,k,new):
 if new is None or new.get('value') is None:return
 old=specs.get(k)
 if old and old['value']!=new['value']:
  # official confirms user input when numerically equal after normalization; otherwise preserve conflict.
  try:eq=abs(float(old['value'])-float(new['value']))<1e-6
  except: eq=str(old['value']).lower()==str(new['value']).lower()
  if not eq:
   old['conflict']=True; old.setdefault('alternatives',[]).append(new); return
 # official source supersedes input while preserving confirmation
 if not old or new['evidence_type'].startswith('official'): specs[k]=new

def parse_opple(url,content,parsed):
 soup=BeautifulSoup(content.decode('utf-8','ignore'),'html.parser'); title=soup.find('h1').get_text(' ',strip=True) if soup.find('h1') else (soup.title.get_text(' ',strip=True) if soup.title else parsed['reference']); page=' '.join(soup.stripped_strings)
 specs=dict(parsed.get('specs') or {})
 labels={'power_w':['Max. system power','System power'],'luminous_flux_lm':['Lumen'],'efficacy_lm_w':['Luminaire efficacy'],'cct_k':['Colour temperature'],'cri':['Colour rendering index (CRI)'],'beam_angle_deg':['Beam angle'],'ip':['Degree of protection (IP)'],'ik':['Impact strength'],'width_mm':['Width'],'length_mm':['Length'],'height_mm':['Height/depth','Height'],'diameter_mm':['Diameter'],'mounting':['Mounting method'],'colour':['Housing colour'],'driver':['Type of control gear'],'dimming':['Dimmability'],'voltage':['Nominal voltage'],'lifetime':['Lifetime (L70)']}
 numeric={'power_w','luminous_flux_lm','efficacy_lm_w','cct_k','cri','beam_angle_deg','width_mm','length_mm','height_mm','diameter_mm','lifetime'}
 for k,ls in labels.items():
  raw=None
  for lab in ls:
   raw=text_value(soup,lab)
   if raw:break
  if not raw:continue
  val=num(raw) if k in numeric else (code(raw,'IP') if k=='ip' else code(raw,'IK') if k=='ik' else raw)
  merge_spec(specs,k,ev(val,url,'official_product_page'))
 if 'post top' in page.lower() or 'post-top' in page.lower():
  merge_spec(specs,'product_type',ev('Post-top luminaire',url)); merge_spec(specs,'application',ev('Outdoor / urban',url)); merge_spec(specs,'mounting',ev('Post top',url))
 pole=text_value(soup,'Compatible pole Ø (mm)') or text_value(soup,'Compatible pole Ø')
 if pole: merge_spec(specs,'pole_diameter_mm',ev(num(pole),url))
 mm=re.search(r'Product Code\s*(\d{9,14})',page,re.I); article=mm.group(1) if mm else None
 ds=None
 for a in soup.find_all('a',href=True):
  if 'Product Sheet' in ' '.join(a.stripped_strings) or re.search(r'ProductSheet.*\.pdf',a['href'],re.I):ds=urljoin(url,a['href']);break
 return {'manufacturer':'OPPLE','reference':title,'family':parsed.get('family') or 'LEDPostTop-P','article_number':article,'status':'OFFICIAL SOURCE VERIFIED','exact_match':True,'page_type':'PRODUCT_PAGE','official_product_url':url,'official_datasheet_url':ds,'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'specs':specs,'sources':[{'url':url,'type':'official_product_page','official':True}]}

async def brave_search(q,m):
 key=os.getenv('BRAVE_SEARCH_API_KEY')
 if not key:return []
 async with httpx.AsyncClient(timeout=20) as c:
  r=await c.get('https://api.search.brave.com/res/v1/web/search',params={'q':q,'count':10},headers={'X-Subscription-Token':key,'Accept':'application/json'})
  if r.status_code!=200:return []
  return [x.get('url') for x in r.json().get('web',{}).get('results',[]) if x.get('url')]

async def run_search(q):
 cached=cache_get(q)
 if cached:cached['cache_hit']=True;return cached
 m=manufacturer(q); parsed=parse_input(q,m); queries=search_queries(parsed); urls=candidate_urls(parsed); errors=[]; trace=[]
 for sq in queries:
  try:urls += await brave_search(sq,m)
  except Exception as e:errors.append('search '+type(e).__name__)
 queue=list(dict.fromkeys(urls)); seen=set(); products=[]; depth=0
 while queue and len(seen)<25:
  u=queue.pop(0)
  if u in seen:continue
  seen.add(u); host=urlparse(u).hostname or ''
  if m in OFFICIAL_DOMAINS and not any(host==d or host.endswith('.'+d) for d in OFFICIAL_DOMAINS[m]):continue
  try:
   final,content,status,ctype=await fetch(u)
   if status!=200:trace.append({'url':u,'status':status,'page_type':'IRRELEVANT'});continue
   cls=page_classifier(final,content,ctype,parsed);trace.append({'url':final,'status':status,'page_type':cls['type'],'classifier_score':cls['score'],'signals':cls['signals']})
   if cls['type']=='PRODUCT_PAGE' and m=='OPPLE':products.append(parse_opple(final,content,parsed));break
   if cls['type'] in ('SEARCH_PAGE','CATEGORY_PAGE'):
    queue += [x for x in relevant_links(final,content,parsed) if x not in seen]
   # DATASHEET is accepted evidence, but this POC only parses HTML product pages; never promote it without variant-safe parser.
  except Exception as e:errors.append(f'{u}: {type(e).__name__}: {e}')
 product=products[0] if products else None
 out={'query':q,'manufacturer':m,'parsed_input':parsed,'queries':queries,'urls_attempted':list(seen),'page_trace':trace,'product':product,'related_products':[],'errors':errors,'search_provider':'Brave Search API + official crawl' if os.getenv('BRAVE_SEARCH_API_KEY') else 'Official-domain deterministic crawl (Brave optional)','cache_hit':False}
 cache_put(q,out);return out

@app.route(route='competitor/search',methods=['POST'])
def competitor_search(req):
 try:body=req.get_json();q=norm(str((body or {}).get('query','')))
 except Exception:return func.HttpResponse(json.dumps({'error':'invalid JSON'}),status_code=400,mimetype='application/json')
 if not q:return func.HttpResponse(json.dumps({'error':'query required'}),status_code=400,mimetype='application/json')
 try:return func.HttpResponse(json.dumps(asyncio.run(run_search(q)),ensure_ascii=False),mimetype='application/json')
 except Exception as e:return func.HttpResponse(json.dumps({'error':type(e).__name__,'message':str(e)}),status_code=500,mimetype='application/json')

@app.route(route='health',methods=['GET'])
def health(req):return func.HttpResponse(json.dumps({'ok':True,'version':VERSION,'brave_search':bool(os.getenv('BRAVE_SEARCH_API_KEY')),'page_classifier':True,'official_domains':OFFICIAL_DOMAINS}),mimetype='application/json')
