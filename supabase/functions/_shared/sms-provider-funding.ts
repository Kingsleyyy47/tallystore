import {providerBalances} from './provider-balances.ts';
export type SmsFunding=Record<string,{status:'ready'|'unavailable';availableUsd:number;checkedAt:string}>;
export async function smsProviderFunding(providers:string[],fresh=false):Promise<SmsFunding>{
  const accounts=await providerBalances({kind:'sms',ids:[...new Set(providers)],fresh});
  return Object.fromEntries(accounts.map(account=>{
    const usd=account.balances.find(balance=>balance.currency==='USD');
    const available=Number(usd?.available);
    const ready=account.status==='ready'&&!!usd&&Number.isFinite(available)&&available>=0;
    return [account.id,{status:ready?'ready':'unavailable',availableUsd:ready?available:0,checkedAt:account.checked_at}];
  }));
}
export function smsOfferFunded(provider:string,price:number,funding:SmsFunding){
  const account=funding[provider];
  return account?.status==='ready'&&account.availableUsd>=price;
}
