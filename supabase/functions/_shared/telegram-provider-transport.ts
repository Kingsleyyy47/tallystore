// Preserve the Telegram adapter's public import while sharing bounded server
// transport with other supplier and exchange-rate requests.
export { serverJson as telegramProviderJson } from './server-json-transport.ts'
