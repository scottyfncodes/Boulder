# Fits the route grader's weights against the setters' grades. Run via `npm run fit:grades`;
# needs numpy. Board routes count at a third of a hand-set route: their grades
# came from the old "longer is harder" rule, so they are weak labels.
import json, numpy as np
def nnls(A,b,free=()):
    x=np.zeros(A.shape[1]); L=np.linalg.norm(A,2)**2
    for _ in range(200000):
        g=A.T@(A@x-b); x=x-g/L
        for i in range(len(x)):
            if i not in free: x[i]=max(0,x[i])
        x[7]=min(x[7],1.5)
    return x,None
def spear(a,b):
    ra=np.argsort(np.argsort(a)); rb=np.argsort(np.argsort(b)); return np.corrcoef(ra,rb)[0,1]
rows=json.load(open('node_modules/.cache/features.json'))
keys=['crux','sustained','meanDifficulty','maxPump','pumpAtCrux','tanks','complexity','length','steep','restsBeforeCrux','extraSolutions']
sign={'restsBeforeCrux':-1,'extraSolutions':-1}
X=np.array([[r['f'][k]*sign.get(k,1) for k in keys]+[1] for r in rows]); y=np.array([r['g'] for r in rows],float)
w=np.array([0.35 if r['board'] else 1.0 for r in rows])
# nonneg on all but bias: shift bias by allowing negative via two columns
Xb=np.hstack([X,-X[:,-1:]])
lam=0.3
A=np.vstack([Xb*np.sqrt(w)[:,None], np.sqrt(lam)*np.eye(Xb.shape[1])[:-2] if False else np.sqrt(lam)*np.hstack([np.eye(len(keys)),np.zeros((len(keys),2))])])
b=np.concatenate([y*np.sqrt(w), np.zeros(len(keys))])
coef,_=nnls(A,b)
W=coef[:len(keys)]; bias=coef[len(keys)]-coef[len(keys)+1]
pred=X[:,:-1]@W+bias
print({k:round(float(W[i]*sign.get(k,1)),2) for i,k in enumerate(keys)}, 'bias', round(float(bias),2))
print('spearman all', spear(pred,y), 'handset', spear(pred[:20],y[:20]))
print('MAE', np.mean(np.abs(np.round(pred)-y)), 'within1', np.mean(np.abs(np.round(pred)-y)<=1), 'within2', np.mean(np.abs(np.round(pred)-y)<=2))
for r,p in zip(rows,pred): print(r['id'].ljust(22), r['g'], round(p,1), {k:round(r['f'][k],2) for k in keys})
