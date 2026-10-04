const baseline=Object.freeze({positionPct:25,grossPct:100,riskPct:.5,dailyLossPct:2,maxPositions:4,stopPct:1,takePct:2,participationPct:1});
export const PROFILES=Object.freeze({
 baseline:Object.freeze({name:'Corrected combined baseline',strategies:['breakout','reversion','momentum'],settings:baseline}),
 activity:Object.freeze({name:'Active opening breakout · experimental',strategies:['activity'],settings:baseline}),
 scalp:Object.freeze({name:'Aggressive scalp · paper experiment',strategies:['scalp'],settings:Object.freeze({
  positionPct:75,grossPct:75,riskPct:.5,dailyLossPct:2,maxPositions:1,stopPct:.4,takePct:.8,
  participationPct:1,maxHoldMinutes:15,cooldownMinutes:5,maxEntriesDay:8,maxSpreadBps:10,entryBufferBps:2
 })})
});
export const sessionSettings=baseline;
