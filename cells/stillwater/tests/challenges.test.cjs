// Run after bundling client/challenges.ts to /tmp/stillwater-challenges.cjs.
const assert=require('node:assert/strict');
const C=require('/tmp/stillwater-challenges.cjs');
let seed=67890;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
let tested=0;
for(let band=1;band<=5;band++)for(const skill of C.SKILLS[band])for(let i=0;i<400;i++){
 const c=C.makeChallenge(band,skill,rand);
 assert(C.accepts(c,c.answers),C.equation(c));
 assert(c.answers.every(n=>Number.isInteger(n)&&n>=0&&n<=144));
 assert(!C.accepts(c,[]));assert(!C.accepts(c,[NaN]));assert(!C.accepts(c,c.answers.map(x=>x+.5)));
 if(skill==='pairs'){
  for(let a=2;a<=12;a++)for(let b=2;b<=12;b++)assert.equal(C.accepts(c,[a,b]),a*b===c.total);
  assert(!C.accepts(c,[1,c.total]));
 }else{
  assert(!C.accepts(c,[c.answers[0]+1]));
 }
 tested++;
}
// Regression examples requested by the user; validation does not demand the seeded pair.
const pair={...C.makeChallenge(5,'pairs',rand),left:C.op('×',C.slot(0),C.slot(1)),right:42,total:42,answers:[6,7]};
assert(C.accepts(pair,[6,7]));assert(C.accepts(pair,[7,6]));assert(!C.accepts(pair,[2,21]));
const bond={...C.makeChallenge(1,'bond',rand),left:12,right:C.op('+',C.slot(),7),answers:[5]};
assert(C.accepts(bond,[5]));assert(!C.accepts(bond,[19]));
const zero={...bond,left:7,right:C.op('+',C.slot(),7),answers:[0]};assert(C.accepts(zero,[0]));
let learner=new C.Curriculum();learner.counted(true);learner.counted(true);assert.equal(learner.data.band,0);learner.counted(true);assert.equal(learner.data.band,1);
for(let i=0;i<160&&learner.data.band<5;i++){const c=learner.next(rand);learner.record(c,true);}
assert.equal(learner.data.band,5,'clean varied answers should advance without counting grind');
learner=new C.Curriculum({band:2});
for(let i=0;i<50;i++){const c=learner.next(rand);learner.record(c,false);}assert.equal(learner.data.band,2,'help/guesses do not prove readiness');
const restored=new C.Curriculum(JSON.parse(JSON.stringify(learner.data)));assert.deepEqual(restored.data,learner.data);
assert.equal(new C.Curriculum(null,.8).data.band,3,'legacy proficiency supplies a starting point, not mastered skills');
const forms=new Set();learner=new C.Curriculum({band:5});for(let i=0;i<50;i++){const c=learner.next(rand);forms.add(c.skill);learner.record(c,true);}for(const s of C.SKILLS[5])assert(forms.has(s),s);
console.log(`PASS ${tested} generated equations; exhaustive factor alternatives; invalid answers; user examples; progression, support and save migration`);
