SMS-BUS Logo
OTP Activations
Rent Number
New
API
Help Center
Blog
Buy Tron Energy
New

English

Balance
$4.86
Temp Phone Number for Receive SMS Online. High Quality SMS Receive Service - SMS BUS
SMS-BUS Service API Documentation
Welcome to our API services. This documentation provides comprehensive API interface specifications, parameter details, and usage examples to help you quickly integrate our services into your applications.

OTP API
Rent API
SMS Verification API
Provides virtual phone numbers and receive SMS services, supporting multiple countries and regions worldwide.

Protocol Description

All requests should go to https://sms-bus.com/api/control

All requests must have an API Key as a parameter "token"

Search for country and service id

List service idShow

List country idShow

Affiliate Programs for Developers
You can get a commission on every spend when users use your program, all you need to do is sign up for an account and put you referral code on every request. Check out for more details.

Your software must be public so that everyone can buy or rent it.

Query balance
GET - https://sms-bus.com/api/control/get/balance?token=$token

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "frozen": 0,
    "balance": 2.52
  }
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
Get all countries
GET - https://sms-bus.com/api/control/list/countries?token=$token

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "1": {
      "id": 1,
      "title": "Unite State of America",
      "code": "us"
    },
    "2": {
      "id": 2,
      "title": "Russia",
      "code": "ru"
    }
  }
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
Get all projects
GET - https://sms-bus.com/api/control/list/projects?token=$token

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "1": {
      "id": 1,
      "title": "Telegram",
      "code": "tg"
    },
    "2": {
      "id": 2,
      "title": "Paypal",
      "code": "pp"
    }
  }
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
Check project prices and available numbers
GET - https://sms-bus.com/api/control/list/prices?token=$token&country_id=$country_id

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
country_id	query	Integer	Yes	Country
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "5": {
      "country_id": 5,
      "project_id": 2,
      "cost": 0.9,
      "total_count": 1023,
      "title": "United States of America",
      "code": "us"
    }
  }
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50001,
  "message": "No service available"
}
Get a number
GET - https://sms-bus.com/api/control/get/number?token=$token&country_id=$country_id&project_id=$project_id

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
country_id	query	Integer	Yes	Country
project_id	query	Integer	Yes	Service
reuse	query	Boolean	No	When true, only purchase reusable numbers. Since reactivate numbers may affect service quality, only support reuse number within 20 mins.
refer_id	query	String	No	Pass Referral ID
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "request_id": 124,
    "number": "17548003793"
  }
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50002,
  "message": "No number available"
}
{
  "code": 50104,
  "message": "The number of waiting requests exceeds the limit, please complete or cancel it and try again."
}
{
  "code": 50201,
  "message": "Balance not enough"
}
{
  "code": 50208,
  "message": "This account is not activated, please click the activation link in the mailbox to activate"
}
{
  "code": 50214,
  "message": "Your account is blocked from ordering this service for the next 24 hours: {blockTime}"
}
Get sms
GET - https://sms-bus.com/api/control/get/sms?token=$token&request_id=$request_id

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
request_id	query	String	Yes	Request Id
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": "429916"
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50101,
  "message": "Not received sms yet"
}
{
  "code": 50102,
  "message": "Number has been released or timeout, please reacquire"
}
Cancel a request
GET - https://sms-bus.com/api/control/cancel?token=$token&request_id=$request_id

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
request_id	query	String	Yes	Request Id
Result

Success

{
  "code": 200,
  "message": "Operation Success"
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50103,
  "message": "Can't change request status because the request has already closed."
}
Reuse number for certain project
Not every number can be reused. And this feature is only available if you have previously used the number to receive SMS from this service.

GET - https://sms-bus.com/api/control/reuse?token=$token&country_id=$country_id&project_id=$project_id&mobile_number=$mobile_number

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
country_id	query	Integer	Yes	Country
project_id	query	Integer	Yes	Service
mobile_number	query	String	Yes	Number without the + sign
refer_id	query	String	No	Pass Referral ID
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "request_id": 124,
    "number": "17548003793"
  }
}
Possible Errors

{
  "code": 400,
  "message": "Wrong token!"
}
{
  "code": 50001,
  "message": "No service available."
}
{
  "code": 50007,
  "message": "The number doesn't exist."
}
{
  "code": 50107,
  "message": "The number cannot be reused."
}
{
  "code": 50108,
  "message": "The number cannot be reused."
}
{
  "code": 50109,
  "message": "The number is expired."
}
{
  "code": 50201,
  "message": "Balance not enough"
}
{
  "code": 50208,
  "message": "This account is not activated, please click the activation link in the mailbox to activate"
}
Footer
SMS-BUS Logo
Contact:
Telegram
Email
Stripe
VISA
MasterCard
Alipay
BitCoin
USDT
Information
Blog
Contact
Service
Rent Number
Activation History
My Rental Numbers
Support
Help Center
API Document
Partners
legal
Privacy Policy
Payment Policy
Refund Policy
Terms & Conditions
© 2025 SMS-BUS. All rights reserved.



