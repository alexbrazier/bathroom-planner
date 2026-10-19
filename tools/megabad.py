import re,sys,json,html,subprocess,concurrent.futures as cf,os
links=json.load(open(sys.argv[1])); out=sys.argv[2]
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
import hashlib
CACHE=os.path.join(os.path.dirname(os.path.abspath(out)),'cache'); os.makedirs(CACHE,exist_ok=True)
def get(u):
    f=os.path.join(CACHE,hashlib.md5(u.encode()).hexdigest()+'.html')
    if os.path.exists(f): return open(f,encoding='utf8').read()
    s=_get(u)
    if s: open(f,'w',encoding='utf8').write(s)
    return s
def _get(u):
    for _ in range(3):
        r=subprocess.run(['curl','-sL','--max-time','60','-A',UA,u],capture_output=True)
        s=r.stdout.decode('utf8','replace')
        if len(s)>20000: return s
    return ''
def parse(item):
    try: return _parse(item)
    except Exception as e:
        print('ERR',item,e,file=sys.stderr); return None
def _parse(item):
    rng,cat,path=item[0],item[1],item[2]
    u='https://www.megabad.com/en/'+path
    s=get(u)
    if not s: return None
    d={'range':rng,'cat':cat,'url':u}
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>',s,re.S):
        t=m.group(1)
        if '"Product"' in t:
            try: j=json.loads(t)
            except Exception: continue
            d['name']=j.get('name'); d['mpn']=j.get('mpn'); d['image']=j.get('image'); d['color']=j.get('color')
            off=j.get('offers') or {}
            if isinstance(off,list): off=off[0] if off else {}
            ps=off.get('priceSpecification') if isinstance(off,dict) else None
            if isinstance(ps,list): ps=ps[0] if ps else None
            d['price']=(off.get('price') if isinstance(off,dict) else None) or (ps.get('price') if isinstance(ps,dict) else None)
            d['currency']='EUR'
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S); t=re.sub(r'<[^>]+>','\n',t)
    L=[l.strip() for l in html.unescape(t).split('\n') if l.strip()]
    for i,l in enumerate(L):
        if l=='Dimensions:' and i+1<len(L): d['dims']=L[i+1]; break
    # variant rows: "colour ...:" value pairs followed by price
    vars=[]; cur={}
    for i,l in enumerate(L):
        m=re.match(r'^(colour front|colour body|colour|surface|finish|Colour|Surface|Finish|colour/surface)\s*:?$',l)
        if m and i+1<len(L) and not L[i+1].endswith(':'):
            cur[m.group(1).lower()]=L[i+1]
        pm=re.match(r'^€\s*([\d,]+\.\d\d)$',l)
        if pm and cur:
            cur['price']=pm.group(1).replace(',',''); vars.append(cur); cur={}
    d['variants']=vars
    d['images']=sorted(set(re.findall(r'https://www-megabad-com-res\.cloudinary\.com/image/upload/[^"\s]*?/f_auto/([a-z0-9-]+)',s)))[:6]
    return d
with cf.ThreadPoolExecutor(12) as ex:
    res=[r for r in ex.map(parse,links) if r]
json.dump(res,open(out,'w'),indent=0)
print(len(res))
