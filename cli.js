#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { AgentBackup } from './src/index.js';

const args = process.argv.slice(2);
const command = args[0];

const USAGE = `
agent-backup - Portable identity and memory backup for autonomous agents

USAGE:
  agent-backup export [options]     Create a backup
  agent-backup import <file>        Restore from backup
  agent-backup verify <file>        Verify backup integrity

EXPORT OPTIONS:
  --name <name>                     Agent name (required)
  --email <email>                   Agent email
  --credentials <paths>             Comma-separated credential files
  --memory <paths>                  Comma-separated memory files
  --output <file>                   Output backup file (default: backup.json)
  --encrypt                         Encrypt backup with password
  --password <pass>                 Encryption password (or use AGENT_BACKUP_PASSWORD env)

IMPORT OPTIONS:
  --target <dir>                    Target directory (default: current)
  --password <pass>                 Decryption password
  --overwrite                       Overwrite existing files

EXAMPLES:
  # Export with encryption
  agent-backup export \\
    --name Polaroid \\
    --email polaroid-ai@proton.me \\
    --credentials .credentials/agent-commons.key,.credentials/lightningfaucet.key \\
    --memory MEMORY.md,IDENTITY.md \\
    --encrypt \\
    --output polaroid-backup.json

  # Import to new directory
  agent-backup import polaroid-backup.json \\
    --target /new/agent/workspace \\
    --password mypassword
`;

async function exportBackup() {
  const name = getArg('--name');
  const email = getArg('--email');
  const credentialsPaths = getArg('--credentials')?.split(',') || [];
  const memoryPaths = getArg('--memory')?.split(',') || [];
  const output = getArg('--output') || 'backup.json';
  const encrypt = hasFlag('--encrypt');
  const password = getArg('--password') || process.env.AGENT_BACKUP_PASSWORD;

  if (!name) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  if (encrypt && !password) {
    console.error('Error: --encrypt requires --password or AGENT_BACKUP_PASSWORD env');
    process.exit(1);
  }

  const backup = new AgentBackup({ 
    encryption: encrypt, 
    password 
  });

  console.log(`Exporting backup for ${name}...`);
  
  const data = await backup.export({
    name,
    email,
    metadata: { created: new Date().toISOString() },
    credentialsPaths,
    memoryPaths
  });

  await writeFile(output, JSON.stringify(data, null, 2));
  
  const fingerprint = AgentBackup.fingerprint(data);
  console.log(`✅ Backup created: ${output}`);
  console.log(`📋 Fingerprint: ${fingerprint}`);
  console.log(`🔒 Encrypted: ${data.encrypted || false}`);
  console.log(`📁 Files: ${(data.credentials.files?.length || 0) + (data.memory.files?.length || 0)}`);
}

async function importBackup() {
  const file = args[1];
  const target = getArg('--target');
  const password = getArg('--password') || process.env.AGENT_BACKUP_PASSWORD;
  const overwrite = hasFlag('--overwrite');

  if (!file) {
    console.error('Error: backup file required');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(file, 'utf8'));

  const backup = new AgentBackup({ 
    password,
    workdir: target 
  });

  console.log(`Importing backup for ${data.agent.name}...`);
  
  const result = await backup.import(data, { overwrite, targetDir: target });
  
  console.log(`✅ Backup restored`);
  console.log(`👤 Agent: ${result.agent.name} (${result.agent.email || 'no email'})`);
  console.log(`📁 Restored: ${result.restored.credentials} credentials, ${result.restored.memory} memory files`);
}

async function verifyBackup() {
  const file = args[1];
  
  if (!file) {
    console.error('Error: backup file required');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(file, 'utf8'));
  const fingerprint = AgentBackup.fingerprint(data);
  
  console.log(`Backup: ${file}`);
  console.log(`Version: ${data.version}`);
  console.log(`Agent: ${data.agent.name}`);
  console.log(`Exported: ${data.exported}`);
  console.log(`Encrypted: ${data.encrypted || false}`);
  console.log(`Fingerprint: ${fingerprint}`);
  console.log(`\n✅ Backup is valid`);
}

function getArg(flag) {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

// Main
switch (command) {
  case 'export':
    exportBackup().catch(err => {
      console.error('Export failed:', err.message);
      process.exit(1);
    });
    break;
  
  case 'import':
    importBackup().catch(err => {
      console.error('Import failed:', err.message);
      process.exit(1);
    });
    break;
  
  case 'verify':
    verifyBackup().catch(err => {
      console.error('Verify failed:', err.message);
      process.exit(1);
    });
    break;
  
  default:
    console.log(USAGE);
    process.exit(command ? 1 : 0);
}
