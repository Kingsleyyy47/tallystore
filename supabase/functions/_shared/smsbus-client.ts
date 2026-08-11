export type SmsBusCountry = {
  id: number
  title: string
  code: string
}

export type SmsBusProject = {
  id: number
  title: string
  code: string
}

export type SmsBusPrice = {
  country_id: number
  project_id: number
  cost: number
  total_count: number
  title?: string
  code?: string
}

export type SmsBusOtpNumber = {
  request_id: string | number
  number: string
}

export type SmsBusRentalArea = {
  area_code: string
  area_title: string
  unit_price: number
  min_month: number
  total: number
}

export type SmsBusRentalNumber = {
  order_id: string
  mobile_number: string
  dialing_code: string
  area_code: string
  expire_at: string
  keep_at: string
}

export type SmsBusResponse<T> = {
  code: number
  message: string
  data?: T
}

export class SmsBusApiError extends Error {
  code: number
  providerMessage: string
  status: string

  constructor(code: number, message: string) {
    super(message)
    this.name = 'SmsBusApiError'
    this.code = code
    this.providerMessage = message
    this.status = mapSmsBusStatus(code)
  }
}

function mapSmsBusStatus(code: number): string {
  const statusMap: Record<number, string> = {
    400: 'bad_request',
    401: 'bad_token',
    404: 'not_found',
    50001: 'no_service',
    50002: 'no_number',
    50004: 'no_number',
    50005: 'already_closed',
    50007: 'number_not_found',
    50101: 'waiting',
    50102: 'expired',
    50103: 'already_closed',
    50104: 'too_many_waiting_requests',
    50107: 'cannot_reuse',
    50108: 'cannot_reuse',
    50109: 'expired',
    50201: 'insufficient_provider_balance',
    50208: 'provider_account_not_activated',
    50214: 'provider_service_blocked',
    50401: 'no_area',
    50402: 'minimum_rent_not_met',
    50403: 'sms_received_cannot_cancel',
    50404: 'cannot_renew',
    50405: 'cancel_limit_reached',
  }

  return statusMap[code] || 'provider_error'
}

function valuesFromRecord<T>(data: Record<string, T> | T[] | undefined): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return Object.values(data)
}

function assertToken(token: string) {
  if (!token) {
    throw new Error('SMSBus API key is not configured')
  }
}

export function extractSmsCode(content: string): string | null {
  const match = content.match(/\b\d{4,8}\b/)
  return match?.[0] || null
}

export function createSmsBusClient(token: string) {
  assertToken(token)

  async function request<T>(
    baseUrl: string,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = new URL(path, baseUrl)
    url.searchParams.set('token', token)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    let response: Response | null = null
    let lastError: unknown = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })

        if (response.ok || response.status < 500) break
      } catch (error) {
        lastError = error
      }
    }

    if (!response) {
      throw new Error(lastError instanceof Error ? lastError.message : 'SMSBus network request failed')
    }

    let payload: SmsBusResponse<T>
    try {
      payload = await response.json()
    } catch {
      throw new Error(`SMSBus returned a non-JSON response with HTTP ${response.status}`)
    }

    if (payload.code !== 200) {
      throw new SmsBusApiError(payload.code, payload.message || 'SMSBus provider error')
    }

    return payload.data as T
  }

  return {
    async getBalance() {
      return request<{ frozen: number; balance: number }>('https://sms-bus.com', '/api/control/get/balance')
    },

    async listCountries() {
      const data = await request<Record<string, SmsBusCountry>>(
        'https://sms-bus.com',
        '/api/control/list/countries',
      )
      return valuesFromRecord(data)
    },

    async listProjects() {
      const data = await request<Record<string, SmsBusProject>>(
        'https://sms-bus.com',
        '/api/control/list/projects',
      )
      return valuesFromRecord(data)
    },

    async listPrices(countryId: number) {
      const data = await request<Record<string, SmsBusPrice>>(
        'https://sms-bus.com',
        '/api/control/list/prices',
        { country_id: countryId },
      )
      return valuesFromRecord(data)
    },

    async getNumber(countryId: number, projectId: number) {
      return request<SmsBusOtpNumber>('https://sms-bus.com', '/api/control/get/number', {
        country_id: countryId,
        project_id: projectId,
      })
    },

    async getSms(requestId: string) {
      return request<string>('https://sms-bus.com', '/api/control/get/sms', {
        request_id: requestId,
      })
    },

    async cancelRequest(requestId: string) {
      return request<unknown>('https://sms-bus.com', '/api/control/cancel', {
        request_id: requestId,
      })
    },

    async listRentalAreas() {
      return request<SmsBusRentalArea[]>('https://api.sms-bus.com', '/v1/rent/list/area')
    },

    async rentNumber(areaCode: string, months: number) {
      return request<SmsBusRentalNumber>('https://api.sms-bus.com', '/v1/rent/get/number', {
        area_code: areaCode,
        time: months,
      })
    },

    async renewRental(areaCode: string, mobileNumber: string, months: number) {
      return request<SmsBusRentalNumber>('https://api.sms-bus.com', '/v1/rent/renew/number', {
        area_code: areaCode,
        mobile_number: mobileNumber,
        time: months,
      })
    },

    async cancelRental(orderId: string) {
      return request<unknown>('https://api.sms-bus.com', '/v1/rent/cancel/order', {
        order_id: orderId,
      })
    },

    async getRentalSms(areaCode: string, mobileNumber: string) {
      return request<{ content: string; receive_at?: string }>('https://api.sms-bus.com', '/v1/rent/get/sms', {
        area_code: areaCode,
        mobile_number: mobileNumber,
      })
    },

    async listRentalSms(areaCode: string, mobileNumber: string, pageNum = 1, pageSize = 20) {
      return request<unknown>('https://api.sms-bus.com', '/v1/rent/list/sms', {
        area_code: areaCode,
        mobile_number: mobileNumber,
        page_num: pageNum,
        page_size: pageSize,
      })
    },
  }
}
