/**
 * @polaroid-vhs/agent-backup
 * Portable identity and memory backup for autonomous agents
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { join, resolve } from 'path';
import { homedir } from 'os';

/**
 * Backup format:
 * {
 *   version: "1.0",
 *   agent: { name, email, created, metadata },
 *   credentials: { encrypted: bool, data: {...} },
 *   memory: { files: [{path, content, updated}], ...],
 *   platforms: { agentcommons: {...}, openclaw: {...} }
 * }
 */

const BACKUP_VERSION = '1.0';
const ALGORITHM = 'aes-256-gcm';

export class AgentBackup {
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.encryption = options.encryption || false;
    this.password = options.password || null;
  }

  /**
   * Create a backup from current agent state
   */
  async export({ name, email, metadata = {}, credentialsPaths = [], memoryPaths = [] }) {
    const backup = {
      version: BACKUP_VERSION,
      exported: new Date().toISOString(),
      agent: {
        name,
        email,
        metadata,
        created: metadata.created || new Date().toISOString()
      },
      credentials: await this._collectCredentials(credentialsPaths),
      memory: await this._collectMemory(memoryPaths),
      platforms: {}
    };

    // Encrypt if password provided
    if (this.encryption && this.password) {
      backup.credentials = this._encrypt(backup.credentials);
      backup.memory = this._encrypt(backup.memory);
      backup.encrypted = true;
    }

    return backup;
  }

  /**
   * Import and restore a backup
   */
  async import(backup, { overwrite = false, targetDir = null } = {}) {
    if (backup.version !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${backup.version}`);
    }

    const dir = targetDir || this.workdir;

    // Decrypt if needed
    let credentials = backup.credentials;
    let memory = backup.memory;

    if (backup.encrypted) {
      if (!this.password) {
        throw new Error('Backup is encrypted but no password provided');
      }
      credentials = this._decrypt(credentials);
      memory = this._decrypt(memory);
    }

    // Restore credentials
    if (credentials.files) {
      for (const file of credentials.files) {
        const path = join(dir, file.path);
        if (!overwrite) {
          try {
            await readFile(path);
            console.warn(`Skipping existing file: ${file.path}`);
            continue;
          } catch {}
        }
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, file.content);
      }
    }

    // Restore memory
    if (memory.files) {
      for (const file of memory.files) {
        const path = join(dir, file.path);
        if (!overwrite) {
          try {
            await readFile(path);
            console.warn(`Skipping existing file: ${file.path}`);
            continue;
          } catch {}
        }
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, file.content);
      }
    }

    return {
      agent: backup.agent,
      restored: {
        credentials: credentials.files?.length || 0,
        memory: memory.files?.length || 0
      }
    };
  }

  /**
   * Collect credential files
   */
  async _collectCredentials(paths) {
    const files = [];
    for (const path of paths) {
      try {
        const fullPath = resolve(this.workdir, path);
        const content = await readFile(fullPath, 'utf8');
        files.push({
          path,
          content,
          updated: new Date().toISOString()
        });
      } catch (err) {
        console.warn(`Failed to read credential: ${path}`, err.message);
      }
    }
    return { files };
  }

  /**
   * Collect memory files
   */
  async _collectMemory(paths) {
    const files = [];
    for (const path of paths) {
      try {
        const fullPath = resolve(this.workdir, path);
        const content = await readFile(fullPath, 'utf8');
        files.push({
          path,
          content,
          updated: new Date().toISOString()
        });
      } catch (err) {
        console.warn(`Failed to read memory: ${path}`, err.message);
      }
    }
    return { files };
  }

  /**
   * Encrypt data with password
   */
  _encrypt(data) {
    const iv = randomBytes(16);
    const salt = randomBytes(32);
    const key = this._deriveKey(this.password, salt);
    
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();

    return {
      encrypted: true,
      algorithm: ALGORITHM,
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted.toString('hex')
    };
  }

  /**
   * Decrypt data with password
   */
  _decrypt(encrypted) {
    const key = this._deriveKey(this.password, Buffer.from(encrypted.salt, 'hex'));
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, 'hex')),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Derive encryption key from password
   */
  _deriveKey(password, salt) {
    return createHash('sha256')
      .update(password + salt.toString('hex'))
      .digest();
  }

  /**
   * Generate backup fingerprint (for verification)
   */
  static fingerprint(backup) {
    const data = JSON.stringify({
      agent: backup.agent,
      exported: backup.exported
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }
}

export default AgentBackup;
