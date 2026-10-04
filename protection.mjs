// Broker-held brackets are opt-in through frozen new-session settings.
export function bracketPrices(entry,settings){
 const stop=Math.floor(entry*(1-settings.stopPct/100)*100)/100;
 const target=Math.ceil(entry*(1+settings.takePct/100)*100)/100;
 if(!Number.isFinite(stop)||stop<=0||stop>=entry-.009||target<=entry)throw Error('Invalid protective bracket prices.');
 return {stop,target};
}

// Nested legs are separate orders. Deduplicate by broker ID, never count the parent twice.
export function flattenOrders(orders){
 const byId=new Map();
 function visit(order){
  if(!order?.id)throw Error('Broker order is missing its identity.');
  const {legs,...value}=order;byId.set(order.id,{...byId.get(order.id),...value});
  for(const leg of legs||[])visit(leg);
 }
 for(const order of orders)visit(order);
 return [...byId.values()];
}

export function adoptLegs(intents,parents){
 function visit(remote,parent){
  for(const leg of remote.legs||[]){
   if(leg.symbol!==parent.symbol||leg.side!=='sell'||!leg.id||!leg.client_order_id)throw Error('Unexpected protective order identity.');
   if(!['limit','stop','stop_limit'].includes(leg.type)||!Number.isFinite(Number(leg.qty))||Number(leg.qty)<=0||Number(leg.qty)>Number(parent.qty))throw Error('Invalid protective order quantity or type.');
   const existing=intents.find(i=>i.brokerId===leg.id||i.client_order_id===leg.client_order_id);
   if(existing&&existing.parentId!==parent.client_order_id)throw Error('Protective order ownership conflict.');
   if(!existing)intents.push({symbol:leg.symbol,side:'sell',qty:leg.qty,client_order_id:leg.client_order_id,brokerId:leg.id,parentId:parent.client_order_id,protective:true,type:leg.type,stop_price:leg.stop_price,limit_price:leg.limit_price,status:leg.status,filled_qty:leg.filled_qty||'0',filled_avg_price:leg.filled_avg_price,filled_at:leg.filled_at,createdAt:leg.created_at||parent.createdAt,strategy:parent.strategy,reason:leg.type==='limit'?'Broker profit target':'Broker stop'});
  }
 }
 for(const remote of parents){const parent=intents.find(i=>i.client_order_id===remote.client_order_id&&i.side==='buy'&&i.order_class==='bracket');if(parent)visit(remote,parent);}
}
