// Draw Jev's pair answers as a matrix page: bun eval/judge-graph-html.ts eval/runs/judge-jev/graph-part-a.json out.html
const g = await Bun.file(Bun.argv[2]!).json();
const known = new Set(["ТР-07 (Ф-3)|ТР-08 (Ф-4)", "ТР-06 (Ф-2)|ТР-14"]);
const data = JSON.stringify({ nodes: g.nodes, edges: g.edges, known: [...known], model: g.model });
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Связи требований по Jev</title>
<style>
:root{--surface:#ffffff;--text:#191919;--text2:#666666;--grid:#e6e6e6;--critical:#dc3c3d;--s100:#cce3fd;--s700:#0e3d7e}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--surface:#191919;--text:#efefef;--text2:#9c9c9c;--grid:#333333;--critical:#eb6263;--s100:#1e2a3a;--s700:#84b9f3}}
:root[data-theme="dark"]{--surface:#191919;--text:#efefef;--text2:#9c9c9c;--grid:#333333;--critical:#eb6263;--s100:#1e2a3a;--s700:#84b9f3}
body{margin:0;background:var(--surface);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px}
h1{font-size:20px;margin:0 0 4px} p{margin:4px 0 12px;color:var(--text2);max-width:760px}
.wrap{overflow-x:auto} svg text{fill:var(--text);font-size:12px} .lab{fill:var(--text2)}
.legend{display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin:8px 0 14px;color:var(--text2);font-size:13px}
.ramp{width:140px;height:10px;border-radius:2px;background:linear-gradient(90deg,var(--s100),var(--s700))}
.ring{width:12px;height:12px;border:2px solid var(--critical);border-radius:2px;display:inline-block;vertical-align:middle}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--text);border:1px solid var(--grid);border-radius:6px;padding:8px 10px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;max-width:320px}
table{border-collapse:collapse;font-size:12px;margin-top:16px} td,th{border-bottom:1px solid var(--grid);padding:4px 8px;text-align:left}
</style></head><body><main>
<h1>Связи требований части A по TypeSafe Jev</h1>
<p>Для каждой пары из 14 требований Jev выбрал «противоречат», «уточняет или проверяет» или «не связаны». Цвет клетки — вероятность «уточняет или проверяет». Красной рамкой отмечены два противоречия из нашего списка известных дефектов. Jev ни одну пару не отнёс к противоречиям: Ф-3 и Ф-4 у него первые по вероятности противоречия, но всего 0.08, а пару «Ф-2 и критерий про 31 января» он считает уточнением с уверенностью 0.97.</p>
<div class="legend"><span>вероятность «уточняет или проверяет»: 0</span><span class="ramp"></span><span>1</span><span><span class="ring"></span> известное противоречие</span></div>
<div class="wrap"><svg id="m" role="img" aria-label="Матрица связей требований"></svg></div>
<details><summary>Таблица всех пар</summary><table id="t"><thead><tr><th>Пара</th><th>Ответ Jev</th><th>Уверенность</th><th>P(противоречат)</th></tr></thead><tbody></tbody></table></details>
<div id="tip"></div>
<script>
const D=${data};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const x=hex(a),y=hex(b);return "rgb("+x.map((v,i)=>Math.round(v+(y[i]-v)*t)).join(",")+")"};
const N=D.nodes.map(n=>n.id), cell=34, gap=2, left=118, top=10;
const key=(a,b)=>a+"|"+b, E=new Map(D.edges.map(e=>[key(e.a,e.b),e]));
const ru={conflict:"противоречат",refines:"уточняет или проверяет",none:"не связаны"};
function draw(){
 const svg=document.getElementById("m"); const w=left+N.length*(cell+gap)+10, h=top+N.length*(cell+gap)+90;
 svg.setAttribute("width",w); svg.setAttribute("height",h); svg.innerHTML="";
 const lo=css("--s100"), hi=css("--s700");
 N.forEach((r,i)=>{ const y=top+i*(cell+gap);
  const t=document.createElementNS("http://www.w3.org/2000/svg","text"); t.setAttribute("x",left-8); t.setAttribute("y",y+cell/2+4); t.setAttribute("text-anchor","end"); t.textContent=r; svg.appendChild(t);
  N.forEach((c,j)=>{ if(j>=i) return; const e=E.get(key(c,r))||E.get(key(r,c)); if(!e) return;
   const x=left+j*(cell+gap); const p=e.probabilities.refines;
   const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
   Object.entries({x,y,width:cell,height:cell,rx:4,fill:mix(lo,hi,p)}).forEach(([k,v])=>rect.setAttribute(k,v));
   const isKnown=D.known.includes(key(e.a,e.b));
   if(isKnown){rect.setAttribute("stroke",css("--critical"));rect.setAttribute("stroke-width",3)}
   rect.addEventListener("mousemove",ev=>{const tip=document.getElementById("tip");tip.style.display="block";tip.style.left=(ev.clientX+14)+"px";tip.style.top=(ev.clientY+14)+"px";
    tip.innerHTML="<b>"+e.a+" — "+e.b+"</b><br>Jev: "+ru[e.choice]+", уверенность "+e.confidence.toFixed(2)+"<br>P(противоречат) "+e.probabilities.conflict.toFixed(2)+" · P(уточняет) "+e.probabilities.refines.toFixed(2)+" · P(не связаны) "+e.probabilities.none.toFixed(2)+(isKnown?"<br><b>Известное противоречие</b>":"")});
   rect.addEventListener("mouseleave",()=>document.getElementById("tip").style.display="none");
   svg.appendChild(rect);
  });
 });
 N.forEach((c,j)=>{ if(j===N.length-1) return; const x=left+j*(cell+gap)+cell/2, y=top+N.length*(cell+gap)+4;
  const t=document.createElementNS("http://www.w3.org/2000/svg","text"); t.setAttribute("transform","translate("+x+","+y+") rotate(50)"); t.setAttribute("class","lab"); t.textContent=c; svg.appendChild(t);});
}
draw(); matchMedia("(prefers-color-scheme: dark)").addEventListener("change",draw);
const tb=document.querySelector("#t tbody");
[...D.edges].sort((a,b)=>b.probabilities.conflict-a.probabilities.conflict).forEach(e=>{const tr=document.createElement("tr");tr.innerHTML="<td>"+e.a+" — "+e.b+"</td><td>"+ru[e.choice]+"</td><td>"+e.confidence.toFixed(2)+"</td><td>"+e.probabilities.conflict.toFixed(2)+"</td>";tb.appendChild(tr)});
</script></main></body></html>`;
await Bun.write(Bun.argv[3]!, html);

export {};
