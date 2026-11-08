import json, statistics, collections
from math import comb
# Run from the worktree root: python3 -I docs/research/jev-1-14-vs-1-13/paired.py
B='docs/research/jev-1-14-vs-1-13/raw/'
P={('1.13',1):'mae832-jev-1.13.0',('1.14',1):'mae832-jev-1.14.0',('1.13',2):'mae832-jev-1.13.0-round2',('1.14',2):'mae832-jev-1.14.0-round2'}
D={}
for k,p in P.items():
    D[k]={(r['suite'],r['scenarioId'],r['repeat']):r for r in json.load(open(B+p+'/records.json'))}
def scored(r): return r.get('score') is not None
def passed(r): return bool(r['score']['pass'])
def cheap(r): return passed(r) and r.get('fallbackCalls',0)==0
def mc(n,k):
    return min(1.0,2*sum(comb(n,i) for i in range(0,min(k,n-k)+1))/2**n) if n else 1.0
for k,d in D.items():
    s=[r for r in d.values() if scored(r)]
    print(k,len(d),len(s),sum(passed(r) for r in s),sum(cheap(r) for r in s))
def table(rounds,f):
    t=[0,0,0,0]
    for rd in rounds:
        for key,a in D[('1.13',rd)].items():
            b=D[('1.14',rd)].get(key)
            if b is None or not scored(a) or not scored(b): continue
            x,y=f(a),f(b)
            if x and y:t[0]+=1
            elif not x and not y:t[1]+=1
            elif x:t[2]+=1
            else:t[3]+=1
    return t,mc(t[2]+t[3],min(t[2],t[3]))
for name,f in (('pass',passed),('cheap',cheap)):
    for lab,rs in (('r1',[1]),('r2',[2]),('comb',[1,2])):
        t,p=table(rs,f); print(name,lab,'both',t[0],'neither',t[1],'1.13only',t[2],'1.14only',t[3],'p=%.4f'%p)
# per scenario
agg=collections.defaultdict(lambda:{'1.13':0,'1.14':0,'n':0}); recs=collections.defaultdict(list)
for rd in (1,2):
    for key,a in D[('1.13',rd)].items():
        b=D[('1.14',rd)].get(key)
        if b is None or not scored(a) or not scored(b): continue
        sk=key[:2]; g=agg[sk]; g['1.13']+=passed(a); g['1.14']+=passed(b); g['n']+=1
        if not passed(b): recs[sk].append(b)
gt=sum(g['1.13']>g['1.14'] for g in agg.values()); lt=sum(g['1.13']<g['1.14'] for g in agg.values()); eq=len(agg)-gt-lt
print('scenarios',len(agg),'1.13>',gt,'1.14>',lt,'eq',eq,'sign p=%.4f'%mc(gt+lt,min(gt,lt)))
top=sorted(agg.items(),key=lambda kv:-(kv[1]['1.13']-kv[1]['1.14']))[:5]
for sk,g in top:
    c=collections.Counter()
    for r in recs[sk]:
        ss=r.get('stageScores',{})
        bad=[s for s,v in ss.items() if isinstance(v,dict) and v.get('pass') is False]
        c[(tuple(bad),r.get('fallbackCalls'))]+=1
    print(sk,g,dict(c))
for m in ('1.13','1.14'):
    v=[r['turnMs'] for rd in (1,2) for r in D[(m,rd)].values() if r.get('turnMs') is not None]
    print(m,'median turnMs',round(statistics.median(v)),len(v))
