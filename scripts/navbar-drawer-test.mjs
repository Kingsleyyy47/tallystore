import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const lockExports = {}
vm.runInNewContext(compile('src/lib/navbarScrollLock.ts'), { exports: lockExports })

for (const [x, y] of [[0, 0], [0, 1600], [45, 9300]]) {
  const before = { position: 'relative', top: '2px', left: '3px', width: '96%', overflow: 'hidden' }
  const document = { body: { style: { ...before } }, documentElement: { style: { scrollBehavior: 'smooth' } } }
  const scrollCalls = []
  const window = { scrollX: x, scrollY: y, scrollTo: (...args) => {
    assert.equal(document.documentElement.style.scrollBehavior, 'auto')
    assert.deepEqual(document.body.style, before)
    scrollCalls.push(args)
  } }
  const unlock = lockExports.lockNavbarScroll(document, window)
  assert.equal(document.body.style.position, 'fixed')
  assert.equal(document.body.style.top, `${-y}px`)
  assert.equal(document.body.style.left, `${-x}px`)
  assert.equal(document.body.style.overflow, 'hidden', 'Do not interfere with the dialog overflow lock')
  window.scrollY = 0
  unlock()
  unlock()
  assert.deepEqual(scrollCalls, [[x, y]], 'Restore the captured position once, even after the fixed body reports zero scroll')
  assert.equal(document.documentElement.style.scrollBehavior, 'smooth')
}

const pass = tag => ({ children, className, disabled, ...props }) => React.createElement(tag, { className, disabled, ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}) }, children)
const fragments = ({ children }) => React.createElement(React.Fragment, null, children)
const dialog = {
  Root: fragments, Trigger: fragments, Close: fragments,
  Portal: ({ children }) => React.createElement('aside', { 'data-viewport-portal': true }, children),
  Overlay: pass('div'), Content: pass('section'), Title: pass('h2'), Description: pass('p'),
}
const dropdown = {
  DropdownMenu: fragments, DropdownMenuTrigger: fragments, DropdownMenuContent: pass('section'),
  DropdownMenuItem: ({ children, disabled }) => disabled
    ? React.createElement('button', { disabled }, children) : React.createElement(React.Fragment, null, children),
  DropdownMenuLabel: pass('h3'), DropdownMenuSeparator: () => React.createElement('hr'),
}
let pathname = '/products'
const routes = {
  useLocation: () => ({ pathname }),
  Link: ({ to, children, className }) => React.createElement('a', { href: to, className }, children),
  NavLink: ({ to, children, className }) => {
    const state = { isActive: to === pathname }
    return React.createElement('a', { href: to, className: typeof className === 'function' ? className(state) : className },
      typeof children === 'function' ? children(state) : children)
  },
}
let auth
let effects
function renderNavbar(overrides = {}, pagePath = '/products') {
  pathname = pagePath
  auth = {
    user: { id: 'test-user' }, loading: false, roleLookupError: null, accountSuspended: false,
    isAdmin: false, isStaff: false, walletBalance: 75, walletLoading: false,
    walletBalanceUnavailable: false, showBalances: true, ...overrides,
  }
  effects = []
  let state = 0
  const exports = {}
  vm.runInNewContext(compile('src/components/NavbarAuth.tsx'), { exports, require: name => {
    if (name === 'react') return {
      ...React, useState: initial => [++state === 2 ? true : initial, () => {}],
      useEffect: callback => { effects.push(callback) }, useLayoutEffect: callback => { effects.push(callback) },
    }
    if (name === '@radix-ui/react-dialog') return dialog
    if (name === 'react-router-dom') return routes
    if (name === '@/components/ui/dropdown-menu') return dropdown
    if (name === '@/components/ui/button') return { Button: pass('button') }
    if (name === '@/components/ThemeToggle') return { ThemeToggle: () => null }
    if (name === '@/components/InstallAppDialog') return { default: () => null }
    if (name === '@/contexts/SimpleAuth') return { useAuth: () => auth }
    if (name === '@/contexts/CurrencyContext') return { useCurrency: () => ({ currency: 'NGN', toggleCurrency: () => {}, formatPrice: n => `NGN ${n}` }) }
    if (name === '@/hooks/usePWAInstall') return { usePWAInstall: () => ({ isInstalled: true }) }
    if (name === '@/hooks/use-toast') return { useToast: () => ({ toast: () => {} }) }
    if (name === '@/lib/navbarScrollLock') return lockExports
    return require(name)
  } })
  return renderToStaticMarkup(React.createElement(exports.default))
}

const markup = renderNavbar()
assert.ok(markup.indexOf('</nav>') < markup.indexOf('data-viewport-portal'), 'Drawer portal is outside the transformed navigation')
const drawer = markup.slice(markup.indexOf('data-viewport-portal'))
const expectedRoutes = ['/dashboard', '/products', '/us-canada', '/social-boost', '/telegram-stars', '/travel-visa', '/support']
assert.deepEqual([...drawer.matchAll(/href="([^"]+)"/g)].map(match => match[1]), expectedRoutes)
assert.match(drawer, /disabled=""[^>]*>[\s\S]*Tally Circle[\s\S]*Coming soon/)
assert.match(drawer, /h-\[100dvh\]/)
assert.match(drawer, /min-h-0 flex-1 overflow-y-auto/)
assert.match(drawer, /safe-area-inset-bottom/)
assert.match(markup, /href="\/wallet"/)
assert.match(markup, /href="\/orders"/)
assert.match(markup, /href="\/profile"/)
assert.match(markup, /<button disabled="">[\s\S]*API Access[\s\S]*Coming soon/)
assert.doesNotMatch(markup, /href="\/(?:bills|referrals|developer-api|admin|staff-admin)"/)
assert.match(renderNavbar({ isAdmin: true }), /href="\/admin"/)
assert.match(renderNavbar({ isStaff: true }), /href="\/staff-admin"/)
for (const guard of [{ loading: true }, { roleLookupError: 'unverified' }, { accountSuspended: true }, { user: null }]) {
  assert.doesNotMatch(renderNavbar({ isAdmin: true, isStaff: true, ...guard }), /href="\/(?:admin|staff-admin)"/)
}
assert.doesNotMatch(renderNavbar({ showBalances: false }), /NGN 75/)
assert.match(renderNavbar({ walletBalanceUnavailable: true }), /Unavailable/)
assert.match(renderNavbar({ user: null }), /href="\/login"/)
assert.match(renderNavbar({ user: null }), /href="\/"/)
for (const path of ['/products','/product/synthetic','/category/synthetic','/checkout']) {
  assert.equal((renderNavbar({},path).match(/src="\/TALLYAPPLOGO.png"/g) || []).length,1)
  assert.match(renderNavbar({},path),/data-selected-menu-marker="Products"/)
}
for (const [path,label] of [['/dashboard','Home'],['/us-canada','US &amp; Canada (SMS)'],['/telegram-stars','Telegram'],['/travel-visa','Travel &amp; Visa'],['/support','Help Centre']]) {
  const result=renderNavbar({},path)
  assert.equal((result.match(/src="\/TALLYAPPLOGO.png"/g) || []).length,1,'Only the selected row has a marker')
  assert.ok(result.includes(`data-selected-menu-marker="${label}"`))
}
for (const path of ['/wallet','/orders']) {
  assert.doesNotMatch(renderNavbar({},path),/src="\/TALLYAPPLOGO.png"/,
    'Unselected navigation must keep its standard icons')
}
console.log('Navbar drawer checks passed: scrolled viewport locking/restoration, routes, disabled choices, account controls, and verified workspace gates.')
