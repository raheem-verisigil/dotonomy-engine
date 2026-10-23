export function funnel(evs){const by=t=>evs.filter(e=>e.type===t),ws=t=>new Set(by(t).map(e=>e.ws)),runs={},days={};
 by('run').forEach(e=>{runs[e.ws]=(runs[e.ws]||0)+1;(days[e.ws]??=new Set()).add(String(e.at).slice(0,10))});const a=Object.keys(runs);
 return{demo_runs:by('demo_run').length,signups:ws('signup').size,activated_first_run:a.length,three_or_more_runs:a.filter(w=>runs[w]>=3).length,returned_on_another_day:a.filter(w=>days[w].size>=2).length,calendar_connected:ws('connector_connected').size,unlocked_demo_switch:ws('unlock').size,
  note:'unlock is a demo switch, not a payment. Paid conversion cannot be measured until billing exists.'}}
