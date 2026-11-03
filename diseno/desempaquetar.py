# Desempaqueta un export de Claude Design (__bundler/manifest) en sitio.html + assets/.
# Si una pantalla es a su vez un bundle, la desempaqueta en paginas/<n>-<titulo>.html (assets en paginas/assets/).
#   python3 -I diseno/desempaquetar.py "diseno/R.Costa Automóviles — Web.html" diseno
import sys,re,json,base64,gzip,os,unicodedata
EXT={'text/javascript':'js','application/javascript':'js','font/woff2':'woff2','image/png':'png','image/jpeg':'jpg','image/svg+xml':'svg','text/css':'css','text/html':'html','image/webp':'webp'}
def blk(s,t):
    m=re.search(r'<script type="'+re.escape(t)+r'">(.*?)</script>',s,re.S); return m.group(1) if m else None
def unpack(s,out,html_name,prefix='assets'):
    man=json.loads(blk(s,'__bundler/manifest'))
    tpl=json.loads(blk(s,'__bundler/template'))
    ext=json.loads(blk(s,'__bundler/ext_resources') or '[]')
    os.makedirs(out+'/assets',exist_ok=True)
    names={}
    for u,e in man.items():
        b=base64.b64decode(e['data'])
        if e.get('compressed'): b=gzip.decompress(b)
        x='woff2' if b[:4]==b'wOF2' else EXT.get(e['mime'],'bin')
        n=f'assets/{u}.{x}'
        open(f'{out}/{n}','wb').write(b)
        names[u]=n
    for r in ext: names[r['uuid']]=r['id']
    for u,n in names.items(): tpl=tpl.replace(u,n)
    open(f'{out}/{html_name}','w',encoding='utf-8').write(tpl)
    return tpl,names
def slug(t):
    t=unicodedata.normalize('NFD',t).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',t).strip('-')
src,out=sys.argv[1],sys.argv[2]
tpl,names=unpack(open(src,encoding='utf-8').read(),out,'sitio.html')
print('template',len(tpl))
for i,(u,title) in enumerate(re.findall(r'#assets/([0-9a-f-]+)\.html" title="([^"]+)"',tpl),1):
    s=open(f'{out}/assets/{u}.html',encoding='utf-8').read()
    if not blk(s,'__bundler/manifest'): continue
    n=f'{i:02d}-{slug(title)}.html'
    t,_=unpack(s,out+'/paginas',n)
    print(n,len(t))
