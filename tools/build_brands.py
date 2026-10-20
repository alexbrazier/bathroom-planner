# Usage: build_brands.py products.json cache_dir out_catalog.json img_dir img_prefix brand
import re,sys,json,html,hashlib,os,subprocess,collections,concurrent.futures as cf
P=json.load(open(sys.argv[1])); CACHE=sys.argv[2]; OUT=sys.argv[3]; IMG=sys.argv[4]; PREFIX=sys.argv[5]; BRAND=sys.argv[6]
os.makedirs(IMG,exist_ok=True)
GERMAN=re.compile(r'folie|beschichtung|verspiegelt|unterschrank|auszüg|waschtisch|ß|\bmit\b|schwarz|eiche|grau\b|glanz|chrom\b|weiss|edelstahl|gebürstet|gold optic|messing|armatur|^weiß',re.I)
def lines(url):
    f=os.path.join(CACHE,hashlib.md5(url.encode()).hexdigest()+'.html')
    if not os.path.exists(f): return [], ''
    s=open(f,encoding='utf8').read()
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S); t=re.sub(r'<[^>]+>','\n',t)
    return [l.strip() for l in html.unescape(t).split('\n') if l.strip()], s
def num(x):
    x=x.replace(',','.').strip('.')
    m=re.match(r'\d+(?:\.\d+)?',x)
    return float(m.group(0)) if m else 0.0
def dims(p,L):
    w=d=h=None
    for i,l in enumerate(L[:400]):
        nx=L[i+1] if i+1<len(L) else ''
        m=re.match(r'^([\d.,]+)\s*(cm|mm)$',nx)
        if not m: continue
        v=num(m.group(1))*(10 if m.group(2)=='cm' else 1)
        if l in('Width:','Breite:') and w is None: w=v
        elif l in('Depth:','Tiefe:','Projection:','Ausladung:') and d is None: d=v
        elif l in('Height:','Höhe:') and h is None: h=v
        if w and d and h: break
    s=p.get('dims') or ''
    # baths give "L: 180 W: 80 H: 48 cm" — length is our width, W is our depth
    keys=(('L','w'),('W','d'),('B','d'),('H','h')) if re.search(r'\bL:\s*\d',s) else (('W','w'),('B','w'),('D','d'),('T','d'),('H','h'))
    if re.search(r'\bL:\s*\d',s): w=d=None
    for k,var in keys:
        m=re.search(r'\b'+k+r':\s*([\d.,]+)',s)
        if m:
            v=num(m.group(1))*10
            if var=='w' and w is None: w=v
            if var=='d' and d is None: d=v
            if var=='h' and h is None: h=v
    nm=p.get('name') or ''
    m=re.search(r'(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm)',nm)
    if m:
        f=10 if m.group(4)=='cm' else 1
        a,b=num(m.group(1))*f,num(m.group(2))*f
        if w is None: w=a
        if d is None and h is None: d=b
    m=re.search(r'Ø\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)',nm)
    if m and w is None: w=num(m.group(1))*(10 if m.group(2)=='cm' else 1)
    return w,d,h
def kind_of(cat,name):
    n=name.lower(); c=cat.lower()
    if BRAND!='hansgrohe':
        if 'viclean' in c or 'viclean' in n:
            return None if re.search(r'seat|lid|remote|spare|kit|set for|cover', n) else 'toilet'
        if 'washbasin' in c:
            if re.search(r'surface-mounted|countertop|bowl|top-mounted',n): return 'ctbasin'
            return 'basin'
        if 'vanity' in c: return 'vanity'
        if 'tall' in c or 'side cabinet' in c: return 'tall'
        if 'mirror' in c: return 'mirror'
        if 'wc' in c or 'bidet' in c: return 'wc' if re.search(r'floor|stand|close-coupled|back-to-wall',n) else 'toilet'
        if 'bathtub' in c: return 'bath'
        if 'mixer' in c:
            if re.search(r'shower|thermostat',n) and re.search(r'concealed|flush|wall|in-wall',n): return 'showervalve'
            if re.search(r'wall|concealed|flush',n): return 'walltap'
            if re.search(r'shower',n): return 'showervalve'
            return 'tap'
        return None
    # hansgrohe — hand-shower kits first (their names mention hoses, which the skip rule below would drop)
    if re.search(r'shower sets with shower holder', c) or re.search(r'porter set|holder set|duschkopfhalterungset|bidette', n): return 'porterset'
    if re.search(r'shower sets with shower bar', c): return 'showerrail'
    if 'fixfit' in n and 'porter' in n: return 'porter'
    if re.search(r'fixfit|wall outlet|wall connection elbow|hose connection', n) and not re.search(r'spare|seal|o-ring', n): return 'walloutlet'
    if re.search(r'\bporter', n): return 'porter'
    if re.search(r'spare|cartridge|basic set|ibox|basic body|hose|cover|connector|adapter|extension|seal|o-ring|aerator|installation (?:box|set|kit|unit)|rough|mounting|repair|filter|cleaning|^set ', n): return None
    if re.search(r'towel ring|towel holder|towel bar|towel rail|towel hook|bath towel|hand towel|hook', n): return 'towelholder'
    if 'accessoir' in c or re.search(r'addstoris|wallstoris|logis universal', c): return 'accessory'
    if 'showerpipe' in n or 'showerpipe' in c: return 'showerrail'
    if re.search(r'shower set|wall bar|shower rod|shower rail|unica|shower system', n): return 'showerrail'
    if re.search(r'hand shower|handshower', n): return 'handshower'
    if re.search(r'overhead shower|head shower|rain shower|rainmaker|ceiling shower|overhead', n): return 'showerhead'
    if re.search(r'thermostat|showerselect|rainselect|shower mixer|bath mixer for concealed|shower valve|mixer for concealed installation|concealed', n) and not re.search(r'basin|washbasin', n): return 'showervalve'
    if re.search(r'basin|washbasin', n):
        return 'walltap' if re.search(r'wall|concealed|flush', n) else 'tap'
    if re.search(r'bath mixer|bath spout|tub', n): return 'tap'
    return None
