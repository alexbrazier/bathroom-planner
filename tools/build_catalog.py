import json,re,sys,os,subprocess,html,collections,concurrent.futures as cf
D=sys.argv[1]; OUT=sys.argv[2]
J=json.load(open(f'{D}/luna_joined.json'))
CM=json.load(open(f'{D}/colours.json'))
cache_f=f'{D}/colour_cache.json'
cache=json.load(open(cache_f)) if os.path.exists(cache_f) else {}
SKIP=re.compile(r'push open|grommet|overflow|waste|^(led|internal|light|battery)|downlight|light in |lighting in|light for|lamp|connector kit|interior pack|drawer insert|storage tray|el-box|sensor|laundry|remote|support rail|fixing bracket|infill|legs|divider|bottle trap|drainage|metal shelf|seal|profile|spacer|squeegee|tower|handle for match|corner|wall support|ceiling support|extension|floor profile|bath panel|^h - ',re.I)
def kind(cat,name):
    n=name.lower()
    if cat=='vanity-units': return 'vanity'
    if cat=='cabinets':
        if n.startswith('tall'): return 'tall'
        if n.startswith('wall'): return 'wall'
        if n.startswith('open shelf'): return 'shelf'
        if n.startswith('open unit'): return 'open'
        return 'base'
    if cat=='basins':
        return 'ctbasin' if 'countertop' in n else 'basin'
    if cat=='mirrors': return 'shelf' if 'shelf' in n and 'present' not in n else 'mirror'
    if cat=='mirror-cabinets': return 'mirrorcab'
    if cat=='worktops': return 'console' if 'console' in n else 'worktop'
    if cat=='toilets-incl-seat': return 'toilet'
    if cat=='heated-towel-rails': return 'towelrail'
    if cat=='showers': return 'glass'
    return 'other'
def dims(s):
    m=dict((k,float(v)) for k,v in re.findall(r'([HWD])([\d.]+)',s))
    return round(m.get('W',0)*10),round(m.get('D',0)*10),round(m.get('H',0)*10)
def img(u,w=360):
    if not u: return None
    u=u.replace('https://mediabank.dansani.dk/cdn/','https://www.dansani.co.uk/mediabank/cdn/')
    return u.split('&')[0]+f'&rmode=max&width={w}&format=webp&quality=80'
def colour_of(v):
    m=re.match(r'^[A-Z]\d\d-[0-9A-Z]{2}(\w\w)$',v['sku'])
    if m and CM.get(m.group(1)): return CM[m.group(1)]
    return cache.get(v['sku'])
def fetch_colour(v):
    s=subprocess.run(['curl','-sL','--max-time','60','-A','Mozilla/5.0',v['url']],capture_output=True).stdout.decode('utf8','replace')
    t=re.sub(r'<[^>]+>','\n',re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S)); L=[l.strip() for l in html.unescape(t).split('\n') if l.strip()]
    try: return L[L.index('Colour')+1]
    except ValueError: return ''
items=[v for v in J if 'name' in v and not SKIP.search(v['name']) and v['cat']!='handles']
items=[v for v in items if v['cat']!='showers' or re.match(r'^[A-E]-? ?|^D-|^Sliding',v['name'])]
need=[v for v in items if colour_of(v) is None]
print('fetch colours',len(need),file=sys.stderr)
with cf.ThreadPoolExecutor(16) as ex:
    for v,c in zip(need,ex.map(fetch_colour,need)): cache[v['sku']]=c
json.dump(cache,open(cache_f,'w'))
def front(n):
    n=n.lower()
    for k,l in [('black frame','blackframe'),('curved','curved'),('fluted','fluted'),('framed','framed'),('grooved','grooved'),('integrated handle','integrated'),('open shelf','openshelf')]:
        if k in n: return l
    return 'plain'
models=collections.OrderedDict()
for v in items:
    name=v['name']; k=kind(v['cat'],name)
    mid=re.sub(r'[^a-z0-9]+','-',(v['cat']+' '+name).lower()).strip('-')
    w,d,h=dims(v['dimensions'])
    m=models.setdefault(mid,{'id':mid,'name':name,'cat':v['cat'],'kind':k,'front':front(name),
        'drawers':2 if '2 drawers' in name else (1 if '1 drawer' in name else 0),
        'doors':2 if '2 doors' in name or '2 mirror doors' in name else (1 if '1 door' in name or 'hinged' in name else 0),
        'hinge':'L' if 'left hand' in name.lower() else ('R' if 'right hand' in name.lower() else ''),
        'double':'double' in name.lower(),'mtm':'made to measure' in name.lower(),'sizes':{}})
    sk=f'{w}x{d}x{h}'
    sz=m['sizes'].setdefault(sk,{'w':w,'d':d,'h':h,'variants':[]})
    sz['variants'].append({'sku':v['sku'],'colour':colour_of(v) or '','price':v.get('price',''),'img':img((v.get('image') or {}).get('urlOriginal')),'url':v['url']})
out=[]
for m in models.values():
    m['sizes']=sorted(m['sizes'].values(),key=lambda s:(s['w'],s['d'],s['h']))
    for s in m['sizes']:
        s['variants'].sort(key=lambda x:(x['colour']!='White matt',x['colour']))
    # shape hints for mirrors/basins
    n=m['name'].lower()
    m['shape']='round' if re.search(r'hoop|moon|circle|globe|orbit|round',n) else ('squircle' if 'squircle' in n or 'soft' in n else ('oval' if re.search(r'ellipse|stadium|corona|oval',n) else 'rect'))
    if 'moon' in n or 'corona' in n: m['shape']='oval'
    out.append(m)
print(len(out),'models',sum(len(m['sizes']) for m in out),'sizes',file=sys.stderr)
json.dump(out,open(OUT,'w'),separators=(',',':'))
