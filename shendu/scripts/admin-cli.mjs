import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
const [command, output, password] = process.argv.slice(2);
const dataDir = resolve(process.env.SHENDU_DATA_DIR || './data');
const database = join(dataDir, 'shendu.db');
const masterKeyPath = resolve(process.env.SHENDU_MASTER_KEY_PATH || join(dataDir, 'backup-master.key'));

function usage() {
  console.log('创建整站加密快照：node scripts/admin-cli.mjs snapshot ./backups/site.shendu-db "强密码"');
  console.log('创建迁移包：      node scripts/admin-cli.mjs migration ./backups/site.shendu-migration "强密码"');
  console.log('恢复：            node scripts/admin-cli.mjs restore ./backups/site.shendu-db "强密码"');
  process.exit(1);
}
if (!['snapshot','migration','restore'].includes(command) || !output || !password || password.length < 15) usage();

function seal(payload, kind) {
  const salt=randomBytes(16),iv=randomBytes(12),key=pbkdf2Sync(password,salt,600000,32,'sha256');
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`shendu-${kind}-v1`));
  const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
  return Buffer.from(JSON.stringify({format:`shendu-${kind}-v1`,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));
}
function open(buffer) {
  const x=JSON.parse(buffer.toString('utf8'));if(!/^shendu-(snapshot|migration)-v1$/.test(x.format))throw new Error('不支持的整站备份格式');
  const key=pbkdf2Sync(password,Buffer.from(x.salt,'base64'),600000,32,'sha256'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));
  decipher.setAAD(Buffer.from(x.format));decipher.setAuthTag(Buffer.from(x.tag,'base64'));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(x.data,'base64')),decipher.final()])).toString('utf8'));
}

if (command === 'snapshot' || command === 'migration') {
  if (!existsSync(database)) throw new Error('找不到数据库，请先启动慎独');
  const temp=join(dataDir,`.snapshot-${process.pid}.db`);let snapshotDb;
  try {
    snapshotDb=new DatabaseSync(database);snapshotDb.exec(`VACUUM INTO '${temp.replaceAll("'","''")}'`);snapshotDb.close();snapshotDb=null;
    const persistedMasterKey=existsSync(masterKeyPath)?readFileSync(masterKeyPath,'utf8').trim():String(process.env.SHENDU_MASTER_KEY||'').trim();
    const payload={createdAt:new Date().toISOString(),schemaVersion:6,masterKey:persistedMasterKey,database:readFileSync(temp).toString('base64')};
    mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(resolve(output),seal(payload,command),{mode:0o600});try{chmodSync(resolve(output),0o600)}catch{}
    console.log(resolve(output));
  } finally {
    try{snapshotDb?.close()}catch{}try{if(existsSync(temp))unlinkSync(temp)}catch{}
  }
} else {
  const payload=open(readFileSync(resolve(output)));mkdirSync(dataDir,{recursive:true});
  const hadDatabase=existsSync(database);if(hadDatabase){copyFileSync(database,`${database}.before-restore`);try{chmodSync(`${database}.before-restore`,0o600)}catch{}}
  const temp=`${database}.incoming`;writeFileSync(temp,Buffer.from(payload.database,'base64'),{mode:0o600});
  const check=new DatabaseSync(temp);const integrity=check.prepare('PRAGMA integrity_check').get();if(Object.values(integrity||{})[0]!=='ok'){check.close();throw new Error('快照中的数据库完整性校验失败')}check.exec('DELETE FROM sessions');check.exec('UPDATE users SET session_version=session_version+1');check.close();
  renameSync(temp,database);
  if(/^[a-f0-9]{64}$/i.test(payload.masterKey||'')){mkdirSync(dirname(masterKeyPath),{recursive:true});writeFileSync(masterKeyPath,`${payload.masterKey}\n`,{mode:0o600});try{chmodSync(masterKeyPath,0o600)}catch{}}
  console.log('数据库与内部备份密钥已恢复。');
  if(hadDatabase)console.log(`旧数据库保留在：${database}.before-restore`);
}
