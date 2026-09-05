import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const file=new URL('../verification/windows-public-first-use-20260905.json',import.meta.url);
const text=await fs.readFile(file,'utf8');
const receipt=JSON.parse(text);

test('public first-use receipt binds the released package and fixed request',()=>{
  assert.equal(receipt.schema,'aperture-public-verification/1');
  assert.equal(receipt.distribution.release,'v0.4.3');
  assert.equal(receipt.distribution.packageSha256,'0bf13b2fbebba34af5796ca80b72d8ad801adbf8360bdb5eb2e621fb5febaea8');
  assert.equal(receipt.request.artifactSha256,'74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db');
  assert.equal(receipt.request.contextPerSequence,2048);
  assert.equal(receipt.request.sequences,1);
  assert.equal(receipt.request.modelSubstitution,false);
  assert.equal(receipt.request.contextReduction,false);
});

test('public first-use receipt distinguishes estimate, execution and cleanup',()=>{
  assert.equal(receipt.observations.prefitCheckpointAcquired,false);
  assert.equal(receipt.observations.nativeFitBeforeFullWeightDownload,'FITS_ESTIMATE');
  assert.equal(receipt.observations.actualBackend,'cuda');
  assert.equal(receipt.observations.actualGpuLayers,25);
  assert.equal(receipt.observations.actualContext,2048);
  assert.equal(receipt.observations.oneAnswerCompleted,true);
  assert.equal(receipt.observations.twoTurnContextRetentionCompleted,true);
  assert.equal(receipt.observations.cleanChatExit,true);
  assert.equal(receipt.observations.ownedProcessesAfterExit,0);
});

test('public first-use receipt contains hashes, not private paths or prompts',()=>{
  assert.doesNotMatch(text,/[A-Z]:\\\\|GPU-[0-9a-f-]{20,}|ORCHID-742|L01 APERTURE PASS|Aperture-External-Seat/i);
  assert.equal(receipt.privateEvidence.pathsPromptsGpuUuidsPublished,false);
  assert.ok(receipt.privateEvidence.evidenceHashes.length>=7);
  for(const item of receipt.privateEvidence.evidenceHashes){
    assert.match(item.sha256,/^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>0);
    assert.equal(Object.hasOwn(item,'path'),false);
  }
});
