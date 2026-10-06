// Provider field contract: https://thelordofthepanels.com/api (verified 2026-10-05).
// Catalog rate/price is per 1000 units, except the two fixed package types.
// Subscriptions have open-ended billing; Media Likers needs an unimplemented media input.
export const SMM_UNAVAILABLE = 'This service is temporarily unavailable. Please choose another service.';
const contracts: Record<string, { mode: 'quantity' | 'comments' | 'usernames' | 'package'; fields: string[] }> = {
  Default: { mode: 'quantity', fields: ['link', 'quantity'] },
  Package: { mode: 'package', fields: ['link'] },
  'Custom Comments Package': { mode: 'package', fields: ['link', 'comments'] },
  'Custom Comments': { mode: 'comments', fields: ['link', 'comments'] },
  'Comment Replies': { mode: 'comments', fields: ['link', 'username', 'comments'] },
  'Mentions Custom List': { mode: 'usernames', fields: ['link', 'usernames'] },
  Mentions: { mode: 'quantity', fields: ['link', 'quantity', 'usernames'] },
  'Mentions with Hashtags': { mode: 'quantity', fields: ['link', 'quantity', 'usernames', 'hashtags'] },
  'Mentions Hashtag': { mode: 'quantity', fields: ['link', 'quantity', 'hashtag'] },
  'Mentions User Followers': { mode: 'quantity', fields: ['link', 'quantity', 'username'] },
  'Comment Likes': { mode: 'quantity', fields: ['link', 'quantity', 'username'] },
  Poll: { mode: 'quantity', fields: ['link', 'quantity', 'answer_number'] },
  SEO: { mode: 'quantity', fields: ['link', 'quantity', 'keywords'] },
  'Invites from Groups': { mode: 'quantity', fields: ['link', 'quantity', 'groups'] },
};
export const getSmmOrderContract = (type: string) => Object.prototype.hasOwnProperty.call(contracts, type) ? contracts[type] : null;
export const SMM_QUANTITY_TYPES = Object.keys(contracts).filter(type => contracts[type].mode === 'quantity');
export function normalizeSmmLines(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20_000 || /\0/.test(value)) throw new Error('Please check the order details.');
  return value.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean).join('\n');
}
const countLines = (value: unknown) => normalizeSmmLines(value).split('\n').filter(Boolean).length;
export type SmmPriceService = { service_type: string; price_ngn: number; min_quantity: number; max_quantity: number };
export function quoteSmmOrder(service: SmmPriceService, input: Record<string, unknown>) {
  const contract = getSmmOrderContract(service.service_type);
  if (!contract) throw new Error(SMM_UNAVAILABLE);
  const price = Number(service.price_ngn);
  if (!Number.isFinite(price) || price <= 0) throw new Error(SMM_UNAVAILABLE);
  const quantity = contract.mode === 'package' ? 1 : contract.mode === 'comments' ? countLines(input.comments)
    : contract.mode === 'usernames' ? countLines(input.usernames) : Number(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Quantity must be a whole number');
  if (contract.mode !== 'package') {
    const min = Number(service.min_quantity), max = Number(service.max_quantity);
    if (!Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(max) || max < min) throw new Error(SMM_UNAVAILABLE);
    if (quantity < min) throw new Error(`Minimum quantity is ${min}`);
    if (quantity > max) throw new Error(`Maximum quantity is ${max}`);
  }
  const amountNgn = Math.ceil(contract.mode === 'package' ? price : (price / 1000) * quantity);
  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1) throw new Error(SMM_UNAVAILABLE);
  return { quantity, amountNgn, package: contract.mode === 'package' };
}
export function validateSmmOrderFields(type: string, input: Record<string, unknown>): Record<string, string | number> {
  const contract = getSmmOrderContract(type);
  if (!contract) throw new Error(SMM_UNAVAILABLE);
  const output: Record<string, string | number> = {};
  for (const field of contract.fields.filter(field => field !== 'quantity')) {
    const item = input[field];
    if (field === 'answer_number') {
      const answer = Number(item);
      if (!Number.isSafeInteger(answer) || answer < 1) throw new Error('Please check the order details.');
      output[field] = answer;
    } else {
      if (typeof item !== 'string' || !item.trim() || item.length > 20_000 || /\0/.test(item)) throw new Error('Please check the order details.');
      const value = ['comments', 'usernames', 'hashtags', 'keywords', 'groups'].includes(field) ? normalizeSmmLines(item) : item.trim();
      if (!value) throw new Error('Please check the order details.');
      if (field === 'link') {
        let url: URL;
        try { url = new URL(value); } catch { throw new Error('Please enter a valid web link.'); }
        if (!['http:', 'https:'].includes(url.protocol) || value.length > 2048 || url.username || url.password) throw new Error('Please enter a valid web link.');
      }
      output[field] = value;
    }
  }
  return output;
}
