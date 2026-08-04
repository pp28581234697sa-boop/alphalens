import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from '../lib/jwt.js';
import express from '../lib/mini-express.js';

test('JWT sign and verify round trip',()=>{const token=jwt.sign({sub:'u1'},'a-very-long-test-secret',{expiresIn:'1h',issuer:'alphalens'});const body=jwt.verify(token,'a-very-long-test-secret',{issuer:'alphalens'});assert.equal(body.sub,'u1')});
test('JWT rejects a modified token',()=>{const token=jwt.sign({sub:'u1'},'secret-secret-secret'),parts=token.split('.'),sig=parts[2],replacement=sig[0]==='a'?'b':'a';parts[2]=replacement+sig.slice(1);assert.throws(()=>jwt.verify(parts.join('.'),'secret-secret-secret'))});
test('mini express exposes expected server methods',()=>{const app=express();for(const method of ['use','get','post','delete','listen'])assert.equal(typeof app[method],'function')});
