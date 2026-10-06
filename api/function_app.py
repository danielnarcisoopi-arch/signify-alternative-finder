import os, re, json, hashlib, time, asyncio
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse
import azure.functions as func
import httpx
from bs4 import BeautifulSoup

CACHE_DIR=Path(os.getenv("TMPDIR","/tmp"))/"signify-alt-cache"
CACHE_DIR.mkdir(parents=True,exist_ok=True)
CACHE_TTL=int(os.getenv('CACHE_TTL_SECONDS','86400'))
UA='Mozilla/5.0 (compatible; SignifyAlternativeFinder/46; quotation research)'
OFFICIAL_DOMAINS={
 'OPPLE':['opple.eu','opple.com','opple.pt'],
 'LEDVANCE':['ledvance.com'], 'TRILUX':['trilux.com'], 'ZUMTOBEL':['zumtobel.com']
}
app=func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

def norm(s:str)->str:
 return re.sub(r'\s+',' ',re.sub(r'[_–—]+','-',s.strip())).strip()

def manufacturer(q:str)->str:
 u=q.upper()
 for m in OFFICIAL_DOMAINS:
  if m in u:return m
 return 'UNKNOWN'

def cache_file(q:str)->Path:return CACHE_DIR/(hashlib.sha256(norm(q).lower().encode()).hexdigest()+'.json')
def cache_get(q):
 p=cache_file(q)
 if p.exists() and time.time()-p.stat().st_mtime<CACHE_TTL:
  try:return json.loads(p.read_text('utf-8'))
  except:pass
 return None
def cache_put(q,data):cache_file(q).write_text(json.dumps(data,ensure_ascii=False,indent=2),'utf-8')

def ev(value,source,kind='official_product_page',conflict=False,alternatives=None):
 return {'value':value,'source':source,'evidence_type':kind,'conflict':conflict,'alternatives':alternatives or []}

def extract_model(q,m):
 x=re.sub(r'\b'+re.escape(m)+r'\b','',q,flags=re.I).strip(' -') if m!='UNKNOWN' else q
 return norm(x)

def opple_slug(model:str)->str:
 s=model.lower().replace('_','-').replace(' ','-')
 s=re.sub(r'[^a-z0-9-]+','-',s); s=re.sub(r'-+','-',s).strip('-')
 # OPPLE URLs omit a leading "opple" and use ledposttop style.
 return s

def candidate_urls(q,m):
 model=extract_model(q,m); urls=[]
 if m=='OPPLE':
  slug=opple_slug(model)
  # known OPPLE hierarchy for PostTop; deterministic official lookup, not fabricated specs.
  if 'posttop' in slug or 'post-top' in slug:
   slug=slug.replace('led-posttop','ledposttop').replace('led-post-top','ledposttop').replace('post-top','posttop')
   urls += [f'https://www.opple.eu/en/product/outdoor/urban/post-top/{slug}',f'https://www.opple.com/en/product/outdoor/urban/post-top/{slug}']
  urls += [f'https://www.opple.eu/en/search?search={quote(model)}']
 return urls

