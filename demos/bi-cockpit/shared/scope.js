export function detailScope(state,model,source='global'){
 const point=source==='local'?model.trends.find(p=>p.date===state.evidenceDate):null;
 return {start:point?.date||state.start,end:point?.end||state.end,shop:source==='local'?state.selectedShop||state.shop:source==='explore'?state.exploreShop||state.shop:state.shop,platform:source==='explore'?state.explorePlatform||state.platform:state.platform};
}