def front_of(name):
    n=name.lower()
    if BRAND=='Villeroy & Boch':
        return 'integrated' if 'collaro' in n else 'plain'
    return 'plain'
def clean(name):
    n=re.sub(r'^(Villeroy & Boch|hansgrohe)\s+','',name or '',flags=re.I)
    n=re.sub(r'\s*\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\s*(cm|mm)','',n)
    n=re.sub(r'\s*Ø?\s*\d+(?:[.,]\d+)?\s*(cm|mm)\b','',n)
    n=re.sub(r'\s+(in|,)\s*(matt|glossy|alpine|stone|chrome|black|white|brushed|polished)[^,]*$','',n,flags=re.I)
    n=re.sub(r'\s{2,}',' ',n).strip(' ,-')
    return n
models=collections.OrderedDict(); imgjobs={}
for p in P:
    name=p.get('name') or ''
    k=kind_of(p['cat'],name)
    if BRAND=='hansgrohe' and not name.lower().startswith('hansgrohe'): continue
    if not k or GERMAN.search(name) or re.search(r'\bseat\b',name,re.I) and k in ('toilet','wc'): continue
    L,_=lines(p['url'])
    w,d,h=dims(p,L)
    if not w:
        # fittings often list only height/projection: use the head size if given, else a typical body width
        head=next((num(m.group(1)) for l in L[:700] for m in [re.search(r'(?:shower head size|head diameter|spray disc)[^\d]{0,12}(\d+)\s*mm',l,re.I)] if m), None)
        typical={'tap':50,'walltap':160,'showervalve':155,'porterset':120,'handshower':110,'porter':60,'walloutlet':60,'showerhead':250}
        if k in typical: w=head or typical[k]
    if not w: continue
    defaults={'walltap':(60,180),'tap':(160,170),'showervalve':(80,160),'showerhead':(400,40),'handshower':(80,250),'showerrail':(100,1000),'towelholder':(70,60),'accessory':(100,100),'porterset':(130,330),'porter':(70,90),'walloutlet':(60,50)}
    if k in defaults:
        dd,hh=defaults[k]; d=d or dd; h=h or hh
    if not d or not h:
        if k=='basin': h=h or 165; d=d or 470
        elif k=='mirror': d=d or 40; h=h or 750
        elif k in('toilet','wc'): h=h or 350
        elif k=='bath': h=h or 470
        if not d or not h: continue
    if k=='bath' and h<540: h+=110  # tub height + leg set = rim height off the floor
    rng = p['range'] if BRAND!='hansgrohe' else re.split(r'\s*\|\s*', p['cat'])[0]
    rng_label={'collaro':'Collaro','subway':'Subway 3.0','viclean':'ViClean','Shower sets with shower holder':'Hand shower sets','Shower sets with shower bar':'Shower rail sets','Wall outlets':'FixFit & Porter','Shower holders':'FixFit & Porter'}.get(rng,rng)
    cname=clean(name)
    mid=re.sub(r'[^a-z0-9]+','-',(PREFIX+' '+rng_label+' '+k+' '+cname).lower()).strip('-')[:120]
    nl=name.lower()
    mm=re.search(r'(\d)\s*(?:drawers?|pull-outs?)',nl); nd=int(mm.group(1)) if mm else 0
    mdoor=re.search(r'(\d)\s*doors?',nl); ndo=int(mdoor.group(1)) if mdoor else (1 if 'door' in nl else 0)
    m=models.setdefault(mid,{'id':mid,'name':(BRAND+' '+cname) if BRAND!='hansgrohe' else 'hansgrohe '+cname,'brand':BRAND,'range':rng_label,'cat':p['cat'],'kind':k,
        'front':front_of(name),'drawers':min(nd,2),'cols':2 if nd>=4 else 1,'doors':0 if nd else min(ndo,2),
        'hinge':'L' if re.search(r'hinged left|left hinged|left-hinged|hinge left',nl) else ('R' if re.search(r'hinged right|right hinged|right-hinged|hinge right',nl) else ''),
        'double':'double' in nl,'mtm':False,'showertoilet':'viclean' in nl,'shape':'round' if re.search(r'round|oval|circle|ring|\bs\b|croma 100|crometta 85|select s',nl) and not re.search(r'\b(e|q)\b|angular|square|softcube',nl) else 'rect','sizes':{}})
    sk=f'{round(w)}x{round(d)}x{round(h)}'
    sz=m['sizes'].setdefault(sk,{'w':round(w),'d':round(d),'h':round(h),'variants':[]})
    img=p.get('image')
    imgid=img.rstrip('/').split('/')[-1] if img else None
    thumb=None
    if imgid:
        thumb=f'data/img/{PREFIX}/{imgid}.webp'; imgjobs[imgid]=thumb
    seen={v['colour'] for v in sz['variants']}
    cols=[]
    if p.get('color'): cols.append((p['color'], p.get('price')))
    for v in p.get('variants',[]):
        c=v.get('colour front') or v.get('colour') or v.get('surface') or v.get('finish') or v.get('colour/surface')
        if c: cols.append((c, v.get('price')))
    for c,pr in cols:
        c=c.strip()
        if not c or GERMAN.search(c) or c.lower() in seen: continue
        seen.add(c.lower())
        sz['variants'].append({'sku':p.get('mpn') or '','colour':c[:1].upper()+c[1:],'price':f'€{float(pr):,.2f}' if pr else '','img':thumb,'url':p['url']})
    if not sz['variants']:
        sz['variants'].append({'sku':p.get('mpn') or '','colour':'Chrome' if k in('tap','walltap','showervalve','showerhead','handshower','showerrail','towelholder','accessory') else 'White','price':f"€{float(p['price']):,.2f}" if p.get('price') else '','img':thumb,'url':p['url']})
    sz.setdefault('thumb',thumb)