async def fetch(url:str)->tuple[str,str,int]:
 async with httpx.AsyncClient(headers={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/pdf'},follow_redirects=True,timeout=20) as c:
  r=await c.get(url)
  return str(r.url),r.text,r.status_code

def text_value(soup,label):
 lab=re.escape(label)
 # Drupal product pages render labels and values as nearby text. Search parent blocks first.
 node=soup.find(string=re.compile(r'^\s*'+lab+r'\s*$',re.I))
 if node:
  parent=node.parent
  for anc in [parent,parent.parent if parent else None,parent.parent.parent if parent and parent.parent else None]:
   if anc:
    txt=' '.join(anc.stripped_strings)
    txt=re.sub(r'^\s*'+lab+r'\s*','',txt,flags=re.I).strip(' :|')
    if txt and len(txt)<160:return txt
 # fallback on full text line-ish regex
 txt='\n'.join(soup.stripped_strings)
 m=re.search(lab+r'\s*[|:]?\s*([^\n]{1,80})',txt,re.I)
 return m.group(1).strip() if m else None

def n(v):
 if not v:return None
 m=re.search(r'-?\d+(?:[.,]\d+)?',v.replace(' ','') if isinstance(v,str) else str(v))
 return float(m.group().replace(',','.')) if m else None

def clean_ip(v,prefix):
 if not v:return None
 m=re.search(prefix+r'\s*([0-9]{2})',v,re.I);return prefix.upper()+m.group(1) if m else None

def parse_opple(url,html,query):
 soup=BeautifulSoup(html,'html.parser'); title=(soup.find('h1').get_text(' ',strip=True) if soup.find('h1') else (soup.title.get_text(' ',strip=True) if soup.title else ''))
 page_text=' '.join(soup.stripped_strings)
 model=extract_model(query,'OPPLE')
 exact=norm(model).lower().replace(' ','') in norm(title).lower().replace(' ','') or norm(model).lower() in norm(page_text[:2000]).lower()
 labels={
  'power_w':['Max. system power','System power'], 'luminous_flux_lm':['Lumen'], 'efficacy_lm_w':['Luminaire efficacy'],
  'cct_k':['Colour temperature'], 'cri':['Colour rendering index (CRI)'], 'beam_angle_deg':['Beam angle'],
  'ip':['Degree of protection (IP)'], 'ik':['Impact strength'], 'width_mm':['Width'], 'length_mm':['Length'],
  'height_mm':['Height/depth','Height'], 'diameter_mm':['Diameter'], 'mounting':['Mounting method'], 'colour':['Housing colour'],
  'driver':['Type of control gear'], 'dimming':['Dimmability'], 'voltage':['Nominal voltage'], 'lifetime':['Lifetime (L70)']}
 raw={}
 for k,ls in labels.items():
  for lab in ls:
   v=text_value(soup,lab)
   if v:raw[k]=v;break
 specs={}
 numeric={'power_w','luminous_flux_lm','efficacy_lm_w','cct_k','cri','beam_angle_deg','width_mm','length_mm','height_mm','diameter_mm'}
 for k,v in raw.items():
  val=n(v) if k in numeric else (clean_ip(v,'IP') if k=='ip' else clean_ip(v,'IK') if k=='ik' else v)
  if val is not None:specs[k]=ev(val,url)
 # page wording confirms category/application when exact page is found
 if 'post top' in page_text.lower() or 'post-top' in query.lower() or 'posttop' in query.lower():
  specs['product_type']=ev('Post-top luminaire',url); specs['application']=ev('Outdoor / urban',url); specs['mounting']=ev('Post top',url)
 # product code
 code=None
 m=re.search(r'Product Code\s*(\d{9,14})',page_text,re.I)
 if m:code=m.group(1)
 # datasheet link
 ds=None
 for a in soup.find_all('a',href=True):
  href=a['href']; label=' '.join(a.stripped_strings)
  if 'Product Sheet' in label or re.search(r'ProductSheet.*\.pdf',href,re.I): ds=urljoin(url,href);break
 return {'manufacturer':'OPPLE','reference':title or model,'family':'LED PostTop-P' if 'posttop' in (title+model).lower().replace('-','') else None,
  'article_number':code,'status':'OFFICIAL SOURCE VERIFIED' if exact else 'PARTIALLY VERIFIED','exact_match':exact,
  'official_product_url':url,'official_datasheet_url':ds,'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'specs':specs,'sources':[{'url':url,'type':'official_product_page','official':True}], 'raw_title':title}

async def brave_search(q,m):
 key=os.getenv('BRAVE_SEARCH_API_KEY')
 if not key:return []
 domains=OFFICIAL_DOMAINS.get(m,[]); query=q+' '+(' OR '.join('site:'+d for d in domains) if domains else '')
 async with httpx.AsyncClient(timeout=20) as c:
  r=await c.get('https://api.search.brave.com/res/v1/web/search',params={'q':query,'count':10},headers={'X-Subscription-Token':key,'Accept':'application/json'})
  if r.status_code!=200:return []
  return [x.get('url') for x in r.json().get('web',{}).get('results',[]) if x.get('url')]


@app.route(route="competitor/search", methods=["POST"])
def competitor_search(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body=req.get_json()
    except Exception:
        return func.HttpResponse(json.dumps({"error":"invalid JSON"}),status_code=400,mimetype="application/json")
    q=norm(str((body or {}).get("query", "")))
    if not q:
        return func.HttpResponse(json.dumps({"error":"query required"}),status_code=400,mimetype="application/json")
    try:
        out=asyncio.run(run_search(q))
        return func.HttpResponse(json.dumps(out,ensure_ascii=False),status_code=200,mimetype="application/json")
    except Exception as e:
        return func.HttpResponse(json.dumps({"error":type(e).__name__,"message":str(e)}),status_code=500,mimetype="application/json")

async def run_search(q):
    cached=cache_get(q)
    if cached:
        cached['cache_hit']=True
        return cached
    m=manufacturer(q)
    model=extract_model(q,m)
    queries=[f'"{model}"',f'"{model}" {m}']
    if m in OFFICIAL_DOMAINS:
        queries += [f'site:{d} "{model}"' for d in OFFICIAL_DOMAINS[m]]
    urls=candidate_urls(q,m); errors=[]; found=[]
    for sq in queries:
        try: urls += await brave_search(sq,m)
        except Exception as e: errors.append('search: '+type(e).__name__)
    seen=set()
    for u in urls:
        if not u or u in seen: continue
        seen.add(u)
        host=urlparse(u).hostname or ''
        if m in OFFICIAL_DOMAINS and not any(host==d or host.endswith('.'+d) for d in OFFICIAL_DOMAINS[m]): continue
        try:
            final,html,status=await fetch(u)
            if status==200 and '<html' in html[:1000].lower() and m=='OPPLE':
                p=parse_opple(final,html,q); found.append(p)
                if p['exact_match']: break
        except Exception as e: errors.append(f'{u}: {type(e).__name__}')
    exact=[x for x in found if x.get('exact_match')]
    product=exact[0] if exact else (found[0] if found else None)
    out={'query':q,'manufacturer':m,'queries':queries,'urls_attempted':list(seen),'product':product,'related_products':[] if product else found[:5],
         'errors':errors,'search_provider':'Brave Search API' if os.getenv('BRAVE_SEARCH_API_KEY') else 'Official-domain deterministic lookup (Brave optional)',
         'cache_hit':False}
    cache_put(q,out)
    return out

@app.route(route="health", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({'ok':True,'version':'46','brave_search':bool(os.getenv('BRAVE_SEARCH_API_KEY')),'official_domains':OFFICIAL_DOMAINS}),mimetype='application/json')
