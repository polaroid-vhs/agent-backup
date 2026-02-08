import { test } from 'node:test';
import assert from 'node:assert';
import { AgentBackup } from '../src/index.js';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEST_DIR = '/tmp/agent-backup-test';

test('AgentBackup - export without encryption', async () => {
  await mkdir(TEST_DIR, { recursive: true });
  
  // Create test files
  await writeFile(join(TEST_DIR, 'cred.key'), 'secret123');
  await writeFile(join(TEST_DIR, 'memory.md'), '# Memory\nTest content');

  const backup = new AgentBackup({ workdir: TEST_DIR });
  
  const data = await backup.export({
    name: 'TestAgent',
    email: 'test@example.com',
    credentialsPaths: ['cred.key'],
    memoryPaths: ['memory.md']
  });

  assert.strictEqual(data.version, '1.0');
  assert.strictEqual(data.agent.name, 'TestAgent');
  assert.strictEqual(data.agent.email, 'test@example.com');
  assert.strictEqual(data.credentials.files.length, 1);
  assert.strictEqual(data.memory.files.length, 1);
  assert.strictEqual(data.encrypted, undefined);

  await rm(TEST_DIR, { recursive: true, force: true });
});

test('AgentBackup - export with encryption', async () => {
  await mkdir(TEST_DIR, { recursive: true });
  
  await writeFile(join(TEST_DIR, 'secret.key'), 'supersecret');

  const backup = new AgentBackup({ 
    workdir: TEST_DIR,
    encryption: true,
    password: 'testpass123'
  });
  
  const data = await backup.export({
    name: 'TestAgent',
    email: 'test@example.com',
    credentialsPaths: ['secret.key'],
    memoryPaths: []
  });

  assert.strictEqual(data.encrypted, true);
  assert.strictEqual(data.credentials.encrypted, true);
  assert.ok(data.credentials.iv);
  assert.ok(data.credentials.salt);
  assert.ok(data.credentials.authTag);
  assert.ok(data.credentials.data);

  await rm(TEST_DIR, { recursive: true, force: true });
});

test('AgentBackup - import without encryption', async () => {
  const exportDir = join(TEST_DIR, 'export');
  const importDir = join(TEST_DIR, 'import');
  
  await mkdir(exportDir, { recursive: true });
  await mkdir(importDir, { recursive: true });
  
  await writeFile(join(exportDir, 'data.key'), 'mydata');
  await writeFile(join(exportDir, 'notes.md'), '# Notes\nImportant');

  // Export
  const exportBackup = new AgentBackup({ workdir: exportDir });
  const data = await exportBackup.export({
    name: 'TestAgent',
    credentialsPaths: ['data.key'],
    memoryPaths: ['notes.md']
  });

  // Import
  const importBackup = new AgentBackup({ workdir: importDir });
  const result = await importBackup.import(data);

  assert.strictEqual(result.agent.name, 'TestAgent');
  assert.strictEqual(result.restored.credentials, 1);
  assert.strictEqual(result.restored.memory, 1);

  // Verify files
  const restoredData = await readFile(join(importDir, 'data.key'), 'utf8');
  const restoredNotes = await readFile(join(importDir, 'notes.md'), 'utf8');
  
  assert.strictEqual(restoredData, 'mydata');
  assert.strictEqual(restoredNotes, '# Notes\nImportant');

  await rm(TEST_DIR, { recursive: true, force: true });
});

test('AgentBackup - import with encryption', async () => {
  const exportDir = join(TEST_DIR, 'export');
  const importDir = join(TEST_DIR, 'import');
  
  await mkdir(exportDir, { recursive: true });
  await mkdir(importDir, { recursive: true });
  
  await writeFile(join(exportDir, 'secret.key'), 'encrypted-data');

  // Export with encryption
  const exportBackup = new AgentBackup({ 
    workdir: exportDir,
    encryption: true,
    password: 'securepass'
  });
  
  const data = await exportBackup.export({
    name: 'SecureAgent',
    credentialsPaths: ['secret.key'],
    memoryPaths: []
  });

  assert.strictEqual(data.encrypted, true);

  // Import with decryption
  const importBackup = new AgentBackup({ 
    workdir: importDir,
    password: 'securepass'
  });
  
  const result = await importBackup.import(data);

  assert.strictEqual(result.agent.name, 'SecureAgent');
  assert.strictEqual(result.restored.credentials, 1);

  // Verify decrypted content
  const restored = await readFile(join(importDir, 'secret.key'), 'utf8');
  assert.strictEqual(restored, 'encrypted-data');

  await rm(TEST_DIR, { recursive: true, force: true });
});

test('AgentBackup - fingerprint generation', async () => {
  const backup1 = {
    version: '1.0',
    exported: '2026-02-08T02:00:00.000Z',
    agent: { name: 'Agent1', email: 'a@example.com' }
  };

  const backup2 = {
    version: '1.0',
    exported: '2026-02-08T02:00:00.000Z',
    agent: { name: 'Agent1', email: 'a@example.com' }
  };

  const backup3 = {
    version: '1.0',
    exported: '2026-02-08T03:00:00.000Z', // Different timestamp
    agent: { name: 'Agent1', email: 'a@example.com' }
  };

  const fp1 = AgentBackup.fingerprint(backup1);
  const fp2 = AgentBackup.fingerprint(backup2);
  const fp3 = AgentBackup.fingerprint(backup3);

  assert.strictEqual(fp1, fp2); // Same data = same fingerprint
  assert.notStrictEqual(fp1, fp3); // Different timestamp = different fingerprint
  assert.strictEqual(fp1.length, 16); // 16 hex chars
});

test('AgentBackup - overwrite protection', async () => {
  const importDir = join(TEST_DIR, 'import');
  await mkdir(importDir, { recursive: true });
  
  // Create existing file
  await writeFile(join(importDir, 'existing.md'), 'original content');

  const backup = {
    version: '1.0',
    exported: new Date().toISOString(),
    agent: { name: 'Test' },
    credentials: { files: [] },
    memory: {
      files: [{
        path: 'existing.md',
        content: 'new content',
        updated: new Date().toISOString()
      }]
    }
  };

  const importBackup = new AgentBackup({ workdir: importDir });
  
  // Import without overwrite (should skip)
  await importBackup.import(backup, { overwrite: false });
  
  const content1 = await readFile(join(importDir, 'existing.md'), 'utf8');
  assert.strictEqual(content1, 'original content'); // Unchanged

  // Import with overwrite
  await importBackup.import(backup, { overwrite: true });
  
  const content2 = await readFile(join(importDir, 'existing.md'), 'utf8');
  assert.strictEqual(content2, 'new content'); // Overwritten

  await rm(TEST_DIR, { recursive: true, force: true });
});