SMS-BUS Logo
OTP Activations
Rent Number
New
API
Help Center
Blog
Buy Tron Energy
New

English

Balance
$4.86
Temp Phone Number for Receive SMS Online. High Quality SMS Receive Service - SMS BUS
SMS-BUS Service API Documentation
Welcome to our API services. This documentation provides comprehensive API interface specifications, parameter details, and usage examples to help you quickly integrate our services into your applications.

OTP API
Rent API
Long-term Rental API
This API allows you to rent virtual phone numbers for long-term use, manage rentals, renew subscriptions, and receive SMS. All requests must include your API token for authentication.

Protocol Description

All requests should go to https://api.sms-bus.com

All requests must have an API Key as a parameter "token"

Get available rental areas
GET - https://api.sms-bus.com/v1/rent/list/area?token=$token

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": [
    {
      "area_code": "CA",
      "area_title": "Canada",
      "unit_price": 200,
      "min_month": 1,
      "total": 48
    },
    {
      "area_code": "GB",
      "area_title": "United Kingdom",
      "unit_price": 400,
      "min_month": 1,
      "total": 41
    },
    {
      "area_code": "US",
      "area_title": "United States of America",
      "unit_price": 200,
      "min_month": 1,
      "total": 184
    }
  ]
}
Field Description

area_code: Area code (e.g., US, CA, GB)
area_title: Area name
unit_price: Monthly price in cents
min_month: Minimum rental period in months
total: Available numbers count
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
Rent a number
GET - https://api.sms-bus.com/v1/rent/get/number?token=$token&area_code=$area_code&time=$time

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	Yes	Area code (e.g., US, CA, GB)
time	query	Integer	Yes	Rental period in months
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "order_id": "2667702625210000003",
    "mobile_number": "5143080170",
    "dialing_code": "1",
    "area_code": "CA",
    "expire_at": "2026-02-06T12:30:25Z",
    "keep_at": "2026-02-13T12:30:25Z"
  }
}
Field Description

order_id: Order ID
mobile_number: Rented phone number
dialing_code: Country dialing code
area_code: Area code
expire_at: Expiration date (ISO 8601 format)
keep_at: Number reservation end date (renewal must be done before this date)
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50004,
  "message": "Not enough numbers available, please try again later"
}
{
  "code": 50201,
  "message": "Balance not enough"
}
{
  "code": 50208,
  "message": "This account is not activated, please click the activation link in the mailbox to activate"
}
{
  "code": 50401,
  "message": "No available area found."
}
{
  "code": 50402,
  "message": "Minimum rent time are not met."
}
Renew a rented number
Renew subscription for a rented number. Note: Renewal must be completed before the keep_at date, after which renewal is no longer possible.

GET - https://api.sms-bus.com/v1/rent/renew/number?token=$token&area_code=$area_code&mobile_number=$mobile_number&time=$time

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	Yes	Area code
mobile_number	query	String	Yes	Phone number to renew
time	query	Integer	Yes	Renewal period in months
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "order_id": "2667702651210000003",
    "mobile_number": "5143080170",
    "dialing_code": "1",
    "area_code": "CA",
    "expire_at": "2026-03-06T12:30:25Z",
    "keep_at": "2026-03-13T12:30:25Z"
  }
}
Field Description

order_id: Order ID
mobile_number: Rented phone number
dialing_code: Country dialing code
area_code: Area code
expire_at: Expiration date (ISO 8601 format)
keep_at: Number reservation end date (renewal must be done before this date)
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50201,
  "message": "Balance not enough"
}
{
  "code": 50401,
  "message": "No available area found."
}
{
  "code": 50402,
  "message": "Minimum rental time are not met."
}
{
  "code": 50404,
  "message": "Unable to renew as the number has been released."
}
Cancel rental order
Cancel a rental order. Can only be cancelled within 20 minutes of ordering and only if no SMS has been received. Each number only can be cancelled 3 times. Warning: Excessive cancellations may result in account suspension.

GET - https://api.sms-bus.com/v1/rent/cancel/order?token=$token&order_id=$order_id

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
order_id	query	String	Yes	Order ID
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": "Cancel successful"
}
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 50005,
  "message": "Can't change order status because the order has already closed."
}
{
  "code": 50403,
  "message": "Unable to cancel the order as the SMS has been received."
}
{
  "code": 50405,
  "message": "Number has been canceled 3 times, can not continue to cancel the order"
}
List rented numbers
Retrieve all numbers currently rented by your account.

