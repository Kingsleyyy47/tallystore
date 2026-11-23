import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
let auth;
const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync('src/components/SimpleProtectedRoute.tsx','utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
  module,exports:module.exports,require(name){
    if(name==='@/contexts/SimpleAuth')return {useAuth:()=>auth};
    if(name==='react-router-dom')return {Navigate:({to})=>React.createElement('span',{'data-redirect':to})};
    if(name==='@/components/ui/button')return {Button:({children})=>React.createElement('button',null,children)};
    return require(name);
  },
});
const {ProtectedRoute,PublicRoute}=module.exports;
const render=(props={})=>renderToStaticMarkup(React.createElement(ProtectedRoute,{requireRole:'user',children:React.createElement('p',null,'Storefront'),...props}));
auth={user:{id:'admin'},loading:false,isAdmin:true,isStaff:false};assert.match(render(),/Storefront/);assert.doesNotMatch(render(),/data-redirect/);
auth={...auth,isStaff:true};assert.match(render(),/Storefront/);assert.doesNotMatch(render(),/data-redirect/);auth={...auth,isStaff:false};
auth={...auth,isAdmin:false};assert.match(render(),/Storefront/);assert.match(render({requireRole:'admin'}),/data-redirect="\/dashboard"/);
auth={...auth,isStaff:true};assert.match(render(),/data-redirect="\/staff-admin"/);assert.match(render({requireRole:'admin'}),/data-redirect="\/staff-admin"/);
auth={...auth,user:null};assert.match(render(),/data-redirect="\/login"/);
auth={user:{id:'admin'},loading:false,isAdmin:true,isStaff:false,roleLookupError:'Role lookup failed',retryRoleLookup:async()=>{}};assert.match(render(),/Role lookup failed/);assert.doesNotMatch(render(),/Storefront/);
auth={...auth,roleLookupError:null};assert.match(renderToStaticMarkup(React.createElement(PublicRoute,{children:'Login'})),/data-redirect="\/admin"/);
console.log('Actual route guard: admins can browse customer pages; login, role lookup and staff/admin authorization restrictions remain enforced.');