out=[]
for m in models.values():
    m['sizes']=sorted(m['sizes'].values(),key=lambda s:(s['w'],s['d'],s['h']))[:24]
    for s in m['sizes']: s['variants']=s['variants'][:14]
    m['thumb']=m['sizes'][0].get('thumb')
    out.append(m)
def dl(item):
    imgid,path=item
    fn=os.path.join(IMG,imgid+'.webp')
    if os.path.exists(fn) and os.path.getsize(fn)>500: return True
    u=f'https://www-megabad-com-res.cloudinary.com/image/upload/ar_1:1,c_pad,b_white,w_360/q_auto:good/f_webp/{imgid}'
    subprocess.run(['curl','-sL','--max-time','60','-A','Mozilla/5.0','-o',fn,u])
    if os.path.exists(fn) and os.path.getsize(fn)>500: return True
    if os.path.exists(fn): os.remove(fn)
    return False
# every image the output references: size thumbs and each colour variant's own photo
used={s.get('thumb') for m in out for s in m['sizes']}|{v['img'] for m in out for s in m['sizes'] for v in s['variants']}
jobs=[(i,p) for i,p in imgjobs.items() if p in used]
with cf.ThreadPoolExecutor(16) as ex: ok=list(ex.map(dl,jobs))
bad={p for (i,p),o in zip(jobs,ok) if not o}
for m in out:
    for s in m['sizes']:
        if s.get('thumb') in bad: s['thumb']=None
        for v in s['variants']:
            if v['img'] in bad: v['img']=s.get('thumb')  # fall back to the size's photo
    m['thumb']=m['sizes'][0].get('thumb')
json.dump(out,open(OUT,'w'),separators=(',',':'))
print(len(out),'models',sum(len(m['sizes']) for m in out),'sizes; images',sum(ok),'/',len(ok),file=sys.stderr)
print(collections.Counter(m['kind'] for m in out),file=sys.stderr)