GET - https://api.sms-bus.com/v1/rent/list/number?token=$token&only_active=$only_active&page_num=$page_num&page_size=$page_size

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	No	Area code
mobile_number	query	String	No	Phone number
only_active	query	Boolean	No	Filter only active numbers (default: true)
page_num	query	Integer	No	Page number (default: 1)
page_size	query	Integer	No	Items per page (default: 10, max: 500)
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "page_num": 1,
    "page_size": 10,
    "total_page": 1,
    "total": 3,
    "list": [
      {
        "area_code": "US",
        "area_name": "United States of America",
        "dialing_code": "1",
        "mobile_number": "9302778494",
        "first_seen_at": "2024-12-15T01:59:49Z",
        "expire_at": "2025-04-15T01:59:49Z",
        "keep_at": "2025-04-22T01:59:49Z",
        "auto_renew": false,
        "sms_link": "https://sms.sms-bus.com/link/us/9302778494/iDdF",
        "allow_link": false
      }
    ]
  }
}
Field Description

area_code: Area code
area_name: Area name
dialing_code: Country dialing code
mobile_number: Phone number
first_seen_at: First rental date
expire_at: Expiration date
keep_at: Number reservation end date
auto_renew: Auto-renewal status
sms_link: Quick link to view latest SMS
allow_link: Whether link access is enabled
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
List rental orders
Retrieve rental order history.

GET - https://api.sms-bus.com/v1/rent/list/order?token=$token&only_active=$only_active&page_num=$page_num&page_size=$page_size

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	No	Area code
mobile_number	query	String	No	Phone number
page_num	query	Integer	No	Page number (default: 1)
page_size	query	Integer	No	Items per page (default: 10, max: 500)
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "page_num": 1,
    "page_size": 10,
    "total_page": 1,
    "total": 3,
    "list": [
      {
        "order_id": "2667702651210000003",
        "area_code": "CA",
        "area_name": "Canada",
        "dialing_code": "1",
        "mobile_number": "5143080170",
        "rent_month": 1,
        "amount": 200,
        "status": "CANCEL",
        "order_at": "2026-01-06T12:30:52Z",
        "begin_at": "2026-02-06T12:30:25Z",
        "expire_at": "2026-03-06T12:30:25Z",
        "keep_at": "2026-03-13T12:30:25Z"
      }
    ]
  }
}
Field Description

order_id: Order ID
area_code: Area code
area_name: Area name
dialing_code: Country dialing code
mobile_number: Phone number
rent_month: Rental period in months
amount: Price in cents
status: Order status (COMPLETED, CANCEL)
order_at: Order date
begin_at: Service start date
expire_at: Service end date
keep_at: Number reservation end date
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
Get latest SMS
Retrieve the most recent SMS message received on a rented number.

GET - https://api.sms-bus.com/v1/rent/get/sms?token=$token&area_code=$area_code&mobile_number=$mobile_number

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	Yes	Area code
mobile_number	query	String	Yes	Phone number
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "content": "Telegram code: 41529",
    "receive_at": "2025-02-15T08:19:34Z"
  }
}
Field Description

content: SMS message content
receive_at: Received Time (ISO 8601 format)
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 404,
  "message": "Number not found."
}
List SMS messages
Retrieve SMS message history for a rented number.

GET - https://api.sms-bus.com/v1/rent/list/sms?token=$token&area_code=$area_code&mobile_number=$mobile_number&page_num=$page_num&page_size=$page_size

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	Yes	Area code
mobile_number	query	String	Yes	Phone number
page_num	query	Integer	No	Page number (default: 1)
page_size	query	Integer	No	Items per page (default: 10, max: 500)
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": {
    "page_num": 1,
    "page_size": 10,
    "total_page": 1,
    "total": 3,
    "list": [
      {
        "content": "It expires in 15 minutes. We'll never call or text to request this code.",
        "receive_at": "2025-02-14T08:21:10Z"
      },
      {
        "content": "445088 is your OTP. Do not share it with anyone.",
        "receive_at": "2025-01-15T07:54:44Z"
      }
    ]
  }
}
Field Description

content: SMS message content
receive_at: Received Time (ISO 8601 format)
Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 404,
  "message": "Number not found."
}
Change SMS link status
Enable or disable public link access for viewing SMS messages on a rented number.

GET - https://api.sms-bus.com/v1/rent/change/link/status?token=$token&area_code=$area_code&mobile_number=$mobile_number&status=$status

Parameters

Field	Location	Type	Required	Description
token	query	String	Yes	Your API KEY
area_code	query	String	Yes	Area code
mobile_number	query	String	Yes	Phone number
status	query	Boolean	Yes	Enable (true) or disable (false) link
Result

Success

{
  "code": 200,
  "message": "Operation Success",
  "data": false
}
The response data field returns the updated link status (true = enabled, false = disabled).

Possible Errors

{
  "code": 401,
  "message": "Wrong token!"
}
{
  "code": 404,
  "message": "Number not found."
}
Footer
SMS-BUS Logo
Contact:
Telegram
Email
Stripe
VISA
MasterCard
Alipay
BitCoin
USDT
Information
Blog
Contact
Service
Rent Number
Activation History
My Rental Numbers
Support
Help Center
API Document
Partners
legal
Privacy Policy
Payment Policy
Refund Policy
Terms & Conditions
© 2025 SMS-BUS. All rights reserved.